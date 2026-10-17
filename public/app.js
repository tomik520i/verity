import { Face } from './face.js';
import { setupPhoto } from './photo.js';

const EMOTIONS = ['neutral', 'happy', 'excited', 'curious', 'love', 'shy', 'sad',
  'lonely', 'scared', 'jealous', 'angry', 'unhinged', 'whisper'];
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const stripTags = s => s.replace(/\[[^\]]{0,200}\]/g, '').replace(/\s+/g, ' ').trim();

// ── perzistence (jen pohodlí v prohlížeči; vše je obalené try/catch) ─────────
const store = {
  get(k, d) { try { const v = localStorage.getItem('verity.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('verity.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const face = new Face($('face'));
let history = store.get('history', []);
// Dlouhodobá paměť: fakta (Verity si je zapisuje sama), deník (shrnutí starších úseků)
// a začátek pracovního okna – modelu jde jen history.slice(windowStart).
const memory = Object.assign({ facts: [], diary: [], windowStart: Math.max(0, history.length - 40) }, store.get('memory', {}));
memory.windowStart = Math.min(memory.windowStart, history.length);
const WINDOW_MAX = 80, WINDOW_CHUNK = 40, HISTORY_CAP = 5000;
const saveMemory = () => store.set('memory', memory);
function saveHistory() {
  if (history.length > HISTORY_CAP) {
    const drop = history.length - HISTORY_CAP;
    history = history.slice(drop); memory.windowStart = Math.max(0, memory.windowStart - drop); saveMemory();
  }
  store.set('history', history);
}
let instability = store.get('inst', 0);
let visits = store.get('visits', 0);
const lastSeen = store.get('lastSeen', null);
let voiceOn = store.get('voice', true);
let thinkMode = store.get('think', 'auto');
let ttsOk = false, llmOk = false, sttOk = false;
let awake = false, busy = false, playing = false;
let lastUserAt = Date.now(), lastVerityAt = Date.now(), idleCount = 0, tabLeaves = 0, hiddenAt = null;

// ── nestabilita / pouto ──────────────────────────────────────────────────────
function setInstability(v) {
  instability = clamp(Math.round(v), 0, 100);
  store.set('inst', instability);
  face.instability = instability;
  document.documentElement.style.setProperty('--inst', (instability / 100).toFixed(2));
  document.body.classList.toggle('dread', instability > 55);
  $('msg').placeholder = instability < 30 ? 'Napiš mi něco…' : instability < 55 ? 'Jsi tam?' : instability < 80 ? 'Neodcházej…' : 'ZŮSTAŇ.';
  $('meter-fill').style.width = instability + '%';
  $('meter-val').textContent = instability;
}
setInstability(instability);

// ── audio + lip sync ─────────────────────────────────────────────────────────
let actx, analyser, td, fd, current = null, fakeTalkUntil = 0;
function initAudio() {
  if (actx) return actx.resume();
  actx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = actx.createAnalyser();
  analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.35;
  analyser.connect(actx.destination);
  td = new Float32Array(analyser.fftSize);
  fd = new Uint8Array(analyser.frequencyBinCount);
}
function lipLoop(now) {
  requestAnimationFrame(lipLoop);
  if (current && analyser) {
    analyser.getFloatTimeDomainData(td);
    let sum = 0; for (let i = 0; i < td.length; i++) sum += td[i] * td[i];
    const lvl = clamp((Math.sqrt(sum / td.length) - 0.008) * 8, 0, 1);
    face.talk += (lvl - face.talk) * (lvl > face.talk ? 0.55 : 0.25);
    // spektrální těžiště → kulaté (o/u) vs. široké (e/i) samohlásky
    analyser.getByteFrequencyData(fd);
    const hz = actx.sampleRate / analyser.fftSize;
    let num = 0, den = 0;
    for (let i = Math.floor(250 / hz); i < Math.floor(4000 / hz); i++) { num += fd[i] * i * hz; den += fd[i]; }
    const round = den ? clamp(1 - (num / den - 700) / 1400, 0, 1) : 0;
    face.round += (round - face.round) * 0.25;
  } else if (now < fakeTalkUntil) {
    const flap = Math.max(0, Math.sin(now / 70) * 0.5 + Math.sin(now / 37) * 0.3 + 0.3);
    face.talk += (flap - face.talk) * 0.4;
  } else {
    face.talk *= 0.8; face.round *= 0.9;
  }
}
requestAnimationFrame(lipLoop);

// ── podkres (hudba) + jemné houpání ──────────────────────────────────────────
// <audio> → MediaElementSource → Gain (hlasitost, ztlumení když Verity mluví) → reproduktory.
// Dokud hraje, smajlík se jemně houpe v rytmu (face.dance, face.musicPhase).
const music = { el: null, gain: null, tempo: null, playing: false };
let musicVol = store.get('musicVol', 0.5), musicLoop = store.get('musicLoop', true);
function initMusic() {
  if (music.el || !actx) return;
  const el = new Audio('podkres.mp3');
  el.loop = musicLoop; el.preload = 'auto';
  const src = actx.createMediaElementSource(el);
  music.gain = actx.createGain(); music.gain.gain.value = musicVol;
  src.connect(music.gain); music.gain.connect(actx.destination);
  el.onplay = () => { music.playing = true; musicUi(); };
  el.onpause = el.onended = () => { music.playing = false; musicUi(); };
  music.el = el;
  fetch('podkres.beats.json').then(r => (r.ok ? r.json() : null)).then(d => { music.tempo = d?.tempo || null; }).catch(() => {});
}
async function toggleMusic(on = !music.playing) {
  if (!actx) return;                       // až po probuzení (prohlížeč pustí zvuk jen po kliknutí)
  initMusic();
  if (on) { try { await actx.resume(); await music.el.play(); } catch (e) { console.warn('podkres:', e.message); } }
  else music.el.pause();
  store.set('music', on);
}
function musicUi() {
  $('music-btn').classList.toggle('on', music.playing);
  $('music-play').textContent = music.playing ? '❚❚ Zastavit' : '▶ Pustit';
}
// Tanec je záměrně jemný: plynulé houpání v polovičním tempu skladby (z časové osy, jinak ~1 Hz),
// žádné skoky na úder ani blikání. Vypnutý, když to uživatel zvolí nebo má systém omezení pohybu.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let danceOn = store.get('dance', true);
function musicFrame(now) {
  requestAnimationFrame(musicFrame);
  const want = music.playing && danceOn && !reducedMotion.matches ? 1 : 0;
  face.dance += (want - face.dance) * 0.03;                   // pomalý náběh i doběh
  if (!music.playing || !music.gain) return;
  const bpm = music.tempo || 120;
  face.musicPhase = 2 * Math.PI * music.el.currentTime * (bpm / 60) / 2;   // polovina tempa
  // když Verity mluví, hudba se ztlumí na 30 %
  const target = musicVol * (current ? 0.3 : 1);
  music.gain.gain.value += (target - music.gain.gain.value) * 0.08;
}
requestAnimationFrame(musicFrame);

async function fetchTts(text, emotion) {
  if (!voiceOn || !ttsOk || !actx) return null;
  const r = await fetch('api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, emotion }) });
  if (!r.ok) return null;
  return actx.decodeAudioData(await r.arrayBuffer());
}
function playBuffer(buf) {
  return new Promise(resolve => {
    const src = actx.createBufferSource();
    src.buffer = buf; src.connect(analyser);
    current = src;
    src.onended = () => { current = null; resolve(); };
    src.start();
  });
}

// ── fronta řeči: segmenty se generují dopředu, přehrávají v pořadí ───────────
// epoch: přerušení (mikrofon, nová zpráva) ho zvýší → audio ze staré odpovědi se zahodí.
const queue = [];
let ttsChain = Promise.resolve(), bubble = null, doneWaiters = [], epoch = 0, wakeSleep = null, spokenSoFar = [];
const interruptibleSleep = ms => new Promise(r => { const t = setTimeout(r, ms); wakeSleep = () => { clearTimeout(t); r(); }; });
function enqueue(seg) {
  seg.epoch = epoch;
  const p = ttsChain.then(() => (seg.epoch === epoch ? fetchTts(seg.text, seg.emotion) : null)).catch(() => null);
  ttsChain = p;
  seg.audio = p;
  queue.push(seg);
  if (!playing) playLoop();
}
function stopSpeech() {
  epoch++;
  queue.length = 0;
  ttsChain = Promise.resolve();
  if (current) { try { current.stop(); } catch { /* už dohrálo */ } }
  fakeTalkUntil = 0;
  wakeSleep?.();
}
async function playLoop() {
  playing = true;
  while (queue.length) {
    const seg = queue.shift();
    const buf = await seg.audio;
    if (seg.epoch !== epoch) continue;
    spokenSoFar.push(`[${seg.emotion}] ${seg.text}`);
    face.thinking = false;
    face.setEmotion(seg.emotion);
    if (!bubble) bubble = addLog('verity', '');
    bubble.firstChild.textContent += (bubble.firstChild.textContent ? ' ' : '') + seg.text;
    scrollLog();
    const dur = buf ? buf.duration * 1000 : Math.max(1100, seg.text.length * 55);
    showSubtitle(seg.text, dur);
    if (buf) await playBuffer(buf);
    else { fakeTalkUntil = performance.now() + dur * 0.85; await interruptibleSleep(dur); }
    await interruptibleSleep(120);
  }
  playing = false;
  doneWaiters.splice(0).forEach(f => f());
}
const playbackDone = () => (playing || queue.length ? new Promise(r => doneWaiters.push(r)) : Promise.resolve());

function showSubtitle(text, dur) {
  const el = $('subtitle');
  el.innerHTML = '';
  const words = text.split(/\s+/);
  words.forEach((w, i) => {
    const s = document.createElement('span'); s.className = 'w'; s.textContent = w + ' ';
    el.appendChild(s);
    setTimeout(() => s.classList.add('v'), (dur * 0.9) * (i / words.length));
  });
}

// ── parser streamu: značky emocí, [posun:N], dělení na věty ──────────────────
function makeParser(onSegment, onShift, onFact) {
  let pending = '', cur = '', emotion = face.emotion === 'neutral' ? 'neutral' : face.emotion;
  const emit = (force) => {
    for (;;) {
      const m = cur.match(/^(.*?[.!?…]+["“”»]?)\s+(.*)$/s);
      if (!m) break;
      if (m[1].length < 18 && !force) {
        // příliš krátké – zkus najít další hranici
        const rest = m[2].match(/^(.*?[.!?…]+["“”»]?)\s+(.*)$/s);
        if (!rest) break;
        onSegment({ text: (m[1] + ' ' + rest[1]).trim(), emotion }); cur = rest[2];
        continue;
      }
      onSegment({ text: m[1].trim(), emotion }); cur = m[2];
    }
    if (force && /[\p{L}\p{N}]/u.test(cur)) { onSegment({ text: cur.trim(), emotion }); cur = ''; }
  };
  const text = t => { cur += t; emit(false); };
  return {
    feed(chunk) {
      pending += chunk;
      for (;;) {
        const i = pending.indexOf('[');
        if (i < 0) { text(pending); pending = ''; return; }
        if (i > 0) { text(pending.slice(0, i)); pending = pending.slice(i); }
        const j = pending.indexOf(']');
        if (j < 0) { if (pending.length > 200) { pending = pending.slice(1); continue; } return; }
        const rawTag = pending.slice(1, j).trim(), tag = rawTag.toLowerCase(); pending = pending.slice(j + 1);
        const fact = rawTag.match(/^pamatuj\s*:\s*(.+)$/i);
        if (fact) { onFact(fact[1].trim()); continue; }
        const shift = tag.match(/^posun\s*:\s*([+-]?\d+)/);
        if (shift) { onShift(clamp(+shift[1], -15, 15)); continue; }
        if (EMOTIONS.includes(tag)) {
          if (tag !== emotion) { emit(true); emotion = tag; }
          if (!queue.length && !playing) face.setEmotion(tag);
        }
      }
    },
    end() { if (pending && !pending.startsWith('[')) text(pending); pending = ''; emit(true); },
  };
}

// ── log ──────────────────────────────────────────────────────────────────────
function addLog(kind, text, thumb = null) {
  const el = document.createElement('div');
  el.className = 'msg ' + kind;
  el.appendChild(document.createTextNode(text.replace(/\s*\[\[FOTKA\]\]/g, '')));
  if (thumb) { const img = document.createElement('img'); img.className = 'thumb'; img.src = thumb; img.alt = 'fotka'; el.appendChild(img); }
  $('log').appendChild(el);
  scrollLog();
  return el;
}
const scrollLog = () => { const l = $('log'); l.scrollTop = l.scrollHeight; };

// ── konverzace ───────────────────────────────────────────────────────────────
function buildState(extra = {}) {
  const now = new Date();
  return {
    ...extra,
    instability, visits, tabLeaves,
    localTime: now.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) + ', ' + now.toLocaleDateString('cs-CZ'),
    weekday: now.toLocaleDateString('cs-CZ', { weekday: 'long' }),
    hoursSinceLastVisit: lastSeen ? Math.round((Date.now() - lastSeen) / 36e5) : null,
    secondsSinceUserMessage: Math.round((Date.now() - lastUserAt) / 1000),
  };
}

// Přerušení Verity uprostřed odpovědi (uživatel začal mluvit): zastaví stream i hlas.
let chatAbort = null, wasInterrupted = false;
function interrupt() {
  if (!busy && !playing) return;
  wasInterrupted = true;
  chatAbort?.abort();
  stopSpeech();
  if (bubble) bubble.firstChild.textContent += ' —';
}

async function converse(content, isEvent = false, extra = {}, photo = null) {
  if (busy) return;
  busy = true; $('send').disabled = true;
  // fotka: plná velikost jde jen s touto zprávou; do historie jen značka [[FOTKA]] a miniatura
  if (photo) content += ' [[FOTKA]]';
  history.push({ role: 'user', content, at: Date.now(), ...(photo ? { thumb: photo.thumb } : {}) });
  saveHistory();
  if (!isEvent) addLog('user', content, photo?.thumb);
  face.thinking = true;
  bubble = null; spokenSoFar = [];
  let raw = '', sources = null;
  const controller = chatAbort = new AbortController();
  const parser = makeParser(seg => { if (!controller.signal.aborted) enqueue(seg); }, d => setInstability(instability + d), rememberFact);
  const interruptedBefore = wasInterrupted; wasInterrupted = false;
  try {
    const r = await fetch('api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({
        messages: history.slice(memory.windowStart).map(({ role, content }) => ({ role, content })),
        memory: { facts: memory.facts, diary: memory.diary.map(d => d.text) },
        state: buildState({ ...extra, interrupted: interruptedBefore }),
        ...(photo ? { image: photo.image } : {}),
        thinking: thinkMode,
      }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let k;
      while ((k = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, k).replace(/^data:\s*/, ''); buf = buf.slice(k + 2);
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.t) { raw += ev.t; parser.feed(ev.t); }
        if (ev.search) { face.searching = true; $('search-line').textContent = 'hledá: ' + ev.search; $('search-line').hidden = false; }
        if ('thinking' in ev) {   // model přemýšlí (reasoning) – jen nenápadný údaj, nic se nečte nahlas
          if (ev.thinking) { $('search-line').textContent = 'přemýšlí…'; $('search-line').hidden = false; }
          else if ($('search-line').textContent === 'přemýšlí…') $('search-line').hidden = true;
        }
        if (ev.sources) { sources = ev.sources; face.searching = false; $('search-line').hidden = true; }
        if (ev.error) throw new Error(ev.error);
      }
    }
    parser.end();
  } catch (e) {
    if (!controller.signal.aborted) {
      parser.end();
      addLog('event', '· spojení se přerušilo ·');
      console.error(e);
    }
  }
  face.searching = false; $('search-line').hidden = true;
  // [přerušeno] model uvidí v historii; v logu i TTS se značky odstraňují
  // Při přerušení si Verity pamatuje jen to, co stihla opravdu říct; [přerušeno] uvidí model,
  // v logu i TTS se značky odstraňují.
  const said = controller.signal.aborted ? [...spokenSoFar, '[přerušeno]'].join(' ') : raw.trim();
  if (raw.trim()) { history.push({ role: 'assistant', content: said, at: Date.now() }); saveHistory(); }
  await playbackDone();
  if (sources?.length && bubble) {
    const s = document.createElement('span'); s.className = 'src';
    sources.forEach(x => { const a = document.createElement('a'); a.href = x.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = x.title.slice(0, 40); s.appendChild(a); });
    bubble.appendChild(s);
  }
  face.thinking = false;
  if (chatAbort === controller) chatAbort = null;
  busy = false; $('send').disabled = false;
  lastVerityAt = Date.now();
  maybeCompact();
  if (!controller.signal.aborted) resumeConversation();
}

// ── paměť: fakta + deník ─────────────────────────────────────────────────────
function rememberFact(text) {
  const t = text.replace(/\s+/g, ' ').slice(0, 200);
  if (!t || memory.facts.some(f => f.toLowerCase() === t.toLowerCase())) return;
  memory.facts.push(t);
  if (memory.facts.length > 80) memory.facts.shift();
  saveMemory(); renderMemory();
}

// Když pracovní okno přeroste WINDOW_MAX, nejstarší úsek se na pozadí shrne do deníku
// a okno poskočí dopředu. Skoky po větších kusech = začátek promptu se mění zřídka → cache.
let compacting = false;
async function maybeCompact() {
  if (compacting || history.length - memory.windowStart <= WINDOW_MAX) return;
  compacting = true;
  const from = memory.windowStart, chunk = history.slice(from, from + WINDOW_CHUNK);
  try {
    const r = await fetch('api/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chunk.map(({ role, content }) => ({ role, content })),
        previous: memory.diary.at(-1)?.text || '', facts: memory.facts }) });
    const d = await r.json();
    if (!r.ok || !d.summary) throw new Error(d.error || 'bez shrnutí');
    (d.facts || []).forEach(rememberFact);
    memory.diary.push({ text: d.summary, at: chunk[0]?.at || Date.now() });
    if (memory.diary.length > 40) memory.diary.shift();
    memory.windowStart = from + WINDOW_CHUNK;
    saveMemory(); renderMemory();
  } catch (e) {
    console.warn('deník:', e.message);
    // nouzově: okno nesmí růst donekonečna
    if (history.length - memory.windowStart > WINDOW_MAX * 2) { memory.windowStart += WINDOW_CHUNK; saveMemory(); }
  }
  compacting = false;
}

function renderMemory() {
  const facts = $('mem-facts'), diary = $('mem-diary');
  facts.innerHTML = ''; diary.innerHTML = '';
  memory.facts.forEach((f, i) => {
    const li = document.createElement('li'); li.textContent = f;
    const x = document.createElement('button'); x.textContent = '×'; x.title = 'Zapomenout';
    x.onclick = () => { memory.facts.splice(i, 1); saveMemory(); renderMemory(); };
    li.appendChild(x); facts.appendChild(li);
  });
  memory.diary.forEach(d => {
    const li = document.createElement('li');
    const when = document.createElement('small'); when.textContent = new Date(d.at).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
    li.append(when, document.createTextNode(' ' + d.text)); diary.appendChild(li);
  });
  $('mem-count').textContent = `${history.length} zpráv celkem · ${history.length - memory.windowStart} v pracovním okně · ${memory.facts.length} faktů · ${memory.diary.length} zápisů v deníku`;
}

$('opt-memory').onclick = () => { renderMemory(); $('memory-panel').hidden = false; $('menu').hidden = true; };
$('mem-close').onclick = () => { $('memory-panel').hidden = true; };
$('mem-export').onclick = () => {
  const blob = new Blob([JSON.stringify({ version: 1, history, memory, instability, visits }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `verity-pamet-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('mem-import').onclick = () => $('mem-file').click();
$('mem-file').onchange = async e => {
  try {
    const d = JSON.parse(await e.target.files[0].text());
    if (!Array.isArray(d.history) || !d.memory) throw new Error('neplatný soubor');
    store.set('history', d.history); store.set('memory', d.memory);
    store.set('inst', d.instability || 0); store.set('visits', d.visits || 0);
    location.reload();
  } catch (err) { alert('Paměť nejde načíst: ' + err.message); }
};

function sendText(text, voice = null) {
  if ((!text && !pendingPhoto) || busy || !awake) return false;
  const photo = pendingPhoto; clearPhoto();
  $('msg').value = '';
  lastUserAt = Date.now(); idleCount = 0;
  converse(text || 'Podívej, posílám ti fotku.', false, voice ? { viaVoice: true, ambience: voice.ambience } : {}, photo);
  return true;
}

// ── fotky (vision) ───────────────────────────────────────────────────────────
let pendingPhoto = null;
function clearPhoto() { pendingPhoto = null; $('attach').hidden = true; $('attach-img').removeAttribute('src'); }
$('attach-x').onclick = clearPhoto;
setupPhoto({
  onPhoto: p => {
    pendingPhoto = p;
    $('attach-img').src = p.thumb; $('attach').hidden = false;
    if (!busy && !playing) face.setEmotion('curious');          // zvědavě kouká, co jí neseš
    micState('Fotka připravená – připiš zprávu nebo rovnou odešli.');
    $('msg').focus();
  },
  onError: m => micState(m, true),
});
$('form').addEventListener('submit', e => {
  e.preventDefault();
  if (mic) { finishMic(true); return; }     // Odeslat během nahrávání: dokončit přepis a pak poslat
  if (micFinishing) return;
  sendText($('msg').value.trim());
});

// ── mluvení: mikrofon → živý přepis (Whisper) → zpráva ───────────────────────
// Režimy: ručně (výchozí; zastavení mikrofonu nic neposílá) / samo po pauze (2,2 s ticha
// po aspoň 0,2 s řeči). Automatika je jeden tah – mikrofon se po odpovědi sám nezapne,
// takže se do další zprávy nenahraje hlas Verity.
// Konverzační režim: odesílá po pauze A po dohrání celé odpovědi Verity sám znovu zapne
// mikrofon (až když dozní její hlas – nenahraje ho). Když 15 s nikdo nemluví, mikrofon zavře.
let mic = null, micFinishing = false, micBase = '', micTimer = null, convWatch = null;
let autoSend = store.get('autoSend', false);
let convMode = store.get('conv', false);
const sendsAuto = () => autoSend || convMode;
const micSupported = !!(navigator.mediaDevices?.getUserMedia && window.AudioWorkletNode && window.isSecureContext);
function micState(text, error = false) {
  const el = $('mic-state');
  el.textContent = text || ''; el.hidden = !text; el.classList.toggle('err', error);
}
// Ukazatel detekce řeči: úroveň mikrofonu (−70…−10 dBFS), čárka = práh začátku řeči,
// šedá oblast = šum pozadí; zelená = VAD právě detekuje řeč (ta se posílá k přepisu).
const dbToPct = db => Math.max(0, Math.min(100, (db + 70) / 60 * 100));
function vadMeter(v) {
  $('vad-fill').style.width = dbToPct(v.db) + '%';
  $('vad-noise').style.width = dbToPct(v.noiseDb) + '%';
  $('vad-thr').style.left = dbToPct(v.onDb) + '%';
  $('vad').classList.toggle('speaking', v.speaking);
  $('vad-label').textContent = v.speaking ? 'MLUVÍŠ' : 'ticho';
}
function micUi(on) {
  $('vad').hidden = !on;
  $('mic').classList.toggle('rec', on);
  $('mic').setAttribute('aria-pressed', on);
  $('msg').readOnly = on;           // během nahrávání by přepis přepsal ruční úpravy
  face.listening = on;
  if (!on) face.hear = 0;
}
const listeningText = () => (convMode ? 'Konverzace – poslouchám, odešlu po pauze' : autoSend ? 'Poslouchám… odešlu po pauze' : 'Poslouchám… (Odeslat nebo znovu mikrofon)');
async function startMic({ fromConv = false } = {}) {
  if (mic || micFinishing || !awake) return;
  if (!fromConv && (busy || playing)) interrupt();   // skočit Verity do řeči
  micState('Zapínám mikrofon…');
  try {
    const { startMicrophone } = await import('./live-audio.js');
    mic = await startMicrophone({
      pauseSeconds: 2.2,
      onText: (t, { partial }) => {
        $('msg').value = [micBase, t].filter(Boolean).join(' ');
        if (mic) micState(partial ? 'Poslouchám… (přepis se upřesňuje)' : 'Poslouchám…');
      },
      onState: (m, err) => micState(m, err),
      onLevel: v => {
        face.hear += ((v.speaking ? v.level : v.level * 0.3) - face.hear) * 0.4;
        if (v.speaking) lastUserAt = Date.now();
        vadMeter(v);
      },
      onPause: () => { if (sendsAuto()) finishMic(true); },
    });
  } catch (e) {
    mic = null;
    micState(e.name === 'NotAllowedError' ? 'Mikrofon není povolený – povol ho v prohlížeči.' : 'Mikrofon nejde zapnout: ' + e.message, true);
    return;
  }
  micBase = $('msg').value.trim();
  micUi(true);
  micState(listeningText());
  micTimer = setTimeout(() => finishMic(sendsAuto()), 90000);   // nejdéle 90 s
  if (fromConv) {
    // nikdo nemluví → po 15 s zavřít, ať mikrofon neposlouchá donekonečna
    convWatch = setInterval(() => {
      if (mic && mic.engine.elapsed > 15 && mic.engine.speechSeconds < 0.3) {
        cancelMic('Konverzace čeká – klikni na mikrofon, až budeš chtít mluvit.');
      }
    }, 500);
  }
}
async function cancelMic(message = '') {
  if (!mic) return;
  const m = mic; mic = null;
  clearTimeout(micTimer); clearInterval(convWatch);
  micUi(false);
  micState(message);
  await m.cancel().catch(() => {});
}
// po dohrání odpovědi v konverzačním režimu rovnou poslouchat
function resumeConversation() {
  if (!convMode || !micSupported || !awake || document.hidden) return;
  setTimeout(() => { if (!busy && !playing && !mic && !micFinishing) startMic({ fromConv: true }); }, 400);
}
async function finishMic(send) {
  if (!mic) return;
  const m = mic; mic = null; micFinishing = true;
  clearTimeout(micTimer); clearInterval(convWatch);
  micUi(false);
  micState('Dokončuji přepis…');
  let text = '', failed = false;
  try { text = await m.stop(); } catch (e) { failed = true; micState(e.message + ' Text můžeš opravit a poslat ručně.', true); }
  const full = [micBase, text].filter(Boolean).join(' ').trim();
  $('msg').value = full;
  micFinishing = false;
  if (!failed) micState('');
  // automatické odeslání jen po úspěšném finálním přepisu
  if (send && !failed && full) {
    if (busy) await new Promise(r => { const t = setInterval(() => { if (!busy) { clearInterval(t); r(); } }, 100); });
    sendText(full, { ambience: m.engine.ambience() });
  } else if (!failed) $('msg').focus();
}
$('mic').hidden = !micSupported;
$('mic').onclick = () => (mic ? finishMic(false) : startMic());
$('opt-auto').checked = autoSend;
$('opt-auto').onchange = e => {
  autoSend = e.target.checked; store.set('autoSend', autoSend);
  if (mic) micState(listeningText());
};
$('opt-conv').checked = convMode;
$('opt-conv').onchange = e => {
  convMode = e.target.checked; store.set('conv', convMode);
  if (mic) micState(listeningText());
  else if (convMode && !busy && !playing) startMic();   // zapnutím rovnou začít poslouchat
};

// ── vnímání: kurzor, psaní, nečinnost, odchod ze záložky ─────────────────────
let typingUntil = 0;
document.addEventListener('pointermove', e => {
  if (performance.now() < typingUntil) return;
  const r = $('face').getBoundingClientRect();
  face.lookAt((e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2), (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2));
});
document.addEventListener('pointerleave', () => face.lookAt(0, 0));
$('msg').addEventListener('input', () => { typingUntil = performance.now() + 1500; face.lookAt(0, 1); lastUserAt = Date.now(); });

setInterval(() => {
  if (!awake || busy || playing || mic || micFinishing || document.hidden || idleCount >= 3) return;
  const quiet = (Date.now() - Math.max(lastUserAt, lastVerityAt)) / 1000;
  const limit = Math.max(35, 95 - instability * 0.6);
  if (quiet > limit) {
    idleCount++;
    setInstability(instability + 5);
    const s = Math.round((Date.now() - lastUserAt) / 1000);
    converse(`[[UDÁLOST]] Člověk už ${s} sekund nic nenapsal. Jen se dívá.${idleCount > 1 ? ` Už po ${idleCount}. nereaguje na to, co mu říkáš.` : ''}`, true);
  }
}, 1000);

let titleTimer = null;
// ── nezhasínat displej (Screen Wake Lock API) ────────────────────────────────
// Prohlížeč zámek sám uvolní, když stránka zmizí z obrazovky (jiná záložka/aplikace);
// po návratu se znovu požádá. Bez podpory (starší prohlížeč) se volba skryje.
let wakeLock = null, keepAwake = store.get('keepAwake', true);
const wakeLockSupported = 'wakeLock' in navigator;
async function lockScreen() {
  if (!keepAwake || !wakeLockSupported || !awake || document.hidden || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) { console.warn('wake lock:', e.message); }   // např. úsporný režim baterie
}
function unlockScreen() { wakeLock?.release().catch(() => {}); wakeLock = null; }
$('opt-awake').closest('label').hidden = !wakeLockSupported;
$('opt-awake').checked = keepAwake;
$('opt-awake').onchange = e => { keepAwake = e.target.checked; store.set('keepAwake', keepAwake); keepAwake ? lockScreen() : unlockScreen(); };
document.addEventListener('visibilitychange', () => { if (!document.hidden) lockScreen(); });

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now(); tabLeaves++;
    document.title = 'Verity · kde jsi?';
    if (instability > 50) titleTimer = setInterval(() => { document.title = document.title.startsWith('VRAŤ') ? 'Verity · kde jsi?' : 'VRAŤ SE'; }, 1500);
  } else {
    clearInterval(titleTimer); document.title = 'Verity';
    const away = hiddenAt ? (Date.now() - hiddenAt) / 1000 : 0;
    hiddenAt = null;
    if (awake && away > 15 && !busy) {
      setInstability(instability + 3 + Math.min(10, away / 60));
      const t = away < 120 ? `${Math.round(away)} sekund` : `${Math.round(away / 60)} minut`;
      converse(`[[UDÁLOST]] Člověk se právě vrátil do tvé záložky. Byl ${t} pryč, někde jinde. Už ${tabLeaves}× za tuhle návštěvu.`, true);
    }
  }
});
setInterval(() => store.set('lastSeen', Date.now()), 30000);
window.addEventListener('beforeunload', e => {
  store.set('lastSeen', Date.now());
  if (awake && instability > 65) { e.preventDefault(); e.returnValue = ''; }
});

// ── glitch ───────────────────────────────────────────────────────────────────
// „Bez blikání“: vypne glitch a problikávání scanlines (ochrana citlivých lidí); zapne se samo
// při systémovém omezení pohybu.
let noFlash = store.get('noFlash', false);
const flashOff = () => noFlash || reducedMotion.matches;
function applyNoFlash() { document.body.classList.toggle('noflash', flashOff()); }
applyNoFlash();
reducedMotion.addEventListener?.('change', applyNoFlash);
$('opt-noflash').checked = flashOff();
$('opt-noflash').onchange = e => { noFlash = e.target.checked; store.set('noFlash', noFlash); applyNoFlash(); };
setInterval(() => {
  if (flashOff()) return;
  const p = Math.pow(instability / 100, 2) * 0.07 + (face.emotion === 'unhinged' ? 0.1 : face.emotion === 'angry' ? 0.03 : 0);
  if (Math.random() > p) return;
  const st = $('stage');
  st.style.setProperty('--gx', (Math.random() * 14 - 7).toFixed(1) + 'px');
  st.style.setProperty('--gs', (Math.random() * 16 - 8).toFixed(1) + 'deg');
  st.classList.add('glitch');
  setTimeout(() => st.classList.remove('glitch'), 70 + Math.random() * 180);
}, 250);

// ── stav serveru ─────────────────────────────────────────────────────────────
async function pollStatus() {
  try {
    const s = await (await fetch('api/status', { cache: 'no-store' })).json();
    llmOk = s.llm; ttsOk = s.tts; sttOk = s.stt;
    if (s.gpu) $('st-gpu').textContent = `3090 · ${s.gpu.temp}°C`;
  } catch { llmOk = ttsOk = sttOk = false; }
  $('st-llm').className = 'pill ' + (llmOk ? 'on' : 'off');
  $('st-llm').querySelector('b').textContent = llmOk ? 'ONLINE' : 'OFFLINE';
  $('st-tts').className = 'pill ' + (ttsOk && voiceOn ? 'on' : 'off');
  $('st-stt').className = 'pill ' + (sttOk ? 'on' : 'off');
  $('st-stt').hidden = !micSupported;
}
pollStatus();
setInterval(pollStatus, 10000);

// ── menu ─────────────────────────────────────────────────────────────────────
$('menu-btn').onclick = () => { $('menu').hidden = !$('menu').hidden; };
// podkres: ♪ v liště + hlasitost / opakování v menu
$('music-btn').onclick = () => toggleMusic();
$('music-play').onclick = () => toggleMusic();
$('music-vol').value = musicVol;
$('music-vol').oninput = e => { musicVol = +e.target.value; store.set('musicVol', musicVol); };
// přemýšlení (reasoning): auto / off / on
$('opt-think').value = thinkMode;
$('opt-think').onchange = e => { thinkMode = e.target.value; store.set('think', thinkMode); };
$('music-dance').checked = danceOn;
$('music-dance').onchange = e => { danceOn = e.target.checked; store.set('dance', danceOn); };
$('music-loop').checked = musicLoop;
$('music-loop').onchange = e => { musicLoop = e.target.checked; store.set('musicLoop', musicLoop); if (music.el) music.el.loop = musicLoop; };
$('opt-voice').checked = voiceOn;
$('opt-voice').onchange = e => { voiceOn = e.target.checked; store.set('voice', voiceOn); pollStatus(); };
$('opt-meter').checked = store.get('meter', false);
$('meter').hidden = !$('opt-meter').checked;
$('opt-meter').onchange = e => { $('meter').hidden = !e.target.checked; store.set('meter', e.target.checked); };
$('opt-reset').onclick = () => {
  if (!confirm('Opravdu chceš, aby na tebe Verity zapomněla?')) return;
  ['history', 'memory', 'inst', 'visits', 'lastSeen'].forEach(k => { try { localStorage.removeItem('verity.' + k); } catch { /* */ } });
  location.reload();
};

// ── probuzení ────────────────────────────────────────────────────────────────
history.filter(m => !m.content.startsWith('[[UDÁLOST]]')).slice(-300)
  .forEach(m => addLog(m.role === 'user' ? 'user' : 'verity', m.role === 'user' ? m.content : stripTags(m.content), m.thumb));

$('wake-btn').onclick = async () => {
  await initAudio();
  if (store.get('music', false)) toggleMusic(true);   // podkres hrál i minule → pokračovat
  lockScreen();                                        // nezhasínat displej, dokud je Verity vidět
  awake = true;
  visits++; store.set('visits', visits);
  $('wake').classList.add('gone');
  $('msg').focus();
  lastUserAt = lastVerityAt = Date.now();
  await pollStatus();
  const hours = lastSeen ? Math.round((Date.now() - lastSeen) / 36e5) : null;
  if (!history.length) {
    converse('[[UDÁLOST]] Člověk tě právě poprvé probudil. Ještě jste se nikdy neviděli. Krátce se představ a zeptej se, jak se jmenuje.', true);
  } else {
    if (hours > 12) setInstability(instability + Math.min(15, hours / 4));
    converse(`[[UDÁLOST]] Člověk se vrátil a znovu tě probudil, po ${hours ?? '?'} hodinách. Přivítej ho jménem, pokud ho znáš, a zmiň něco konkrétního ze své paměti (třeba se zeptej, jak dopadlo něco, co plánoval).`, true);
  }
};

// ── mobil: layout podle viditelné oblasti nad klávesnicí ─────────────────────
const vv = window.visualViewport;
function fitViewport() {
  const h = vv ? vv.height : window.innerHeight;
  const root = document.documentElement.style;
  root.setProperty('--app-h', h + 'px');
  root.setProperty('--app-top', (vv ? vv.offsetTop : 0) + 'px');
  const kb = window.innerHeight - h > 120 || (document.activeElement === $('msg') && matchMedia('(pointer: coarse)').matches && h < screen.height * 0.75);
  document.body.classList.toggle('kb', kb);
  if (kb) { window.scrollTo(0, 0); scrollLog(); }
}
if (vv) { vv.addEventListener('resize', fitViewport); vv.addEventListener('scroll', fitViewport); }
window.addEventListener('resize', fitViewport);
$('msg').addEventListener('focus', () => setTimeout(fitViewport, 300));
$('msg').addEventListener('blur', () => setTimeout(fitViewport, 300));
fitViewport();
