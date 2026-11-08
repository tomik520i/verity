// Verity – malý server bez závislostí (Node 18+).
// Statické soubory + /api/chat (SSE stream z llama.cpp, s hledáním na webu)
// + /api/tts (OmniVoice → WAV) + /api/status.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { buildSystemPrompt, buildContextNote, EMOTIONS, SUMMARY_PROMPT, detectCrisis, detectCalc, detectFeedback } = require('./prompt');

const { searchRequest, detectSearch, needsConversation, QUERY_PROMPT, requestedCount, outputBudget, RESEARCH_PROMPT, cleanResearch, researchProblem } = require('./research');
const { randomUUID } = require('crypto');
const {createDiagnostics,clean:diagnosticText,UUID:DIAGNOSTIC_UUID}=require('./diagnostics');
const { MEMORY_PROMPT } = require('./memory-prompts');
const EXPRESSION_CATALOG=require('./public/emotions.json');
const memoryCore = import('./public/memory-core.mjs');
const conversationMode = import('./public/conversation-mode.mjs');
const imageLimits = import('./public/image-limits.mjs');

const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
// Klíč k interní Whisper službě je v samostatném souboru (chmod 600), ne v config.json.
if (CFG.stt?.key_file) {
  try { CFG.stt.key = fs.readFileSync(CFG.stt.key_file, 'utf8').trim(); } catch { console.warn('[stt] chybí soubor s klíčem', CFG.stt.key_file); }
}
const diagnostics=createDiagnostics(__dirname,CFG.diagnostics);
if(diagnostics.enabled)setInterval(()=>{try{diagnostics.prune();}catch{console.error('[diagnostics] cleanup failed');}},60000).unref();
const PUBLIC = path.join(__dirname, 'public');
const SEARCH_PY = CFG.search?.python || 'python3';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream',
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
// Přemýšlení (CFG.llm.thinking): llama.cpp ho posílá zvlášť jako reasoning_content – do řeči
// se nikdy nedostane, jen se hlásí přes onThinking (UI ukáže „přemýšlí…“). Když model
// vyčerpá limit jen přemýšlením a nic neřekne, zkusí se to znovu bez přemýšlení.
async function streamLLM(messages, onText, controller, onThinking = () => {}, think = !!CFG.llm.thinking, options = {}) {
  const r = await fetch(CFG.llm.url + '/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages, stream: true,
      temperature: CFG.llm.temperature, top_p: CFG.llm.top_p,
      presence_penalty: CFG.llm.presence_penalty,
      max_tokens: (options.maxTokens || CFG.llm.max_tokens) + (think ? (CFG.llm.thinking_budget || 1500) : 0),
      chat_template_kwargs: { enable_thinking: think },
      ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
    }),
  });
  if (!r.ok) throw new Error('LLM HTTP ' + r.status);
  const decoder = new TextDecoder();
  let buf = '', said = 0, thought = 0, finishReason = null;
  try {
    for await (const chunk of r.body) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') break;
        let choice;
        try { choice = JSON.parse(data).choices?.[0]; } catch { continue; }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const delta = choice?.delta || {};
        if (delta.reasoning_content) { if (!thought++) onThinking(true); }
        if (delta.content) { if (!said++ && thought) onThinking(false); onText(delta.content); }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError' && !controller.signal.aborted) throw e;
  }
  if (think && !said && thought && !controller.signal.aborted) {
    console.warn('[llm] přemýšlení bez odpovědi → znovu bez přemýšlení');
    onThinking(false);
    return streamLLM(messages, onText, controller, onThinking, false, options);
  }
  return { finishReason };
}

