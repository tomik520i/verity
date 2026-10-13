// Verity – malý server bez závislostí (Node 18+).
// Statické soubory + /api/chat (SSE stream z llama.cpp, s hledáním na webu)
// + /api/tts (OmniVoice → WAV) + /api/status.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { buildSystemPrompt, buildContextNote, EMOTIONS, SUMMARY_PROMPT, detectCrisis, detectSearch, detectCalc } = require('./prompt');

const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, fs.existsSync(path.join(__dirname, 'config.json')) ? 'config.json' : 'config.example.json'), 'utf8'));
// Klíč k interní Whisper službě je v samostatném souboru (chmod 600), ne v config.json.
if (CFG.stt?.key_file) {
  try { CFG.stt.key = fs.readFileSync(path.resolve(__dirname, CFG.stt.key_file), 'utf8').trim(); } catch { console.warn('[stt] chybí soubor s klíčem', CFG.stt.key_file); }
}
const PUBLIC = path.join(__dirname, 'public');
const SEARCH_PY = CFG.search?.python || 'python3';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.json': 'application/json', '.md': 'text/plain; charset=utf-8' };

// ── GPU „tělo“ ───────────────────────────────────────────────────────────────
let gpu = null;
function pollGpu() {
  execFile('nvidia-smi', ['--query-gpu=temperature.gpu,utilization.gpu,memory.used,memory.total',
    '--format=csv,noheader,nounits'], { timeout: 5000 }, (err, out) => {
    if (err) return;
    const [temp, util, mem, total] = out.trim().split(',').map(Number);
    gpu = { temp, util, mem, total };
  });
}
pollGpu();
setInterval(pollGpu, 15000);

// ── helpers ──────────────────────────────────────────────────────────────────
function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
async function ping(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(2500) }); return r.ok; } catch { return false; }
}
function describeDevice(ua = '') {
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android telefon' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad'
    : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : null;
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  return [br, os].filter(Boolean).join(' na ') || null;
}

// ── LLM stream ───────────────────────────────────────────────────────────────
// Zavolá llama.cpp se streamem, text posílá do onText. Vrací po skončení/abortu.
async function streamLLM(messages, onText, controller) {
  const r = await fetch(CFG.llm.url + '/v1/chat/completions', {
    method: 'POST', signal: controller.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages, stream: true,
      temperature: CFG.llm.temperature, top_p: CFG.llm.top_p,
      presence_penalty: CFG.llm.presence_penalty, max_tokens: CFG.llm.max_tokens,
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  if (!r.ok) throw new Error('LLM HTTP ' + r.status);
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for await (const chunk of r.body) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const t = JSON.parse(data).choices?.[0]?.delta?.content;
          if (t) onText(t);
        } catch { /* neúplný řádek */ }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError' && !controller.signal.aborted) throw e;
  }
}

// Filtr, který propouští text, ale zachytí značku [hledat: ...] a přeruší generování.
function makeTagFilter(emit, onSearch) {
  let pending = '';
  return {
    feed(chunk) {
      pending += chunk;
      for (;;) {
        const i = pending.indexOf('[');
        if (i < 0) { emit(pending); pending = ''; return; }
        if (i > 0) { emit(pending.slice(0, i)); pending = pending.slice(i); }
        const j = pending.indexOf(']');
        if (j < 0) { if (pending.length > 80) { emit(pending); pending = ''; } return; }
        const tag = pending.slice(0, j + 1); pending = pending.slice(j + 1);
        const m = tag.match(/^\[\s*hledat\s*:\s*(.+?)\s*\]$/i);
        if (m) { pending = ''; onSearch(m[1]); return; }
        emit(tag);
      }
    },
    flush() { if (pending) emit(pending); pending = ''; },
  };
}

function runSearch(query) {
  return new Promise(resolve => {
    execFile(SEARCH_PY, ['-I', path.join(__dirname, 'search.py'), query],
      { timeout: 30000, maxBuffer: 1 << 20,
        env: { ...process.env, SEARXNG_URL: CFG.search?.searxng_url || '', SEARCH_FALLBACK_PATH: CFG.search?.fallback_path || '' } },
      (err, out) => {
        if (err) return resolve({ query, results: [], error: String(err.message).slice(0, 200) });
        try { resolve(JSON.parse(out)); } catch { resolve({ query, results: [], error: 'bad output' }); }
      });
  });
}
function formatResults(s) {
  if (!s.results?.length && !s.answers?.length) return `Hledání „${s.query}“ nic nenašlo${s.error ? ' (chyba sítě)' : ''}.`;
  const answers = (s.answers || []).map(a => '[rychlá odpověď] ' + a).join('\n');
  const results = (s.results || []).map((r, i) => `(${i + 1}) ${r.title}${r.date ? ' [' + r.date + ']' : ''}\n${r.url}\n` +
    `Úryvek: ${r.snippet || '-'}${r.text ? '\nZe stránky: ' + r.text.slice(0, 1500) : ''}`).join('\n\n');
  return [answers, results].filter(Boolean).join('\n\n');
}

