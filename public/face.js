import {ExpressionState} from './expression-state.mjs?v=20261108-10';
import {IdleDirector,reactionEnvelope} from './animation-director.mjs?v=20261108-10';
import {HorrorDirector} from './horror-director.mjs?v=20261108-10';
const performanceTime = () => performance.now();
let nextFaceId=0;
// Obličej Verity: SVG koule, jejíž rysy se plynule interpolují mezi emocemi.
// Nestabilita (0–100) přidává širší úsměv, zuby, rudé oči a třes.

const NS = 'http://www.w3.org/2000/svg';

// Cílové parametry pro každou emoci.
// erx/ery = poloměr očí, lookY = posun pohledu, brow = úhel obočí (+ zlé, − smutné), browOp = viditelnost,
// w = polovina šířky úst, curve = úsměv (+) / mračení (−), open = otevření, teeth, blush, red, shake, tilt, glow, dim
const BASE = { erx: 16, ery: 26, eryL: 0, lookX: 0, lookY: 0, brow: 0, browOp: 0, w: 46, curve: 16, open: 0,
  teeth: 0, blush: 0, red: 0, shake: 0, tilt: 0, glow: 1, dim: 0, bob: 1, scale: 1, smileEye:0, mouthBias:0, browAsym:0, tear:0, sparkle:0, starEye:0, heartEye:0, flatEye:0, watery:0, sweat:0, anger:0, shock:0, question:0, puff:0 };

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mix = (c1, c2, t) => '#' + [0, 2, 4].map(i => Math.round(lerp(parseInt(c1.substr(i + 1, 2), 16),
  parseInt(c2.substr(i + 1, 2), 16), t)).toString(16).padStart(2, '0')).join('');

export class Face {
  constructor(host, {catalog, ambient=true} = {}) {
    this.catalog=catalog; this.expression=new ExpressionState(catalog);
    this.ambient=ambient; this.uid='vf'+(++nextFaceId)+'-';
    this.horror=new HorrorDirector();this.horrorEnabled=true;this.horrorPose=this.horror.step(0,{enabled:false});
    this.idle=new IdleDirector(); this.awake=false; this.idleEnabled=true; this.attending=false;this.userSpeaking=false;
    this.motion=.85; this.reducedMotion=false; this.noFlash=false;
    this.gesture=null; this.nextGesture=0; this.nextGlance=0; this.glance={x:0,y:0};
    this.gaze={x:0,y:0}; this.speaking=false; this.speechNod=0; this.lastTalk=0;
    this.host = host;
    this.emotion = 'neutral';
    this.instability = 0;
    this.thinking = false;
    this.searching = false;
    this.listening = false; // nahrává se mikrofon
    this.hear = 0;          // 0..1 hlasitost uživatele
    this.dance = 0;         // 0..1 hraje hudba (podkres) → tančí
    this.musicPhase = 0;    // fáze houpání podle tempa hudby (radiány)
    this.talk = 0;        // 0..1 hlasitost z lip syncu
    this.round = 0;       // 0..1 „kulatost“ samohlásky (o/u)
    this.look = { x: 0, y: 0 };
    this.p = { ...BASE };
    this.blink = 0; this.nextBlink = performance.now() + 1200 + Math.random()*3500;
    this.pop = 0;
    this.build();
    requestAnimationFrame(t => this.frame(t));
  }

