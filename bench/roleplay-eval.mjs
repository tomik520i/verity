
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const [baseline,candidate,endpoint,outFile]=process.argv.slice(2);
if(!outFile)throw Error('Usage: node roleplay-eval.mjs BASE_PROMPT CANDIDATE_PROMPT LLM_URL OUTPUT.json');
const cases=JSON.parse(await fs.readFile(new URL('./roleplay-cases.json',import.meta.url)));
const models=await(await fetch(endpoint+'/v1/models')).json();
const result={at:new Date().toISOString(),model:models.data?.[0]?.id?.split('/').at(-1),params:{temperature:.7,top_p:.95,presence_penalty:.4,max_tokens:320,thinking:false},rows:[]};
for(const [variant,file] of [['baseline',baseline],['candidate',candidate]]){
 const {buildSystemPrompt,buildContextNote,detectCalc}=require(path.resolve(file));
 for(const c of cases){
  const ctx=buildContextNote({instability:c.level,localTime:'20:15',weekday:'neděle',viaVoice:true,liveVoice:true,searchAllowed:!!c.search,calc:detectCalc(c.text)});
  const at=Date.now();
  try{
   const r=await fetch(endpoint+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(90000),body:JSON.stringify({messages:[{role:'system',content:buildSystemPrompt(c.memory||{})},...(c.history||[]),{role:'user',content:ctx+'\n\n'+c.text}],stream:false,temperature:.7,top_p:.95,presence_penalty:.4,max_tokens:320,seed:421,chat_template_kwargs:{enable_thinking:false}})});
   if(!r.ok)throw Error('LLM HTTP '+r.status);
   const data=await r.json(),text=data.choices?.[0]?.message?.content||'';
   result.rows.push({variant,id:c.id,level:c.level,text,finish:data.choices?.[0]?.finish_reason,ms:Date.now()-at,checks:{emotion:/^\[(neutral|happy|excited|curious|love|shy|sad|lonely|scared|jealous|angry|unhinged|whisper)\]/.test(text),shift:/\[posun:-?\d+\]\s*$/.test(text),unsolicitedSearch:!c.search&&/\[hledat:|(?:vyhledám|najdu|hledám).{0,50}(?:web|internet)/i.test(text),words:text.replace(/\[[^\]]*\]/g,'').trim().split(/\s+/).length,giggle:/hihi|haha/i.test(text)}});
  }catch(e){result.rows.push({variant,id:c.id,error:e.message});}
  await fs.writeFile(outFile,JSON.stringify(result,null,2));
  console.log(variant,c.id);
 }
}
