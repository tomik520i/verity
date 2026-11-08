// Local choreography only. No timers, requests, conversation events or microphone access.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const IDLE_MODES=['lookaround','curious','stretch','dozy','float','peek','quiet'];
export class IdleDirector {
 constructor(random=Math.random){this.random=random;this.nextAt=9000;this.current=null;this.lastMode=null;}
 cancel(now){this.current=null;this.nextAt=now+9000+this.random()*7000;}
 step(now,{active=false,enabled=true,mood='warm',motion=1,listening=false}={}){
  const p={x:0,y:0,tilt:0,sx:1,sy:1,lookX:0,lookY:0,lid:1,mouth:0,smile:0,amount:0,mode:null};
  if(active||!enabled||motion<.05){this.cancel(now);return p;}
  if(this.current&&now-this.current.at>this.current.duration){this.current=null;this.nextAt=now+10000+this.random()*13000;}
  if(!this.current&&now>=this.nextAt){
   const pool=listening?['quiet','curious','lookaround']:mood==='eerie'?['peek','quiet','lookaround']:['gloomy','uneasy','tender'].includes(mood)?['quiet','curious','lookaround']:mood==='playful'?['float','peek','stretch','lookaround','curious']:IDLE_MODES;
   const choices=pool.filter(x=>x!==this.lastMode),mode=choices[Math.floor(this.random()*choices.length)%choices.length];
   this.current={mode,at:now,duration:mode==='dozy'?6200:mode==='lookaround'?5200:4200};this.lastMode=mode;
  }
  const current=this.current;if(!current)return p;
  const t=clamp((now-current.at)/current.duration,0,1),e=Math.sin(Math.PI*t)**2,a=e*motion;
  p.mode=current.mode;p.amount=a;
  switch(current.mode){
   case 'lookaround':p.lookX=Math.sin(t*Math.PI*2)*17*a;p.lookY=-4*a;p.tilt=Math.sin(t*Math.PI*2)*6*a;break;
   case 'curious':p.tilt=13*a;p.lookY=-8*a;p.lookX=6*a;p.y=-4*a;break;
   case 'stretch':p.sx=1-.065*a;p.sy=1+.09*a;p.y=-10*a;p.lid=1-.75*a;p.mouth=10*a;break;
   case 'dozy':p.lid=1-.94*a;p.tilt=7*a;p.y=8*a;p.mouth=13*a;break;
   case 'float':p.x=Math.sin(t*Math.PI*2)*9*a;p.y=-17*a;p.tilt=Math.sin(t*Math.PI*2)*12*a;p.smile=.55*a;break;
   case 'peek':p.lookX=18*a;p.tilt=-9*a;p.x=-5*a;p.lid=1-.3*a;break;
   case 'quiet':p.y=3*a;p.lid=1-.25*a;break;
  }
  return p;
 }
}
export function reactionEnvelope(t){
 t=clamp(t,0,1);if(t===0||t===1)return 0;
 if(t<.12)return -.17*Math.sin(t/.12*Math.PI);
 if(t<.34){const x=(t-.12)/.22;return 1-(1-x)**3;}
 if(t<.58)return 1;
 const x=(t-.58)/.42;return (1-x)**2*(1+.2*Math.sin(x*Math.PI*2));
}