  build() {
    this.host.innerHTML = `
<svg viewBox="0 0 400 400" class="face" aria-label="Verity">
  <defs>
    <radialGradient id="vg-body" cx="38%" cy="32%" r="75%">
      <stop offset="0%" class="s0"/><stop offset="55%" class="s1"/><stop offset="100%" class="s2"/>
    </radialGradient>
    <radialGradient id="vg-shine" cx="35%" cy="25%" r="35%">
      <stop offset="0%" stop-color="#fff" stop-opacity=".75"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <pattern id="vg-teeth" width="15" height="60" patternUnits="userSpaceOnUse">
      <rect width="15" height="60" fill="#f4ecd2"/><rect x="13" width="2" height="60" fill="#2a1a00"/>
    </pattern>
    <clipPath id="vg-mouth-clip"><path class="mouth-clip"/></clipPath>
  </defs>
  <ellipse class="floor-shadow" cx="200" cy="371" rx="69" ry="7" fill="#ffce4f" opacity=".10"/>
  <circle class="aura-ring" cx="200" cy="200" r="166" fill="none" stroke="#ffda71" stroke-width=".8" opacity=".13"/>
  <g class="horror-shadow" opacity="0" fill="#250c0e"><path d="M170 166Q137 213 126 277L67 371Q110 363 148 311L145 393H255L251 310Q291 362 333 371L274 276Q262 213 230 166Z"/><ellipse cx="200" cy="112" rx="57" ry="84"/></g>
  <g class="rig">
    <circle cx="200" cy="200" r="150" fill="url(#vg-body)" class="sphere"/>
    <ellipse cx="160" cy="130" rx="90" ry="70" fill="url(#vg-shine)"/>
    <g class="puff-cheeks" opacity="0"><ellipse cx="85" cy="232" rx="31" ry="32" fill="#e9a918"/><ellipse cx="315" cy="232" rx="31" ry="32" fill="#e9a918"/><path d="M80 215q-13 16 1 32M320 215q13 16-1 32" stroke="#ab7418" stroke-width="3" fill="none"/></g>
    <ellipse class="blush l" cx="122" cy="226" rx="24" ry="13" fill="#ff5f7a"/>
    <ellipse class="blush r" cx="278" cy="226" rx="24" ry="13" fill="#ff5f7a"/>
    <path class="brow l" stroke-linecap="round" fill="none"/>
    <path class="brow r" stroke-linecap="round" fill="none"/>
    <g class="eye l"><ellipse class="iris"/><path class="smile-eye" fill="none" stroke-linecap="round" stroke-width="8"/><path class="flat-eye" fill="none" stroke-linecap="round" stroke-width="7"/><path class="star-eye" d="M0 -25L7 -8L24 -7L12 6L15 24L0 14L-15 24L-12 6L-24 -7L-7 -8Z" fill="#5d3305" stroke="#fff0ae" stroke-width="3"/><path class="heart-eye" d="M0 22C-44 -5-14 -33 0 -13C14 -33 44 -5 0 22Z" fill="#e9426b" stroke="#a5254b" stroke-width="2"/><circle class="hl" r="5" fill="#fff"/><g class="wet-eye" fill="#fff"><ellipse class="wet-shine" rx="6" ry="9"/><circle class="wet-dot" r="3"/></g></g>
    <g class="eye r"><ellipse class="iris"/><path class="smile-eye" fill="none" stroke-linecap="round" stroke-width="8"/><path class="flat-eye" fill="none" stroke-linecap="round" stroke-width="7"/><path class="star-eye" d="M0 -25L7 -8L24 -7L12 6L15 24L0 14L-15 24L-12 6L-24 -7L-7 -8Z" fill="#5d3305" stroke="#fff0ae" stroke-width="3"/><path class="heart-eye" d="M0 22C-44 -5-14 -33 0 -13C14 -33 44 -5 0 22Z" fill="#e9426b" stroke="#a5254b" stroke-width="2"/><circle class="hl" r="5" fill="#fff"/><g class="wet-eye" fill="#fff"><ellipse class="wet-shine" rx="6" ry="9"/><circle class="wet-dot" r="3"/></g></g>
    <g class="tear-streams" fill="#8cddf5" stroke="#d8f7ff" stroke-width="2" opacity="0"><path d="M139 188q10 6 20 0l5 108q-12 9-28 0Z"/><path d="M239 188q10 6 20 0l5 108q-12 9-28 0Z"/></g>
    <path class="tear" d="M138 201 Q132 212 138 215 Q144 212 138 201" fill="#ccecff" opacity="0"/>
    <g class="sparks" fill="none" stroke="#fff3bc" stroke-width="2" stroke-linecap="round" opacity="0"><path d="M306 87v14m-7-7h14M85 152v10m-5-5h10M305 290v10m-5-5h10"/></g>
    <path class="mouth" stroke-linejoin="round" stroke-linecap="round"/>
    <g clip-path="url(#vg-mouth-clip)"><rect class="teeth" x="80" y="200" width="240" height="140" fill="url(#vg-teeth)"/></g>
    <g class="horror-cracks" opacity="0" fill="none" stroke="#31130c" stroke-width="3"><path d="M143 61l-4 30 13 12-8 26M268 68l-8 32 15 19-6 26M67 210l25 8-4 14 20 10M324 231l-22 11 3 20-13 12M173 322l9 15-5 11"/></g>
    <g class="comic-marks" stroke-linecap="round" stroke-linejoin="round">
      <g class="sweat-mark" opacity="0"><path d="M319 110q-28 33-14 43q22 14 25-12q0-11-11-31Z" fill="#6bc6ed" stroke="#daf5ff" stroke-width="3"/><path d="M321 129q4 12-2 16" fill="none" stroke="#fff" stroke-width="3"/></g>
      <g class="anger-mark" opacity="0" stroke="#a32221" stroke-width="6" fill="none"><path d="M283 93q16 0 16 16m11-16q-16 0-16 16m-11 6q16 0 16-16m11 16q-16 0-16-16"/></g>
      <g class="shock-mark" opacity="0" stroke="#ffeeb6" stroke-width="7" fill="none"><path d="M80 75L62 53M200 47V20M320 75l18-22"/><path d="M342 116v20m0 11v2" stroke="#ffe580"/></g>
      <g class="question-mark" opacity="0" fill="none" stroke="#9c6016" stroke-width="7"><path d="M306 95q1-20 17-17q23 3 9 20q-12 10-11 17m0 11v2"/></g>
      <g class="blush-lines" opacity="0" stroke="#da5c46" stroke-width="3"><path d="M106 220l-5 12m17-12-5 12m17-12-5 12M274 220l-5 12m17-12-5 12m17-12-5 12"/></g>
      <g class="sleep-mark" opacity="0" fill="none" stroke="#e5c783" stroke-width="4"><path d="M292 100h15l-15 16h15M311 73h20l-20 20h20"/></g>
    </g>
  </g>
</svg>`.replaceAll('vg-',this.uid);
    const q = s => this.host.querySelector(s);
    this.svg = q('svg'); this.rig = q('.rig');
    this.stops = [q('.s0'), q('.s1'), q('.s2')];
    this.eyes = [q('.eye.l'), q('.eye.r')];
    this.brows = [q('.brow.l'), q('.brow.r')];
    this.blushes = [q('.blush.l'), q('.blush.r')];
    this.horrorShadow=q('.horror-shadow');this.horrorCracks=q('.horror-cracks');
    this.tearStreams=q('.tear-streams');this.cheeks=q('.puff-cheeks');this.sweat=q('.sweat-mark');this.anger=q('.anger-mark');this.shock=q('.shock-mark');this.question=q('.question-mark');this.blushLines=q('.blush-lines');this.sleepMark=q('.sleep-mark');
    this.tear=q('.tear');this.sparks=q('.sparks');this.shadow=q('.floor-shadow');this.aura=q('.aura-ring');
    this.mouth = q('.mouth'); this.mouthClip = q('.mouth-clip'); this.teeth = q('.teeth');
  }

