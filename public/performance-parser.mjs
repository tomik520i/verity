import {expressionTag,clamp} from './expression-state.mjs';
export function createPerformanceParser({catalog,onSegment,onShift=()=>{}}) {
  let pending='',cur='',emotion='neutral',intensity=.65,mood=null;
  const send=text=>onSegment({text,emotion,intensity,mood:mood||catalog.emotions[emotion].mood});
  const emit=force=>{
    for(;;) {
      const m=cur.match(/^(.*?[.!?…]+["“”»]?)\s+(.*)$/s);
      if(!m)break;
      if(m[1].length<18&&!force) {
        const rest=m[2].match(/^(.*?[.!?…]+["“”»]?)\s+(.*)$/s);
        if(!rest)break;
        send((m[1]+' '+rest[1]).trim());cur=rest[2];continue;
      }
      send(m[1].trim());cur=m[2];
    }
    if(force&&/[\p{L}\p{N}]/u.test(cur)){send(cur.trim());cur='';}
  };
  const text=t=>{cur+=t;emit(false);};
  return {
    feed(chunk) {
      pending+=chunk;
      for(;;) {
        const i=pending.indexOf('[');
        if(i<0){text(pending);pending='';return;}
        if(i>0){text(pending.slice(0,i));pending=pending.slice(i);}
        const j=pending.indexOf(']');
        if(j<0){if(pending.length>200){pending='';}return;}
        const tag=pending.slice(1,j).trim().toLowerCase();pending=pending.slice(j+1);
        const shift=tag.match(/^posun\s*:\s*([+-]?\d+)$/);
        if(shift){onShift(clamp(+shift[1],-15,15));continue;}
        const next=expressionTag(tag,catalog);
        if(next){emit(true);emotion=next.emotion;intensity=next.intensity;continue;}
        const nextMood=tag.match(/^mood\s*:\s*([a-z]+)$/);
        if(nextMood&&Object.hasOwn(catalog.moods,nextMood[1])){emit(true);mood=nextMood[1];}
        // Neznámé a paměťové značky nikdy nejdou do titulků ani TTS.
      }
    },
    end(){if(pending&&!pending.startsWith('['))text(pending);pending='';emit(true);}
  };
}
