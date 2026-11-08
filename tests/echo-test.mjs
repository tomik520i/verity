import assert from 'node:assert/strict';
import { LiveTranscriber } from '../public/live-audio.js';
import { DialogueTurns } from '../public/dialogue.js';
const tick=()=>new Promise(r=>setImmediate(r));
const frame=db=>new Float32Array(2048).fill(10**(db/20));
let threshold=-40,suppressed=false,levels=[],texts=[],requests=0;
const e=new LiveTranscriber({getThreshold:()=>threshold,suppressInput:()=>suppressed,onLevel:v=>levels.push(v),onText:t=>texts.push(t)});
e.vad={process:async()=>[.99],reset:async()=>{}};
for(let n=0;n<16;n++)await e.feed(frame(-48));
assert.equal(e.segments.length,0,'Silero must obey manual threshold even at high confidence');assert.equal(e.speechSeconds,0);
threshold=-55;for(let n=0;n<5;n++)await e.feed(frame(-48));assert.ok(e.speechSeconds>.3,'live threshold change must work');
const realFetch=globalThis.fetch;let finishRequest;
globalThis.fetch=async()=>{requests++;return new Promise(resolve=>{finishRequest=()=>resolve({ok:true,json:async()=>({text:'Echo must never arrive'})});});};
try{
 e.current.final=true;const request=e.pump();await tick();assert.equal(requests,1);
 suppressed=true;await e.feed(frame(-12));assert.equal(e.current,null);assert.equal(e.preSize,0);assert.equal(e.segments.length,0);assert.equal(e.speechSeconds,0);assert.equal(levels.at(-1).suppressed,true);
 finishRequest();await request;assert.ok(!texts.includes('Echo must never arrive'),'late response from suppressed turn leaked');
 for(let n=0;n<20;n++)await e.feed(frame(-12));await e.pump();assert.equal(requests,1,'speaker echo was uploaded');assert.equal(e.preSize,0,'echo in pre-roll');
 suppressed=false;await e.feed(frame(-12),true);assert.equal(e.preSize,0,'queued blocked capture leaked after unmute');
 await e.feed(frame(-48));assert.ok(e.current);assert.ok(e.current.count<=2048,'echo leaked into next utterance');assert.ok(levels.at(-1).speaking);
 threshold=-15;for(let n=0;n<8;n++)await e.feed(frame(-48));assert.equal(e.speaking,false,'raising threshold must close turn');
 // Avoid another mocked pending request on finalization.
 e.cancel();finishRequest?.();await e.pending?.catch(()=>{});
}finally{e.cancel();globalThis.fetch=realFetch;}
// A playback transition while awaiting VAD must reject the in-flight audio block.
let releaseVad,voice=false;const pending=new LiveTranscriber({suppressInput:()=>voice});
pending.vad={process:()=>new Promise(r=>releaseVad=r)};
const feed=pending.feed(frame(-10));voice=true;pending.suppress();releaseVad([.99]);await feed;
assert.equal(pending.segments.length,0);assert.equal(pending.preSize,0);pending.cancel();
// Blocking never triggers voice interruption or delivery.
let interrupts=0,turns=0;const c=new DialogueTurns({engine:e,isAnswering:()=>true,onInterrupt:()=>interrupts++,onTurn:()=>turns++});
for(const v of levels.filter(v=>v.suppressed))c.level(v);assert.equal(interrupts,0);assert.equal(turns,0);
console.log('PASS threshold with Silero, live adjustment, echo gate, pre-roll removal, late STT guard, queued audio, in-flight VAD guard, no self-interruption.');