  perform(performance) {
    const now=performanceTime();
    const previous=this.expression.emotion;
    const profile=this.expression.set(performance,now);
    this.idle.cancel(now);
    this.horror.perform(now,{enabled:this.horrorEnabled,level:this.instability,emotion:this.expression.emotion,mood:this.expression.mood});
    this.emotion=this.expression.emotion;
    // Gesto patří právě přehrávané větě, ne předem vygenerovanému textu.
    if(now>=this.nextGesture || previous!==this.expression.emotion) {
      this.gesture={name:profile.gesture,at:now,duration:profile.gesture==='huff'?3200:profile.gesture==='exhale'?2200:1800};
      this.nextGesture=now+2200;
      this.pop=this.expression.intensity*.45;
    }
    if(this.horror.current&&this.horror.current.mode!=='release'){this.gesture=null;this.pop=0;}
    this.onExpression?.(this.expression.describe());
  }
  setEmotion(emotion) {
    if(!Object.hasOwn(this.catalog.emotions,emotion)||emotion===this.emotion)return;
    this.perform({emotion});
  }
  cancelGesture() { this.gesture=null; this.pop=0; this.horror.clear(performanceTime()); }
  lookAt(x,y) { this.look.x=clamp(x,-1,1);this.look.y=clamp(y,-1,1); }
  gesturePose(now) {
    const out={x:0,y:0,tilt:0,scale:0,wink:0};
    const g=this.gesture;
    if(!g||this.reducedMotion)return out;
    const phase=clamp((now-g.at)/g.duration,0,1);
    if(phase>=1){this.gesture=null;return out;}
    const envelope=reactionEnvelope(phase), pulse=Math.sin(phase*Math.PI*3)*Math.max(0,envelope);
    const power=this.motion*(.4+.6*this.expression.intensity);
    switch(g.name) {
      case 'nod':out.y=10*pulse;out.tilt=5*pulse;break;
      case 'tilt':out.tilt=17*envelope;break;
      case 'sideeye':out.x=10*envelope;out.tilt=-12*envelope;break;
      case 'shake':out.tilt=Math.sin(phase*Math.PI*5)*9*envelope;break;
      case 'perk':out.y=-26*envelope;out.scale=.09*envelope;break;
      case 'recoil':out.y=12*envelope;out.scale=-.10*envelope;break;
      case 'bow':out.y=13*envelope;out.tilt=-11*envelope;break;
      case 'soften':out.tilt=-10*envelope;out.scale=.04*envelope;break;
      case 'avert':out.x=-10*envelope;out.y=8*envelope;out.tilt=-15*envelope;break;
      case 'chuckle':out.y=Math.sin(phase*Math.PI*6)*8*envelope;out.tilt=7*envelope;break;
      case 'wink':out.wink=Math.sin(Math.PI*clamp(phase*2,0,1))**2;out.tilt=12*envelope;break;
      case 'exhale':out.y=10*envelope;out.scale=-.04*envelope;break;
      case 'huff':out.x=-15*envelope;out.tilt=-20*envelope;out.scale=.06*envelope;break;
      case 'lean':out.scale=.07*envelope;out.tilt=-8*envelope;break;
    }
    for(const key of Object.keys(out))out[key]*=power;
    return out;
  }

