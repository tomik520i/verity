import assert from 'node:assert/strict';
import {LiveTranscriber,startMicrophone} from '../public/live-audio.js';
let requests=0,levels=[],textCalls=0,pauses=0,threshold=-40;
globalThis.fetch=async()=>{requests++;throw Error('Monitor must not use network');};
const monitor=new LiveTranscriber({monitorOnly:true,getThreshold:()=>threshold,onLevel:v=>levels.push(v),onText:()=>textCalls++,onPause:()=>pauses++});
monitor.vad={process:async()=>[.95],reset:async()=>{}};
const frame=db=>new Float32Array(2048).fill(10**(db/20));
monitor.startTimer();assert.equal(monitor.timer,undefined);
for(let i=0;i<12;i++)await monitor.feed(frame(-48));
assert.ok(levels.every(v=>!v.speaking),'voice below user threshold stays blocked');
threshold=-55;
for(let i=0;i<12;i++)await monitor.feed(frame(-48));
assert.ok(levels.some(v=>v.speaking&&v.voiced),'slider applies immediately to actual VAD');
for(let i=0;i<30;i++)await monitor.feed(frame(-80));
await monitor.pump();monitor.publish();
assert.equal(await monitor.finish(),'');
assert.equal(requests,0);assert.equal(textCalls,0);assert.equal(pauses,0);
assert.equal(monitor.pre.length,0);assert.equal(monitor.segments.length,0);assert.equal(monitor.current,null);

let capture,trackStopped=0,closed=0,diagnostic=null;
const track={stop(){trackStopped++},getSettings:()=>({sampleRate:48000}),addEventListener(){}};
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]})}}});
class Node{connect(){}disconnect(){}}
class Context{
 constructor(){this.sampleRate=48000;this.destination={};this.audioWorklet={addModule:async()=>{}};}
 resume(){return Promise.resolve();}
 close(){closed++;return Promise.resolve();}
 createMediaStreamSource(){return new Node();}
 createGain(){const n=new Node();n.gain={value:0};return n;}
}
globalThis.AudioContext=Context;
globalThis.AudioWorkletNode=class extends Node{
 constructor(ctx,name,opts){super();diagnostic=opts.processorOptions.diagnostic;capture=this;this.port={postMessage:()=>queueMicrotask(()=>this.port.onmessage?.({data:{flushed:true}}))};}
};
const test=await startMicrophone({monitorOnly:true,vad:false,debug:true});
assert.equal(diagnostic,false,'test must force native recording off');
capture.port.onmessage({data:{raw:frame(-20)}});
for(let i=0;i<20;i++)capture.port.onmessage({data:frame(-20)});
assert.equal(await test.stop(),'');assert.equal(requests,0);
assert.equal(trackStopped,1);assert.equal(closed,1);
assert.equal(test.engine.segments.length,0);
console.log('PASS local-only VAD test: live sensitivity, no STT or chat callback, no audio buffers/archive, no network even on stop, released microphone.');