// Filtr, který propouští text, ale zachytí značku [hledat: ...] a přeruší generování.
function makeTagFilter(emit, onSearch) {
  let pending = '', stopped = false;
  return {
    feed(chunk) {
      if (stopped) return;
      pending += chunk;
      for (;;) {
        const i = pending.indexOf('[');
        if (i < 0) { emit(pending); pending = ''; return; }
        if (i > 0) { emit(pending.slice(0, i)); pending = pending.slice(i); }
        const j = pending.indexOf(']');
        if (j < 0) { if (pending.length > 1024) { if (/^\[\s*hledat\s*:/i.test(pending)) { stopped = true; onSearch(pending.replace(/^\[\s*hledat\s*:/i, '').slice(0, 200)); } else emit(pending); pending = ''; } return; }
        const tag = pending.slice(0, j + 1); pending = pending.slice(j + 1);
        const m = tag.match(/^\[\s*hledat\s*:\s*(.+?)\s*\]$/i);
        if (m) { stopped = true; pending = ''; onSearch(m[1].slice(0, 200)); return; }
        emit(tag);
      }
    },
    flush() { if (pending && !stopped) emit(pending); pending = ''; },
  };
}

function runSearch(query, signal) {
  return new Promise(resolve => {
    execFile(SEARCH_PY, ['-I', path.join(__dirname, 'search.py'), query],
      { timeout: 30000, maxBuffer: 1 << 20, signal,
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
    `Úryvek: ${r.snippet || '-'}${r.text ? '\nZe stránky: ' + r.text.slice(0, 6500) : ''}`).join('\n\n');
  return [answers, results].filter(Boolean).join('\n\n');
}

async function handleChat(req, res) {
  const body = await readBody(req, 20 * 1024 * 1024);
  let images;
  try { images = (await imageLimits).requestImages(body); }
  catch (e) { return json(res, 400, {error:e.message}); }
  const history = (Array.isArray(body.messages) ? body.messages : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-CFG.llm.history_limit)
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!history.length || history[history.length - 1].role !== 'user') return json(res, 400, { error: 'chybí zpráva' });

  // Oprávnění platí jen pro tuto zprávu; historie ani klientský state ho nemohou udělit.
  const searchAllowed = !!searchRequest(history[history.length - 1].content);
  const st = body.state || {};
  const num = (v, lo, hi) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : null);
  const {roleplayPreference} = await conversationMode;
  const roleplayPaused = typeof st.roleplayPaused === 'boolean'
    ? roleplayPreference(history[history.length-1].content,st.roleplayPaused)
    : history.filter(m=>m.role==='user').reduce((v,m)=>roleplayPreference(m.content,v),false);
  const ctx = {
    searchAllowed, imageCount:images.length, normalConversation:roleplayPaused,
    feedback:detectFeedback(history[history.length-1].content),
    mood:!roleplayPaused && Object.hasOwn(EXPRESSION_CATALOG.moods,st.mood) ? st.mood : 'warm',
    instability: num(st.instability, 0, 100) || 0,
    localTime: typeof st.localTime === 'string' ? st.localTime.slice(0, 40) : null,
    weekday: typeof st.weekday === 'string' ? st.weekday.slice(0, 20) : null,
    visits: num(st.visits, 0, 1e6),
    hoursSinceLastVisit: num(st.hoursSinceLastVisit, 0, 1e6),
    secondsSinceUserMessage: num(st.secondsSinceUserMessage, 0, 1e7),
    tabLeaves: num(st.tabLeaves, 0, 1e4),
    interrupted: st.interrupted === true,
    viaVoice: st.viaVoice === true,
    liveVoice: st.liveVoice === true && st.viaVoice === true,
    ambience: ['ticho', 'mírný ruch', 'hluk'].includes(st.ambience) ? st.ambience : null,
    // pojistka: krizová slova v poslední zprávě → výrazné upozornění v KONTEXTU
    crisis: detectCrisis ? detectCrisis(history[history.length - 1].content) : false,
    // kalkulačka: příklad s čísly spočítá server, model dostane hotový výsledek
    calc: detectCalc ? detectCalc(history[history.length - 1].content) : null,
    device: describeDevice(req.headers['user-agent']),
    gpu: gpu ? `${gpu.temp} °C, vytížení ${gpu.util} %, paměť ${Math.round(gpu.mem / 1024)} z ${Math.round(gpu.total / 1024)} GB` : null,
  };
  const core = await memoryCore;
  const memory = core.selectMemory(core.normalizeMemory(body.memory || {}), history[history.length - 1].content);
  // Proměnlivý kontext jen do poslední zprávy → začátek promptu zůstává stejný a llama.cpp ho vezme z cache.
  const last = history[history.length - 1];
  const messages = [{ role: 'system', content: buildSystemPrompt(memory) }, ...history.slice(0, -1),
    { role: 'user', content: buildContextNote(ctx) + '\n\n' + last.content }];

  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
  let delivered='';
  const send = obj => { if (!res.destroyed && !res.writableEnded) {if(obj.t)delivered=(delivered+obj.t).slice(0,24000);res.write('data: ' + JSON.stringify(obj) + '\n\n');} };
  let controller = new AbortController();
  res.once('close', () => { if (!res.writableEnded) controller.abort(); });

  const requestId = randomUUID(), started = Date.now();
  const conversationId=DIAGNOSTIC_UUID.test(body.conversationId||'')?body.conversationId:randomUUID();
  const trace=(event,details={})=>diagnostics.append({type:'server',requestId,conversationId,event,...details});
  let journalDone=false;
  const finishTrace=interrupted=>{if(journalDone)return;journalDone=true;trace('output',{text:diagnosticText(delivered,24000),interrupted,ms:Date.now()-started});};
  res.once('close',()=>{if(!res.writableEnded)finishTrace(true);});
  trace('input',{text:diagnosticText(last.content,4000),imageCount:images.length,state:{instability:ctx.instability,mood:ctx.mood,normalConversation:ctx.normalConversation,viaVoice:ctx.viaVoice,searchAllowed},historyMessages:history.length});
  const log = (event, details = {}) => {console.log(JSON.stringify({ at: new Date().toISOString(), requestId, event, ...details }));trace(event,details);};
  log('chat_start', { chars: last.content.length, live: ctx.liveVoice, phase: ctx.instability, historyMessages: history.length, searchAllowed });
  send({ requestId, ...(diagnostics.enabled?{diagnostics:diagnostics.receipt(requestId,conversationId)}:{}) });
  async function research(query) {
    // Poslední kontrola přímo před externím nástrojem; model tuto hranici nemůže obejít.
    if (!searchAllowed || ctx.crisis) {
      log('search_blocked', { reason: 'no_current_permission' });
      throw new Error('Hledání nebylo v této zprávě vyžádáno');
    }
    if (res.destroyed || controller.signal.aborted) return;
    log('search_start', { queryChars: query.length, contextualMessages: history.slice(0, -1).filter(m => !m.content.startsWith('[[UDÁLOST]]')).slice(-12).length });
    trace('search_query',{query:diagnosticText(query,300)});
    send({ search: query });
    const searchAt = Date.now(), result = await runSearch(query, controller.signal);
    if (res.destroyed || controller.signal.aborted) return;
    const sources = (result.results || []).slice(0, 6).map(r => ({ title: r.title, url: r.url }));
    trace('sources',{sources:sources.map(x=>({title:diagnosticText(x.title,200),url:String(x.url||'').split('?')[0].slice(0,500)}))});
    send({ sources });
    log('search_end', { results: sources.length, error: !!result.error, ms: Date.now() - searchAt });
    if (!sources.length && !result.answers?.length) {
      send({ t: result.error ? '[sad] Hledání se teď nepodařilo dokončit kvůli chybě služby. Nemám ověřené výsledky, které bych ti mohla předat. [posun:0]' : '[sad] Hledání nepřineslo použitelné výsledky, takže ti teď nemám z čeho sestavit ověřenou odpověď. [posun:0]' });
      log('research_answer', { outcome: result.error ? 'search_error' : 'no_results' });
      return;
    }
    const question = last.content, count = requestedCount(question);
    const recentConversation = history.slice(0, -1).filter(m => !m.content.startsWith('[[UDÁLOST]]')).slice(-12).map(m => ({ role: m.role, content: m.content.replace(/\[(?:hledat|pamatuj|zapomeň|posun):[^\]]*\]/gi, '').slice(0, 4000) }));
    const context = { question, recentConversation, knownUserFacts: memory.facts, searchQuery: query, results: formatResults(result), date: new Date().toLocaleDateString('cs-CZ'), phase: ctx.instability };
    const researchMessages = [{ role: 'system', content: RESEARCH_PROMPT }, { role: 'user', content: JSON.stringify(context) }];
    let maxTokens = outputBudget(question, Math.max(768, CFG.llm.max_tokens || 320));
    for (let attempt = 0; attempt < 2; attempt++) {
      let answer = '';
      send({ thinking: true });
      const outcome = await streamLLM(researchMessages, t => { answer += t; }, controller, () => {}, false, { maxTokens });
      send({ thinking: false });
      if (res.destroyed || controller.signal.aborted) return;
      const problem = researchProblem(answer, outcome?.finishReason, count);
      if (!problem) {
        send({ t: cleanResearch(answer) });
        log('research_answer', { outcome: 'complete', attempt: attempt + 1, chars: answer.length, maxTokens, finishReason: outcome?.finishReason });
        return;
      }
      if (attempt === 1 && problem === 'incomplete_list') {
        const found = Array.from(answer.matchAll(/(?:^|\n)\s*(?:\[[^\]]+\]\s*)*\d{1,2}[.)]\s+\S/g)).length;
        if (found > 0) {
          send({ t: cleanResearch(answer.replace(/\[posun:[^\]]+\]/g, '') + '\n\nSeznam zatím obsahuje jen ' + found + ' z požadovaných ' + count + ' položek. Další z dostupných podkladů nemám ověřené.') });
          log('research_answer', { outcome: 'partial_list', found, requested: count });
          return;
        }
      }
      log('research_repair', { reason: problem, attempt: attempt + 1 });
      researchMessages.push({ role: 'assistant', content: answer }, { role: 'user', content: 'Předchozí odpověď nebyla dokončená. Napiš celou konečnou odpověď znovu, pouze z již dodaných podkladů. Nehledej znovu. Dodrž požadovaný počet položek, nebo konkrétně přiznej chybějící podklady. Začni přirozeným oznámením výsledku hledání a skonči [posun:0].' });
      maxTokens = Math.min(2000, Math.max(960, maxTokens * 2));
    }
    throw new Error('Z výsledků se nepodařilo sestavit úplnou odpověď');
  }
  try {
    const contextual = history.slice(0, -1).some(m => m.role === 'user' && !m.content.startsWith('[[UDÁLOST]]')) && needsConversation(last.content);
    const routed = !images.length ? detectSearch(last.content) : null;
    const mode = ['off', 'auto', 'on'].includes(body.thinking) ? body.thinking : (CFG.llm.thinking === true ? 'on' : CFG.llm.thinking || 'auto');
    const think = mode === 'on' || (mode === 'auto' && !ctx.liveVoice && !last.content.startsWith('[[') && !ctx.crisis &&
      (last.content.length > 160 || /(^|[^\p{L}])(vysvětli|vysvětlit|napiš|napsat|poraď|pomoz|pomoct|proč|jak (to|mám|se dá|funguje)|přelož|spočítej|porovnej|navrhni|shrň|oprav)(?!\p{L})/iu.test(last.content)));
    if (routed && !ctx.crisis) {
      let resolvedQuery = routed;
      if (contextual) {
        const recentConversation = history.slice(0, -1).filter(m => !m.content.startsWith('[[UDÁLOST]]')).slice(-12);
        let planning = '';
        send({ thinking: true });
        await streamLLM([{ role: 'system', content: QUERY_PROMPT }, { role: 'user', content: JSON.stringify({ question: last.content, recentConversation }) }], t => { planning += t; }, controller, () => {}, false, { maxTokens: 256, responseFormat: { type: 'json_object' } });
        send({ thinking: false });
        if (res.destroyed || controller.signal.aborted) return res.end();
        let parsed;
        try { parsed = JSON.parse(planning); } catch { throw new Error('Nepodařilo se upřesnit návaznost dotazu'); }
        resolvedQuery = typeof parsed.query === 'string' ? parsed.query.trim().slice(0, 200) : '';
        log('query_resolution', { outcome: resolvedQuery ? 'resolved' : 'clarification', historyMessages: recentConversation.length });
        if (!resolvedQuery) {
          const clarification = typeof parsed.clarification === 'string' ? parsed.clarification.slice(0, 300) : '';
          send({ t: cleanResearch('[curious] ' + (clarification || 'Ke kterému tématu z předchozího rozhovoru se má hledání vztahovat?')) });
        }
      }
      if (resolvedQuery) await research(resolvedQuery);
    } else {
      if (images.length) {
        const m = messages[messages.length - 1];
        // Gemma doporučuje obrázky před textem; zachováme pořadí výběru.
        m.content = [...images.map(url => ({type:'image_url',image_url:{url}})), {type:'text',text:m.content}];
      }
      const canSearch = searchAllowed && !ctx.crisis;
      // Bez svolení držíme text do kontroly značek: ani slib "hledám" se nesmí
      // dostat do přehrávání, pokud se model pokusí spustit zakázaný nástroj.
      for (let attempt = 0; attempt < (canSearch ? 1 : 2); attempt++) {
        let query = null, draft = '';
        if (!canSearch) send({ thinking: true });
        const filter = makeTagFilter(t => { if (canSearch) send({ t }); else draft += t; },
          q => { query = q; controller.abort(); });
        await streamLLM(messages, t => filter.feed(t), controller,
          on => { if (canSearch) send({ thinking: on }); }, attempt ? false : think);
        if (!query) filter.flush();
        if (res.destroyed || (!query && controller.signal.aborted)) break;
        // Zachytíme i uříznutou značku, kterou filtr nemohl uzavřít.
        const blocked = !canSearch && (query !== null || /\[\s*hledat\s*:/i.test(draft));
        if (blocked) {
          log('search_blocked', { reason: 'model_without_permission', attempt: attempt + 1 });
          controller = new AbortController();
          if (!attempt) {
            messages[0] = { ...messages[0], content: messages[0].content +
              '\n\nPRO TUTO ODPOVĚĎ JE WEB VYPNUTÝ. Uživatel nedal nový výslovný pokyn k hledání. Odpověz přímo na jeho poslední zprávu z rozhovoru a vlastních znalostí. Nic nevyhledávej, nepoužívej značku hledat a neslibuj hledání. Pokud aktuální údaj neznáš, přiznej to. Starší úkoly už znovu neprováděj.' };
            continue;
          }
          send({ thinking: false });
          send({ t: '[neutral] Hledání nechám vypnuté, dokud si o něj výslovně neřekneš. [posun:0]' });
          break;
        }
        if (query !== null) {
          controller = new AbortController();
          await research(query);
        } else if (!canSearch) {
          send({ thinking: false });
          if (draft) send({ t: draft });
        }
        break;
      }
    }
    if (!res.destroyed && !controller.signal.aborted) {
      send({ done: true });
      log('chat_done', { ms: Date.now() - started });
    } else log('chat_interrupted', { ms: Date.now() - started });
  } catch (e) {
    log('chat_error', { name: e.name, ms: Date.now() - started });
    if (!res.destroyed) send({ error: 'Verity teď neodpovídá (' + e.message + ')' });
  }
  finishTrace(controller.signal.aborted||res.destroyed);
  res.end();
}

