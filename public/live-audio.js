// Živý přepis řeči: mikrofon → AudioWorklet → PCM → samostatně dekódovatelné WAV snímky
// → /api/stt (server ho přepošle na Whisper službu). Navíc hlásí úroveň hlasu (pro animaci),
// odhad ruchu v místnosti a pauzu v řeči (pro automatické odeslání).
//
// Proč PCM a ne MediaRecorder: druhý a další kus WebM nemá hlavičky, takže ho nejde
// přepsat samostatně. Každý snímek tady je kompletní WAV.

export function wav(samples, rate) {
  const bytes = new ArrayBuffer(44 + samples.length * 2), v = new DataView(bytes);
  const s = (at, t) => { for (let i = 0; i < t.length; i++) v.setUint8(at + i, t.charCodeAt(i)); };
  s(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); s(8, 'WAVE'); s(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  s(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), true);
  return new Blob([bytes], { type: 'audio/wav' });
}

// Spojí přepisy úseků; u úseků s překryvem odstraní shodná slova na švu (max 12).
const norm = w => w.toLocaleLowerCase('cs').replace(/[^\p{L}\p{N}]/gu, '');
export function joinTranscript(items) {
  const words = [];
  for (const item of items) {
    const next = item.text.trim().split(/\s+/).filter(Boolean);
    let overlap = 0;
    if (item.overlap) {
      for (let n = 1; n <= Math.min(12, words.length, next.length); n++) {
        if (words.slice(-n).every((w, i) => norm(w) === norm(next[i]))) overlap = n;
      }
    }
    words.push(...next.slice(overlap));
  }
  return words.join(' ');
}

// AbortSignal.any je až v novějších prohlížečích (Chrome 116, Safari 17.4).
function anySignal(signals) {
  if (AbortSignal.any) return AbortSignal.any(signals);
  const c = new AbortController();
  for (const s of signals) { if (s.aborted) { c.abort(); break; } s.addEventListener('abort', () => c.abort(), { once: true }); }
  return c.signal;
}
const timeoutSignal = ms => (AbortSignal.timeout ? AbortSignal.timeout(ms) : (() => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; })());

export class LiveTranscriber {
  constructor({ onText = () => {}, onState = () => {}, onLevel = () => {}, onPause = () => {},
    endpoint = 'api/stt?live=1', rate = 16000, pauseSeconds = 2.2 } = {}) {
    Object.assign(this, { onText, onState, onLevel, onPause, endpoint, rate, pauseSeconds });
    this.segments = []; this.current = null;
    this.pre = []; this.preSize = 0;          // ~0,24 s před začátkem řeči, aby se neukrojilo první slovo
    this.elapsed = 0; this.lastSpeechAt = 0; this.speechSeconds = 0;
    this.noise = 0.002;                         // adaptivní odhad okolního šumu (RMS)
    this.pending = null; this.cancelled = false; this.closed = false; this.paused = false;
    this.controller = new AbortController();
  }

  startTimer() { this.timer = setInterval(() => this.pump().catch(() => {}), 1700); }

  feed(samples) {
    if (this.closed || this.cancelled) return;
    const dt = samples.length / this.rate;
    this.elapsed += dt;
    let sum = 0; for (const x of samples) sum += x * x;
    const rms = Math.sqrt(sum / samples.length);
    const threshold = Math.max(0.007, Math.min(0.026, this.noise * 3));
    const speech = rms > threshold;
    this.onLevel(Math.min(1, rms / (threshold * 4)), speech);
    if (speech) { this.lastSpeechAt = this.elapsed; this.speechSeconds += dt; this.paused = false; }
    if (!speech && !this.current) this.noise = this.noise * 0.98 + rms * 0.02;

    // pauza po řeči (pro režim „odeslat po pauze“): ≥ 0,2 s řeči a pak pauseSeconds ticha
    if (!this.paused && this.speechSeconds >= 0.2 && this.elapsed - this.lastSpeechAt >= this.pauseSeconds) {
      this.paused = true; this.onPause();
    }

    if (!this.current) {
      if (!speech) {
        this.pre.push(samples); this.preSize += samples.length;
        while (this.preSize > this.rate * 0.24 && this.pre.length > 1) this.preSize -= this.pre.shift().length;
        return;
      }
      this.current = { chunks: [...this.pre], count: this.preSize, silence: 0, text: '', sent: 0, final: false, done: false, overlap: false };
      this.pre = []; this.preSize = 0;
      this.segments.push(this.current);
    }
    const seg = this.current;
    seg.chunks.push(samples); seg.count += samples.length;
    seg.silence = speech ? 0 : seg.silence + dt;
    if (seg.silence >= 0.85) {
      // úsek je dokončený (to ještě neznamená odeslání zprávy)
      seg.final = true; this.current = null; this.pump().catch(() => {});
    } else if (seg.count >= this.rate * 24) {
      // souvislá řeč: rozdělit po 24 s s 0,55 s překryvem
      seg.final = true;
      const tail = this.samples(seg).slice(-Math.floor(this.rate * 0.55));
      this.current = { chunks: [tail], count: tail.length, silence: 0, text: '', sent: 0, final: false, done: false, overlap: true };
      this.segments.push(this.current);
      this.pump().catch(() => {});
    }
  }

