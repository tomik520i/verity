// Visual horror choreography. Does not send messages, play sounds or access devices.
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
export const HORROR_MODES=['mask','stare','tilt','loom','fracture','release'];
const calm=new Set(['calm','relieved','empathetic','grateful','embarrassed']);
export class HorrorDirector{
 constructor(random=Math.random){this.random=random;this.current=null;this.nextAt=12000;this.easeUntil=0;this.lastMode=null;}
 clear(now=0){this.current=null;this.nextAt=now+12000;}
 perform(now,{enabled=true,level=0,emotion='neutral',mood='warm'}={}){
  if(!enabled){this.clear(now);this.easeUntil=0;return;}
  if(calm.has(emotion)||mood==='focused'||mood==='tender'||emotion==='sad'||emotion==='worried'){this.current={mode:'release',at:now,duration:2100};this.easeUntil=now+14000;this.nextAt=now+18000;return;}
  if(now<this.easeUntil)return;
  const explicit=emotion==='unhinged'||emotion==='whisper'||mood==='eerie';
  if(!explicit&&level<45)return;
  if(this.current&&now<this.current.at+this.current.duration)return;
  const mode=emotion==='unhinged'?'fracture':emotion==='whisper'?'loom':emotion==='jealous'?'stare':emotion==='curious'?'tilt':mood==='eerie'?'mask':'stare';
  this.start(mode,now);
 }
 start(mode,now){this.current={mode,at:now,duration:mode==='fracture'?4200:mode==='loom'?6000:5200};this.lastMode=mode;this.nextAt=now+15000+this.random()*13000;}
 step(now,{enabled=true,awake=true,level=0,emotion='neutral',mood='warm',busy=false,speaking=false,idleEnabled=true,reducedMotion=false,motion=1}={}){
  const p={mode:null,amount:0,still:0,tilt:0,scale:0,smile:0,eyeScale:1,asym:0,shadow:0,cracks:0,relax:0,tension:0};
  if(!enabled||!awake){this.clear(now);return p;}
  p.relax=now<this.easeUntil?1:smooth((this.easeUntil+3000-now)/3000);
  p.tension=clamp((clamp(level,0,100)-18)/82+(mood==='eerie'?.22:0))*(1-p.relax);
  if(busy){this.clear(now);return p;}
  if(this.current&&now>=this.current.at+this.current.duration)this.current=null;
  if(!this.current&&!speaking&&idleEnabled&&!reducedMotion&&motion>.05&&p.tension>.08&&now>=this.nextAt){
   const pool=level<45?['mask','stare']:level<75?['stare','tilt','loom']:['stare','loom','fracture','mask'];
   const choices=pool.filter(x=>x!==this.lastMode);this.start(choices[Math.floor(this.random()*choices.length)%choices.length],now);
  }
  const c=this.current;
  if(!c||reducedMotion||motion<.05)return p;
  const t=clamp((now-c.at)/c.duration);
  const rise=smooth(t/.18),fall=1-smooth((t-.72)/.28);
  const a=rise*fall*clamp(motion)*(.35+.65*Math.max(p.tension,mood==='eerie'?.45:0));
  p.mode=c.mode;p.amount=a;
  if(c.mode==='release'){p.amount=0;return p;}
  p.still=a;p.shadow=a*.5;
  switch(c.mode){
   case 'mask':p.smile=22*a;p.eyeScale=1-.28*a;p.asym=8*a;break;
   case 'stare':p.eyeScale=1-.45*a;p.smile=8*a;break;
   case 'tilt':p.tilt=26*a;p.smile=13*a;p.asym=12*a;break;
   case 'loom':p.scale=.16*a;p.smile=18*a;p.shadow=a*.8;break;
   case 'fracture':p.tilt=-14*a;p.smile=30*a;p.eyeScale=1-.60*a;p.asym=16*a;p.cracks=a;p.shadow=a;break;
  }
  return p;
 }
}