  target(now) {
    const t = this.expression.pose(BASE,now,{active:this.speaking||this.talk>.03,expressiveness:this.motion});
    const horror=this.horrorPose;
    const visualLevel=(this.horrorEnabled?this.instability:0)*(1-horror.relax*.9);
    const inst = visualLevel / 100;
    // nestabilita deformuje každou emoci
    t.w += inst * 34; t.curve += inst * 12;
    t.red = Math.max(t.red, clamp((visualLevel - 55) / 45, 0, 1)*.65);
    t.teeth = Math.max(t.teeth, clamp((visualLevel - 70) / 30, 0, 1));
    t.shake += clamp((visualLevel - 75) / 25, 0, 1) * 0.25;
    if (this.thinking) { t.lookX = Math.sin(now / 700) * 6; t.lookY = -7; t.w *= 0.6; t.curve *= 0.6; t.open = 0; }
    if (this.dance > 0.05) t.curve += 6 * this.dance;   // při hudbě se jen trochu víc usmívá
    if (this.listening && !this.speaking && !this.thinking && !this.searching) {
      // naklání se k uživateli, oči dokořán, pozorně zírá; při hlasu se rozzáří
      t.scale *= 1.06 + this.hear * 0.03; t.ery += 4; t.lookX = this.look.x * 2; t.lookY = 2;
      t.open = Math.max(t.open, 3); t.w *= 0.75; t.bob *= 0.3; t.glow += this.hear * 0.6;
    }
    if (this.searching) { t.lookX = Math.sin(now / 260) * 10; t.lookY = -3; t.erx -= 2; }
    const mask=clamp(horror.amount*1.6,0,1);
    t.curve+=horror.smile;t.w+=horror.smile*.65;t.mouthBias+=horror.asym;
    t.erx*=horror.eyeScale;t.ery*=1-mask*.15;t.browAsym+=horror.asym*.5;
    t.lookX*=1-horror.still;t.lookY*=1-horror.still;t.bob*=1-horror.still;
    // The cheerful eyes disappear before the smile does.
    for(const key of ['starEye','heartEye','smileEye','flatEye','sparkle','sweat','anger','question','shock'])t[key]*=1-mask;
    if(horror.mode==='fracture'){t.teeth=Math.max(t.teeth,horror.amount);t.open=Math.max(t.open,horror.amount*18);}
    if(!this.horrorEnabled){t.red=0;t.teeth=0;t.shake=0;}
    return t;
  }

