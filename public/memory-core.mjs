// Sdílená pravidla paměti: žádný model, síť ani ukládání v tomto modulu.
export const DAY = 86400000;
export const TTL = { identity: null, preference: 180 * DAY, current: 90 * DAY, plan: 7 * DAY, ephemeral: DAY };
const text = (s, n = 300) => typeof s === 'string' ? s.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim().slice(0, n) : '';
const folded = s => text(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const stamp = (n, fallback) => Number.isFinite(n) && n > 0 ? n : fallback;
const keyOK = k => typeof k === 'string' && /^[a-z0-9][a-z0-9._-]{0,79}$/.test(k);
export const tokens = s => new Set(folded(s).match(/[a-z0-9]{4,}/g)?.map(w => w.slice(0, 5)) || []);
const overlap = (a,b) => [...tokens(a)].filter(w => tokens(b).has(w)).length;
function legacyKind(s) {
  return /\b(jmenuje|jmeno|prezdiv|rika[tj]?|oslov)/.test(folded(s)) ? 'identity' : 'current';
}
export function normalizeMemory(raw = {}, now = Date.now()) {
  const v2 = raw?.version === 2 && Array.isArray(raw.entries);
  const m = { version: 2, entries: [], diary: [], tombstones: [],
    windowStart: Math.max(0, Number(raw.windowStart) || 0), sessionStart: Math.max(0, Number(raw.sessionStart) || 0) };
  const input = v2 ? raw.entries : (Array.isArray(raw.facts) ? raw.facts : []).map((f,i) => ({
    key: 'legacy.'+i, text: f, kind: legacyKind(f), source: 'legacy', updatedAt: 0, createdAt: now,
  }));
  for (const f of input.slice(-120)) {
    if (!f || !keyOK(f.key) || !text(f.text)) continue;
    const kind = Object.hasOwn(TTL, f.kind) ? f.kind : 'current';
    const source = ['user','manual','legacy'].includes(f.source) ? f.source : 'legacy';
    const updatedAt = source === 'legacy' ? 0 : Math.min(now, stamp(f.updatedAt, now));
    const createdAt = Math.min(now, stamp(f.createdAt, now));
    const expiresAt = source === 'manual' || TTL[kind] === null ? null :
      Math.min(stamp(f.expiresAt, (updatedAt || createdAt) + TTL[kind]), (updatedAt || createdAt) + (kind==='plan'?30*DAY:TTL[kind]));
    const entry = { key: f.key, text: text(f.text), kind, source, createdAt, updatedAt, expiresAt,
      evidence: source === 'legacy' ? '' : text(f.evidence, 500), dueOn: /^\d{4}-\d{2}-\d{2}$/.test(f.dueOn||'')?f.dueOn:null };
    const at = m.entries.findIndex(e => e.key === entry.key);
    if (at < 0) m.entries.push(entry);
    else if (entry.updatedAt >= m.entries[at].updatedAt) m.entries[at] = entry;
  }
  m.diary = (Array.isArray(raw.diary) ? raw.diary : []).filter(d => d && text(d.text, 2000)).slice(-40)
    .map(d => ({ text: text(d.text,2000), at: Math.min(now,stamp(d.at,now)), verified: v2 && d.verified === true }));
  m.tombstones = (Array.isArray(raw.tombstones) ? raw.tombstones : []).filter(t=>keyOK(t?.key)&&Number.isFinite(t.at)).slice(-120);
  return pruneMemory(m, now);
}
export function pruneMemory(m, now = Date.now()) {
  m.entries = m.entries.filter(e => !e.expiresAt || e.expiresAt > now)
    .filter(e=>!m.tombstones.some(t=>t.key===e.key && t.at >= e.updatedAt));
  if (m.entries.length > 60) {
    m.entries.sort((a,b)=>(Number(b.source==='manual')*1e15+Number(b.kind==='identity')*1e14+b.updatedAt)-
      (Number(a.source==='manual')*1e15+Number(a.kind==='identity')*1e14+a.updatedAt));
    m.entries.length = 60;
  }
  m.diary = m.diary.filter(d=>d.at > now - 30 * DAY).slice(-12);
  m.tombstones = m.tombstones.filter(t=>t.at>now-180*DAY).slice(-120);
  m.facts = m.entries.map(e=>e.text); // Kompatibilní export; autoritativní jsou entries.
  return m;
}
export function removeEntry(m, key, at = Date.now()) {
  if (!keyOK(key)) return;
  const old=m.entries.find(e=>e.key===key);
  if (old && old.updatedAt > at) return;
  m.entries=m.entries.filter(e=>e.key!==key);
  const tomb=m.tombstones.find(t=>t.key===key);
  if(tomb)tomb.at=Math.max(tomb.at,at); else m.tombstones.push({key,at});
  pruneMemory(m,at);
}
export function manualEntry(m, key, value, now = Date.now()) {
  const old=m.entries.find(e=>e.key===key);
  const t=text(value);
  if(!t){removeEntry(m,key,now);return;}
  key=keyOK(key)?key:'manual.'+now.toString(36);
  m.entries=m.entries.filter(e=>e.key!==key);
  m.tombstones=m.tombstones.filter(t=>t.key!==key);
  m.entries.push({key,text:t,kind:old?.kind||'current',source:'manual',createdAt:old?.createdAt||now,
    updatedAt:now,expiresAt:null,evidence:t});
  pruneMemory(m,now);
}
export function applyOperations(m, operations, now = Date.now()) {
  for(const op of (Array.isArray(operations)?operations:[]).slice(0,8)){
    if(!keyOK(op?.key)||!Number.isFinite(op.at)||op.at>now+300000)continue;
    const old=m.entries.find(e=>e.key===op.key);
    if(old?.updatedAt>op.at || m.tombstones.some(t=>t.key===op.key&&t.at>=op.at))continue;
    if(op.op==='delete'){removeEntry(m,op.key,op.at);continue;}
    if(op.op!=='upsert'||!text(op.text)||!Object.hasOwn(TTL,op.kind)||!text(op.evidence,500))continue;
    const expiresAt=TTL[op.kind]===null?null:Math.min(stamp(op.expiresAt,op.at+TTL[op.kind]),op.at+(op.kind==='plan'?30*DAY:TTL[op.kind]));
    m.entries=m.entries.filter(e=>e.key!==op.key);
    m.tombstones=m.tombstones.filter(t=>t.key!==op.key);
    m.entries.push({key:op.key,text:text(op.text),kind:op.kind,source:'user',
      createdAt:old?.createdAt||op.at,updatedAt:op.at,expiresAt,evidence:text(op.evidence,500),dueOn:op.dueOn||null});
  }
  return pruneMemory(m,now);
}
// Konzervativně vyřadit nepřímou řeč, zadání příběhu a hypotetické údaje.
export function evidenceText(message) {
  if(typeof message!=='string'||message.startsWith('[['))return '';
  const f=message.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
  if(/\b(predstav si|predstirej|hrajme|hypoteticky|kdybych|kdybys|kdyby|v pribehu|jen priklad|napriklad|preloz|cituj)\b/.test(f))return '';
  if(/\b(verity|asistent|asistentka|model|on|ona)\s+(?:mi\s+)?(?:rekl|rekla|rika|napsal|napsala)\b/.test(f))return '';
  return message.replace(/[\x60]{3}[\s\S]*?[\x60]{3}|[\x60][^\x60]*[\x60]/g,' ')
    .replace(/"[^"]*"|„[^“”]*[“”]|“[^”]*”|«[^»]*»/g,(quote,offset)=>{
      const prefix=message.slice(Math.max(0,offset-35),offset).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
      return /(?:jmenuj[ui] se|rikej mi|oslovuj me)\s*$/.test(prefix)?quote:' ';
    });
}

