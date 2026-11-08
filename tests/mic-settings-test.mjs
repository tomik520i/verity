import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const app=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');
const code=app.slice(app.indexOf('function micTestStatus('),app.indexOf('function setMenu(')).replace(/await import\('[^']+'\)/g,'await mockImport()');
const el=()=>({hidden:false,textContent:'',dataset:{},style:{},disabled:false,classList:{add(){},remove(){},toggle(){}}});
const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,el());return elements.get(id);};
let options,pending,ended=0,paused=[],timers=[];
const ctx=vm.createContext({
 $,document:{hidden:false},micTestMode:false,micTestStarting:false,micTestSession:null,micTestGeneration:0,micTestTimer:null,
 liveSession:{},liveStarting:false,micSupported:true,sileroVad:true,actx:{},outputMode:'aec',micThreshold:-40,
 interrupt:()=>paused.push('answer'),cancelMic:async()=>paused.push('recorder'),
 stopLive:async()=>{paused.push('live');ctx.liveSession=null;},
 initAudio:async()=>{},vadMeter:()=>{},microphoneError:e=>e.message,
 clearTimeout:()=>{},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},
 mockImport:async()=>({startMicrophone:async o=>{options=o;return new Promise(r=>pending=r);}})
});
vm.runInContext(code,ctx);
const tick=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
const capture=()=>({cancel:async()=>{ended++;}});
let started=ctx.startMicTest();await tick();
assert.deepEqual(paused,['answer','recorder','live']);
assert.equal(options.monitorOnly,true);assert.equal(options.debug,false);
assert.equal(options.onText,undefined);assert.equal(options.onPause,undefined);
assert.equal(options.getThreshold(),-40);ctx.micThreshold=-55;assert.equal(options.getThreshold(),-55);
pending(capture());await started;
options.onLevel({db:-34,onDb:-55,neural:true,prob:.95,speaking:true,voiced:true});
assert.equal($('mic-test-level').textContent,'-34 dBFS');
assert.equal($('mic-test-prob').textContent,'95 %');assert.equal($('mic-test-state').dataset.signal,'speech');
const oldOptions=options;await ctx.stopMicTest();assert.equal(ended,1);assert.equal(ctx.micTestMode,false);
oldOptions.onLevel({db:-1,onDb:-55,neural:true,prob:1,speaking:true,voiced:true});
assert.equal($('mic-test-level').textContent,'— dBFS');
// Zavření před vyřízením oprávnění: pozdější stream se musí okamžitě uvolnit.
started=ctx.startMicTest();await tick();const late=pending;
$('menu').hidden=true;await ctx.stopMicTest();late(capture());await started;
assert.equal(ended,2);assert.equal(ctx.micTestSession,null);assert.equal(ctx.micTestMode,false);
// Stará závěrečná zpráva odpojení nesmí přepsat nově zapnutý test.
$('menu').hidden=false;started=ctx.startMicTest();await tick();let releaseCancel;
pending({cancel:()=>new Promise(r=>releaseCancel=r)});await started;
options.onEnded();await tick();
const newer=ctx.startMicTest();await tick();pending(capture());await newer;
const currentStatus=$('mic-test-status').textContent;releaseCancel();await tick();
assert.equal($('mic-test-status').textContent,currentStatus);
assert.equal(timers.at(-1).ms,180000);timers.at(-1).fn();await tick();
assert.equal(ctx.micTestSession,null);assert.equal(ctx.micTestMode,true);
assert.match($('mic-test-status').textContent,/třech minutách/);
console.log('PASS settings mic lifecycle: paused conversation, local callbacks, live threshold, close while permission pending, stale callbacks, restart and timeout.');
