// Živý přepis řeči: mikrofon → AudioWorklet → PCM → samostatně dekódovatelné WAV snímky
// → /api/stt (Whisper large-v3-turbo na Windows stroji). Převzato z projektu Katrína Latrína
// a rozšířeno o úroveň hlasu (pro animaci), odhad ruchu v místnosti, detekci pauzy
// a neuronovou detekci řeči Silero VAD (vad.js).
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

// Zesílí úsek na špičku ~ −3 dBFS (max 30×) ještě ve float – tichý mikrofon by po převodu
// do 16 bitů měl jen pár bitů rozlišení a Whisper by z něj rozpoznal méně.
function normalize(samples) {
  let peak = 0; for (const x of samples) peak = Math.max(peak, Math.abs(x));
  const gain = peak > 0 ? Math.min(30, 0.7 / peak) : 1;
  return gain === 1 ? samples : samples.map(x => x * gain);
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
    endpoint = 'api/stt?live=1', rate = 16000, pauseSeconds = 2.2, snapshotMs = 1700, snapshotSeconds = 1.45,
    getThreshold = () => null, suppressInput = () => false } = {}) {
    Object.assign(this, { onText, onState, onLevel, onPause, endpoint, rate, pauseSeconds, snapshotMs, snapshotSeconds, getThreshold, suppressInput });
    this.segments = []; this.current = null;
    this.pre = []; this.preSize = 0;          // ~0,35 s (se Silero 0,8 s – ohlásí řeč o 0,2–0,4 s později) před začátkem řeči, aby se neukrojilo první slovo
    this.elapsed = 0; this.lastSpeechAt = 0; this.speechSeconds = 0;
    // VAD v decibelech s hysterezí (viz feed); hodnoty v dBFS
    this.noiseDb = -60;                         // odhad šumu pozadí (rychle dolů, pomalu nahoru)
    this.peakDb = -120;                         // nejhlasitější blok – pro hlášku „mikrofon nic nezachytává“
    this.speaking = false; this.onTime = 0; this.quiet = 0;
    this.vad = null; this.prob = 0;             // Silero VAD, jakmile se načte (jinak jen decibely)
    this.pending = null; this.cancelled = false; this.closed = false; this.paused = false; this.warned = false;
    this.controller = new AbortController();
    this.inputSuppressed = false; this.inputRevision = 0; this.vadNeedsReset = false;
  }

  startTimer() { this.timer = setInterval(() => this.pump().catch(() => {}), this.snapshotMs); }

  // Detekce řeči (VAD):
  //  - úroveň bloku v dBFS, šum pozadí se průběžně měří jen mimo řeč;
  //  - řeč ZAČNE, když je úroveň ≥ 9 dB nad šumem aspoň 0,1 s (min. −64 dBFS);
  //  - řeč SKONČÍ, když je úroveň < 5 dB nad šumem déle než 0,8 s (hystereze → úsek se neseká
  //    při každém poklesu hlasitosti uprostřed věty);
  //  - celý úsek od začátku do konce řeči (+ 0,35 s předtím) je jedna promluva; kratší než
  //    0,3 s znělé řeči (klik, kašel) se zahodí a vůbec se neposílá.
  // Se Silero VAD rozhoduje o řeči neuronová síť místo decibelů: řeč ZAČNE při pravděpodobnosti
  // ≥ 0,5 a trvá, dokud neklesne pod 0,35 na déle než 0,8 s. Decibely dál měří šum a úroveň pro
  // ukazatel. Když síť selže, vrátí se to samo k decibelům.
  // Zablokování reproduktoru musí vymazat i pre-roll a zahodit pozdní STT odpověď.
  suppress() {
    if (this.inputSuppressed || this.closed || this.cancelled) return;
    this.inputSuppressed = true; this.inputRevision++;
    this.controller.abort(); this.controller = new AbortController();
    this.segments = []; this.current = null; this.pre = []; this.preSize = 0;
    this.speaking = false; this.onTime = 0; this.quiet = 0; this.prob = 0;
    this.speechSeconds = 0; this.paused = true; this.recent = [];
    this.vadNeedsReset = true;
    this.publish();
  }

  async feed(samples, capturedSuppressed = false) {
    if (this.closed || this.cancelled) return;
    const dt = samples.length / this.rate;
    this.elapsed += dt;
    let sum = 0; for (const x of samples) sum += x * x;
    const db = 10 * Math.log10(sum / samples.length + 1e-12);
    const requested = this.getThreshold();
    const threshold = Number.isFinite(requested) ? Math.max(-70, Math.min(-10, requested)) : null;
    const onDb = threshold ?? Math.max(this.noiseDb + 9, -64);
    const offDb = threshold != null ? onDb - 4 : Math.max(this.noiseDb + 5, -68);
    const blocked = () => capturedSuppressed || this.suppressInput();
    const reportBlocked = () => {
      this.suppress();
      this.onLevel({ db, noiseDb: this.noiseDb, onDb, offDb, speaking: false, voiced: false,
        elapsed: this.elapsed, lastSpeechAt: this.lastSpeechAt, speechSeconds: 0, dt,
        neural: !!this.vad, prob: null, level: 0, suppressed: true });
    };
    if (blocked()) { reportBlocked(); return; }
    this.inputSuppressed = false;
    if (this.vadNeedsReset && this.vad) {
      this.vadNeedsReset = false;
      try { await this.vad.reset(); } catch { this.vad = null; }
      if (this.closed || this.cancelled) return;
      if (blocked()) { reportBlocked(); return; }
    }
    const revision = this.inputRevision;
    const vad = this.vad;
    let probs = null;
    if (vad) {
      try { probs = await vad.process(samples); }
      catch (e) { console.warn('Silero VAD selhal, jedu podle hlasitosti:', e); if (this.vad === vad) this.vad = null; }
      if (this.closed || this.cancelled) return;
    }
    if (blocked() || revision !== this.inputRevision) { reportBlocked(); return; }
    if (probs?.length) this.prob = probs.reduce((a, b) => a + b, 0) / probs.length;
    this.peakDb = Math.max(this.peakDb, db);
    const calibrating = this.elapsed < 0.5;     // prvních 0,5 s jen měří šum místnosti
    if (!this.speaking) {
      // šum: rychle dolů, pomalu nahoru (řeč ho tak nevytáhne nahoru)
      const k = calibrating ? 0.5 : db < this.noiseDb ? 0.3 : 0.02;
      this.noiseDb = Math.max(-90, Math.min(-25, this.noiseDb + (db - this.noiseDb) * k));
    }
    // minimum za poslední ~2 s: řeč má mezi slovy mezery, stálý hluk (ventilátor) ne
    (this.recent ||= []).push([this.elapsed, db]);
    while (this.recent[0][0] < this.elapsed - 2) this.recent.shift();
    if (this.speaking && this.elapsed - this.speechStart > 6) {
      const floor = Math.min(...this.recent.map(r => r[1]));
      if (floor > this.noiseDb + 9) { this.noiseDb = floor - 3; }   // šum se zvedl → přeměřit
    }
    const neural = !!probs;
    const voiced = neural ? this.prob >= 0.35 && (threshold == null || db >= offDb) : db > offDb;
    const starts = neural ? this.prob >= 0.5 && db >= (threshold ?? -75) : !calibrating && db > onDb;

    if (!this.speaking) {
      this.onTime = starts ? this.onTime + dt : 0;
      if (this.onTime >= 0.1) { this.speaking = true; this.quiet = 0; this.speechStart = this.elapsed; }
    } else {
      this.quiet = voiced ? 0 : this.quiet + dt;
      if (this.quiet >= 0.8) this.speaking = false;
    }
    if (this.speaking && voiced) { this.lastSpeechAt = this.elapsed; this.speechSeconds += dt; this.paused = false; }
    this.onLevel({ db, noiseDb: this.noiseDb, onDb, offDb, speaking: this.speaking, voiced, elapsed: this.elapsed, lastSpeechAt: this.lastSpeechAt, speechSeconds: this.speechSeconds, dt,
      neural, prob: neural ? this.prob : null,
      level: Math.max(0, Math.min(1, (db - this.noiseDb) / 30)) });

    if (!this.warned && this.elapsed > 3 && this.peakDb < -75) {
      this.warned = true;
      this.onState('Mikrofon nic nezachytává – zkontroluj, jestli je v prohlížeči vybraný ten správný.', true);
    }

    // pauza po řeči (pro režim „odeslat po pauze“): ≥ 0,3 s řeči a pak pauseSeconds ticha
    if (!this.paused && !this.speaking && this.speechSeconds >= 0.3 && this.elapsed - this.lastSpeechAt >= this.pauseSeconds) {
      this.paused = true; this.onPause();
    }

    if (!this.current) {
      if (!this.speaking) {
        this.pre.push(samples); this.preSize += samples.length;
        while (this.preSize > this.rate * (neural ? 0.8 : 0.35) && this.pre.length > 1) this.preSize -= this.pre.shift().length;
        return;
      }
      this.current = { chunks: [...this.pre], count: this.preSize, voiced: 0, text: '', sent: 0, final: false, done: false, overlap: false };
      this.pre = []; this.preSize = 0;
      this.segments.push(this.current);
    }
    const seg = this.current;
    seg.chunks.push(samples); seg.count += samples.length;
    if (voiced) seg.voiced += dt;
    if (!this.speaking) {
      // konec promluvy podle VAD → odeslat celý úsek k závěrečnému přepisu
      this.current = null;
      if (seg.voiced < 0.3 && !seg.text) { this.segments.splice(this.segments.indexOf(seg), 1); return; }
      seg.final = true; this.pump().catch(() => {});
    } else if (seg.count >= this.rate * 24) {
      // souvislá řeč: rozdělit po 24 s s 0,55 s překryvem
      seg.final = true;
      const tail = this.samples(seg).slice(-Math.floor(this.rate * 0.55));
      this.current = { chunks: [tail], count: tail.length, voiced: 0, text: '', sent: 0, final: false, done: false, overlap: true };
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
    const seg = this.segments.find(s => !s.done && (s.final || s.count - s.sent >= this.rate * this.snapshotSeconds));
    if (!seg) return;
    const final = seg.final, snapshot = this.samples(seg);
    const revision = this.inputRevision, requestSignal = this.controller.signal;
    seg.sent = snapshot.length;
    this.pending = (async () => {
      let last;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          // vad/in jen pro diagnostiku na serveru (Whisper je nedostane)
          const r = await fetch(this.endpoint + (final ? '&final=1' : '') + `&vad=${this.vad ? 1 : 0}&in=${this.inputRate || this.rate}`, {
            method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav(normalize(snapshot), this.rate),
            signal: anySignal([requestSignal, timeoutSignal(45000)]),
          });
          let d; try { d = await r.json(); } catch { throw Error('Přepis dočasně neodpovídá.'); }
          if (!r.ok) { const e = Error(d.error || d.detail || 'Přepis selhal.'); e.retry = r.status === 429 || r.status >= 500; throw e; }
          if (this.cancelled || revision !== this.inputRevision) return;
          if (d.debug_saved === false) this.onState('Přepis funguje, ale testovací nahrávka se neuložila (disk nebo limit archivu).', true);
          seg.text = d.text || '';
          if (final) { seg.done = true; seg.chunks = []; }
          this.publish();
          return;
        } catch (e) {
          last = e;
          if (this.cancelled || revision !== this.inputRevision) return;
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

  // Vybere jen hotovou promluvu. Mikrofon, resampler i stav Silera běží dál.
  // Průběžný nebo právě zpřesňovaný text se nikdy neodešle jako hotová zpráva.
  takeTurn() {
    if (this.current || this.pending || !this.segments.length || this.segments.some(s => !s.done)) return null;
    const result = { text: joinTranscript(this.segments), ambience: this.ambience() };
    this.segments = []; this.speechSeconds = 0; this.paused = true;
    return result;
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
  ambience() { return this.noiseDb < -58 ? 'ticho' : this.noiseDb < -45 ? 'mírný ruch' : 'hluk'; }
}

export async function startMicrophone({ vad = true, debug = false, audioContext = null, echoCancellation = false, onEnded = () => {}, ...options } = {}) {
  const vadLoading = vad ? import('./vad.js?v=20261107-2').then(m => m.SileroVad.create())
    .catch(e => { console.warn('Silero VAD se nenačetl, jedu podle hlasitosti:', e); return null; }) : null;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
  let context;
  const ownsContext = !audioContext;
  try {
    // AEC je oddělená volba. AGC/NS a vynucených 16 kHz se nevracejí.
    // Pokud prohlížeč umí "all", zruší i lokálně přehrávané TTS, nejen WebRTC.
    const track = stream.getAudioTracks?.()[0];
    if (echoCancellation && track?.getCapabilities?.().echoCancellation?.includes('all')) {
      try { await track.applyConstraints({ echoCancellation: { exact: 'all' } }); } catch { /* ponechat boolean AEC */ }
    }
    // Nativní frekvence zařízení; na 16 kHz převádí worklet (vynucených 16 kHz na Androidu praskalo).
    context = audioContext || new AudioContext();
    await context.audioWorklet.addModule(new URL('./pcm-worklet.js?v=20261107-3', import.meta.url));
    await context.resume();
    const input = context.createMediaStreamSource(stream);
    const rate = Math.min(16000, context.sampleRate);
    const capture = new AudioWorkletNode(context, 'pcm-capture', { processorOptions: { outRate: rate, diagnostic: debug } });
    const mute = context.createGain(); mute.gain.value = 0;   // mikrofon se nepřehrává zpět
    input.connect(capture); capture.connect(mute); mute.connect(context.destination);
    const engine = new LiveTranscriber({ ...options, rate, ...(debug ? { endpoint: 'api/stt?live=1&debug=1' } : {}) });
    engine.inputRate = context.sampleRate;
    const settings = stream.getAudioTracks?.()[0]?.getSettings?.() || {};
    engine.echoCancellation = settings.echoCancellation ?? null;
    const captureId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    const info = new URLSearchParams({ capture: captureId, build: '20261107-3' });
    for (const [key, name] of [['echoCancellation','ec'],['noiseSuppression','ns'],['autoGainControl','agc'],['sampleRate','trackrate']]) {
      if (typeof settings[key] === 'boolean') info.set(name, settings[key] ? '1' : '0');
      else if (typeof settings[key] === 'number') info.set(name, String(settings[key]));
    }
    if (debug) engine.endpoint += '&' + info;
    const rawChunks = []; let rawCount = 0;
    const saveNative = async () => {
      if (!debug || !rawCount || engine.cancelled) return;
      const native = new Float32Array(rawCount); let offset = 0;
      for (const chunk of rawChunks) { native.set(chunk, offset); offset += chunk.length; }
      rawChunks.length = 0;
      try {
        const response = await fetch('api/stt?debug=1&source=1&in=' + context.sampleRate + '&' + info, {
          method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav(native, context.sampleRate), signal: timeoutSignal(20000),
        });
        const result = await response.json();
        if (!response.ok || result.debug_saved !== true) throw Error('Záznam vstupu se neuložil.');
      } catch (error) {
        engine.archiveWarning = 'Přepis funguje, ale surový testovací záznam se nepodařilo uložit.';
        engine.onState(engine.archiveWarning, true);
      }
    };
    // Never discard captured audio just because inference is slower than capture.
    // Only VAD falls back; all queued PCM still reaches the transcriber in order.
    let flushDone, queue = Promise.resolve(), queued = 0, vadDisabled = false;
    let ended = false, stopPromise = null, processingError = null;
    capture.port.onmessage = event => {
      if (event.data?.flushed) { flushDone?.(); return; }
      if (event.data?.raw) { rawChunks.push(event.data.raw); rawCount += event.data.raw.length; return; }
      const block = new Float32Array(event.data);
      const capturedSuppressed = engine.suppressInput();
      queued++;
      if (queued > 8 && !vadDisabled) {
        vadDisabled = true; engine.vad = null;
        engine.onState('Detekce řeči nestíhá – pokračuji podle hlasitosti.');
      }
      queue = queue.then(() => engine.feed(block, capturedSuppressed)).catch(error => {
        processingError = error;
        console.warn('Zpracování mikrofonu:', error);
        engine.onState('Zpracování zvuku se nezdařilo. Zkus mikrofon znovu.', true);
      }).finally(() => { queued--; });
    };
    engine.startTimer();
    if (vadLoading && rate === 16000) {
      engine.vadReady = vadLoading.then(detector => {
        if (detector && !ended && !vadDisabled) engine.vad = detector;
        return !!detector;
      });
    }
    const stop = (cancel = false) => {
      if (cancel) engine.cancel();
      if (stopPromise) return stopPromise;
      ended = true; clearInterval(engine.timer);
      // Release the real microphone immediately. The worklet only flushes already captured data.
      stream.getTracks().forEach(track => track.stop());
      input.disconnect();
      stopPromise = (async () => {
        try {
          await new Promise(resolve => {
            const timer = setTimeout(resolve, 500);
            flushDone = () => { clearTimeout(timer); resolve(); };
            capture.port.postMessage('flush');
          });
        } finally {
          capture.port.onmessage = null;
          capture.disconnect(); mute.disconnect();
          if (ownsContext) await context.close();
        }
        // The 500 ms timeout is only for the AudioWorklet ACK, never for the VAD queue.
        await queue;
        if (engine.cancelled) { rawChunks.length = 0; return ''; }
        if (processingError) { engine.cancel(); throw processingError; }
        const save = saveNative();
        try { return await engine.finish(); } finally { await save; }
      })();
      return stopPromise;
    };
    for (const track of stream.getTracks()) track.addEventListener?.('ended', () => { if (!ended) onEnded(); }, { once: true });
    return { stop, cancel: () => stop(true), engine };
  } catch (e) {
    stream.getTracks().forEach(t => t.stop());
    if (ownsContext) await context?.close();
    throw e;
  }
}