  frame(now) {
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000); this.last = now;
    this.expression.step(dt);
    this.horrorPose=this.horror.step(now,{enabled:this.horrorEnabled,awake:this.awake,level:this.instability,emotion:this.expression.emotion,mood:this.expression.mood,busy:this.userSpeaking||(this.listening&&this.hear>.08)||this.attending||this.thinking||this.searching,speaking:this.speaking||this.talk>.03,idleEnabled:this.idleEnabled,reducedMotion:this.reducedMotion,motion:this.motion});
    const horror=this.horrorPose;
    const idle=this.idle.step(now,{active:this.speaking||this.talk>.03||this.thinking||this.searching||this.userSpeaking||(this.listening&&this.hear>.08)||this.attending||!!this.gesture||horror.amount>.02||horror.tension>.35,enabled:this.awake&&this.idleEnabled&&!this.reducedMotion,mood:this.expression.mood,motion:this.motion,listening:this.listening});
    const t = this.target(now);
    t.lookX+=idle.lookX;t.lookY+=idle.lookY;t.open+=idle.mouth;t.smileEye+=idle.smile;
    const k = 1 - Math.pow(0.0015, dt);      // plynulý přechod
    for (const key in t) this.p[key] = lerp(this.p[key], t[key], k);
    const p = this.p;
    const movement=this.reducedMotion?0:this.motion*(1-horror.still);
    const gesture=this.gesturePose(now);
    // Pomalejší drobné přesuny pohledu, žádný náhodný třes očí každý snímek.
    if(now>this.nextGlance){this.glance={x:(Math.random()-.5)*3,y:(Math.random()-.5)*2};this.nextGlance=now+2200+Math.random()*3400;}
    const focusX=(p.lookX+this.look.x*9+this.glance.x*movement)*(1-horror.still);
    const focusY=(p.lookY+this.look.y*7+this.glance.y*movement)*(1-horror.still);
    const eyeK=1-Math.exp(-dt*13);this.gaze.x+=(focusX-this.gaze.x)*eyeK;this.gaze.y+=(focusY-this.gaze.y)*eyeK;
    this.speechNod+=(Math.max(0,this.talk-this.lastTalk)-this.speechNod)*.15;this.lastTalk=this.talk;

    // mrkání (při vysoké nestabilitě skoro vůbec – zírá)
    if (now > this.nextBlink && horror.still<.35) {
      this.blink = 1;
      const rare = 1 + this.instability / 12;
      this.nextBlink = now + (1800 + Math.random() * 4200) * rare;
    }
    this.blink = Math.max(0, this.blink - dt * 7);
    const lid = lerp((1 - Math.sin(this.blink * Math.PI) * 0.92)*idle.lid,1,horror.still);

    // celkový pohyb
    const shake = this.noFlash ? 0 : p.shake * 1.2 * movement;
    const jx = (Math.random() - 0.5) * shake, jy = (Math.random() - 0.5) * shake;
    const bob = Math.sin(now / 1400) * 4.5 * p.bob * movement;
    this.pop = Math.max(0, this.pop - dt * 3);
    // tanec na podkres – ZÁMĚRNĚ JEMNÝ: plynulé houpání v polovičním tempu (~1×/s), pár pixelů,
    // žádné skoky, žádné blikání záře (rychlé změny jasu/pohybu mohou u citlivých lidí vyvolat záchvat).
    const dn = this.dance * movement, ph = this.musicPhase || 0;
    const sway = Math.sin(ph) * 3 * dn;                       // naklonění ±3°
    const lift = -Math.abs(Math.sin(ph)) * 5 * dn;            // lehké nadzvednutí max 5 px
    const squash = 1 + Math.sin(this.pop * Math.PI) * .13 * movement;
    const breathe = 1 + (Math.sin(now / 1900) * .008 + this.talk * .009) * movement;
    const s = p.scale * (breathe+gesture.scale+horror.scale);
    this.rig.setAttribute('transform',
      `translate(${200 + jx + Math.sin(ph) * 4 * dn + gesture.x + idle.x} ${200 + bob * (1 - dn) + jy + lift + gesture.y + idle.y - this.speechNod*35*movement}) rotate(${p.tilt + Math.sin(now / 3100) * 1.4 * movement + sway + gesture.tilt + idle.tilt + horror.tilt}) scale(${s * squash * idle.sx} ${s / squash * idle.sy}) translate(-200 -200)`);