// ── úklid paměti: které staré fakty nové fakty / zpráva vyvrací ──────────────
// Model při psaní odpovědi [zapomeň: …] spolehlivě nepoužívá (testy 0–3 ze 3), proto se po přidání
// nového faktu zeptá zvlášť, stroze a s teplotou 0. Vrací indexy starých faktů k odstranění.
// ── ověřené změny paměti z nové lidské zprávy ─────────────────────────────────
async function handleMemory(req, res) {
  const body = await readBody(req, 128 * 1024);
  const message = typeof body.message === 'string' ? body.message.slice(0, 4000) : '';
  if (!message.trim() || message.startsWith('[[')) return json(res, 200, { operations: [] });
  const core = await memoryCore, now = Date.now();
  const eligible = core.evidenceText(message);
  if (!eligible.trim()) return json(res, 200, { operations: [] });
  const at = Number.isFinite(body.at) ? Math.min(now, body.at) : now;
  const memory = core.normalizeMemory(body.memory || {}, now);
  const controller = new AbortController();
  res.once('close', () => { if (!res.writableEnded) controller.abort(); });
  try {
    const r = await fetch(CFG.llm.url + '/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
      body: JSON.stringify({
        messages: [{ role: 'system', content: MEMORY_PROMPT }, { role: 'user', content: JSON.stringify({
          message: eligible, date: new Date(at).toLocaleDateString('sv-SE', {timeZone:'Europe/Prague'}),
          entries: memory.entries.map(({key,text,kind,updatedAt})=>({key,text,kind,updatedAt})),
        }) }],
        temperature: 0, max_tokens: 900, chat_template_kwargs: { enable_thinking: false },
        response_format: { type: 'json_object' },
      }),
    });
    if (!r.ok) throw new Error('LLM HTTP ' + r.status);
    const d = await r.json();
    if (d.choices?.[0]?.finish_reason === 'length') throw new Error('Neúplná změna paměti');
    const proposed = JSON.parse(d.choices?.[0]?.message?.content || '{}');
    const operations = core.validateOperations(proposed.operations, message, memory, at, now);
    if (!res.destroyed) json(res, 200, { operations });
  } catch (e) {
    if (!res.destroyed) json(res, 502, { error: 'Paměť se nepodařilo aktualizovat', operations: [] });
  }
}

