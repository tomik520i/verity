// Restrained delivery is based on the current spoken sentence, not the previous mood.
const fold=s=>String(s||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
export function seriousContent(text){
 const t=fold(text);
 // Explicit fiction and titles are not reports of real victims.
 if(/\b(ve hre|videohre|ve filmu|v serialu|fiktivni|fikcni|hororove scene|herni postav|death stranding)\b/.test(t))return false;
 if(/\bpamatn\w*/.test(t)&&/\b(svic\w*|kvetin\w*)/.test(t))return true;
 return t.split(/[.!?\n]+/).some(s=>{
  if(/\b(nikdo|zadny|zadne|zadni)\b.{0,45}\b(nezemrel|nezahynul|zranen|mrtv|obet)/.test(s)||/\b(bez obeti|bez zraneni|nikdo nebyl zranen)\b/.test(s))return false;
  return /\b(zemrel\w*|zahynul\w*|zavrazd\w*|zastrelen\w*|usmrcen\w*|mrtvych|mrtvi|mrtve|mrtvy|obet[iy]|obetem|pohreb\w*|pietni|truchl\w*|umrel\w*|znasiln\w*)\b/.test(s)||/\b(strelb\w*|nehod\w*|utok\w*|pozar\w*|vybuch\w*)\b.{0,80}\b(zran\w*|smrt\w*|obeti|lidi|lide|osob)\b/.test(s);
 });
}
export function deliveryPerformance(segment){
 const forced=seriousContent(segment.text);
 const sober=forced||(['sad','empathetic','worried'].includes(segment.emotion)&&!['eerie','playful'].includes(segment.mood));
 if(!sober)return {...segment,serious:false};
 return {...segment,serious:true,
  emotion:['sad','empathetic','worried','calm','neutral'].includes(segment.emotion)?segment.emotion:'empathetic',
  mood:forced?'gloomy':segment.mood,
  intensity:Math.max(.35,Math.min(.6,Number.isFinite(segment.intensity)?segment.intensity:.45))};
}
