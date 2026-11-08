import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';import {createRequire} from 'node:module';
import {DiagnosticTrace,conversationId} from '../public/diagnostics-client.mjs';
const require=createRequire(import.meta.url),{createDiagnostics,clean}=require('../diagnostics.js');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'verity-diagnostics-'));
try{
 const disabled=createDiagnostics(temp);assert.equal(disabled.append({text:'nothing'}),false);assert.equal(fs.existsSync(path.join(temp,'diagnostics.key')),false);
 const d=createDiagnostics(temp,{enabled:true,retention_days:7});const key=fs.readFileSync(path.join(temp,'diagnostics.key'),'utf8').trim();
 assert.ok(d.authorized('Bearer '+key));for(const bad of ['',key+'a','Bearer '+ 'x'.repeat(64),'Bearer '+'ž'.repeat(64)])assert.equal(d.authorized(bad),false);
 const requestId=randomUUID(),cid=randomUUID();const receipt=d.receipt(requestId,cid);
 assert.equal(d.acceptClient({receipt:{...receipt,token:'f'.repeat(64)},event:'interrupted'}),false);
 assert.equal(d.acceptClient({receipt:{...receipt,issued:receipt.issued-7200000},event:'interrupted'}),false);
 assert.equal(d.acceptClient({receipt,event:'unknown'}),false);
 assert.ok(d.acceptClient({receipt,event:'playback_start',text:'Při nehodě zemřeli dva lidé.',emotion:'sad',mood:'gloomy',serious:true,audio:true,segment:1,image:'data:image/png;base64,AAAA'}));
 const rows=d.read({conversationId:cid});assert.equal(rows.length,1);assert.equal(rows[0].serious,true);assert.ok(!JSON.stringify(rows).includes('base64'));assert.ok(!JSON.stringify(rows).includes(key));assert.ok(!JSON.stringify(rows).includes(receipt.token));
 d.append({type:'server',conversationId:randomUUID(),requestId:randomUUID(),event:'output',text:'Other'});assert.equal(d.read({requestId}).length,1);assert.equal(d.read({limit:1}).length,1);
 const old=path.join(temp,'var','diagnostics','events-'+(Date.now()-8*86400000)+'-deadbeef.jsonl');fs.writeFileSync(old,'{}\n');d.prune();assert.equal(fs.existsSync(old),false);
 assert.equal(createDiagnostics(temp,{enabled:true}).authorized('Bearer '+key),true);
 assert.ok(!clean('password=SECRET token=PRIVATE data:image/png;base64,AAAA').includes('SECRET'));
 const sent=[],trace=new DiagnosticTrace(async(...args)=>{sent.push(args);});trace.report('interrupted');assert.equal(sent.length,0);trace.accept(receipt);trace.report('playback_start',{segment:1,emotion:'sad'});assert.equal(sent.length,1);
 const fail=new DiagnosticTrace(()=>{throw Error('offline')});fail.accept(receipt);assert.doesNotThrow(()=>fail.report('client_error'));
 const originalFetch=globalThis.fetch;let browserSend=false;try{globalThis.fetch=function(){assert.equal(this,globalThis);browserSend=true;return Promise.resolve({ok:true});};const browserTrace=new DiagnosticTrace();browserTrace.accept(receipt);browserTrace.report('playback_start');assert.equal(browserSend,true);}finally{globalThis.fetch=originalFetch;}
 const saved=new Map(),storage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};assert.equal(conversationId(storage),conversationId(storage));assert.match(conversationId({getItem(){throw Error('disabled')}}),/^[a-f0-9-]{36}$/);
 console.log('PASS private diagnostic auth, receipt validation, bounded fields, no media/key leakage, filtering, retention, restart and offline client.');
}finally{if(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep+'verity-diagnostics-'))fs.rmSync(temp,{recursive:true,force:true});}