// Starý klient musí obnovit stránku; paměťové značky už nejsou důvěryhodný zdroj.
async function handleConsolidate(req, res) {
  await readBody(req, 128 * 1024);
  json(res, 200, { forget: [], deprecated: true });
}

// ── stručný archiv: ověřené citace, žádná výroba osobních faktů ────────────────
async function handleSummarize(req, res) {
  const body = await readBody(req, 512 * 1024);
  const core = await memoryCore;
  const messages = (Array.isArray(body.messages) ? body.messages : []).slice(0,120)
    .filter(m=>m?.role==='user' && typeof m.content==='string' && !m.content.startsWith('[['))
    .map(m=>({...m,content:core.evidenceText(m.content)})).filter(m=>m.content.trim())
    .map((m,index)=>({index,content:m.content.slice(0,1500),at:Number(m.at)||Date.now()}));
  if (!messages.length) return json(res,200,{summary:'',facts:[],verified:true});
  const controller = new AbortController();
  res.once('close',()=>{if(!res.writableEnded)controller.abort();});
  try {
    const r = await fetch(CFG.llm.url + '/v1/chat/completions', {
      method:'POST',headers:{'Content-Type':'application/json'},
      signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]),
      body:JSON.stringify({messages:[{role:'system',content:SUMMARY_PROMPT},
        {role:'user',content:JSON.stringify({messages})}],temperature:0,max_tokens:600,
        chat_template_kwargs:{enable_thinking:false},response_format:{type:'json_object'}}),
    });
    if(!r.ok)throw new Error('LLM HTTP '+r.status);
    const d=await r.json();
    if(d.choices?.[0]?.finish_reason==='length')throw new Error('Neúplný výběr citací');
    const parsed=JSON.parse(d.choices?.[0]?.message?.content||'{}');
    const quotes=(Array.isArray(parsed.quotes)?parsed.quotes:[]).slice(0,4).filter(q=>
      Number.isInteger(q.index)&&typeof q.quote==='string'&&q.quote.trim().length>=4&&
      messages[q.index]?.content.includes(q.quote));
    const summary=quotes.map(q=>'Uživatel: „'+q.quote.slice(0,400)+'“').join(' ');
    if(!res.destroyed)json(res,200,{summary, facts:[], verified:true});
  }catch(e){if(!res.destroyed)json(res,502,{error:'Nepodařilo se zkrátit historii'});}
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
  const over = {...EXPRESSION_CATALOG.emotions[emo],...(t.emotions?.[emo] || {})};
  const intensity=Number.isFinite(body.intensity)?Math.max(0,Math.min(1,body.intensity)):.65;
  // Emoce může mít vlastní referenci (např. šepot klonovaný ze šepotané nahrávky – design režim
  // OmniVoice je trénovaný jen na čínštině a angličtině, česky šepot nespolehlivě šumí).
  const refWav = over.speaker_wav && fs.existsSync(over.speaker_wav) ? over.speaker_wav : t.speaker_wav;
  const refText = refWav === over.speaker_wav ? (over.reference_text || '') : (t.reference_text || '');
  const cloning = t.mode === 'clone' && refWav && fs.existsSync(refWav);
  const settings = {
    voice_mode: cloning ? 'clone' : 'design',
    language: t.language, num_step: t.num_step, seed: t.seed, normalize_text: true,
    speed: Math.max(0.5, Math.min(2, (1+((over.speed||1)-1)*(.5+.5*intensity)) * (t.speed || 1))),
  };
  if (cloning) settings.reference_text = refText;
  else settings.instruct = [t.instruct, over.instruct_extra].filter(Boolean).join(', ');
  const payload = { text, settings, streamer: 'verity', queue_timeout: 60 };
  if (cloning) payload.speaker_wav = refWav;

  const controller = new AbortController();
  res.once('close', () => { if (!res.writableEnded) controller.abort(); });
  try {
    let wav;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (controller.signal.aborted || res.destroyed) return;
      if (attempt) payload.settings.seed = (t.seed || 0) + attempt;
      const r = await fetch(t.url + '/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]) });
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
    if (!controller.signal.aborted && !res.destroyed) json(res, 502, { error: 'TTS nedostupné: ' + e.message });
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

// ── STT: proxy na Whisper (interní Windows služba) ────────────────────────
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
  // Recording diagnostics are disabled, including requests from older open pages.
  if (q.get('source') === '1') return json(res, 410, { debug_saved: false, error: 'Ukládání testovacích nahrávek je vypnuté.' });

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
    // The proxy never forwards a recording/debug flag to Windows.
    json(res, r.status, r.ok ? { text: cleanTranscript(d.text), duration: d.duration, ...(q.get('debug') === '1' ? { debug_saved: false } : {}) } : { error: d.error || d.detail || 'Přepis selhal.' });
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
const LIMITS = { '/api/diagnostics/events': 180, '/api/chat': 30, '/api/tts': 150, '/api/stt': 90, '/api/summarize': 6, '/api/consolidate': 30, '/api/memory': 30 };   // za minutu na IP
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
    if (req.method === 'GET' && url.pathname === '/api/diagnostics/logs') {
      if(overLimit(clientIp(req),url.pathname))return json(res,429,{error:'Too many requests'});
      if(!diagnostics.authorized(req.headers.authorization))return json(res,401,{error:'Unauthorized'});
      return json(res,200,{...diagnostics.status(),records:diagnostics.read(Object.fromEntries(url.searchParams))});
    }
    if (req.method === 'POST' && url.pathname === '/api/diagnostics/events') {
      const body=await readBody(req,12*1024),accepted=diagnostics.acceptClient(body);return json(res,accepted?200:403,{accepted});
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') return await handleChat(req, res);
    if (req.method === 'POST' && url.pathname === '/api/tts') return await handleTts(req, res);
    if (req.method === 'POST' && url.pathname === '/api/stt') return await handleStt(req, res);
    if (req.method === 'POST' && url.pathname === '/api/summarize') return await handleSummarize(req, res);
    if (req.method === 'POST' && url.pathname === '/api/memory') return await handleMemory(req, res);
    if (req.method === 'POST' && url.pathname === '/api/consolidate') return await handleConsolidate(req, res);
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const [llm, tts, stt] = await Promise.all([ping(CFG.llm.url + '/health'), ping(CFG.tts.url + '/health'),
        CFG.stt?.url ? ping(CFG.stt.url + '/health') : false]);
      return json(res, 200, { llm, tts, stt, gpu, diagnostics:diagnostics.status(), voice: CFG.tts.mode === 'clone' && fs.existsSync(CFG.tts.speaker_wav) ? 'clone' : 'design' });
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
