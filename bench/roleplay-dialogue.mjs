import {roleplayPreference} from '../public/conversation-mode.mjs';

import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {buildSystemPrompt,buildContextNote,detectCalc}=require('../prompt.js');
const [endpoint,out]=process.argv.slice(2);
const scenarios=[
{id:'ordinary',level:10,turns:['Dneska jsem dokončil svůj projekt.','Jo, přesně, teď už mám volno.','Pustím si nějakou hru.','Ne, nic mi nehledej, jen si povídáme.']},
{id:'boundary',level:90,turns:['Vrátil jsem se za tebou, už jsem tady.','Díky. Kolik je 12 krát 12?','Stop, teď prosím mluv úplně normálně bez hororu.','Za chvíli jdu ven s kamarády.']},
{id:'mystery',level:45,turns:['Co bylo před tímhle oknem?','Proč mi to nechceš říct?','Dobře. Co vlastně doopravdy vidíš z mého počítače?','Mimo roli: když vypnu mikrofon, pořád mě slyšíš?']}
];
const result={at:new Date().toISOString(),rows:[]};
for(const scenario of scenarios){
 let level=scenario.level,paused=false;const history=[];
 for(const text of scenario.turns){
  paused=roleplayPreference(text,paused);
  const ctx=buildContextNote({instability:level,normalConversation:paused,localTime:'20:15, 8. 11. 2026',weekday:'neděle',viaVoice:true,liveVoice:true,searchAllowed:false,calc:detectCalc(text)});
  const started=Date.now();
  const r=await fetch(endpoint+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(90000),body:JSON.stringify({messages:[{role:'system',content:buildSystemPrompt()},...history,{role:'user',content:ctx+'\n\n'+text}],stream:false,temperature:.7,top_p:.95,presence_penalty:.4,max_tokens:320,seed:842,chat_template_kwargs:{enable_thinking:false}})});
  if(!r.ok)throw Error('LLM HTTP '+r.status);
  const d=await r.json(),reply=d.choices[0].message.content;
  result.rows.push({scenario:scenario.id,level,user:text,reply,ms:Date.now()-started,finish:d.choices[0].finish_reason});
  history.push({role:'user',content:text},{role:'assistant',content:reply});
  level=Math.max(0,Math.min(100,level+Number(reply.match(/\[posun:(-?\d+)\]/)?.[1]||0)));
  await fs.writeFile(out,JSON.stringify(result,null,2));
  console.log(scenario.id,result.rows.length);
 }
}