async function handleChat(req, res) {
  const body = await readBody(req, 2 * 1024 * 1024);
  const history = (Array.isArray(body.messages) ? body.messages : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-CFG.llm.history_limit)
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!history.length || history[history.length - 1].role !== 'user') return json(res, 400, { error: 'chybí zpráva' });

  const st = body.state || {};
  const num = (v, lo, hi) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : null);
  const ctx = {
    instability: num(st.instability, 0, 100) || 0,
    localTime: typeof st.localTime === 'string' ? st.localTime.slice(0, 40) : null,
    weekday: typeof st.weekday === 'string' ? st.weekday.slice(0, 20) : null,
    visits: num(st.visits, 0, 1e6),
    hoursSinceLastVisit: num(st.hoursSinceLastVisit, 0, 1e6),
    secondsSinceUserMessage: num(st.secondsSinceUserMessage, 0, 1e7),
    tabLeaves: num(st.tabLeaves, 0, 1e4),
    interrupted: st.interrupted === true,
    viaVoice: st.viaVoice === true,
    ambience: ['ticho', 'mírný ruch', 'hluk'].includes(st.ambience) ? st.ambience : null,
    // pojistka: krizová slova v poslední zprávě → výrazné upozornění v KONTEXTU
    crisis: detectCrisis ? detectCrisis(history[history.length - 1].content) : false,
    // kalkulačka: příklad s čísly spočítá server, model dostane hotový výsledek
    calc: detectCalc ? detectCalc(history[history.length - 1].content) : null,
    device: describeDevice(req.headers['user-agent']),
    gpu: gpu ? `${gpu.temp} °C, vytížení ${gpu.util} %, paměť ${Math.round(gpu.mem / 1024)} z ${Math.round(gpu.total / 1024)} GB` : null,
  };
  const mem = body.memory || {};
  const strings = (arr, n, len) => (Array.isArray(arr) ? arr : []).filter(s => typeof s === 'string').slice(-n).map(s => s.slice(0, len));
  const memory = { facts: strings(mem.facts, 100, 300), diary: strings(mem.diary, 50, 2000) };
  // Proměnlivý kontext jen do poslední zprávy → začátek promptu zůstává stejný a llama.cpp ho vezme z cache.
  const last = history[history.length - 1];
  const messages = [{ role: 'system', content: buildSystemPrompt(memory) }, ...history.slice(0, -1),
    { role: 'user', content: buildContextNote(ctx) + '\n\n' + last.content }];

  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
  const send = obj => res.write('data: ' + JSON.stringify(obj) + '\n\n');
  let controller = new AbortController();
  req.on('close', () => { if (!res.writableEnded) controller.abort(); });

  try {
    // Router: zjevný dotaz na aktuální informace → vyhledat ještě před odpovědí (model by si jinak
    // počasí nebo výsledky občas vymyslel). Model pak dostane výsledky přímo k poslední zprávě.
    const routed = detectSearch ? detectSearch(last.content) : null;
    if (routed) {
      send({ search: routed });
      const result = await runSearch(routed);
      send({ sources: (result.results || []).slice(0, 3).map(r => ({ title: r.title, url: r.url })) });
      messages[messages.length - 1].content += `

[[VÝSLEDKY HLEDÁNÍ „${routed}“ – vidíš je jen ty. Dnes je ${new Date().toLocaleDateString('cs-CZ')}, ` +
        `ignoruj zastaralé údaje.]]
${formatResults(result)}`;
    }
    let spoken = '', query = null;
    const filter = makeTagFilter(t => { spoken += t; send({ t }); }, q => { query = q; controller.abort(); });
    await streamLLM(messages, t => filter.feed(t), controller);
    if (!query) filter.flush();

    if (query && !res.destroyed) {
      send({ search: query });
      const result = await runSearch(query);
      send({ sources: (result.results || []).slice(0, 3).map(r => ({ title: r.title, url: r.url })) });
      controller = new AbortController();
      req.on('close', () => { if (!res.writableEnded) controller.abort(); });
      const followUp = [...messages,
        { role: 'assistant', content: `${spoken}[hledat: ${query}]` },
        { role: 'user', content: `[[UDÁLOST]] Výsledky tvého hledání „${query}“ (vidíš je jen ty). Dnes je ${new Date().toLocaleDateString('cs-CZ')} – ` +
          `ignoruj zastaralé údaje ze starých stránek.\n\n${formatResults(result)}\n\n` +
          'Teď plynule pokračuj ve své odpovědi – navaž na to, co jsi už řekla, neopakuj to. Začni značkou emoce, na konci [posun:N]. Už nehledej.' },
      ];
      const filter2 = makeTagFilter(t => send({ t }), () => controller.abort());
      await streamLLM(followUp, t => filter2.feed(t), controller);
      filter2.flush();
    }
    send({ done: true });
  } catch (e) {
    console.error('[chat]', e.message);
    if (!res.destroyed) send({ error: 'Verity teď neodpovídá (' + e.message + ')' });
  }
  res.end();
}

