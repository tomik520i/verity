import assert from 'node:assert/strict';
import {HorrorDirector,HORROR_MODES} from '../public/horror-director.mjs';
assert.equal(HORROR_MODES.length,6);
for(const mode of HORROR_MODES){
 const h=new HorrorDirector(()=>.5);h.start(mode,1000);
 for(let t=1000;t<8000;t+=40){
  const p=h.step(t,{level:90,mood:'eerie'});
  for(const [k,v] of Object.entries(p))if(typeof v==='number')assert.ok(Number.isFinite(v),mode+' '+k);
  assert.ok(p.scale<=.16&&p.eyeScale>=.4);assert.ok(p.still>=0&&p.still<=1);
 }
}
for(const opts of [{enabled:false},{awake:false},{busy:true},{reducedMotion:true},{motion:0}]){
 const h=new HorrorDirector(()=>.5);h.perform(0,{emotion:'unhinged',level:95,mood:'eerie'});
 const p=h.step(1500,{level:95,mood:'eerie',...opts});assert.equal(p.amount,0);assert.equal(p.tilt,0);assert.equal(p.scale,0);
}
const h=new HorrorDirector(()=>.5);
h.perform(0,{emotion:'unhinged',level:95,mood:'eerie'});assert.equal(h.current.mode,'fracture');
h.perform(2000,{emotion:'relieved',level:90,mood:'tender'});
let p=h.step(2500,{level:90,mood:'tender'});assert.equal(p.relax,1);assert.equal(p.amount,0);assert.equal(p.tension,0);
h.perform(3000,{emotion:'happy',level:80,mood:'warm'});assert.equal(h.current.mode,'release');
p=h.step(14000,{level:80,mood:'warm'});assert.equal(p.amount,0);
for(const reply of [{emotion:'curious',mood:'focused'},{emotion:'sad',mood:'tender'}]){
 const v=new HorrorDirector(()=>.5);v.perform(0,{emotion:'unhinged',level:95,mood:'eerie'});v.perform(1000,{...reply,level:95});assert.equal(v.step(2000,{level:95,mood:reply.mood}).amount,0);assert.equal(v.step(2000,{level:95,mood:reply.mood}).relax,1);
}
const clean=new HorrorDirector(()=>.5);p=clean.step(20000,{level:0,mood:'warm'});assert.equal(p.amount,0);assert.equal(p.mode,null);
console.log('PASS six horror motifs, finite bounded poses, inactive/reduced-motion suppression, immediate interruption and visible reassurance cooldown.');