    // barvy těla: žlutá → tmavě oranžová/rudá
    const dark = clamp(p.red * 0.7 + p.dim, 0, 1);
    const pal = [['#fff8c4', '#ffb27a'], ['#ffd21f', '#d9480f'], ['#d98a00', '#4a0d00']];
    this.stops.forEach((st, i) => st.setAttribute('stop-color', mix(pal[i][0], pal[i][1], dark)));
    const moodColor=this.catalog.moods[this.expression.mood].color;
    const glowCol = mix(mix('#ffcf1f',moodColor,.32), '#ff1e1e', p.red);
    this.horrorShadow.setAttribute('opacity',horror.shadow*.55);
    this.horrorShadow.setAttribute('transform','translate(0 '+(-horror.shadow*12)+')');
    this.horrorCracks.setAttribute('opacity',horror.cracks*.85);
    this.host.dataset.horror=horror.mode||'quiet';
    this.shadow.setAttribute('rx',Math.max(35,69-bob*.7+horror.shadow*75));
    this.shadow.setAttribute('opacity',(.07+p.glow*.025).toFixed(3));
    this.aura.setAttribute('stroke',glowCol);
    this.aura.setAttribute('opacity',(.07+p.glow*.055).toFixed(3));
    this.tear.setAttribute('opacity',clamp(p.tear,0,1)*.5);
    this.sparks.setAttribute('opacity',this.noFlash||this.reducedMotion?0:clamp(p.sparkle,0,1)*.65);
    this.host.style.setProperty('--glow', glowCol);
    this.host.style.setProperty('--glow-size', (24 + 40 * p.glow + (this.noFlash || this.reducedMotion ? 0 : this.talk * 18 + this.hear * 18)).toFixed(0) + 'px');
    if(this.ambient) document.documentElement.style.setProperty('--emo-glow', glowCol);

    // Kreslené doplňky jsou lokální; žádné změny dialogu ani paměti.
    const comic=v=>clamp((v-.14)/.42,0,1);
    this.cheeks.setAttribute('opacity',comic(p.puff));
    this.sweat.setAttribute('opacity',comic(p.sweat));
    this.sweat.setAttribute('transform','translate(0 '+(movement*Math.sin(now/900)*2)+')');
    this.anger.setAttribute('opacity',comic(p.anger));
    this.shock.setAttribute('opacity',this.noFlash?0:comic(p.shock));
    this.question.setAttribute('opacity',comic(p.question));
    this.blushLines.setAttribute('opacity',clamp(p.blush*.7,0,1));
    this.tearStreams.setAttribute('opacity',clamp((p.tear-.58)*5,0,.85));
    this.sleepMark.setAttribute('opacity',idle.mode==='dozy'?idle.amount:0);

