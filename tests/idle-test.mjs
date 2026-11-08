import assert from 'node:assert/strict';
import {IdleDirector,IDLE_MODES,reactionEnvelope} from '../public/animation-director.mjs';
assert.equal(IDLE_MODES.length,7);
for(const mode of IDLE_MODES){
 const director=new IdleDirector(()=>.5);director.current={mode,at:0,duration:4200};
 for(let now=0;now<=4200;now+=50){const p=director.step(now);for(const [k,v] of Object.entries(p))if(typeof v==='number')assert.ok(Number.isFinite(v),mode+' '+k);assert.ok(p.lid>=0&&p.lid<=1);}
 director.current={mode,at:0,duration:4200};let p=director.step(2100,{active:true});assert.equal(p.mode,null);assert.equal(p.lid,1);assert.equal(p.x,0);assert.equal(director.current,null);
 director.current={mode,at:0,duration:4200};p=director.step(2100,{enabled:false});assert.equal(p.mode,null);assert.equal(director.current,null);
}
const d=new IdleDirector(()=>.5);let at=0;
for(let i=0;i<12;i++){at=d.nextAt+1;d.step(at,{mood:'gloomy'});assert.ok(['quiet','curious','lookaround'].includes(d.current.mode));d.step(at+8000,{mood:'gloomy'});}
d.current={mode:'float',at:0,duration:4200};assert.equal(d.step(2000,{motion:0}).mode,null);
assert.ok(reactionEnvelope(0)===0);assert.ok(reactionEnvelope(.05)<0);assert.equal(reactionEnvelope(.5),1);assert.equal(reactionEnvelope(1),0);
console.log('PASS seven local idle modes, safe numerical poses, pause on activity/reduced motion, mood-aware selection, zero-motion and reaction timing.');

const listener=new IdleDirector(()=>.4);for(let i=0;i<10;i++){const t=listener.nextAt+1;listener.step(t,{listening:true,mood:'playful'});assert.ok(['quiet','curious','lookaround'].includes(listener.current.mode));listener.step(t+8000,{listening:true});}
