// Private, bounded diagnostic journal. Never served as static files.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const UUID=/^[a-f0-9-]{36}$/i;
const EVENTS=new Set(['playback_start','playback_end','interrupted','client_error','tts_error']);
function clean(value,max=12000){return String(value??'').slice(0,max).replace(/data:[^\s"']{0,80};base64,[a-z0-9+/=]+/gi,'[media omitted]').replace(/\b(?:sk-[a-zA-Z0-9_-]{20,}|gh[pousr]_[a-zA-Z0-9]{20,})\b/g,'[credential omitted]').replace(/(\b(?:authorization|password|heslo|api[_ -]?key|token)\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/gi,'$1[redacted]');}
function createDiagnostics(root,options={}){
 const enabled=options.enabled===true,retentionDays=Math.max(1,Math.min(30,Number(options.retention_days)||7));
 const dir=path.join(root,'var','diagnostics'),keyFile=path.join(root,'diagnostics.key');
 const maxFile=4*1024*1024,maxTotal=32*1024*1024;
 let key='',lastCleanup=0,lastError=null;
 if(enabled){
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  try{key=fs.readFileSync(keyFile,'utf8').trim();}catch(e){if(e.code!=='ENOENT')throw e;key=crypto.randomBytes(32).toString('hex');try{fs.writeFileSync(keyFile,key+'\n',{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;key=fs.readFileSync(keyFile,'utf8').trim();}}
  if(!/^[a-f0-9]{64}$/i.test(key))throw Error('Invalid diagnostics key');
 }
 const files=()=>fs.readdirSync(dir).filter(n=>/^events-\d{13}-[a-f0-9]{8}\.jsonl$/.test(n)).sort();
 function prune(now=Date.now()){
  if(!enabled)return;let entries=files().map(n=>({n,at:+n.slice(7,20),size:fs.statSync(path.join(dir,n)).size}));let total=entries.reduce((s,e)=>s+e.size,0);
  for(const e of entries){if(e.at<now-retentionDays*86400000||total>maxTotal){fs.unlinkSync(path.join(dir,e.n));total-=e.size;}}
  lastCleanup=now;
 }
 function append(record){
  if(!enabled)return false;
  try{
   const now=Date.now();if(now-lastCleanup>60000)prune(now);
   const data=JSON.stringify({...record,at:now})+'\n';if(Buffer.byteLength(data)>64000)return false;
   let file=files().at(-1);if(!file||fs.statSync(path.join(dir,file)).size+Buffer.byteLength(data)>maxFile)file='events-'+now+'-'+crypto.randomBytes(4).toString('hex')+'.jsonl';
   fs.appendFileSync(path.join(dir,file),data,{mode:0o600});lastError=null;return true;
  }catch(e){lastError=e.code||'write_failed';console.error('[diagnostics] write failed:',lastError);return false;}
 }
 const sign=(requestId,conversationId,issued)=>crypto.createHmac('sha256',key).update(requestId+'|'+conversationId+'|'+issued).digest('hex');
 function receipt(requestId,conversationId){const issued=Date.now();return{requestId,conversationId,issued,token:sign(requestId,conversationId,issued)};}
 function authorized(header){const provided=String(header||'').replace(/^Bearer /,'');return enabled&&/^[a-f0-9]{64}$/i.test(provided)&&crypto.timingSafeEqual(Buffer.from(provided),Buffer.from(key));}
 function acceptClient(body){
  const r=body.receipt||{},now=Date.now();if(!enabled||!UUID.test(r.requestId||'')||!UUID.test(r.conversationId||'')||!Number.isSafeInteger(r.issued)||now-r.issued>3600000||r.issued>now+10000)return false;
  const actual=sign(r.requestId,r.conversationId,r.issued);if(typeof r.token!=='string'||! /^[a-f0-9]{64}$/i.test(r.token)||!crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(r.token)))return false;
  if(!EVENTS.has(body.event))return false;
  const record={type:'client',event:body.event,requestId:r.requestId,conversationId:r.conversationId,segment:Math.max(0,Math.min(200,Math.floor(Number(body.segment)||0)))};
  if(body.event.startsWith('playback_'))Object.assign(record,{text:clean(body.text,2400),emotion:clean(body.emotion,24),mood:clean(body.mood,24),intensity:Math.max(0,Math.min(1,Number(body.intensity)||0)),serious:body.serious===true,audio:body.audio===true});
  if(body.event.endsWith('error'))record.error=clean(body.error,300);
  return append(record);
 }
 function read(query={}){
  if(!enabled)return[];
  prune();const limit=Math.max(1,Math.min(500,Number(query.limit)||100)),since=Math.max(Date.now()-retentionDays*86400000,Number(query.since)||0),before=Number(query.before)||Infinity;
  const found=[];
  for(const name of files().reverse()){
   const lines=fs.readFileSync(path.join(dir,name),'utf8').trim().split('\n').reverse();
   for(const line of lines){let r;try{r=JSON.parse(line);}catch{continue;}
    if(r.at<since||r.at>=before||query.requestId&&r.requestId!==query.requestId||query.conversationId&&r.conversationId!==query.conversationId)continue;
    found.push(r);if(found.length>=limit)return found.reverse();
   }
  }return found.reverse();
 }
 if(enabled)prune();
 return{enabled,retentionDays,append,receipt,authorized,acceptClient,read,prune,status:()=>({enabled,retentionDays,healthy:!lastError})};
}
module.exports={createDiagnostics,clean,UUID};
