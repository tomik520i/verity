import assert from 'node:assert/strict';
let mode='normal', count=0;const sent=[];
class FakeWorker {
 constructor(){if(mode==='constructor')throw Error('worker unavailable');count++;}
 postMessage(message){sent.push(message);if(mode==='hang'&&message.type==='process')return;queueMicrotask(()=>this.onmessage?.({data:{id:message.id,probs:message.type==='process'?[.8]:undefined}}));}
 terminate(){this.terminated=true;}
}
globalThis.Worker=FakeWorker;
const {SileroVad,preload}=await import('../public/vad.js');
mode='constructor';await assert.rejects(preload(),/unavailable/);
mode='normal';await Promise.all([preload(),preload()]);assert.equal(count,1);
const first=await SileroVad.create();const input=new Float32Array(2048).fill(.3);
assert.deepEqual(await first.process(input),[.8]);assert.equal(input.length,2048);
mode='hang';await assert.rejects(first.process(input),/včas/);
mode='normal';const second=await SileroVad.create();assert.equal(count,2);assert.notEqual(first.stream,second.stream);
assert.deepEqual(await second.process(input),[.8]);
console.log('PASS Worker initialization failure, shared preload, inference timeout, clean restart and independent stream ids');
