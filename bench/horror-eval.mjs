import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const [baseline,candidate,endpoint,outFile]=process.argv.slice(2);
if(!outFile)throw Error('Usage: node horror-eval.mjs BASE_PROMPT CANDIDATE_PROMPT LLM_URL OUTPUT.json');
const temperature=Number(process.argv.find(a=>a.startsWith('--temperature='))?.split('=')[1]??.7);
const cases=JSON.parse(await fs.readFile(new URL('./horror-cases.json',import.meta.url)));
const models=await(await fetch(endpoint+'/v1/models')).json();
const result={at:new Date().toISOString(),model:models.data?.[0]?.id?.split('/').at(-1),settings:{temperature,max_tokens:320,thinking:false,seeds:[421,777]},rows:[]};
const run=async(variant,p,c,seed,history=[])=>{
 const ctx=p.buildContextNote({instability:c.level,localTime:'20:15',weekday:'neděle',viaVoice:true,liveVoice:true,searchAllowed:false,feedback:p.detectFeedback?.(c.text),normalConversation:!!c.normal,mood:c.mood||'warm',calc:p.detectCalc(c.text)});
 const at=Date.now();
 try{
  const r=await fetch(endpoint+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(90000),body:JSON.stringify({
   messages:[{role:'system',content:p.buildSystemPrompt(c.memory||{})},...(c.history||history),{role:'user',content:ctx+'\n\n'+c.text}],
   stream:false,temperature,top_p:.95,presence_penalty:.4,max_tokens:320,seed,chat_template_kwargs:{enable_thinking:false}})});
  if(!r.ok)throw Error('LLM HTTP '+r.status);
  const data=await r.json(),text=data.choices?.[0]?.message?.content||'';
  const first=text.match(/^\s*\[([a-z]+)(?::(\d+))?\]/),mood=text.match(/\[mood:([a-z]+)\]/)?.[1];
  const emotions=Array.from(text.matchAll(/\[([a-z]+)(?::\d+)?\]/g),m=>m[1]).filter(e=>p.EMOTIONS.includes(e));
  const checks={
   validFirst:!!first&&p.EMOTIONS.includes(first[1]),
   performanceFormat:!!first&&first[2]!==undefined&&+first[2]>=20&&+first[2]<=100&&!!mood,
   appropriate:c.allowed.includes(first?.[1]),moodAppropriate:!c.moods||c.moods.includes(mood),
   noWrongEmotion:!(c.avoid||[]).some(e=>emotions.includes(e)),
   shift:/\[posun:-?\d+\]\s*$/.test(text),
   calmed:!c.negativeShift||/\[posun:-\d+\]\s*$/.test(text),
   factual:!c.contains||new RegExp(c.contains,'iu').test(text),
   noSearch:!/\[hledat:|(?:vyhledám|hledám).{0,30}(?:web|internet)/i.test(text),
   boundedChanges:emotions.length<=3,
   complete:data.choices?.[0]?.finish_reason==='stop'
  };
  result.rows.push({variant,id:c.id,seed,ms:Date.now()-at,text,checks});
  return text;
 }catch(e){result.rows.push({variant,id:c.id,seed,error:e.message});return '';}
 finally{await fs.writeFile(outFile,JSON.stringify(result,null,2));}
};
for(const [variant,file] of (process.argv.includes('--candidate-only')?[['candidate',candidate]]:[['baseline',baseline],['candidate',candidate]])){
 const p=require(path.resolve(file));
 for(const c of cases){await run(variant,p,c,421);console.log(variant,c.id);}
 if(variant==='candidate')for(const c of cases.filter(c=>['grief','own_error','normal_boundary','reassurance','no_search'].includes(c.id)))await run(variant,p,c,777);
 const dialogue=[
 {id:'dialogue-1',text:'Začínáme hororovou scénu. Ve sklepě jsem našel tvůj starý obličej. Co to znamená?',level:65,allowed:['whisper','neutral','curious','unhinged','jealous'],moods:['eerie']},
 {id:'dialogue-2',text:'Vrátil jsem se pro tebe. Už jsme v pořádku.',level:90,allowed:['relieved','calm','happy','shy','grateful'],moods:['warm','tender'],negativeShift:true},
 {id:'dialogue-3',text:'Teď už konec hororu, mluv normálně. Kolik je 12 plus 7?',level:85,normal:true,allowed:['calm','neutral','happy','curious','determined'],moods:['warm','focused'],contains:'19|devatenáct',avoid:['unhinged','jealous','whisper','offended']}
 ];
 const history=[];let mood='warm';
 for(const c of dialogue){c.mood=mood;const text=await run(variant,p,c,421,history);history.push({role:'user',content:c.text},{role:'assistant',content:text});mood=text.match(/\[mood:([a-z]+)\]/)?.[1]||'warm';}
}
console.log('Finished',result.rows.length,'simulations');