    // oči
    const lx = this.gaze.x, ly = this.gaze.y;
    const eyeCol = mix('#1d1400', '#ff1a1a', clamp(p.red * 1.2 - 0.2, 0, 1));
    [[150, p.ery + p.eryL], [250, p.ery]].forEach(([cx, ery], i) => {
      const g = this.eyes[i];
      const iris=g.querySelector('.iris'),hl=g.querySelector('.hl');
      const wink=i===0?1-gesture.wink*.97:1;
      const smile=clamp(p.smileEye,0,1)*(this.listening&&!this.speaking ? .2 : 1);
      // Anime eye silhouettes switch cleanly; alpha blending would draw two eyes over each other.
      const smileCurve=smile>=.35?1:0,star=p.starEye>=.35?1:0,heart=p.heartEye>=.35?1:0,flat=p.flatEye>=.35?1:0;
      const symbolic=Math.max(smileCurve,star,heart,flat);
      const ry = Math.max(1.5, ery * lid * wink * (1-smile*.6));
      const smilePath=g.querySelector('.smile-eye');
      smilePath.setAttribute('d',`M${cx+lx-p.erx} ${169+ly} Q${cx+lx} ${148+ly} ${cx+lx+p.erx} ${169+ly}`);
      smilePath.setAttribute('stroke',eyeCol);smilePath.setAttribute('opacity',smileCurve*(1-star)*(1-heart)*(1-flat));
      iris.setAttribute('opacity',1-symbolic);
      const starEye=g.querySelector('.star-eye'),heartEye=g.querySelector('.heart-eye'),flatEye=g.querySelector('.flat-eye');
      starEye.setAttribute('opacity',star);heartEye.setAttribute('opacity',heart);
      starEye.setAttribute('transform',`translate(${cx+lx} ${168+ly}) scale(${.9+this.expression.intensity*.22})`);
      heartEye.setAttribute('transform',`translate(${cx+lx} ${168+ly}) scale(${.9+this.expression.intensity*.2})`);
      flatEye.setAttribute('opacity',flat);flatEye.setAttribute('stroke',eyeCol);
      flatEye.setAttribute('d',`M${cx+lx-21} ${165+ly}q21 5 42 0`);
      const wet=g.querySelector('.wet-eye');wet.setAttribute('opacity',p.watery*(1-symbolic)*lid);
      wet.querySelector('.wet-shine').setAttribute('cx',cx+lx-5);wet.querySelector('.wet-shine').setAttribute('cy',161+ly);
      wet.querySelector('.wet-dot').setAttribute('cx',cx+lx+6);wet.querySelector('.wet-dot').setAttribute('cy',179+ly);
      iris.setAttribute('cx', cx + lx); iris.setAttribute('cy', 168 + ly);
      iris.setAttribute('rx', p.erx); iris.setAttribute('ry', ry);
      iris.setAttribute('fill', eyeCol);
      iris.style.filter = p.red > 0.4 ? `drop-shadow(0 0 ${6 + p.red * 8}px #ff0000)` : 'none';
      hl.setAttribute('cx', cx + lx - p.erx * 0.35); hl.setAttribute('cy', 168 + ly - ry * 0.45);
      hl.setAttribute('opacity', clamp(1 - p.red * 1.5, 0, 1) * (ry > 6 ? 1 : 0) * (1-symbolic));
    });

    // obočí
    this.brows.forEach((b, i) => {
      const side = i ? 1 : -1, cx = i ? 250 : 150, y = 130 + ly * 0.4 - (p.ery - 26) * 0.5;
      const a = (p.brow + (i===0 ? p.browAsym : -p.browAsym*.35)) * Math.PI / 180, len = 22;
      const ix = cx - side * len, ox = cx + side * len;
      const iy = y + Math.sin(a) * len, oy = y - Math.sin(a) * len;
      b.setAttribute('d', `M${ix} ${iy} Q${cx} ${y - 6} ${ox} ${oy}`);
      b.setAttribute('stroke', eyeCol); b.setAttribute('stroke-width', 7);
      b.setAttribute('opacity', clamp(p.browOp, 0, 1));
    });
    this.blushes.forEach(b => b.setAttribute('opacity', clamp(p.blush, 0, 1) * 0.55));

    // ústa + lip sync
    const talkOpen = this.talk * (24 - this.round * 6);
    const w = Math.max(10, p.w - this.talk * this.round * 18 + this.talk * 4);
    const open = Math.max(0, p.open + talkOpen);
    const base = 252, curve = p.curve * (1 - this.talk * 0.25);
    const yc = base - curve / 2;
    const roundMouth=clamp((p.shock-.18)/.3,0,1);
    const upC = lerp(base + 1.5 * curve,base-open*1.35,roundMouth);
    const loC = lerp(base + 1.5*curve + 2 * open + (open > 0 ? Math.max(0, curve) * 0.35 : 0),base+open*1.35,roundMouth);
    const bias=p.mouthBias*(1-this.talk*.7);
    const d = `M${200 - w} ${yc+bias} Q200 ${upC} ${200 + w} ${yc-bias} Q200 ${loC} ${200 - w} ${yc+bias}Z`;
    this.mouth.setAttribute('d', d);
    this.mouth.setAttribute('fill', '#2a0d00');
    this.mouth.setAttribute('stroke', mix('#1d1400', '#3a0000', p.red));
    this.mouth.setAttribute('stroke-width', 7);
    this.mouthClip.setAttribute('d', d);
    this.teeth.setAttribute('opacity', open > 4 ? clamp(p.teeth, 0, 1) : 0);

    requestAnimationFrame(t2 => this.frame(t2));
  }
}
