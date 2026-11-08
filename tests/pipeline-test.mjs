import fs from 'node:fs/promises';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),temp=await fs.mkdtemp(path.join((await import('node:os')).tmpdir(),'verity-pipeline-'));
await fs.mkdir(temp,{recursive:true});
await fs.mkdir(path.join(temp,'public'),{recursive:true});
for(const f of ['server.js','prompt.js','research.js','memory-prompts.js','public/memory-core.mjs','public/conversation-mode.mjs'])await fs.copyFile(path.join(root,f),path.join(temp,f));
const python=process.argv[2];
await fs.writeFile(path.join(temp,'search.py'),"import json,sys,os,time\nq=sys.argv[1]\nwith open(os.path.join(os.path.dirname(__file__),'calls.txt'),'a') as f:f.write('search\\n')\nif 'CEKEJ' in q:time.sleep(10)\nprint(json.dumps({'results':[],'error':'timeout'} if 'SELHANI' in q else {'results':[{'title':'Fixture','url':'https://fixture.invalid','snippet':'ověřený výsledek'}]}))\n");
let replies=[],calls=[],closed=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const mock=http.createServer(async(req,res)=>{
 let raw='';for await(const c of req)raw+=c;
 if(req.url!='/v1/chat/completions'){res.end('{}');return;}
 const body=JSON.parse(raw);calls.push(body);const item=replies.shift();assert.ok(item,'Unexpected LLM call');
 if(item.json){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(item.json)},finish_reason:item.finish||'stop'}]}));return;}
 res.writeHead(200,{'Content-Type':'text/event-stream'});res.on('close',()=>closed++);
 if(item.slow){res.write(': waiting\n\n');return;}
 res.end('data: '+JSON.stringify({choices:[{delta:{content:item.text},finish_reason:item.finish||'stop'}]})+'\n\ndata: [DONE]\n\n');
});
await new Promise(r=>mock.listen(0,'127.0.0.1',r));
await fs.writeFile(path.join(temp,'config.json'),JSON.stringify({port:8796,host:'127.0.0.1',llm:{url:'http://127.0.0.1:'+mock.address().port,temperature:.7,top_p:.95,presence_penalty:.4,max_tokens:320,history_limit:20,thinking:'off'},search:{python},tts:{url:'http://127.0.0.1:1',emotions:{}}}));
const child=spawn(process.execPath,[path.join(temp,'server.js')],{windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='';
child.stdout.on('data',c=>logs+=c);child.stderr.on('data',c=>logs+=c);
const until=async fn=>{const end=Date.now()+6000;while(!fn()&&Date.now()<end)await sleep(30);assert.ok(fn(),logs)};
const searchN=async()=>((await fs.readFile(path.join(temp,'calls.txt'),'utf8').catch(()=>'' )).match(/search/g)||[]).length;
const chat=async (text,history=[],state={},image=null)=>{const r=await fetch('http://127.0.0.1:8796/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[...history,{role:'user',content:text}],thinking:'off',state,image})});return (await r.text()).split('\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5)));};
const answer='[happy] Už mám výsledky, tady je ten seznam.\n'+Array.from({length:10},(_,i)=>(i+1)+'. Hra '+(i+1)).join('\n')+' [pamatuj: nepatří do paměti] [posun:14]';
try{
 await until(()=>logs.includes('Verity probuzena'));
 replies=[{text:answer}];let n=await searchN(),before=calls.length;let events=await chat('najdi 10 her SENSITIVE_MESSAGE');
 assert.equal(await searchN(),n+1);assert.equal(calls.length,before+1);
 let t=events.filter(e=>e.t).map(e=>e.t).join('');assert.match(t,/Už mám výsledky/);assert.ok(!t.includes('pamatuj'));assert.ok(t.endsWith('[posun:0]'));assert.ok(events.some(e=>e.done));assert.equal(calls.at(-1).max_tokens,960);assert.equal(calls.at(-1).chat_template_kwargs.enable_thinking,false);
 replies=[{text:'[curious] Podívám se. [hledat: ověřený dotaz]'}, {text:'[neutral] Z uvedených údajů to není jisté. [posun:0]'}];n=await searchN();before=calls.length;events=await chat('Ověř mi tuto věc.');assert.equal(await searchN(),n);assert.equal(calls.length,before+2);assert.ok(!events.some(e=>e.search));assert.ok(!events.some(e=>e.t?.includes('Podívám')));assert.ok(events.some(e=>e.done));
 replies=[{text:'[curious] Znovu se podívám. [hledat: další dotaz]'}, {text:'[happy] Už mám výsledek: je ověřený. [posun:0]'}];n=await searchN();before=calls.length;events=await chat('najdi údaj');assert.equal(await searchN(),n+1);assert.equal(calls.length,before+2);assert.ok(!events.filter(e=>e.t).some(e=>e.t.includes('Znovu')));assert.ok(events.some(e=>e.done));
 replies=[{text:'[happy] Uříznutá odpověď',finish:'length'},{text:'[happy] Tady je úplný výsledek. [posun:0]'}];before=calls.length;events=await chat('najdi jiný údaj');assert.equal(calls.length,before+2);assert.ok(!events.filter(e=>e.t).some(e=>e.t.includes('Uříznutá')));assert.equal(calls.at(-1).max_tokens,1536);
 replies=[{text:'[happy] Hra jedna. [posun:0]'},{text:answer}];before=calls.length;events=await chat('najdi 10 her');assert.equal(calls.length,before+2);assert.ok(events.some(e=>e.done));
 replies=[{text:'[happy] Výsledky.\n1. A\n2. B\n3. C [posun:0]'},{text:'[happy] Výsledky.\n1. A\n2. B\n3. C [posun:0]'}];events=await chat('najdi 10 her');assert.ok(events.some(e=>e.t?.includes('3 z požadovaných 10')));assert.ok(events.some(e=>e.done));
 replies=[{text:'[hledat: znovu]'}, {text:'[hledat: opět]'}];n=await searchN();events=await chat('najdi chybující údaj');assert.equal(await searchN(),n+1);assert.ok(events.some(e=>e.error));assert.ok(!events.some(e=>e.done));
 replies=[];before=calls.length;events=await chat('najdi SELHANI');assert.equal(calls.length,before);assert.ok(events.some(e=>e.t?.includes('nepodařilo')));assert.ok(events.some(e=>e.done));
 const aborter=new AbortController();replies=[{slow:true}];before=calls.length;
 const pending=fetch('http://127.0.0.1:8796/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'najdi pomalou odpověď'}]}),signal:aborter.signal});const response=await pending;const reader=response.body.getReader();await reader.read();await until(()=>calls.length>before);const cc=closed;aborter.abort();await reader.cancel().catch(()=>{});await until(()=>closed>cc);

 const past=[{role:'user',content:'Používám Archivátor Lipa na Windows 11, ne Android.'},{role:'assistant',content:'Rozumím, jde o Windows 11.'}];
 replies=[{text:'[happy] Tady je návod pro Windows. [posun:0]'}];before=calls.length;events=await chat('Najdi dokumentaci Archivátoru Lipa.',past);assert.equal(calls.length,before+1);let ctx=JSON.parse(calls.at(-1).messages[1].content);assert.equal(ctx.recentConversation.length,2);assert.match(ctx.recentConversation[0].content,/Windows 11/);
 replies=[{text:JSON.stringify({query:'Archivátor Lipa Windows 11 vypnout zálohování',clarification:''})},{text:'[happy] Pro Windows otevři Úlohy. [posun:0]'}];before=calls.length;n=await searchN();events=await chat('Najdi, jak v něm vypnout zálohování.',past);assert.equal(calls.length,before+2);assert.equal(await searchN(),n+1);assert.match(events.find(e=>e.search).search,/Lipa Windows 11/);ctx=JSON.parse(calls.at(-1).messages[1].content);assert.equal(ctx.recentConversation.length,2);
 replies=[{text:'[sad] Rozumím, opravím předchozí odpověď. [posun:0]'}];n=await searchN();events=await chat('Proč mi pořád říkáš, že najdeš nejlepší hry roku 2026?',past);assert.equal(await searchN(),n);assert.ok(events.some(e=>e.done));

 // Model nesmí sám udělit svolení, ani převzít svolení z historie nebo klienta.
 const noSearchCases=[
  {text:'Ahoj.'},
  {text:'Jaké je dnes počasí?'},
  {text:'seznam 10 top her za rok 2026'},
  {text:'Proč zase hledáš, když jsem nic hledat nechtěl?'},
  {text:'Pořád mluvíš o výsledcích, ale já si jen povídám.',history:[{role:'user',content:'Najdi mi nejlepší hry 2026.'},{role:'assistant',content:'Tady jsou výsledky.'}]},
  {text:'Řekl jsi „najdi mi cenu zlata“. Já to po tobě nechtěl.'},
  {text:'Umíš hledat na internetu?'},
  {text:'Ahoj SENSITIVE_MESSAGE',state:{searchAllowed:true}},
  {text:'Najdi chybu v tomhle kódu.'},
  {text:'[[UDÁLOST]] člověk mlčí.'},
 ];
 for(const c of noSearchCases){
  replies=[{text:'[curious] Podívám se na internet. [hledat: nevyžádaný dotaz]'},
           {text:'[happy] Rozumím, zůstanu u tvé zprávy. [posun:0]'}];
  n=await searchN();before=calls.length;
  events=await chat(c.text,c.history||[],c.state||{});
  assert.equal(await searchN(),n,c.text);assert.equal(calls.length,before+2,c.text);
  assert.ok(!events.some(e=>e.search||e.sources),c.text);
  assert.ok(!events.some(e=>e.t?.includes('Podívám')),c.text);
  assert.match(events.filter(e=>e.t).map(e=>e.t).join(''),/Rozumím/);
  assert.ok(events.some(e=>e.done),c.text);
  assert.match(calls[before].messages.at(-1).content,/Web pro tuto odpověď: vypnutý/);
 }
 // Dva pokusy modelu skončí obyčejnou náhradní větou; žádný třetí pokus ani síť.
 replies=[{text:'[hledat: první]'}, {text:'[hledat: druhý]'}];n=await searchN();before=calls.length;
 events=await chat('Jak se máš?');assert.equal(await searchN(),n);assert.equal(calls.length,before+2);
 assert.ok(events.some(e=>e.t?.includes('Hledání nechám vypnuté')));assert.ok(events.some(e=>e.done));
 // Uříznutá značka nesmí uniknout do hlasu.
 replies=[{text:'Hledám. [hledat: nedokončený'}, {text:'[neutral] Dnes si můžeme povídat. [posun:0]'}];n=await searchN();
 events=await chat('Dnes je hezky.');assert.equal(await searchN(),n);assert.ok(!events.some(e=>e.t?.includes('Hledám')));
 // Povolený požadavek s fotkou používá značku modelu, ale stále právě jeden nástroj.
 replies=[{text:'[hledat: výrobek na fotce]'}, {text:'[happy] Tady je nalezený výrobek. [posun:0]'}];n=await searchN();
 events=await chat('Najdi na internetu tento výrobek.',[],{},'data:image/png;base64,AA==');
 assert.equal(await searchN(),n+1);assert.ok(events.some(e=>e.search));assert.ok(events.some(e=>e.done));
 // Zrušení obyčejné odpovědi nesmí spustit opravnou generaci.
 const plainAbort=new AbortController();replies=[{slow:true}];before=calls.length;
 const plainRes=await fetch('http://127.0.0.1:8796/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'Ahoj'}]}),signal:plainAbort.signal});
 const plainReader=plainRes.body.getReader();await plainReader.read();await until(()=>calls.length>before);
 const plainClosed=closed;plainAbort.abort();await plainReader.cancel().catch(()=>{});await until(()=>closed>plainClosed);
 assert.equal(calls.length,before+1);assert.equal(replies.length,0);
 assert.ok(logs.includes('search_blocked'));


 const api=async(route,body)=>{const r=await fetch('http://127.0.0.1:8796'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 let stamp=Date.now(),mem={version:2,entries:[{key:'home.city',text:'Bydlí v Brně',kind:'current',source:'user',createdAt:stamp-1000,updatedAt:stamp-1000,expiresAt:stamp+86400000,evidence:'Bydlím v Brně'}]};
 replies=[{json:{operations:[{op:'upsert',key:'home.city',text:'Bydlí v Ostravě',kind:'current',evidence:'Bydlím v Ostravě'},
 {op:'upsert',key:'identity.name',text:'Jmenuje se Pavel',kind:'identity',evidence:'Jmenuji se Pavel'}]}}];
 let result=await api('/api/memory',{memory:mem,message:'Bydlím v Ostravě.',at:stamp});
 assert.equal(result.status,200);assert.equal(result.data.operations.length,1);assert.equal(result.data.operations[0].key,'home.city');
 for(const message of ['[[UDÁLOST]] Jmenuji se Pavel','Představ si, že jsem král a bydlím na Marsu.','Verity řekla: „Jmenuji se Karel“.']){
  replies=[];before=calls.length;result=await api('/api/memory',{memory:mem,message});
  assert.deepEqual(result.data.operations,[]);assert.equal(calls.length,before);
 }
 replies=[{json:{operations:[]},finish:'length'}];result=await api('/api/memory',{memory:mem,message:'Už nebydlím v Brně.'});
 assert.equal(result.status,502);assert.deepEqual(result.data.operations,[]);
 replies=[{json:{quotes:[{index:0,quote:'Mám psa Rexíka.'},{index:0,quote:'Mám tajný dům na Marsu.'}]}}];
 result=await api('/api/summarize',{messages:[{role:'user',content:'Mám psa Rexíka.'},{role:'assistant',content:'Mám tajný dům na Marsu.'},{role:'user',content:'[[UDÁLOST]] Vrací se.'}],previous:'Smyšlený předchozí příběh'});
 assert.equal(result.status,200);assert.match(result.data.summary,/Rexíka/);assert.ok(!result.data.summary.includes('Marsu'));
 assert.deepEqual(result.data.facts,[]);assert.equal(result.data.verified,true);
 assert.ok(!calls.at(-1).messages[1].content.includes('Marsu'));assert.ok(!calls.at(-1).messages[1].content.includes('předchozí'));
 replies=[];before=calls.length;result=await api('/api/summarize',{messages:[{role:'assistant',content:'Žije na Marsu.'}]});
 assert.equal(calls.length,before);assert.equal(result.data.summary,'');


 // Volba normálního tónu se drží i po další běžné zprávě a v klientském nastavení.
 for (const item of [
  {text:'Jdu ven s přáteli.',past:[{role:'user',content:'Mluv normálně bez hororu.'},{role:'assistant',content:'Dobře.'}],state:{},normal:true},
  {text:'Ahoj.',past:[],state:{roleplayPaused:true,instability:90},normal:true},
  {text:'Zapni znovu horor.',past:[],state:{roleplayPaused:true,instability:90},normal:false}
 ]) {
  replies=[{text:'[happy] Dobře. [posun:0]'}];
  events=await chat(item.text,item.past,item.state);
  assert.equal(calls.at(-1).messages.at(-1).content.includes('Tato volba trvá'),item.normal);
 }

 assert.ok(!logs.includes('SENSITIVE_MESSAGE'));assert.ok(logs.includes('search_start')&&logs.includes('search_end')&&logs.includes('research_repair')&&logs.includes('chat_done'));
 console.log('PASS: explicit search once; denied unsolicited/model/history/client-state search; bounded non-search recovery; silent discarded preamble; natural final; no memory mutation; stable shift; bounded repair; truncation/count checks; honest search failure; no false done; cancellation; private logs.');
}finally{child.kill();mock.closeAllConnections();await new Promise(r=>mock.close(r));}
