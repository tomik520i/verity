import {createScreenAwake,screenAwakeLabel} from './screen-awake.mjs?v=20261108-13';
import {conversationId,DiagnosticTrace} from './diagnostics-client.mjs?v=20261108-12';
import { CaptionState } from './captions.mjs?v=20261108-5';
import { roleplayPreference } from './conversation-mode.mjs?v=20261108-2';
import { applyVoiceDefaults, microphoneLabel, needsEchoFallback, microphoneError } from './voice-preferences.mjs?v=20261108-2';
import { Face } from './face.js?v=20261108-12';
import {createPerformanceParser} from './performance-parser.mjs?v=20261108-12';
import { normalizeMemory, pruneMemory, applyOperations, removeEntry, manualEntry, contextMessages } from './memory-core.mjs?v=20261108-1';
import { setupPhoto } from './photo.js?v=20261108-6';
import { MAX_IMAGES, requestImages } from './image-limits.mjs';
import { describeActivity } from './activity.js?v=20261107-7';

const expressionCatalog = await (await fetch(new URL('./emotions.json?v=20261108-12',import.meta.url))).json();
const diagnosticConversationId=conversationId();let activeTrace=null;
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const stripTags = s => s.replace(/\[[^\]]{0,200}\]/g, '').replace(/\s+/g, ' ').trim();

