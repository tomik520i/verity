import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Face} from '../public/face.js';
const catalog=JSON.parse(await fs.readFile(new URL('../public/emotions.json',import.meta.url)));
const all=[];
class Element {
 constructor(){this.attributes={};this.dataset={};this.nodes=new Map();this.style={setProperty:(k,v)=>this.attributes[k]=v};all.push(this);}
 setAttribute(k,v){this.attributes[k]=String(v);assert.ok(!/NaN|Infinity/.test(String(v)),k+' '+v);}
 querySelector(k){if(!this.nodes.has(k))this.nodes.set(k,new Element());return this.nodes.get(k);}
 get firstElementChild(){return this.querySelector('iris');}
 get lastElementChild(){return this.querySelector('highlight');}
}
globalThis.document={documentElement:new Element()};
globalThis.requestAnimationFrame=()=>{};
const face=new Face(new Element(),{catalog});
face.awake=true;
const start=performance.now();let time=start;
for(const emotion of Object.keys(catalog.emotions))for(const intensity of [0,.65,1])for(const instability of [0,100]){
 face.instability=instability;face.perform({emotion,intensity,mood:catalog.emotions[emotion].mood});face.speaking=true;
 for(let i=0;i<10;i++){time+=16;face.frame(time);}
 for(const v of Object.values(face.p))assert.ok(Number.isFinite(v),emotion);
}
face.reducedMotion=true;face.perform({emotion:'playful',intensity:1});
assert.deepEqual(face.gesturePose(performance.now()+600),{x:0,y:0,tilt:0,scale:0,wink:0});
face.noFlash=true;face.frame(time+16);assert.equal(face.sparks.attributes.opacity,'0');
face.cancelGesture();assert.equal(face.gesture,null);
const second=new Face(new Element(),{catalog,ambient:false});assert.notEqual(face.uid,second.uid);
console.log('PASS SVG poses for 29 emotions × 3 intensities × 2 roleplay levels, unique IDs, reduced motion and no-flash.');

face.reducedMotion=false;face.perform({emotion:'happy',intensity:1});face.speaking=true;face.listening=false;const speakingWidth=face.target(performance.now()).w;face.listening=true;assert.equal(face.target(performance.now()).w,speakingWidth);

for(const mode of ['mask','stare','tilt','loom','fracture']){face.horrorEnabled=true;face.awake=true;face.instability=95;face.reducedMotion=false;face.listening=false;face.speaking=false;face.horror.easeUntil=0;face.horror.start(mode,time);for(let i=0;i<60;i++){time+=16;face.frame(time);}assert.ok(face.horrorPose.amount>0,mode);assert.ok(+face.horrorShadow.attributes.opacity>0,mode);}
face.horrorEnabled=false;face.frame(time+16);assert.equal(face.horrorPose.amount,0);assert.equal(face.horrorShadow.attributes.opacity,'0');

face.horrorEnabled=true;face.instability=100;face.perform({emotion:'happy',intensity:1,mood:'playful'});face.frame(time+32);
face.perform({emotion:'empathetic',intensity:.35,mood:'gloomy',serious:true});
assert.ok(face.p.curve<=0);assert.equal(face.p.smileEye,0);
for(let i=0;i<300;i++){time+=16;face.frame(time);assert.ok(face.target(time).curve<=0);assert.equal(face.target(time).teeth,0);assert.equal(face.horrorPose.amount,0);}
face.perform({emotion:'happy',intensity:.7,mood:'warm',serious:false});assert.equal(face.seriousDelivery,false);
console.log('PASS immediate serious delivery overrides happy eyes, smile, horror and idle, and releases for a positive segment.');