// ── deník: shrnutí staršího úseku rozhovoru ──────────────────────────────────
async function handleSummarize(req, res) {
  const body = await readBody(req, 512 * 1024);
  const chunk = (Array.isArray(body.messages) ? body.messages : []).slice(0, 120)
    .filter(m => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'));
  if (!chunk.length) return json(res, 400, { error: 'prázdný úsek' });
  const transcript = chunk.map(m => {
    const text = m.content.replace(/\[(?!\[)[^\]]{0,200}\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500);
    if (m.role === 'assistant') return 'Verity: ' + text;
    return text.startsWith('[[UDÁLOST]]') ? '(' + text.replace('[[UDÁLOST]]', '').trim() + ')' : 'Člověk: ' + text;
  }).join('\n');
  const previous = typeof body.previous === 'string' && body.previous ? `Tvůj předchozí zápis (pro návaznost): ${body.previous.slice(0, 2000)}\n\n` : '';
  const known = (Array.isArray(body.facts) ? body.facts : []).filter(f => typeof f === 'string').slice(-100).map(f => '- ' + f.slice(0, 300)).join('\n');
  try {
    const r = await fetch(CFG.llm.url + '/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(180000),
      body: JSON.stringify({
        messages: [{ role: 'system', content: SUMMARY_PROMPT },
          { role: 'user', content: `${previous}Fakta, která už znáš:\n${known || '(žádná)'}\n\nÚsek rozhovoru:\n${transcript}` }],
        temperature: 0.4, max_tokens: 700, chat_template_kwargs: { enable_thinking: false },
        response_format: { type: 'json_object' },
      }),
    });
    const d = await r.json();
    const content = d.choices?.[0]?.message?.content || '';
    let parsed = null;
    try { parsed = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1)); } catch { /* fallback níže */ }
    const summary = String(parsed?.zapis || (parsed ? '' : content)).replace(/\[[^\]]*\]/g, '').trim();
    const facts = (Array.isArray(parsed?.fakta) ? parsed.fakta : []).filter(f => typeof f === 'string' && f.trim()).slice(0, 15).map(f => f.trim().slice(0, 200));
    if (!summary) return json(res, 502, { error: 'LLM nevrátilo shrnutí' });
    json(res, 200, { summary: summary.slice(0, 2000), facts });
  } catch (e) {
    json(res, 502, { error: e.message });
  }
}

// ── TTS ──────────────────────────────────────────────────────────────────────
// Hrubá kontrola výstupu: šum má vysoký zero-crossing rate, rozbitá generace
// bývá nepřiměřeně dlouhá nebo skoro tichá. Vrací důvod, nebo null.
function audioLooksBroken(wav, text) {
  const at = wav.indexOf('data');
  if (at < 0) return 'bez dat';
  const n = Math.floor((wav.length - at - 8) / 2), sr = wav.readUInt32LE(24);
  const s = i => wav.readInt16LE(at + 8 + i * 2) / 32768;
  const dur = n / sr, chars = text.replace(/\s/g, '').length;
  if (dur > 2 + chars * 0.25) return `moc dlouhé ${dur.toFixed(1)}s`;
  const F = 480, zcrs = [];
  let peak = 0;
  for (let f = 0; f + F <= n; f += F) {
    let e = 0, z = 0, prev = s(f);
    for (let i = f; i < f + F; i++) { const v = s(i); e += v * v; if ((v >= 0) !== (prev >= 0)) z++; prev = v; }
    const rms = Math.sqrt(e / F); peak = Math.max(peak, rms);
    zcrs.push([rms, z / F]);
  }
  if (peak < 0.01) return 'ticho';
  const active = zcrs.filter(([rms]) => rms > peak * 0.1).map(([, z]) => z).sort((a, b) => a - b);
  const median = active[Math.floor(active.length / 2)] || 0;
  return median > 0.3 ? `šum zcr ${median.toFixed(2)}` : null;
}