// ── perzistence (jen pohodlí v prohlížeči; vše je obalené try/catch) ─────────
const store = {
  get(k, d) { try { const v = localStorage.getItem('verity.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('verity.' + k, JSON.stringify(v)); return true; } catch { return false; } },
};

applyVoiceDefaults(store);

const captions = new CaptionState();
const face = new Face($('face'),{catalog:expressionCatalog});
face.motion=clamp(store.get('expressiveness',85)/100,0,1);
face.idleEnabled=store.get('idleAnimations',true);
face.onExpression=state=>{
  $('emotion-name').textContent=state.label; $('emotion-mood').textContent=state.moodLabel;
  $('emotion-status').style.setProperty('--mood-color',state.color);
  $('emotion-strength').style.width=Math.round(state.intensity*100)+'%';
  $('emotion-status').title='Výraz: '+state.label+'. Rozpoložení: '+state.moodLabel+'. Intenzita '+Math.round(state.intensity*100)+' %.';
};
face.onExpression(face.expression.describe());
let history = store.get('history', []);
// Verze 2: originál před převodem zůstává lokálně v záloze.
const oldMemory = store.get('memory', {});
const backupReady = oldMemory.version === 2 || !Object.keys(oldMemory).length ||
  !!store.get('memory-backup-v1',null) || store.set('memory-backup-v1',{at:Date.now(),memory:oldMemory});
const memory = normalizeMemory(oldMemory);
memory.windowStart=Math.min(memory.windowStart,history.length);
memory.sessionStart=Math.min(memory.sessionStart,history.length);
const WINDOW_MAX=60, WINDOW_CHUNK=30, HISTORY_CAP=5000;
const saveMemory=()=>{pruneMemory(memory);if(backupReady)store.set('memory',memory);};
saveMemory();
function saveHistory(){
  if(history.length>HISTORY_CAP){
    const drop=history.length-HISTORY_CAP;history=history.slice(drop);
    memory.windowStart=Math.max(0,memory.windowStart-drop);
    memory.sessionStart=Math.max(0,memory.sessionStart-drop);saveMemory();
  }
  store.set('history',history);
}
let instability = store.get('inst', 0);
let visits = store.get('visits', 0);
const lastSeen = store.get('lastSeen', null);
let voiceOn = store.get('voice', true);
let thinkMode = store.get('think', 'auto');
let roleplayPaused = store.get('roleplayPaused',false);
let ttsOk = false, llmOk = false, sttOk = false;
let awake = false, busy = false, playing = false;
const activity = { streaming: false, search: '', reasoning: false, hasText: false,
  outcome: 'idle', failure: '', inputError: '', voiceFailed: false, memoryTasks: 0, memoryError: false };
let lastUserAt = Date.now(), lastVerityAt = Date.now(), idleCount = 0, tabLeaves = 0, hiddenAt = null;

// ── nestabilita / pouto ──────────────────────────────────────────────────────
function setInstability(v) {
  instability = clamp(Math.round(v), 0, 100);
  store.set('inst', instability);
  const wasHorror=face.horrorEnabled;face.horrorEnabled=!roleplayPaused;
  if(wasHorror&&roleplayPaused){face.cancelGesture();face.perform({emotion:'calm',mood:'warm',intensity:.4});}
  face.instability = roleplayPaused ? 0 : instability;
  const visualInstability=face.instability;
  document.documentElement.style.setProperty('--inst', (visualInstability / 100).toFixed(2));
  document.body.classList.toggle('dread', visualInstability > 55);
  $('msg').placeholder = visualInstability < 30 ? 'Napiš mi něco…' : visualInstability < 55 ? 'Jsi tam?' : visualInstability < 80 ? 'Neodcházej…' : 'ZŮSTAŇ.';
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
  const target = musicVol * (micTestMode || mic || micStarting || micFinishing || liveSession || liveStarting ? 0 : current ? 0.3 : 1);
  music.gain.gain.value += (target - music.gain.gain.value) * 0.08;
}
requestAnimationFrame(musicFrame);

const ttsControllers = new Set();
async function fetchTts(text, emotion, intensity=.65, trace=null, segment=0) {
  if (!voiceOn || !ttsOk || !actx) return null;
  const controller = new AbortController(); ttsControllers.add(controller);
  try {
    const r = await fetch('api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, emotion, intensity }), signal: controller.signal });
    if (!r.ok) throw new Error('TTS HTTP '+r.status);
    return await actx.decodeAudioData(await r.arrayBuffer());
  } catch (error) { if (!controller.signal.aborted) {activity.voiceFailed = true;trace?.report('tts_error',{segment,error:error.message});} throw error; }
  finally { ttsControllers.delete(controller); }
}
let echoOutput = null, echoRouteAbort = null;
function releaseEchoOutput() {
  echoRouteAbort?.abort(); echoRouteAbort = null;
  if (!echoOutput) return;
  analyser.disconnect(); echoOutput.close(); echoOutput = null;
  analyser.connect(actx.destination);
}
function fallbackEchoMode() {
  outputMode = 'speakers'; store.set('outputMode',outputMode);
  releaseEchoOutput(); outputModeUi();
}
function confirmEchoMode(engine) {
  if (!needsEchoFallback(outputMode,engine.echoCancellation)) return false;
  fallbackEchoMode();
  if (current) engine.suppress();
  return true;
}
async function prepareEchoOutput() {
  if (outputMode !== 'aec') { releaseEchoOutput(); return; }
  if (echoOutput) return;
  const controller = echoRouteAbort = new AbortController();
  try {
    const { createEchoOutput } = await import('./echo-output.js?v=20261107-6');
    if (controller.signal.aborted) throw new DOMException('Ukončeno','AbortError');
    const bridge = await createEchoOutput(actx, { signal:controller.signal, onFailure:() => {
      fallbackEchoMode();
      cancelMic(); stopLive({ message:'Potlačení ozvěny se odpojilo. Přepnuto na střídání; mikrofonem začni znovu.', error:true });
    }});
    if (controller.signal.aborted || outputMode !== 'aec') { bridge.close(); throw new DOMException('Ukončeno','AbortError'); }
    analyser.disconnect(); analyser.connect(bridge.input); echoOutput = bridge;
  } catch (e) {
    if (controller.signal.aborted || e.name === 'AbortError') throw e;
    // Bez funkční AEC nesmí reproduktor otevřít další tah rozhovoru.
    fallbackEchoMode();
    micState('Potlačení ozvěny není dostupné. Střídáme mluvení a poslech.');
  }
}
let speakerTailUntil = 0;
const inputSuppressed = () => outputMode === 'speakers' && (!!current || performance.now() < speakerTailUntil);
function playBuffer(buf) {
  return new Promise(resolve => {
    const src = actx.createBufferSource();
    src.buffer = buf; src.connect(analyser);
    current = src;
    if (outputMode === 'speakers') { liveSession?.engine.suppress(); mic?.engine.suppress(); }
    src.onended = () => {
      if (current === src) { current = null; speakerTailUntil = performance.now() + 900; }
      resolve();
    };
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
  const p = ttsChain.then(() => (seg.epoch === epoch ? fetchTts(seg.text, seg.emotion,seg.intensity,seg.trace,seg.number) : null)).catch(() => null);
  ttsChain = p;
  seg.audio = p;
  queue.push(seg);
  if (!playing) playLoop();
}
function stopSpeech() {
  if(activeTrace&&(playing||chatAbort))activeTrace.report('interrupted');
  epoch++; face.speaking=false; face.cancelGesture();
  echoOutput?.flush();
  for (const controller of ttsControllers) controller.abort();
  ttsControllers.clear();
  // Přerušení zvuku nemaže právě čtené titulky.
  if (!captions.reply) $('subtitle').textContent = 'Odpověď přerušena.';
  queue.length = 0;
  ttsChain = Promise.resolve();
  if (current) { speakerTailUntil = performance.now() + 900; try { current.stop(); } catch { /* už dohrálo */ } }
  fakeTalkUntil = 0;
  wakeSleep?.();
}
async function playLoop() {
  playing = true;
  while (queue.length) {
    const seg = queue.shift();
    const buf = await seg.audio;
    if (seg.epoch !== epoch) continue;
    if (!buf) spokenSoFar.push(`[${seg.emotion}:${Math.round(seg.intensity*100)}][mood:${seg.mood}] ${seg.text}`);
    face.thinking = false;
    face.perform(seg); face.speaking=true;
    seg.trace?.report('playback_start',{segment:seg.number,text:seg.text,emotion:seg.emotion,mood:seg.mood,intensity:seg.intensity,serious:seg.serious,audio:!!buf});
    if (!bubble) bubble = addLog('verity', '');
    bubble.firstChild.textContent += (bubble.firstChild.textContent ? ' ' : '') + seg.text;
    scrollLog();
    const dur = buf ? buf.duration * 1000 : Math.max(1100, seg.text.length * 55);
    showSubtitle(seg.text, dur);
    if (buf) { await playBuffer(buf); if (seg.epoch === epoch) spokenSoFar.push(`[${seg.emotion}:${Math.round(seg.intensity*100)}][mood:${seg.mood}] ${seg.text}`); }
    else { fakeTalkUntil = performance.now() + dur * 0.85; await interruptibleSleep(dur); }
    if(seg.epoch===epoch)seg.trace?.report('playback_end',{segment:seg.number,text:seg.text,emotion:seg.emotion,mood:seg.mood,intensity:seg.intensity,serious:seg.serious,audio:!!buf});
    face.speaking=false;
    await interruptibleSleep(120);
  }
  playing = false; face.speaking=false;
  doneWaiters.splice(0).forEach(f => f());
}
const playbackDone = () => (playing || queue.length ? new Promise(r => doneWaiters.push(r)) : Promise.resolve());

function showSubtitle(text) {
  const el = $('subtitle');
  const follow = !captions.reply || el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
  el.textContent = captions.addSegment(text);
  el.classList.remove('placeholder');
  if (follow) el.scrollTop = el.scrollHeight;
}

// ── parser streamu: značky emocí, [posun:N], dělení na věty ──────────────────
function makeParser(onSegment,onShift) {
  return createPerformanceParser({catalog:expressionCatalog,onSegment,onShift});
}

// ── log ──────────────────────────────────────────────────────────────────────
function addLog(kind, text, thumb = null) {
  const el = document.createElement('div');
  el.className = 'msg ' + kind;
  el.appendChild(document.createTextNode(text.replace(/\s*\[\[FOTKA\]\]/g, '')));
  if (thumb) {
    const gallery = document.createElement('div'); gallery.className = 'message-images';
    (Array.isArray(thumb) ? thumb : [thumb]).forEach((src,i) => { const img = document.createElement('img'); img.className = 'thumb'; img.src = src; img.alt = 'Obrázek '+(i+1); gallery.appendChild(img); });
    el.appendChild(gallery);
  }
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
    instability, visits, tabLeaves, roleplayPaused,
    mood:roleplayPaused?'warm':face.expression.mood,
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
  activeTrace?.report('interrupted');
  activity.outcome = 'interrupted'; activity.search = ''; activity.reasoning = false; activity.streaming = false;
  chatAbort?.abort();
  stopSpeech();
  if (bubble) bubble.firstChild.textContent += ' —';
}

async function converse(content, isEvent = false, extra = {}, photos = []) {
  if (busy || micTestMode) return;
  if (!isEvent) { roleplayPaused = roleplayPreference(content,roleplayPaused); store.set('roleplayPaused',roleplayPaused); $('opt-roleplay').checked = !roleplayPaused; setInstability(instability); }
  captions.beginReply();
  $('subtitle').textContent = 'Připravuji odpověď…';
  $('subtitle').classList.add('placeholder');
  busy = true; $('send').disabled = true;
  Object.assign(activity, { streaming: true, search: '', reasoning: false, hasText: false, outcome: 'pending', failure: '', inputError: '', voiceFailed: false, memoryError: false });
  renderActivity();
  // fotka: plná velikost jde jen s touto zprávou; do historie jen značka [[FOTKA]] a miniatura
  if (photos.length) content += ' [[FOTKA]]'.repeat(photos.length);
  const messageAt = Date.now();
  history.push({ role: 'user', content, at: messageAt, ...(photos.length ? { thumbs: photos.map(p=>p.thumb) } : {}) });
  saveHistory();
  if (!isEvent) addLog('user', content, photos.map(p=>p.thumb));
  face.thinking = true;
  bubble = null; spokenSoFar = [];
  let raw = '', sources = null;
  const trace=new DiagnosticTrace();activeTrace=trace;
  const controller = chatAbort = new AbortController();
  const parser = makeParser(seg => { if (!controller.signal.aborted) {seg.trace=trace;seg.number=++trace.segment;enqueue(seg);} }, d => setInstability(instability + d));
  const interruptedBefore = wasInterrupted; wasInterrupted = false;
  try {
    if (!isEvent) await updateMemory(content, messageAt, controller.signal);
    if (controller.signal.aborted) throw new DOMException('Přerušeno', 'AbortError');
    const r = await fetch('api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({
        messages: contextMessages(history, memory).map(({ role, content }) => ({ role, content })),
        memory,conversationId:diagnosticConversationId,
        state: buildState({ ...extra, interrupted: interruptedBefore }),
        ...(photos.length ? { images: photos.map(p=>p.image) } : {}),
        thinking: extra.liveVoice && thinkMode === 'auto' ? 'off' : thinkMode,
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
        if(ev.diagnostics)trace.accept(ev.diagnostics);
        if (ev.t) { activity.hasText = true; raw += ev.t; parser.feed(ev.t); }
        if (ev.search) { activity.search = String(ev.search); face.searching = true; }
        if ('thinking' in ev) activity.reasoning = !!ev.thinking;
        if (ev.sources) { activity.search = ''; sources = ev.sources; face.searching = false; }
        if (ev.error) throw new Error(ev.error);
      }
    }
    parser.end();
  } catch (e) {
    if (!controller.signal.aborted) {
      parser.end();
      trace.report('client_error',{error:e.message});
      activity.failure = 'Spojení se přerušilo. Zkus zprávu odeslat znovu.';
      addLog('event', '· spojení se přerušilo ·');
      console.error(e);
    }
  }
  activity.streaming = false; activity.reasoning = false; activity.search = '';
  if (!controller.signal.aborted && !stripTags(raw) && !activity.failure) activity.failure = 'Nepřišla žádná odpověď. Zkus zprávu odeslat znovu.';
  face.searching = false;
  await playbackDone();
  // [přerušeno] model uvidí v historii; v logu i TTS se značky odstraňují
  // Při přerušení si Verity pamatuje dokončené věty; nedokončená věta se vynechá.
  // [přerušeno] uvidí model,
  // v logu i TTS se značky odstraňují.
  const said = controller.signal.aborted ? [...spokenSoFar, '[přerušeno]'].join(' ') : raw.trim();
  if (raw.trim()) { history.push({ role: 'assistant', content: said, at: Date.now() }); saveHistory(); }
  if (sources?.length && bubble) {
    const s = document.createElement('span'); s.className = 'src';
    sources.forEach(x => { const a = document.createElement('a'); a.href = x.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = x.title.slice(0, 40); s.appendChild(a); });
    bubble.appendChild(s);
  }
  face.thinking = false;
  if (chatAbort === controller) chatAbort = null;
  if(activeTrace===trace)activeTrace=null;
  busy = false; $('send').disabled = photoPreparing;
  activity.outcome = controller.signal.aborted ? 'interrupted' : activity.failure ? 'error' : 'done';
  lastVerityAt = Date.now();
  maybeCompact();
  if (!controller.signal.aborted) resumeConversation();

}

// ── adaptivní paměť: pouze doložené lidské údaje ──────────────────────────────
async function updateMemory(message, at, signal) {
  activity.memoryTasks++;
  try {
    const r = await fetch('api/memory', {method:'POST',headers:{'Content-Type':'application/json'},
      signal, body:JSON.stringify({message:message.replace(/\s*\[\[FOTKA\]\]/g,''),at,memory})});
    const d = await r.json();
    if(!r.ok)throw new Error(d.error||'Paměť se neaktualizovala');
    applyOperations(memory,d.operations);
    saveMemory(); renderMemory();
  } catch(e) {
    if(!signal?.aborted){activity.memoryError=true;console.warn('paměť:',e.message);}
  } finally { activity.memoryTasks--; }
}

// Shrnutí pouze archivuje ověřené lidské citace; nesmí znovu vyrábět fakta.
let compacting = false;
async function maybeCompact() {
  if(compacting || history.length-memory.windowStart<=WINDOW_MAX)return;
  compacting=true;activity.memoryTasks++;
  const from=memory.windowStart,chunk=history.slice(from,from+WINDOW_CHUNK);
  try{
    const r=await fetch('api/summarize',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({messages:chunk.map(({role,content,at})=>({role,content,at}))})});
    const d=await r.json();
    if(!r.ok || typeof d.summary!=='string' || d.verified!==true)throw new Error(d.error||'Neověřené shrnutí');
    if(d.summary.trim())memory.diary.push({text:d.summary.slice(0,2000),at:chunk.at(-1)?.at||Date.now(),verified:true});
    memory.windowStart=from+WINDOW_CHUNK;
    saveMemory();renderMemory();
  }catch(e){
    activity.memoryError=true;console.warn('deník:',e.message);
    // Historie zůstává uložená; omezuje se jen kontext modelu.
  }finally{compacting=false;activity.memoryTasks--;}
}
function renderMemory() {
  pruneMemory(memory);
  const facts=$('mem-facts'),diary=$('mem-diary');
  facts.innerHTML='';diary.innerHTML='';
  memory.entries.forEach(f=>{
    const li=document.createElement('li'),span=document.createElement('span');
    span.className='fact-text';span.textContent=f.text;
    const detail=f.source==='legacy'?'Starší údaj bez doloženého data':
      'Potvrzeno '+new Date(f.updatedAt).toLocaleDateString('cs-CZ');
    span.title=detail+(f.expiresAt?' · Platnost do '+new Date(f.expiresAt).toLocaleDateString('cs-CZ'):' · Do změny');
    const meta=document.createElement('small');meta.textContent=span.title;meta.style.display='block';span.appendChild(meta);
    const edit=document.createElement('button');edit.textContent='✎';edit.title='Upravit';
    const x=document.createElement('button');x.textContent='×';x.title='Zapomenout';
    x.onclick=()=>{removeEntry(memory,f.key);saveMemory();renderMemory();};
    edit.onclick=()=>editFact(li,span,f.key);span.ondblclick=()=>editFact(li,span,f.key);
    li.append(span,edit,x);facts.appendChild(li);
  });
  memory.diary.forEach(d=>{
    const li=document.createElement('li'),when=document.createElement('small');
    when.textContent=new Date(d.at).toLocaleString('cs-CZ',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})+
      (d.verified?'':' · starší neověřený zápis');
    li.append(when,document.createTextNode(' '+d.text));diary.appendChild(li);
  });
  $('mem-count').textContent=history.length+' zpráv celkem · '+memory.entries.length+' údajů · '+memory.diary.length+' zápisů. Staré dočasné údaje se automaticky promazávají.';
}
function editFact(li,span,key=null) {
  const input=document.createElement('input');
  input.className='fact-input';input.value=memory.entries.find(e=>e.key===key)?.text||'';input.maxLength=300;
  li.replaceChild(input,span);input.focus();input.select();
  let done=false;
  const save=ok=>{
    if(done)return;done=true;
    if(ok){manualEntry(memory,key,input.value);saveMemory();}
    renderMemory();
  };
  input.onkeydown=e=>{if(e.key==='Enter')save(true);if(e.key==='Escape')save(false);};
  input.onblur=()=>save(true);
}
$('mem-add').onclick=()=>{
  const li=document.createElement('li'),span=document.createElement('span');
  li.appendChild(span);$('mem-facts').appendChild(li);editFact(li,span);
};
$('opt-memory').onclick=()=>{stopMicTest();$('menu-btn').setAttribute('aria-expanded','false');saveMemory();renderMemory();$('memory-panel').hidden=false;$('menu').hidden=true;};
$('mem-close').onclick=()=>{$('memory-panel').hidden=true;};
$('mem-export').onclick=()=>{
  saveMemory();
  const blob=new Blob([JSON.stringify({version:2,history,memory,instability,visits},null,1)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='verity-pamet-'+new Date().toISOString().slice(0,10)+'.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};
$('mem-import').onclick=()=>$('mem-file').click();
$('mem-file').onchange=async e=>{
  try{
    const d=JSON.parse(await e.target.files[0].text());
    if(!Array.isArray(d.history)||!d.memory)throw new Error('neplatný soubor');
    // Originál importu lze vrátit, i když převod promaže dávno prošlé údaje.
    if(!store.set('memory-before-import',{at:Date.now(),history,memory,instability,visits}))throw new Error('Není místo pro zálohu');
    store.set('memory-import-original',d.memory);
    store.set('history',d.history);store.set('memory',normalizeMemory(d.memory));
    store.set('inst',d.instability||0);store.set('visits',d.visits||0);location.reload();
  }catch(err){alert('Paměť nejde načíst: '+err.message);}
};

function sendText(text, voice = null) {
  if ((!text && !pendingPhotos.length) || busy || photoPreparing || !awake || micTestMode) return false;
  const photos = pendingPhotos.slice(); clearPhoto();
  if (photos.length) micState('');
  text = text || (photos.length > 1 ? 'Podívej, posílám ti '+photos.length+' obrázků.' : 'Podívej, posílám ti fotku.');
  captions.rememberUser(text);
  $('msg').value = '';
  lastUserAt = Date.now(); idleCount = 0;
  converse(text, false, voice ? { viaVoice: true, liveVoice: voice.live === true, ambience: voice.ambience } : {}, photos);
  return true;
}

// ── fotky (vision) ───────────────────────────────────────────────────────────
let pendingPhotos = [], photoPreparing = false;
function renderPhotos() {
  $('attach').hidden = !pendingPhotos.length;
  $('attach-count').textContent = pendingPhotos.length + ' / ' + MAX_IMAGES + ' obrázků';
  $('attach-list').replaceChildren();
  pendingPhotos.forEach((photo,index) => {
    const item = document.createElement('div'); item.className = 'attach-item';
    const img = document.createElement('img'); img.src = photo.thumb; img.alt = 'Obrázek ' + (index+1);
    const number = document.createElement('span'); number.textContent = index+1;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon';
    remove.textContent = '×'; remove.setAttribute('aria-label','Odebrat obrázek '+(index+1));
    remove.onclick = () => { pendingPhotos.splice(index,1); renderPhotos(); micState(pendingPhotos.length ? pendingPhotos.length + ' / ' + MAX_IMAGES + ' obrázků připraveno.' : 'Obrázky odebrány.'); };
    item.append(img,number,remove); $('attach-list').appendChild(item);
  });
}
function clearPhoto() { pendingPhotos = []; renderPhotos(); }
$('attach-x').onclick = () => { clearPhoto(); micState('Obrázky odebrány.'); };
setupPhoto({
  getCount: () => pendingPhotos.length,
  onBusy: value => {
    photoPreparing = value;
    $('send').disabled = busy || value;
    $('attach-x').disabled = value;
    if (value) {
      if (liveSession || liveStarting) stopLive({message:'Připravuji obrázky. Pak zprávu odešli tlačítkem.'});
      if (mic || micStarting) cancelMic();
      openChat(true);
    }
  },
  onPhoto: p => {
    requestImages({images:[...pendingPhotos.map(x=>x.image),p.image]});
    pendingPhotos.push(p); renderPhotos();
    if (!busy && !playing) face.setEmotion('curious');
    micState(pendingPhotos.length + ' / ' + MAX_IMAGES + ' obrázků připraveno – připiš zprávu nebo rovnou odešli.');
    openChat(true);
  },
  onError: m => micState(m, true),
});
$('form').addEventListener('submit', e => {
  e.preventDefault();
  if (liveSession || liveStarting) { stopLive({ send: true }); return; }
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
let micTestMode = false, micTestStarting = false, micTestSession = null, micTestGeneration = 0, micTestTimer = null;
let mic = null, micStarting = false, micGeneration = 0, micFinishing = false, micBase = '', micTimer = null, convWatch = null;
let autoSend = store.get('autoSend', true);
let convMode = store.get('conv', false);
let sileroVad = store.get('silero', true);
const savedThreshold = store.get('micThresholdDb', -50);
let micThreshold = Number.isFinite(savedThreshold) ? clamp(savedThreshold, -70, -10) : -50;
const savedOutput = store.get('outputMode', 'aec');
let outputMode = ['speakers', 'aec', 'headphones'].includes(savedOutput) ? savedOutput : 'aec';
let liveMode = store.get('live', true), liveSession = null, liveStarting = false, liveGeneration = 0;
let livePending = [], liveDrain = null, liveBase = '';
const sendsAuto = () => autoSend || convMode;
const micSupported = !!(navigator.mediaDevices?.getUserMedia && window.AudioWorkletNode && window.isSecureContext);
function micState(text, error = false) {
  activity.inputError = error ? text : '';
  const el = $('mic-state');
  el.textContent = text || ''; el.hidden = !text; el.classList.toggle('err', error);
}
// Ukazatel detekce řeči: úroveň mikrofonu (−70…−10 dBFS), čárka = práh začátku řeči,
// šedá oblast = šum pozadí; zelená = VAD právě detekuje řeč (ta se posílá k přepisu).
// Ruční práh platí i se Silero: hlas musí překročit práh a zároveň ho musí poznat síť.
const dbToPct = db => Math.max(0, Math.min(100, (db + 70) / 60 * 100));
function vadMeter(v) {
  $('vad-fill').style.width = dbToPct(v.db) + '%';
  $('vad-noise').style.width = dbToPct(v.noiseDb) + '%';
  $('vad-thr').style.left = dbToPct(v.onDb) + '%';
  $('vad-thr').style.display = '';
  $('vad').classList.toggle('suppressed', !!v.suppressed);
  $('vad').classList.toggle('speaking', v.speaking && v.voiced && !v.suppressed);
  $('vad-label').textContent = v.suppressed ? 'ozvěna blokována' : (v.speaking && v.voiced ? 'MLUVÍŠ' : 'pod prahem / ticho') + (v.neural ? ` · ${Math.round(v.prob * 100)} %` : '');
}
function thresholdUi() {
  $('mic-threshold').value = micThreshold;
  $('mic-threshold').setAttribute('aria-valuetext', micThreshold + ' decibelů; doprava méně citlivý');
  $('vad-threshold-value').textContent = micThreshold + ' dB';
  $('vad-thr').style.left = dbToPct(micThreshold) + '%';
}
thresholdUi();
$('mic-threshold').oninput = e => {
  micThreshold = clamp(Number(e.target.value), -70, -10);
  store.set('micThresholdDb', micThreshold); thresholdUi();
};
function micUi(on) {
  $('vad').classList.toggle('active', on);
  $('mic').classList.toggle('rec', on);
  $('mic').setAttribute('aria-pressed', on);
  $('msg').readOnly = on;           // během nahrávání by přepis přepsal ruční úpravy
  face.listening = on;
  if (!on) {face.hear = 0;face.userSpeaking=false;}
}
const listeningText = () => (convMode ? 'Konverzace – poslouchám, odešlu po pauze' : autoSend ? 'Poslouchám… odešlu po pauze' : 'Poslouchám… (Odeslat nebo znovu mikrofon)');
async function startMic({ fromConv = false } = {}) {
  if (micTestMode || photoPreparing || mic || micStarting || micFinishing || liveSession || liveStarting || !awake) return;
  micStarting = true; activity.outcome = 'idle'; activity.failure = ''; activity.inputError = '';
  const generation = ++micGeneration;
  micBase = $('msg').value.trim();
  if (!fromConv && (busy || playing)) interrupt();   // skočit Verity do řeči
  if (music.gain) music.gain.gain.value = 0;
  micState('Zapínám mikrofon…');
  try {
    await initAudio();
    if (generation !== micGeneration) return;
    await prepareEchoOutput();
    if (generation !== micGeneration) return;
    const { startMicrophone } = await import('./live-audio.js?v=20261108-6');
    const opened = await startMicrophone({
      pauseSeconds: 2.2, vad: sileroVad, debug: false, audioContext: actx,
      getThreshold: () => micThreshold, suppressInput: inputSuppressed, echoCancellation: outputMode === 'aec',
      onText: (t, { partial }) => {
        if (generation !== micGeneration) return;
        $('msg').value = [micBase, t].filter(Boolean).join(' ');
        if (mic) micState(partial ? 'Poslouchám… (přepis se upřesňuje)' : 'Poslouchám…');
      },
      onState: (m, err) => { if (generation === micGeneration) micState(m, err); },
      onLevel: v => {
        if (generation !== micGeneration) return;
        face.userSpeaking=!!v.speaking;
        face.hear += ((v.speaking ? v.level : v.level * 0.3) - face.hear) * 0.4;
        if (v.speaking) lastUserAt = Date.now();
        vadMeter(v);
      },
      onPause: () => { if (generation === micGeneration && sendsAuto()) finishMic(true); },
    });
    if (generation !== micGeneration) { await opened.cancel(); return; }
    mic = opened;
    confirmEchoMode(opened.engine);
  } catch (e) {
    if (generation !== micGeneration) return;
    mic = null; releaseEchoOutput();
    micState(microphoneError(e), true);
    return;
  } finally { if (generation === micGeneration) micStarting = false; }
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
  micGeneration++; micStarting = false;
  if (!liveSession) releaseEchoOutput();
  if (!mic) { micUi(false); micState(message); return; }
  const m = mic; mic = null;
  clearTimeout(micTimer); clearInterval(convWatch);
  micUi(false);
  micState(message);
  await m.cancel().catch(() => {});
}
// po dohrání odpovědi v konverzačním režimu rovnou poslouchat
function resumeConversation() {
  if (micTestMode || liveMode || !convMode || !micSupported || !awake || document.hidden) return;
  setTimeout(() => { if (!micTestMode && !liveMode && !busy && !playing && !mic && !micFinishing) startMic({ fromConv: true }); }, 400);
}
async function finishMic(send) {
  if (!mic) return;
  const m = mic; mic = null; micFinishing = true;
  clearTimeout(micTimer); clearInterval(convWatch);
  micUi(false);
  micState('Dokončuji přepis…');
  let text = '', failed = false;
  try { text = await m.stop(); } catch (e) { failed = true; micState(e.message + ' Text můžeš opravit a poslat ručně.', true); }
  const full = failed ? $('msg').value.trim() : [micBase, text].filter(Boolean).join(' ').trim();
  $('msg').value = full;
  micFinishing = false; releaseEchoOutput();
  if (!failed) micState(m.engine.archiveWarning || '', !!m.engine.archiveWarning);
  // automatické odeslání jen po úspěšném finálním přepisu
  if (send && !failed && full) {
    if (busy) await new Promise(r => { const t = setInterval(() => { if (!busy) { clearInterval(t); r(); } }, 100); });
    sendText(full, { ambience: m.engine.ambience() });
  } else if (full || failed) openChat(true);
}
$('mic').hidden = !micSupported;
$('mic').onclick = () => {
  if (micFinishing) return;
  if (liveMode) return liveSession || liveStarting ? stopLive() : startLive();
  return micStarting ? cancelMic() : mic ? finishMic(false) : startMic();
};
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
$('opt-silero').checked = sileroVad;
// Silero načíst dopředu ve workeru, ať se 15 MB WASM nekompiluje až v okamžiku nahrávání.
const preloadSilero = () => { if (sileroVad && micSupported) import('./vad.js?v=20261107-2').then(m => m.preload()).catch(() => {}); };
if (window.requestIdleCallback) window.requestIdleCallback(preloadSilero, { timeout: 1500 });
else setTimeout(preloadSilero, 1500);
$('opt-silero').onchange = e => { sileroVad = e.target.checked; store.set('silero', sileroVad); preloadSilero(); if(micTestMode) startMicTest(); };   // platí od dalšího zapnutí mikrofonu


// ── experimentální živý rozhovor: jeden vstup, nezávislé tahy ────────────────
function liveUi(on) {
  $('live-panel').hidden = !on;
  $('mic').setAttribute('aria-label', on ? 'Ukončit živý rozhovor' : 'Mluvit');
  $('mic').title = on ? 'Ukončit živý rozhovor' : 'Mluvit';
  micUi(on);
}
async function deliverLive(turn, generation) {
  if (generation !== liveGeneration) return;
  livePending.push(turn);
  if (liveDrain) return;
  const marker = {}; liveDrain = marker;
  try {
    if (busy || playing) interrupt();
    const deadline = Date.now() + 10000;
    while (busy && generation === liveGeneration && Date.now() < deadline) await sleep(50);
    if (generation !== liveGeneration) return;
    if (busy) { await stopLive({ message: 'Odpověď se nepodařilo přerušit. Text zůstal rozepsaný.', error: true }); return; }
    const turns = livePending.splice(0);
    const text = turns.map(t => t.text).join(' ').trim();
    // Nová řeč už může být rozepsaná, zatímco čekáme na uvolnění staré odpovědi.
    const draft = $('msg').value;
    if (text) sendText(text, { live: true, ambience: turns.at(-1)?.ambience });
    $('msg').value = draft;
  } finally { if (liveDrain === marker) liveDrain = null; }
}
async function startLive() {
  if (micTestMode || photoPreparing || liveSession || liveStarting || micFinishing || !awake || !micSupported) return;
  liveStarting = true; activity.outcome = 'idle'; activity.failure = ''; activity.inputError = '';
  const generation = ++liveGeneration;
  await cancelMic();
  if (generation !== liveGeneration) return;
  liveBase = $('msg').value.trim();
  if (busy || playing) interrupt();
  if (music.gain) music.gain.gain.value = 0;
  liveUi(true); outputModeUi(); micState('Živý rozhovor se zapíná…');
  try {
    await initAudio();
    if (generation !== liveGeneration) return;
    await prepareEchoOutput();
    if (generation !== liveGeneration) return;
    const { startDialogue } = await import('./dialogue.js?v=20261108-6');
    const opened = await startDialogue({
      audioContext: actx, vad: sileroVad,
      getThreshold: () => micThreshold, suppressInput: inputSuppressed, echoCancellation: outputMode === 'aec',
      isAnswering: () => busy || playing,
      onText: text => {
        if (generation !== liveGeneration) return;
        $('msg').value = [liveBase, text].filter(Boolean).join(' ');
        micState('Živě · přepis se upřesňuje');
      },
      onState: (text, error) => {
        if (generation !== liveGeneration) return;
        micState(text, error);
        if (error) stopLive({ message: text + ' Text můžeš upravit a poslat ručně.', error: true });
      },
      onLevel: v => {
        if (generation !== liveGeneration) return;
        vadMeter(v);
        face.userSpeaking=!!v.speaking;
        face.hear += ((v.speaking ? v.level : 0) - face.hear) * 0.4;
        if (v.speaking) lastUserAt = Date.now();
        $('live-takeover').disabled = !busy && !playing && !current;
        $('live-status').textContent = v.suppressed ? (current ? 'Mluvím · vstup je blokovaný' : 'Čekám na dozvuk…') : v.speaking && v.voiced ? 'Slyším tě' : current ? 'Mluvím · můžeš mě přerušit' : busy ? 'Připravuji odpověď · poslouchám dál' : 'Poslouchám';
      },
      onInterrupt: () => { if (generation === liveGeneration) { interrupt(); micState('Živě · máš slovo'); } },
      onTurn: turn => {
        if (generation !== liveGeneration) return;
        turn.text = [liveBase, turn.text].filter(Boolean).join(' '); liveBase = '';
        captions.rememberUser(turn.text);
        $('msg').value = '';
        micState('Živě · zpráva odeslaná, poslouchám dál');
        deliverLive(turn, generation);
      },
      onIdle: message => { if (generation === liveGeneration) stopLive({ message: message || 'Živý rozhovor se po dvou minutách ticha ukončil.' }); },
    });
    if (generation !== liveGeneration) { await opened.cancel(); return; }
    liveSession = opened;
    outputModeUi();
    const fallback = confirmEchoMode(opened.engine);
    micState(fallback ? 'Potlačení ozvěny není dostupné. Bezpečně střídáme mluvení a poslech.' : 'Živě · odesílám po pauze. Citlivost najdeš v nastavení.');
  } catch (e) {
    if (generation !== liveGeneration) return;
    liveUi(false); releaseEchoOutput();
    micState(microphoneError(e), true);
  } finally { if (generation === liveGeneration) liveStarting = false; }
}
async function stopLive({ send = false, message = 'Živý rozhovor skončil. Rozepsaný text můžeš poslat ručně.', error = false } = {}) {
  const session = liveSession;
  if (session || liveStarting) interrupt();
  const generation = ++liveGeneration;
  liveSession = null; liveStarting = false;
  releaseEchoOutput();
  const pending = livePending.splice(0).map(t => t.text).join(' ');
  liveDrain = null;
  const draft = [pending, $('msg').value.trim()].filter(Boolean).join(' ');
  const base = liveBase; liveBase = '';
  $('msg').value = draft;
  liveUi(false); micState(message, error);
  if (!session) return;
  micFinishing = true;
  try {
    // Běžné ukončení zachová už zobrazený přepis a ihned uvolní zařízení.
    const text = send ? await session.stop() : (await session.cancel(), '');
    if (generation !== liveGeneration) return;
    $('msg').value = send && text ? [pending, base, text].filter(Boolean).join(' ') : draft;
    if (send && $('msg').value.trim()) {
      interrupt();
      const deadline = Date.now() + 10000;
      while (busy && Date.now() < deadline) await sleep(50);
      if (generation === liveGeneration) sendText($('msg').value.trim(), { live: true, ambience: session.engine.ambience() });
    }
  } catch (e) { if (generation === liveGeneration) { $('msg').value = draft; micState(e.message + ' Text zůstal rozepsaný.', true); } }
  finally { micFinishing = false; }
}
function liveOptions() {
  $('opt-auto').disabled = $('opt-conv').disabled = liveMode;
  $('opt-live').checked = liveMode;
}
$('opt-live').closest('label').hidden = !micSupported;
liveOptions();
$('opt-live').onchange = async e => {
  liveMode = e.target.checked; store.set('live', liveMode); liveOptions();
  await cancelMic();
  if (liveMode) { if (awake) startLive(); }
  else await stopLive({ message: 'Zpátky v běžném režimu mluvení.' });
};
$('live-end').onclick = () => stopLive();
$('live-takeover').onclick = () => {
  interrupt();
  speakerTailUntil = performance.now() + 900;
  micState('Máš slovo za okamžik, až dozní reproduktor.');
};
function outputModeUi() {
  $('opt-output').value = outputMode;
  const note = outputMode === 'speakers' ? 'Reproduktory: při odpovědi vstup stojí. Přeruš tlačítkem Chci mluvit.' : outputMode === 'aec' ? 'AEC: můžeš přerušit hlasem. Při ozvěně nebo praskání přepni na střídání.' : 'Sluchátka: poslech i přerušení hlasem bez zvukových filtrů.';
  $('output-note').textContent = note;
  $('live-hint').textContent = note;
  renderVoiceControls();
}
outputModeUi();
$('opt-output').onchange = async e => {
  outputMode = e.target.value; store.set('outputMode', outputMode); outputModeUi();
  if (micTestMode) { startMicTest(); return; }
  if (mic || micStarting || liveSession || liveStarting) {
    await cancelMic();
    await stopLive({ message: 'Zvukový režim změněn. Mikrofonem zahaj nový poslech.' });
  }
};
window.addEventListener('pagehide', () => { stopMicTest(); if (liveSession || liveStarting) stopLive(); });

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
  if (!awake || micTestMode || liveMode || busy || playing || mic || micFinishing || liveSession || liveStarting || document.hidden || idleCount >= 3) return;
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
// Displej držíme pro celou viditelnou stránku, i před probuzením a bez mikrofonu.
const screenAwake=createScreenAwake({onState:state=>{ $('screen-awake-status').textContent=screenAwakeLabel(state); }});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopMicTest({keepMode:!$('menu').hidden});
    if (liveSession || liveStarting) stopLive({ message: 'Živý rozhovor je pozastavený. Spusť ho znovu mikrofonem.' });
    hiddenAt = Date.now(); tabLeaves++;
    document.title = 'Verity · kde jsi?';
    if (instability > 50) titleTimer = setInterval(() => { document.title = document.title.startsWith('VRAŤ') ? 'Verity · kde jsi?' : 'VRAŤ SE'; }, 1500);
  } else {
    clearInterval(titleTimer); document.title = 'Verity';
    const away = hiddenAt ? (Date.now() - hiddenAt) / 1000 : 0;
    hiddenAt = null;
    if (awake && !micTestMode && !liveMode && away > 15 && !busy) {
      setInstability(instability + 3 + Math.min(10, away / 60));
      const t = away < 120 ? `${Math.round(away)} sekund` : `${Math.round(away / 60)} minut`;
      converse(`[[UDÁLOST]] Člověk se právě vrátil do tvé záložky. Byl ${t} pryč, někde jinde. Už ${tabLeaves}× za tuhle návštěvu.`, true);
    }
  }
});
setInterval(() => store.set('lastSeen', Date.now()), 30000);
window.addEventListener('beforeunload', e => {
  store.set('lastSeen', Date.now());
  if (awake && !liveMode && instability > 65) { e.preventDefault(); e.returnValue = ''; }
});

// ── glitch ───────────────────────────────────────────────────────────────────
// „Bez blikání“: vypne glitch a problikávání scanlines (ochrana citlivých lidí); zapne se samo
// při systémovém omezení pohybu.
let noFlash = store.get('noFlash', false);
const flashOff = () => noFlash || reducedMotion.matches;
function applyNoFlash() { document.body.classList.toggle('noflash', flashOff()); face.reducedMotion=reducedMotion.matches;face.noFlash=flashOff(); }
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
    for(const id of ['diagnostic-notice','diagnostic-notice-wake']){const el=$(id);if(el){el.hidden=!s.diagnostics?.enabled;el.textContent='Pro ladění se text rozhovoru a průběh odpovědí uchovává na serveru až '+(s.diagnostics?.retentionDays||7)+' dní. Fotky ani zvuk se do logu neukládají.';}}
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

function micTestStatus(text, error = false) {
  $('mic-test-status').textContent = text;
  $('mic-test-status').classList.toggle('err',error);
}
function resetMicTestMeter() {
  $('mic-test-level').textContent = '— dBFS';
  $('mic-test-prob').textContent = '—';
  $('mic-test-state').textContent = 'Vypnutý';
  $('mic-test-state').dataset.signal = 'quiet';
  $('vad-fill').style.width = '0%';
  $('vad').classList.remove('active','speaking','suppressed');
  $('vad-label').textContent = 'test vypnutý';
}
async function stopMicTest({ keepMode = false } = {}) {
  micTestGeneration++; micTestStarting = false;
  if (!keepMode) micTestMode = false;
  clearTimeout(micTestTimer);
  const session = micTestSession; micTestSession = null;
  resetMicTestMeter();
  $('mic-test-retry').disabled = false;
  micTestStatus('Test je vypnutý. Hovor znovu spustíš hlavním mikrofonem.');
  if (session) await session.cancel().catch(() => {});
}
async function startMicTest() {
  if ($('menu').hidden || document.hidden) return;
  micTestMode = true; micTestStarting = true;
  const generation = ++micTestGeneration;
  const isCurrent = () => micTestMode && generation === micTestGeneration && !$('menu').hidden && !document.hidden;
  const previous = micTestSession; micTestSession = null;
  clearTimeout(micTestTimer);
  resetMicTestMeter();
  $('mic-test-state').textContent = 'Zapínám…';
  $('mic-test-retry').disabled = true;
  micTestStatus('Připravuji místní test. Zvuk se nikam neposílá.');
  interrupt();
  try {
    if (previous) await previous.cancel().catch(() => {});
    if (!isCurrent()) return;
    await cancelMic();
    if (liveSession || liveStarting) await stopLive({message:''});
    if (!isCurrent()) return;
    if (!micSupported) throw new Error('Tento prohlížeč mikrofon nepodporuje.');
    await initAudio();
    if (!isCurrent()) return;
    const { startMicrophone } = await import('./live-audio.js?v=20261108-6');
    const opened = await startMicrophone({
      monitorOnly:true, debug:false, vad:sileroVad, audioContext:actx,
      echoCancellation:outputMode === 'aec', getThreshold:()=>micThreshold,
      onLevel:v => {
        if (!isCurrent()) return;
        $('vad').classList.add('active');
        vadMeter(v);
        const passed = v.speaking && v.voiced;
        $('mic-test-level').textContent = Math.round(v.db) + ' dBFS';
        $('mic-test-prob').textContent = v.neural ? Math.round(v.prob * 100) + ' %' : 'podle hlasitosti';
        const badge = $('mic-test-state');
        badge.textContent = passed ? 'Řeč prochází' : v.db < v.onDb ? 'Pod prahem' : 'Čekám na řeč';
        badge.dataset.signal = passed ? 'speech' : v.db < v.onDb ? 'quiet' : 'sound';
      },
      onState:(text,error) => { if (isCurrent()) micTestStatus(text,error); },
      onEnded:() => { if (isCurrent()) stopMicTest({keepMode:true}).then(()=>{ if(micTestMode && micTestGeneration === generation+1) micTestStatus('Mikrofon se odpojil. Připoj ho a zkus test znovu.',true); }); },
    });
    if (!isCurrent()) { await opened.cancel(); return; }
    micTestSession = opened;
    $('vad').classList.add('active');
    micTestStatus('Mluv a posouvej práh. Zeleně = řeč by prošla. Tento test nic neodesílá ani neukládá.');
    micTestTimer = setTimeout(() => {
      if (isCurrent()) stopMicTest({keepMode:true}).then(()=>{ if(micTestMode && micTestGeneration === generation+1) micTestStatus('Test se po třech minutách vypnul. Můžeš ho spustit znovu.'); });
    },180000);
  } catch(e) {
    if (isCurrent()) { resetMicTestMeter(); micTestStatus(microphoneError(e),true); }
  } finally {
    if (generation === micTestGeneration) { micTestStarting = false; $('mic-test-retry').disabled = false; }
  }
}

function setMenu(open) {
  $('menu').hidden = !open;
  $('menu-btn').setAttribute('aria-expanded', String(open));
  if (open) { closeChat(false); $('menu-close').focus(); startMicTest(); }
  else { stopMicTest(); $('menu-btn').focus(); }
}
function closeChat(focus = true) {
  $('chat-panel').hidden = true;
  $('show-chat').setAttribute('aria-expanded','false');
  document.body.classList.remove('chat-open');
  if (focus) $('show-chat').focus();
}
function openChat(focusInput = false) {
  stopMicTest();
  $('menu').hidden = true; $('menu-btn').setAttribute('aria-expanded','false');
  $('chat-panel').hidden = false;
  $('show-chat').setAttribute('aria-expanded','true');
  document.body.classList.add('chat-open');
  scrollLog();
  if (focusInput) $('msg').focus(); else $('chat-close').focus();
}
$('menu-btn').onclick = () => setMenu($('menu').hidden);
$('menu-close').onclick = () => setMenu(false);
$('mic-test-retry').onclick = () => startMicTest();
$('show-chat').onclick = () => $('chat-panel').hidden ? openChat() : closeChat();
$('chat-close').onclick = () => closeChat();
$('write-message').onclick = async () => {
  await cancelMic();
  if (liveSession || liveStarting) await stopLive({message:''});
  openChat(true);
};
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('memory-panel').hidden) { $('mem-close').click(); return; }
  if (!$('menu').hidden) setMenu(false);
  else if (!$('chat-panel').hidden) closeChat();
});
// podkres: ♪ v liště + hlasitost / opakování v menu
$('music-btn').onclick = () => toggleMusic();
$('music-play').onclick = () => toggleMusic();
$('music-vol').value = musicVol;
$('music-vol').oninput = e => { musicVol = +e.target.value; store.set('musicVol', musicVol); };
// přemýšlení (reasoning): auto / off / on
$('opt-roleplay').checked = !roleplayPaused;
$('opt-roleplay').onchange = e => { roleplayPaused = !e.target.checked; store.set('roleplayPaused',roleplayPaused); setInstability(instability); if(roleplayPaused)face.perform({emotion:'calm',mood:'warm',intensity:.45}); };
$('opt-idle-animations').checked=face.idleEnabled;
$('opt-idle-animations').onchange=e=>{face.idleEnabled=e.target.checked;store.set('idleAnimations',face.idleEnabled);face.idle.cancel(performance.now());};
$('opt-expressiveness').value=Math.round(face.motion*100);
$('expressiveness-value').textContent=Math.round(face.motion*100)+' %';
$('opt-expressiveness').oninput=e=>{const value=clamp(Number(e.target.value),0,100);face.motion=value/100;store.set('expressiveness',value);$('expressiveness-value').textContent=value+' %';};
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
  ['history', 'memory', 'memory-backup-v1', 'memory-before-import', 'memory-import-original', 'inst', 'visits', 'lastSeen'].forEach(k => { try { localStorage.removeItem('verity.' + k); } catch { /* */ } });
  location.reload();
};

// ── probuzení ────────────────────────────────────────────────────────────────
history.filter(m => !m.content.startsWith('[[UDÁLOST]]')).slice(-300)
  .forEach(m => addLog(m.role === 'user' ? 'user' : 'verity', m.role === 'user' ? m.content : stripTags(m.content), m.thumbs || m.thumb));

async function wake({ voice = true } = {}) {
  if (awake) return;
  await initAudio();
  if (store.get('music', false)) toggleMusic(true);   // podkres hrál i minule → pokračovat
  awake = true;
  visits++; store.set('visits', visits);
  $('wake').classList.add('gone');
  $('wake').hidden = true;
  if (!voice) openChat(true);
  lastUserAt = lastVerityAt = Date.now();
  const statusReady = pollStatus();
  if (voice && micSupported) {
    if (liveMode) await startLive(); else await startMic();
  } else if (voice) openChat(true);
  await statusReady;
  const hours = lastSeen ? Math.round((Date.now() - lastSeen) / 36e5) : null;
  if (lastSeen && Date.now() - lastSeen > 3600000) { memory.sessionStart=history.length; saveMemory(); }
  // Při odmítnutí mikrofonu nebo během vlastní řeči nevynucuj pozdrav.
  if (voice && (!liveSession && !mic || $('msg').value.trim() || busy || playing)) return;
  if (!history.length) {
    converse('[[UDÁLOST]] Člověk tě právě poprvé probudil. Ještě jste se nikdy neviděli. Krátce se představ a zeptej se, jak se jmenuje.', true);
  } else {
    if (hours > 12) setInstability(instability + Math.min(15, hours / 4));
    converse(`[[UDÁLOST]] Člověk se vrátil a znovu tě probudil, po ${hours ?? '?'} hodinách. Krátce ho přivítej jménem, pokud ho znáš. Neobnovuj staré úkoly, hledání ani plány a nevynucuj zmínku o paměti; počkej, s čím přijde.`, true);
  }
}
$('wake-btn').onclick = () => wake().catch(e => { micState('Zvuk nejde spustit: '+e.message,true); });
$('wake-write').onclick = () => wake({voice:false}).catch(e => { micState(e.message,true); });

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


// Samostatný viditelný ukazatel. DOM měníme jen při změně stavu (i pro čtečky obrazovky).
let lastActivityView = '';
function renderVoiceControls() {
  face.awake=awake; face.attending=micTestMode||photoPreparing||(document.activeElement===$('msg')&&!!$('msg').value.trim());
  $('emotion-status').hidden=!awake;
  const active = !!(mic || liveSession), starting = micStarting || liveStarting;
  const label = micTestMode ? 'Test v nastavení' : microphoneLabel({liveMode,active,starting,finishing:micFinishing,supported:micSupported});
  $('mic-caption').textContent = label;
  $('mic').setAttribute('aria-label',label); $('mic').title = label;
  $('mic').classList.toggle('starting',starting);
  $('mic').disabled = micFinishing || micTestMode;
  $('call-note').textContent = micTestMode ? 'Test mikrofonu · bez odesílání' : !micSupported ? 'Můžeš mi napsat zprávu.' : starting ? 'Připojuji mikrofon…' : active ? (liveMode ? 'Odesílám po pauze · poslouchám dál' : sendsAuto() ? 'Odesílám po pauze' : 'Po nahrání můžeš zprávu upravit') : 'Mikrofon je vypnutý';
  $('conversation-captions').hidden = !awake;
  const userView = captions.userView($('msg').value, {capturing:active || starting, finishing:micFinishing});
  const userEl = $('voice-draft');
  if (userEl.textContent !== userView.text) { userEl.textContent = userView.text; userEl.scrollTop = userEl.scrollHeight; }
  userEl.classList.toggle('placeholder',userView.placeholder);
  $('voice-draft-label').textContent = userView.label;
  const answering = !!(busy || playing || current);
  $('live-takeover').hidden = !awake || !answering;
  $('live-takeover').disabled = !answering;
}
function renderActivity() {
  renderVoiceControls();
  const engine = liveSession?.engine || mic?.engine;
  const state = micTestMode ? {key:'mic-test',tone:'idle',title:'Test mikrofonu',detail:'Zvuk zůstává v prohlížeči. Hovor je pozastavený.'} : describeActivity({ ...activity, awake, busy, playing,
    speaking: !!current, voiceWaiting: ttsControllers.size > 0,
    inputStarting: micStarting || liveStarting,
    transcribing: micFinishing || !!(engine && !engine.inputSuppressed &&
      (engine.pending || engine.segments.some(s => !s.done))),
    hearing: !!engine?.speaking, suppressed: !!engine?.inputSuppressed,
    listening: !!(mic || liveSession),
  });
  if (activity.failure && !captions.reply) $('subtitle').textContent = 'Odpověď se nepodařilo dokončit.';
  const signature = JSON.stringify(state);
  if (signature === lastActivityView) return;
  lastActivityView = signature;
  const el = $('activity');
  el.hidden = !awake;
  el.dataset.state = state.key; el.dataset.tone = state.tone;
  $('activity-title').textContent = state.title;
  $('activity-detail').textContent = state.detail;
  $('activity-symbol').textContent = state.tone === 'done' ? '✓' : state.tone === 'error' ? '!' : state.key === 'interrupted' ? 'Ⅱ' : '•';
}
setInterval(renderActivity, 150);
renderActivity();
