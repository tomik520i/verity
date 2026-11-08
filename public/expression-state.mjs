export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function expressionTag(tag, catalog) {
  const match = String(tag).trim().toLowerCase().match(/^([a-z]+)(?:\s*:\s*(\d{1,3}))?$/);
  if (!match || !Object.hasOwn(catalog.emotions,match[1])) return null;
  return {emotion:match[1],intensity:match[2] === undefined ? .65 : clamp(Number(match[2]),0,100)/100};
}
export class ExpressionState {
  constructor(catalog) {
    this.catalog=catalog; this.emotion='neutral'; this.intensity=.65;
    this.mood='warm'; this.changedAt=0; this.moodBlend={warm:1};
  }
  set({emotion='neutral',intensity=.65,mood=null}={},now=0) {
    if(!Object.hasOwn(this.catalog.emotions,emotion)) emotion='neutral';
    this.emotion=emotion;
    this.intensity=Number.isFinite(intensity)?clamp(intensity,0,1):.65;
    this.mood=Object.hasOwn(this.catalog.moods,mood)?mood:this.catalog.emotions[emotion].mood;
    this.changedAt=now;
    return this.catalog.emotions[emotion];
  }
  step(dt) {
    const k=1-Math.exp(-clamp(dt,0,.1)/2.8);
    for(const mood of Object.keys(this.catalog.moods)) this.moodBlend[mood]=(this.moodBlend[mood]||0)+((mood===this.mood?1:0)-(this.moodBlend[mood]||0))*k;
  }
  pose(base,now,{active=false,expressiveness=1}={}) {
    const result={...base};
    // Rozpoložení doznívá mezi větami; jednotlivý výraz se po chvíli uvolní.
    const age=Math.max(0,(now-this.changedAt)/1000-7);
    const hold=active?1:Math.exp(-age/11);
    const strength=(.28+.72*this.intensity)*(.45+.55*clamp(expressiveness,0,1))*hold;
    for(const [mood,weight] of Object.entries(this.moodBlend)) {
      for(const [key,value] of Object.entries(this.catalog.moods[mood].face)) result[key]+=(value-base[key])*weight*.38;
    }
    for(const [key,value] of Object.entries(this.catalog.emotions[this.emotion].face)) result[key]+=(value-result[key])*strength;
    return result;
  }
  describe() {
    return {emotion:this.emotion,label:this.catalog.emotions[this.emotion].label,
      mood:this.mood,moodLabel:this.catalog.moods[this.mood].label,color:this.catalog.moods[this.mood].color,
      intensity:this.intensity};
  }
}
