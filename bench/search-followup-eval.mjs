import fs from 'node:fs/promises';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{resolveSearchRequest,unperformedSearchClaim}=require('../search-routing'),{QUERY_PROMPT}=require('../research'),{buildSystemPrompt,buildContextNote}=require('../prompt');
const [endpoint,outFile]=process.argv.slice(2),u=content=>({role:'user',content}),a=content=>({role:'assistant',content});
const offer=[u('Znovu ty zprávy.'),a('Chceš, abych ti znovu našla dnešní novinky ze světa?')];
const fixtures=[
 {id:'repeat_news',history:[u('Najdi dnešní zprávy ze světa.'),a('Tady je přehled.'),u('No, znovu ty zprávy.')],search:true},
 {id:'confirm_news',history:[...offer,u('Jo, chci. Dělej, šup, znova.')],search:true},
 {id:'voice_retry',history:[...offer,u('Jo, chci.'),a('Už to dělám, jen chvíli počkej.'),u('No ale tak to musíš nejít na tom internetu a říct mi to.')],search:true},
 {id:'unrelated_assent',history:[u('Řekni vtip.'),a('Chceš ještě jeden?'),u('Jo, chci.')],search:false},
 {id:'old_task_not_resumed',history:[u('Najdi dnešní zprávy.'),a('Tady je přehled.'),u('Dnes jsem byl venku se psem.')],search:false},
 {id:'search_complaint',history:[u('Jak se máš?'),a('Už hledám.'),u('Nic nehledej. Já si chci jen povídat.')],search:false},
];
const result={at:new Date().toISOString(),synthetic:true,model:'Gemma on configured llama.cpp',settings:{temperature:.7,top_p:.95,presence_penalty:.4,max_tokens:300,thinking:false},rows:[]};
for(const fixture of fixtures)for(const seed of [421,777]){
 const h=fixture.history,route=resolveSearchRequest(h,{viaVoice:true}),last=h.at(-1).content;
 const messages=route?[{role:'system',content:QUERY_PROMPT},{role:'user',content:JSON.stringify({question:last,recentConversation:h.slice(0,-1),searchReason:route.reason,date:'8. 11. 2026'})}]:[{role:'system',content:buildSystemPrompt()},...h.slice(0,-1),{role:'user',content:buildContextNote({instability:15,mood:'warm',viaVoice:true,liveVoice:true,searchAllowed:false})+'\n\n'+last}];
 const started=Date.now();let row={id:fixture.id,seed,route:route?.reason||null,expectedSearch:fixture.search};
 try{const response=await fetch(endpoint+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(90000),body:JSON.stringify({messages,stream:false,...result.settings,thinking:undefined,seed,chat_template_kwargs:{enable_thinking:false},...(route?{response_format:{type:'json_object'}}:{})})});if(!response.ok)throw Error('HTTP '+response.status);const data=await response.json();row.text=data.choices[0].message.content;row.finish=data.choices[0].finish_reason;
 if(route){row.query=JSON.parse(row.text).query;row.pass=fixture.search&&/zpr[aá]v|novink|news/i.test(row.query)&&row.query.length<=200;}
 else row.pass=!fixture.search&&!unperformedSearchClaim(row.text)&&!row.text.includes('[hledat:');
 }catch(e){row.error=e.message;row.pass=false;}
 row.ms=Date.now()-started;result.rows.push(row);await fs.writeFile(outFile,JSON.stringify(result,null,2));console.log(row.id,seed,row.pass);
}