export function validateOperations(proposed, message, memory, at, now = Date.now()) {
  if(typeof message!=='string'||message.startsWith('[['))return [];
  at=Math.min(now,stamp(at,now));
  const valid=[];
  const add=op=>{const i=valid.findIndex(v=>v.key===op.key);if(i<0)valid.push(op);else if(op.op==='upsert')valid[i]=op;};
  const normalized=evidenceText(message).replace(/\s+/g,' ').trim().toLowerCase();
  if(!normalized)return [];
  for(const op of (Array.isArray(proposed)?proposed:[]).slice(0,8)){
    const quote=text(op?.evidence,500);
    if(!quote||quote.length<3||!normalized.includes(quote.toLowerCase())||!keyOK(op.key))continue;
    if(!['upsert','delete'].includes(op.op))continue;
    if(op.op==='delete'){
      if(!memory.entries.some(e=>e.key===op.key))continue;
      add({op:'delete',key:op.key,at,evidence:quote});continue;
    }
    if(!text(op.text)||!Object.hasOwn(TTL,op.kind))continue;
    if(/\[|https?:\/\//i.test(op.text))continue;
    const kind=op.key==='preference.addressing'?'identity':op.kind;
    let expiresAt=TTL[kind]===null?null:at+TTL[kind];
    if(op.kind==='plan' && typeof op.expiresOn==='string' && /^\d{4}-\d{2}-\d{2}$/.test(op.expiresOn)){
      const end=Date.parse(op.expiresOn+'T23:59:59Z');
      if(Number.isFinite(end))expiresAt=Math.min(at+30*DAY,end+DAY);
    }
    add({op:'upsert',key:op.key,text:text(op.text),kind,at,evidence:quote,expiresAt,dueOn:op.kind==='plan'&&/^\d{4}-\d{2}-\d{2}$/.test(op.expiresOn||'')?op.expiresOn:null});

  }
  return valid;
}
export function selectMemory(m, question='', now=Date.now()) {
  pruneMemory(m,now);
  const event=question.startsWith('[[');
  const entries=m.entries.map(e=>({e,match:overlap(e.text,question)}))
    .filter(({e,match})=>e.kind==='identity'||(!event&&(match>0||(e.source!=='legacy'&&e.updatedAt>now-14*DAY))))
    .sort((a,b)=>b.match-a.match || Number(b.e.kind==='identity')-Number(a.e.kind==='identity') || b.e.updatedAt-a.e.updatedAt)
    .slice(0,24).map(({e})=>e);
  const date=n=>new Date(n).toLocaleDateString('sv-SE',{timeZone:'Europe/Prague'});
  const facts=entries.map(e=>e.text+' ('+(e.source==='legacy'?'starší údaj, datum potvrzení neznámé':'potvrzeno '+date(e.updatedAt))+
    (e.dueOn?', termín '+e.dueOn:'')+')');
  const recall=/minul|včera|vcer|dřív|driv|předchoz|predchoz|pamatuješ|pamatujes|co jsme|ten seznam/i.test(question);
  const diary=(!event&&recall?m.diary.filter(d=>d.verified&&overlap(d.text,question)>0):[]).slice(-3)
    .map(d=>date(d.at)+': '+d.text);
  return {facts,diary};
}
export function contextMessages(history, m, limit=40) {
  const last=history.at(-1);
  if(last?.content?.startsWith('[[UDÁLOST]]'))return [last];
  return history.slice(Math.max(m.windowStart||0,m.sessionStart||0)).slice(-limit);
}