  samples(seg) {
    const out = new Float32Array(seg.count); let at = 0;
    for (const p of seg.chunks) { out.set(p, at); at += p.length; }
    return out;
  }

  publish() { this.onText(joinTranscript(this.segments), { partial: this.segments.some(s => !s.done), seconds: this.elapsed }); }

  // Nejvýš jeden HTTP přepis najednou; průběžný snímek jen když přibylo ≥ 1,45 s zvuku.
  async pump() {
    if (this.pending) return this.pending;
    if (this.cancelled) return;
    const seg = this.segments.find(s => !s.done && (s.final || s.count - s.sent >= this.rate * 1.45));
    if (!seg) return;
    const final = seg.final, snapshot = this.samples(seg);
    seg.sent = snapshot.length;
    this.pending = (async () => {
      let last;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await fetch(this.endpoint + (final ? '&final=1' : ''), {
            method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav(snapshot, this.rate),
            signal: anySignal([this.controller.signal, timeoutSignal(45000)]),
          });
          let d; try { d = await r.json(); } catch { throw Error('Přepis dočasně neodpovídá.'); }
          if (!r.ok) { const e = Error(d.error || d.detail || 'Přepis selhal.'); e.retry = r.status === 429 || r.status >= 500; throw e; }
          if (this.cancelled) return;
          seg.text = d.text || '';
          if (final) { seg.done = true; seg.chunks = []; }
          this.publish();
          return;
        } catch (e) {
          last = e;
          if (this.cancelled) return;
          if (attempt < 2 && (e.retry || e.name === 'TimeoutError' || e.name === 'AbortError' || e instanceof TypeError)) {
            this.onState('Čekám na přepis…');
            await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
          } else break;
        }
      }
      if (last) { seg.sent = 0; this.onState(last.message, true); throw last; }
    })();
    try { await this.pending; } finally { this.pending = null; }
  }

  async finish() {
    this.closed = true; clearInterval(this.timer);
    if (this.current) { this.current.final = true; this.current = null; }
    if (this.pending) await this.pending.catch(() => {});
    while (this.segments.some(s => !s.done)) await this.pump();
    return joinTranscript(this.segments);
  }

  cancel() {
    this.cancelled = true; this.closed = true; clearInterval(this.timer);
    this.controller.abort(); this.segments = []; this.pre = [];
  }

  // Hrubý popis prostředí pro Verity („slyším, že je u tebe hluk“).
  ambience() { return this.noise < 0.004 ? 'ticho' : this.noise < 0.012 ? 'mírný ruch' : 'hluk'; }
}

export async function startMicrophone(options = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  let context;
  try {
    context = new AudioContext({ sampleRate: 16000 });
    await context.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url));
    await context.resume();
    const input = context.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(context, 'pcm-capture');
    const mute = context.createGain(); mute.gain.value = 0;   // mikrofon se nepřehrává zpět
    input.connect(capture); capture.connect(mute); mute.connect(context.destination);
    const engine = new LiveTranscriber({ ...options, rate: context.sampleRate });   // skutečná frekvence, ne požadovaná
    let flushDone;
    capture.port.onmessage = e => { if (e.data?.flushed) { flushDone?.(); return; } engine.feed(new Float32Array(e.data)); };
    engine.startTimer();
    let ended = false;
    const stop = async (cancel = false) => {
      if (ended) return '';
      ended = true;
      await new Promise(resolve => {
        const t = setTimeout(resolve, 500);
        flushDone = () => { clearTimeout(t); resolve(); };
        capture.port.postMessage('flush');
      });
      stream.getTracks().forEach(t => t.stop());
      input.disconnect(); capture.disconnect(); mute.disconnect();
      await context.close();
      if (cancel) { engine.cancel(); return ''; }
      return engine.finish();
    };
    return { stop, cancel: () => { engine.cancel(); return stop(true); }, engine };
  } catch (e) {
    stream.getTracks().forEach(t => t.stop());
    await context?.close();
    throw e;
  }
}
