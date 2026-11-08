import {roleplayPreference} from '../public/conversation-mode.mjs';

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {applyVoiceDefaults,microphoneLabel,needsEchoFallback} from '../public/voice-preferences.mjs';
const store=(seed={})=>({data:{...seed},get(k,d){return k in this.data?this.data[k]:d},set(k,v){this.data[k]=v;return true;}});
const fresh=store();assert.equal(applyVoiceDefaults(fresh),true);
for(const k of ['live','voice','silero','autoSend'])assert.equal(fresh.data[k],true);
assert.equal(fresh.data.outputMode,'aec');assert.equal(fresh.data.conv,false);
fresh.set('live',false);fresh.set('outputMode','speakers');assert.equal(applyVoiceDefaults(fresh),false);
assert.equal(fresh.data.live,false);assert.equal(fresh.data.outputMode,'speakers');
const old=store({live:false,conv:true,autoSend:false,outputMode:'headphones',micThresholdDb:-38,think:'off'});
applyVoiceDefaults(old);assert.equal(old.data.voiceDefaultsBackup.live,false);assert.equal(old.data.outputMode,'headphones');assert.equal(old.data.micThresholdDb,-38);assert.equal(old.data.think,'off');
assert.equal(microphoneLabel({liveMode:true,starting:true,supported:true}),'Zrušit zapínání');
assert.equal(needsEchoFallback('aec',null),true);assert.equal(needsEchoFallback('aec',false),true);
assert.equal(needsEchoFallback('aec',true),false);assert.equal(needsEchoFallback('aec','all'),false);assert.equal(needsEchoFallback('headphones',null),false);
const app=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');
const part=(from,to)=>{const start=app.indexOf(from),end=app.indexOf(to,start);assert.ok(start>=0&&end>start);return app.slice(start,end);};
const echoCode=part('function fallbackEchoMode()','let speakerTailUntil').replace(/await import\([^)]*\)/g,'await mockImport()');
function echoHarness(mode){
 const h={AbortController,DOMException,needsEchoFallback,mode,events:[],store:store(),current:null,outputMode:'aec',echoOutput:null,echoRouteAbort:null,actx:{},
  analyser:{disconnect(){h.events.push('disconnect')},connect(){h.events.push('connect')}},
  releaseEchoOutput(){h.echoRouteAbort?.abort();h.echoOutput=null;h.events.push('release')},
  outputModeUi(){},micState(t){h.events.push(t)},cancelMic(){h.events.push('cancel')},stopLive(){h.events.push('stop')},
  async mockImport(){return{createEchoOutput:async(ctx,{signal,onFailure})=>{
   if(mode==='fail')throw Error('unavailable');
   if(mode==='abort'){h.echoRouteAbort.abort();throw new DOMException('cancel','AbortError')}
   h.onFailure=onFailure;return{input:{},close(){h.events.push('close')}};
  }}}
 };
 vm.createContext(h);vm.runInContext(echoCode,h);return h;
}
const ok=echoHarness('ok');await ok.prepareEchoOutput();assert.equal(ok.outputMode,'aec');assert.ok(ok.echoOutput);assert.ok(ok.events.includes('connect'));
const failed=echoHarness('fail');await failed.prepareEchoOutput();assert.equal(failed.outputMode,'speakers');assert.equal(failed.echoOutput,null);
const cancelled=echoHarness('abort');await assert.rejects(cancelled.prepareEchoOutput(),{name:'AbortError'});assert.equal(cancelled.outputMode,'aec');
let suppressed=0;assert.equal(ok.confirmEchoMode({echoCancellation:null,suppress(){suppressed++}}),true);assert.equal(ok.outputMode,'speakers');
const lost=echoHarness('ok');await lost.prepareEchoOutput();lost.onFailure();assert.equal(lost.outputMode,'speakers');assert.ok(lost.events.includes('stop'));
const startCode=part('async function startLive()','async function stopLive(').replace(/await import\([^)]*\)/g,'await mockImport()');
function startHarness(){
 let releaseAudio,releaseCapture;
 const dom=new Map(),el=id=>{if(!dom.has(id))dom.set(id,{value:'',hidden:false,disabled:false,textContent:''});return dom.get(id)};
 const h={liveSession:null,liveStarting:false,micFinishing:false,awake:true,micSupported:true,liveGeneration:0,liveBase:'',activity:{},busy:false,playing:false,current:null,music:{},face:{hear:0},outputMode:'aec',sileroVad:true,micThreshold:-50,actx:{},lastUserAt:0,
  $:el,cancelMic:async()=>{},interrupt(){},liveUi(){},outputModeUi(){},micState(){},prepareCount:0,prepareEchoOutput:async()=>{h.prepareCount++},releaseEchoOutput(){},confirmEchoMode(){},inputSuppressed:()=>false,vadMeter(){},deliverLive(){},
  initAudio:()=>new Promise(r=>{releaseAudio=r}),
  mockImport:async()=>({startDialogue:()=>new Promise(r=>{releaseCapture=r})}),
 };
 vm.createContext(h);vm.runInContext(startCode,h);
 return{h,audio:()=>releaseAudio(),capture:o=>releaseCapture(o)};
}
const tick=()=>new Promise(r=>setImmediate(r));
const early=startHarness(),earlyPromise=early.h.startLive();await tick();early.h.liveGeneration++;early.h.liveStarting=false;early.audio();await earlyPromise;assert.equal(early.h.prepareCount,0,'cancel during init must not create output route');
const late=startHarness(),latePromise=late.h.startLive();await tick();late.audio();await tick();late.h.liveGeneration++;late.h.liveStarting=false;let closed=0;late.capture({cancel:async()=>closed++,engine:{}});await latePromise;assert.equal(closed,1,'late microphone permission result must release device');assert.equal(late.h.liveSession,null);
console.log('PASS one-time voice migration, saved choices, sensitivity, echo startup fallback, cancellation, unsupported AEC, runtime disconnection, late microphone cleanup.');

assert.equal(roleplayPreference('Mluv normálně bez hororu.'),true);
assert.equal(roleplayPreference('Jdu ven s kamarády.',true),true);
assert.equal(roleplayPreference('Zapni znovu horor.',true),false);
assert.equal(roleplayPreference('Řekl: „mluv normálně“.',false),false);
assert.equal(roleplayPreference('[[UDÁLOST]] mluv normálně',false),false);

const idleSource=app.slice(app.indexOf("setInterval(() => {\n  if (!awake || liveMode"),app.indexOf('let titleTimer = null;'));
assert.ok(idleSource.includes('converse('));
function idleHarness(live){
 const h={awake:true,liveMode:live,busy:false,playing:false,mic:null,micFinishing:false,liveSession:null,liveStarting:false,document:{hidden:false},idleCount:0,lastUserAt:0,lastVerityAt:0,instability:90,requests:0,
 Date:{now:()=>120000},setInterval(fn){h.tick=fn},setInstability(v){h.instability=v},converse(){h.requests++}};
 vm.createContext(h);vm.runInContext(idleSource,h);h.tick();return h;
}
assert.equal(idleHarness(true).requests,0,'ended live call must not initiate a monologue');
assert.equal(idleHarness(false).requests,1,'legacy idle roleplay remains available');
