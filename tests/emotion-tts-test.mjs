import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
const source=await fs.readFile(new URL('../server.js',import.meta.url),'utf8');
const catalog=JSON.parse(await fs.readFile(new URL('../public/emotions.json',import.meta.url)));
const begin=source.indexOf('async function handleTts('),end=source.indexOf('// Whisper',begin);
let body,calls=[];
const t={mode:'clone',speaker_wav:'base.wav',reference_text:'základ',speed:1,seed:42,url:'http://fixture.invalid',emotions:{whisper:{speaker_wav:'whisper.wav',reference_text:'šepot',speed:.9},proud:{speed:1.2}}};
const sandbox={CFG:{tts:t},EMOTIONS:Object.keys(catalog.emotions),EXPRESSION_CATALOG:catalog,Number,Math,String,Buffer,AbortController,AbortSignal,console,
fs:{existsSync:p=>['base.wav','whisper.wav'].includes(p)},readBody:async()=>body,audioLooksBroken:()=>null,json:()=>{throw Error('Unexpected JSON error')},
fetch:async(url,opts)=>{calls.push({url,payload:JSON.parse(opts.body)});return {ok:true,json:async()=>({audio_base64:Buffer.from('fixture').toString('base64')})};}};
vm.runInNewContext(source.slice(begin,end)+';globalThis.handle=handleTts;',sandbox);
const invoke=async b=>{body=b;const res=new EventEmitter();res.destroyed=false;res.writableEnded=false;res.writeHead=(code,headers)=>{assert.equal(code,200);assert.equal(headers['Content-Type'],'audio/wav')};res.end=bytes=>{assert.equal(bytes.toString(),'fixture');res.writableEnded=true;};await sandbox.handle({},res);return calls.at(-1).payload;};
let p=await invoke({text:'[amused:70][mood:playful] To mě pobavilo.',emotion:'amused',intensity:1});
assert.equal(p.text,'To mě pobavilo.');assert.equal(p.settings.speed,catalog.emotions.amused.speed);assert.equal(p.speaker_wav,'base.wav');assert.equal(p.settings.reference_text,'základ');
p=await invoke({text:'Zvládli jsme to.',emotion:'proud',intensity:1});assert.equal(p.settings.speed,1.2);
p=await invoke({text:'Poslouchej.',emotion:'whisper',intensity:1});assert.equal(p.speaker_wav,'whisper.wav');assert.equal(p.settings.reference_text,'šepot');assert.equal(p.settings.speed,.9);
p=await invoke({text:'Ahoj.',emotion:'__proto__',intensity:NaN});assert.equal(p.settings.speed,1);assert.equal(p.speaker_wav,'base.wav');
for(const intensity of [-20,20,undefined,NaN,Infinity,'1']){
 p=await invoke({text:'Mám radost.',emotion:'excited',intensity});
 const bounded=Number.isFinite(intensity)?Math.max(0,Math.min(1,intensity)):.65;
 assert.equal(p.settings.speed,1+(catalog.emotions.excited.speed-1)*(.5+.5*bounded));
}
assert.ok(calls.every(c=>c.url==='http://fixture.invalid/api/tts'));
console.log('PASS TTS emotion catalog, intensity bounds, explicit voice overrides, whisper reference, unknown fallback and clean spoken text.');
