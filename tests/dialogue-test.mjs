import assert from 'node:assert/strict';
import { LiveTranscriber } from '../public/live-audio.js';
import { DialogueTurns, endPause } from '../public/dialogue.js';
let interrupts=0, turns=[];
const engine = new LiveTranscriber();
const control = new DialogueTurns({engine,onTurn:t=>turns.push(t),onInterrupt:()=>interrupts++,isAnswering:()=>true});
const level = (patch={}) => control.level({speaking:true,voiced:true,neural:true,prob:.9,dt:.128,elapsed:2,lastSpeechAt:2,speechSeconds:1,...patch});
level(); level(); assert.equal(interrupts,0); level(); assert.equal(interrupts,1);
for(let i=0;i<8;i++) level(); assert.equal(interrupts,1,'one interrupt per utterance');
engine.segments=[{text:'Ahoj.',done:false,final:true}];
level({speaking:false,voiced:false,elapsed:3.4}); assert.equal(turns.length,0,'partial text must never be committed');
engine.segments[0].done=true; engine.pending=Promise.resolve();
level({speaking:false,voiced:false,elapsed:3.4}); assert.equal(turns.length,0,'pending correction must finish');
engine.pending=null;
level({speaking:false,voiced:false,elapsed:3.4}); assert.equal(turns.length,1); assert.equal(turns[0].text,'Ahoj.');
assert.equal(engine.segments.length,0); assert.equal(engine.speechSeconds,0);
level({speaking:false,voiced:false,elapsed:10}); assert.equal(turns.length,1,'no duplicate delivery');
engine.segments=[{text:'Chtěl jsem ale',done:true,final:true}];
level({speaking:false,voiced:false,elapsed:3.4}); assert.equal(turns.length,1,'continuation word waits longer');
level({speaking:false,voiced:false,elapsed:4.1}); assert.equal(turns.length,2);
assert.equal(endPause('Myslel jsem, že'),2);assert.equal(endPause('Je to tak?'),1.05); assert.equal(endPause('Protože.'),2); assert.equal(endPause('něco dalšího'),1.4);
// Hysteresis / clicks / weak neural confidence must not interrupt.
control.interrupted=false; interrupts=0;
for(let i=0;i<20;i++) level({voiced:false}); assert.equal(interrupts,0);
for(let i=0;i<20;i++) level({prob:.4}); assert.equal(interrupts,0);
level();level({voiced:false});level();level({voiced:false});assert.equal(interrupts,0);
control.stop();for(let i=0;i<10;i++)level();assert.equal(interrupts,0);
// Real feed + mocked STT: two turns on the SAME engine, calibrated input retained.
const oldFetch=globalThis.fetch;let requests=0;
globalThis.fetch=async()=>({ok:true,json:async()=>({text:++requests===1?'První zpráva.':'Druhá zpráva.'})});
try {
 const e=new LiveTranscriber(); let delivered=[];
 e.vad={process:async samples=>[samples[0] ? .99 : .001]};
 const c=new DialogueTurns({engine:e,onTurn:t=>delivered.push(t)});
 e.onLevel=v=>c.level(v);
 for(let turn=0;turn<2;turn++) {
  for(let i=0;i<12;i++)await e.feed(new Float32Array(2048).fill(.1));
  for(let i=0;i<24;i++){await e.feed(new Float32Array(2048));await new Promise(r=>setImmediate(r));}
 }
 assert.equal(delivered.length,2); assert.equal(delivered[0].text,'První zpráva.'); assert.equal(delivered[1].text,'Druhá zpráva.');
 assert.equal(e.closed,false);assert.equal(e.segments.length,0);assert.ok(e.elapsed>8);
 e.cancel();
} finally {globalThis.fetch=oldFetch;}
console.log('PASS: interruption, debounce, final-only delivery, no duplicates, Czech endpointing, two continuous turns, cancel.');