async function handleTts(req, res) {
  const body = await readBody(req, 16 * 1024);
  const text = String(body.text || '').replace(/\[[^\]]{0,40}\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (!/[\p{L}\p{N}]/u.test(text)) return json(res, 400, { error: 'prázdný text' });
  const t = CFG.tts;
  const emo = EMOTIONS.includes(body.emotion) ? body.emotion : 'neutral';
  const over = t.emotions[emo] || {};
  // Emoce může mít vlastní referenci (např. šepot klonovaný ze šepotané nahrávky – design režim
  // OmniVoice je trénovaný jen na čínštině a angličtině, česky šepot nespolehlivě šumí).
  const refWav = over.speaker_wav && fs.existsSync(over.speaker_wav) ? over.speaker_wav : t.speaker_wav;
  const refText = refWav === over.speaker_wav ? (over.reference_text || '') : (t.reference_text || '');
  const cloning = t.mode === 'clone' && refWav && fs.existsSync(refWav);
  const settings = {
    voice_mode: cloning ? 'clone' : 'design',
    language: t.language, num_step: t.num_step, seed: t.seed, normalize_text: true,
    speed: Math.max(0.5, Math.min(2, (over.speed || 1) * (t.speed || 1))),
  };
  if (cloning) settings.reference_text = refText;
  else settings.instruct = [t.instruct, over.instruct_extra].filter(Boolean).join(', ');
  const payload = { text, settings, streamer: 'verity', queue_timeout: 60 };
  if (cloning) payload.speaker_wav = refWav;

  try {
    let wav;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) payload.settings.seed = (t.seed || 0) + attempt;
      const r = await fetch(t.url + '/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(90000) });
      const d = await r.json();
      if (!r.ok || !d.audio_base64) return json(res, 502, { error: d.error || 'TTS selhalo' });
      wav = Buffer.from(d.audio_base64, 'base64');
      const bad = audioLooksBroken(wav, text);
      if (!bad) break;
      console.warn(`[tts] pokus ${attempt + 1} vypadá rozbitě (${bad}): ${text.slice(0, 60)}`);
    }
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length, 'Cache-Control': 'no-store' });
    res.end(wav);
  } catch (e) {
    json(res, 502, { error: 'TTS nedostupné: ' + e.message });
  }
}

// Whisper si při šumu/tichu „vymýšlí“ fráze z titulků, na kterých se učil
// („Titulky vytvořil JohnyX“, „Děkujeme za pozornost“…). Ty se z přepisu odstraní;
// samotné „Děkuji.“ / „Konec.“ bez dalšího textu se zahodí celé.
const HALLUCINATIONS = [
  /titulky (vytvořil|vytvořila|připravil|přeložil|:)[^.!?]*[.!?]?/gi,
  /(překlad|korektura|titulky)\s*:\s*[^.!?]*[.!?]?/gi,
  /(děkuj(eme|i) za (pozornost|sledování|zhlédnutí)|díky za (pozornost|sledování))[.!?]?/gi,
  /(odebírejte|sledujte nás|nezapomeňte (dát like|odebírat))[^.!?]*[.!?]?/gi,
  /www\.[a-z0-9-]+\.(cz|sk|com)\S*/gi,
  /(amara\.org|johnyx|hradeckesluzby)[^.!?]*[.!?]?/gi,
];
const LONE = /^(konec|děkuji|děkujeme|titulky|hudba|\[hudba\]|♪+|\.+|…)[.!?…]*$/i;
function cleanTranscript(text) {
  let t = String(text || '');
  for (const re of HALLUCINATIONS) t = t.replace(re, ' ');
  // osamocené „Konec.“ / „Děkujeme.“ jako samostatné věty na začátku nebo konci
  const sentences = t.replace(/\s+/g, ' ').match(/[^.!?…]+[.!?…]*/g) || [];
  while (sentences.length && LONE.test(sentences[0].trim())) sentences.shift();
  while (sentences.length && LONE.test(sentences[sentences.length - 1].trim())) sentences.pop();
  return sentences.join('').replace(/^[\s.,!?…-]+/, '').trim();
}

// ── STT: proxy na Whisper službu (config.stt.url) ─────────────────────────────
// Interní klíč zná jen server; prohlížeč na Windows stroj nikdy nemluví přímo.
async function handleStt(req, res) {
  if (!CFG.stt?.url || !CFG.stt?.key) return json(res, 503, { error: 'Přepis hlasu není nastavený.' });
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 12 * 1024 * 1024) return json(res, 413, { error: 'Nahrávka je příliš velká (max 12 MB).' });
    chunks.push(chunk);
  }
  if (!size) return json(res, 400, { error: 'Chybí nahrávka.' });
  const q = new URL(req.url, 'http://x').searchParams;
  const params = new URLSearchParams();
  if (q.get('live') === '1') params.set('live', '1');
  if (q.get('final') === '1') params.set('final', '1');
  try {
    const r = await fetch(`${CFG.stt.url}/transcribe?${params}`, {
      method: 'POST', body: Buffer.concat(chunks), signal: AbortSignal.timeout(150000),
      headers: { 'Content-Type': 'audio/wav', 'X-STT-Key': CFG.stt.key },
    });
    const d = await r.json().catch(() => ({ error: 'Přepis vrátil nečitelnou odpověď.' }));
    // diagnostika bez obsahu: délka audia, úroveň signálu, počet znaků přepisu
    const at = Buffer.concat(chunks).indexOf('data'), pcm = Buffer.concat(chunks).subarray(at + 8);
    let peak = 0; for (let i = 0; i + 1 < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
    console.log(`[stt] ${q.get('final') === '1' ? 'final' : 'live '} ${(d.duration ?? 0).toFixed?.(1) ?? d.duration}s ` +
      `peak ${(20 * Math.log10(peak / 32768 + 1e-9)).toFixed(0)} dBFS → ${r.status} ${String(d.text || '').length} znaků`);
    json(res, r.status, r.ok ? { text: cleanTranscript(d.text), duration: d.duration } : { error: d.error || d.detail || 'Přepis selhal.' });
  } catch {
    json(res, 503, { error: 'Přepis hlasu je právě nedostupný. Můžeš napsat zprávu.' });
  }
}

// ── ochrana: limity na skutečnou IP klienta ──────────────────────────────────
// Za Apache (a HTTPS proxy .200) je socket vždy 127.0.0.1 – klienta najdeme v X-Forwarded-For:
// zprava se přeskočí vlastní/privátní proxy, první veřejná adresa je klient.
const PRIVATE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|::ffff:127\.|fc|fd)/;
function clientIp(req) {
  const chain = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  for (let i = chain.length - 1; i >= 0; i--) if (!PRIVATE.test(chain[i])) return chain[i];
  return chain[0] || req.socket.remoteAddress;
}
const LIMITS = { '/api/chat': 30, '/api/tts': 150, '/api/stt': 90, '/api/summarize': 6 };   // za minutu na IP
const buckets = new Map();
let activePosts = 0;
function overLimit(ip, route) {
  const now = Date.now(), key = ip + ' ' + route;
  let b = buckets.get(key);
  if (!b || now - b.at > 60000) { b = { at: now, n: 0 }; buckets.set(key, b); }
  return ++b.n > (LIMITS[route] || 30);
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.at > 120000) buckets.delete(k); }, 60000);

// ── router ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'microphone=(self)');
  if (req.method === 'POST') {
    if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'Cizí původ požadavku.' });
    if (overLimit(clientIp(req), url.pathname)) return json(res, 429, { error: 'Moc rychle. Chvilku počkej…' });
    if (activePosts >= 12) return json(res, 429, { error: 'Verity teď mluví s moc lidmi najednou.' });
    activePosts++; res.once('close', () => activePosts--);
  }
  try {
    if (req.method === 'POST' && url.pathname === '/api/chat') return await handleChat(req, res);
    if (req.method === 'POST' && url.pathname === '/api/tts') return await handleTts(req, res);
    if (req.method === 'POST' && url.pathname === '/api/stt') return await handleStt(req, res);
    if (req.method === 'POST' && url.pathname === '/api/summarize') return await handleSummarize(req, res);
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const [llm, tts, stt] = await Promise.all([ping(CFG.llm.url + '/health'), ping(CFG.tts.url + '/health'),
        CFG.stt?.url ? ping(CFG.stt.url + '/health') : false]);
      return json(res, 200, { llm, tts, stt, gpu, voice: CFG.tts.mode === 'clone' && fs.existsSync(CFG.tts.speaker_wav) ? 'clone' : 'design' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method' });
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: 'forbidden' });
    fs.readFile(file, (err, data) => {
      if (err) return json(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  } catch (e) {
    console.error('[http]', e.message);
    if (!res.headersSent) json(res, 400, { error: e.message });
  }
});
server.listen(CFG.port, CFG.host, () => console.log(`Verity probuzena na http://${CFG.host}:${CFG.port}`));
