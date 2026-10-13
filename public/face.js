// Obličej Verity: SVG koule, jejíž rysy se plynule interpolují mezi emocemi.
// Nestabilita (0–100) přidává širší úsměv, zuby, rudé oči a třes.

const NS = 'http://www.w3.org/2000/svg';

// Cílové parametry pro každou emoci.
// erx/ery = poloměr očí, lookY = posun pohledu, brow = úhel obočí (+ zlé, − smutné), browOp = viditelnost,
// w = polovina šířky úst, curve = úsměv (+) / mračení (−), open = otevření, teeth, blush, red, shake, tilt, glow, dim
const BASE = { erx: 16, ery: 26, eryL: 0, lookX: 0, lookY: 0, brow: 0, browOp: 0, w: 46, curve: 16, open: 0,
  teeth: 0, blush: 0, red: 0, shake: 0, tilt: 0, glow: 1, dim: 0, bob: 1, scale: 1 };
const EMO = {
  neutral:  {},
  happy:    { ery: 22, w: 58, curve: 30, open: 6, glow: 1.2, bob: 1.4 },
  excited:  { erx: 18, ery: 30, w: 66, curve: 34, open: 20, glow: 1.4, bob: 2.2, scale: 1.04 },
  curious:  { ery: 28, eryL: -8, brow: -6, browOp: 0.7, w: 26, curve: 6, open: 4, tilt: 9 },
  love:     { ery: 19, w: 50, curve: 26, open: 4, blush: 1, glow: 1.3, tilt: -5 },
  shy:      { ery: 20, lookX: -7, lookY: 5, w: 24, curve: 10, blush: 0.85, tilt: -8, scale: 0.97 },
  sad:      { ery: 22, lookY: 6, brow: -22, browOp: 1, w: 34, curve: -16, glow: 0.7, dim: 0.25, bob: 0.5 },
  lonely:   { ery: 21, lookY: 9, lookX: 4, brow: -16, browOp: 0.8, w: 26, curve: -8, glow: 0.5, dim: 0.4, bob: 0.4, scale: 0.95 },
  scared:   { erx: 13, ery: 33, brow: -18, browOp: 0.9, w: 28, curve: -6, open: 14, shake: 0.8, glow: 0.8 },
  jealous:  { ery: 12, lookX: 8, brow: 14, browOp: 0.8, w: 40, curve: 6, red: 0.2, tilt: 4 },
  angry:    { ery: 14, brow: 28, browOp: 1, w: 44, curve: -12, open: 7, red: 0.45, shake: 1.6, glow: 1.1 },
  unhinged: { erx: 10, ery: 31, w: 104, curve: 46, open: 26, teeth: 1, red: 1, shake: 1.3, glow: 1.5, scale: 1.06 },
  whisper:  { ery: 15, lookY: 3, w: 22, curve: 8, open: 6, glow: 0.6, dim: 0.35, scale: 1.08, bob: 0.3 },
};

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mix = (c1, c2, t) => '#' + [0, 2, 4].map(i => Math.round(lerp(parseInt(c1.substr(i + 1, 2), 16),
  parseInt(c2.substr(i + 1, 2), 16), t)).toString(16).padStart(2, '0')).join('');

export class Face {
  constructor(host) {
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
    this.blink = 0; this.nextBlink = performance.now() + 2000;
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
  <g class="rig">
    <circle cx="200" cy="200" r="150" fill="url(#vg-body)" class="sphere"/>
    <ellipse cx="160" cy="130" rx="90" ry="70" fill="url(#vg-shine)"/>
    <ellipse class="blush l" cx="122" cy="226" rx="24" ry="13" fill="#ff5f7a"/>
    <ellipse class="blush r" cx="278" cy="226" rx="24" ry="13" fill="#ff5f7a"/>
    <path class="brow l" stroke-linecap="round" fill="none"/>
    <path class="brow r" stroke-linecap="round" fill="none"/>
    <g class="eye l"><ellipse class="iris"/><circle class="hl" r="5" fill="#fff"/></g>
    <g class="eye r"><ellipse class="iris"/><circle class="hl" r="5" fill="#fff"/></g>
    <path class="mouth" stroke-linejoin="round" stroke-linecap="round"/>
    <g clip-path="url(#vg-mouth-clip)"><rect class="teeth" x="80" y="200" width="240" height="140" fill="url(#vg-teeth)"/></g>
  </g>
</svg>`;
    const q = s => this.host.querySelector(s);
    this.svg = q('svg'); this.rig = q('.rig');
    this.stops = [q('.s0'), q('.s1'), q('.s2')];
    this.eyes = [q('.eye.l'), q('.eye.r')];
    this.brows = [q('.brow.l'), q('.brow.r')];
    this.blushes = [q('.blush.l'), q('.blush.r')];
    this.mouth = q('.mouth'); this.mouthClip = q('.mouth-clip'); this.teeth = q('.teeth');
  }

  setEmotion(e) {
    if (!EMO[e] || e === this.emotion) return;
    this.emotion = e; this.pop = 1;
  }
  lookAt(x, y) { this.look.x = clamp(x, -1, 1); this.look.y = clamp(y, -1, 1); }

  target(now) {
    const t = { ...BASE, ...EMO[this.emotion] };
    const inst = this.instability / 100;
    // nestabilita deformuje každou emoci
    t.w += inst * 34; t.curve += inst * 12;
    t.red = Math.max(t.red, clamp((this.instability - 45) / 55, 0, 1));
    t.teeth = Math.max(t.teeth, clamp((this.instability - 70) / 30, 0, 1));
    t.shake += clamp((this.instability - 60) / 40, 0, 1) * 0.8;
    if (this.thinking) { t.lookX = Math.sin(now / 700) * 6; t.lookY = -7; t.w *= 0.6; t.curve *= 0.6; t.open = 0; }
    if (this.dance > 0.05) t.curve += 6 * this.dance;   // při hudbě se jen trochu víc usmívá
    if (this.listening) {
      // naklání se k uživateli, oči dokořán, pozorně zírá; při hlasu se rozzáří
      t.scale *= 1.06 + this.hear * 0.03; t.ery += 4; t.lookX = this.look.x * 2; t.lookY = 2;
      t.open = Math.max(t.open, 3); t.w *= 0.75; t.bob *= 0.3; t.glow += this.hear * 0.6;
    }
    if (this.searching) { t.lookX = Math.sin(now / 260) * 10; t.lookY = -3; t.erx -= 2; }
    return t;
  }

  frame(now) {
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000); this.last = now;
    const t = this.target(now);
    const k = 1 - Math.pow(0.0015, dt);      // plynulý přechod
    for (const key in t) this.p[key] = lerp(this.p[key], t[key], k);
    const p = this.p;

    // mrkání (při vysoké nestabilitě skoro vůbec – zírá)
    if (now > this.nextBlink) {
      this.blink = 1;
      const rare = 1 + this.instability / 12;
      this.nextBlink = now + (1800 + Math.random() * 4200) * rare;
    }
    this.blink = Math.max(0, this.blink - dt * 7);
    const lid = 1 - Math.sin(this.blink * Math.PI) * 0.92;

    // celkový pohyb
    const shake = p.shake * 2.2;
    const jx = (Math.random() - 0.5) * shake, jy = (Math.random() - 0.5) * shake;
    const bob = Math.sin(now / 900) * 7 * p.bob;
    this.pop = Math.max(0, this.pop - dt * 3);
    // tanec na podkres – ZÁMĚRNĚ JEMNÝ: plynulé houpání v polovičním tempu (~1×/s), pár pixelů,
    // žádné skoky, žádné blikání záře (rychlé změny jasu/pohybu mohou u citlivých lidí vyvolat záchvat).
    const dn = this.dance, ph = this.musicPhase || 0;
    const sway = Math.sin(ph) * 3 * dn;                       // naklonění ±3°
    const lift = -Math.abs(Math.sin(ph)) * 5 * dn;            // lehké nadzvednutí max 5 px
    const squash = 1 + Math.sin(this.pop * Math.PI) * 0.06;
    const breathe = 1 + Math.sin(now / 1600) * 0.012 + this.talk * 0.02;
    const s = p.scale * breathe;
    this.rig.setAttribute('transform',
      `translate(${200 + jx + Math.sin(ph) * 4 * dn} ${200 + bob * (1 - dn) + jy + lift}) rotate(${p.tilt + Math.sin(now / 2300) * 2 + sway}) scale(${s * squash} ${s / squash}) translate(-200 -200)`);

    // barvy těla: žlutá → tmavě oranžová/rudá
    const dark = clamp(p.red * 0.7 + p.dim, 0, 1);
    const pal = [['#fff8c4', '#ffb27a'], ['#ffd21f', '#d9480f'], ['#d98a00', '#4a0d00']];
    this.stops.forEach((st, i) => st.setAttribute('stop-color', mix(pal[i][0], pal[i][1], dark)));
    const glowCol = mix('#ffcf1f', '#ff1e1e', p.red);
    this.host.style.setProperty('--glow', glowCol);
    this.host.style.setProperty('--glow-size', (24 + 40 * p.glow + this.talk * 30 + this.hear * 30).toFixed(0) + 'px');
    document.documentElement.style.setProperty('--emo-glow', glowCol);

    // oči
    const lx = p.lookX + this.look.x * 9, ly = p.lookY + this.look.y * 7;
    const eyeCol = mix('#1d1400', '#ff1a1a', clamp(p.red * 1.2 - 0.2, 0, 1));
    [[150, p.ery + p.eryL], [250, p.ery]].forEach(([cx, ery], i) => {
      const g = this.eyes[i];
      const iris = g.firstElementChild, hl = g.lastElementChild;
      const ry = Math.max(1.5, ery * lid);
      iris.setAttribute('cx', cx + lx); iris.setAttribute('cy', 168 + ly);
      iris.setAttribute('rx', p.erx); iris.setAttribute('ry', ry);
      iris.setAttribute('fill', eyeCol);
      iris.style.filter = p.red > 0.4 ? `drop-shadow(0 0 ${6 + p.red * 8}px #ff0000)` : 'none';
      hl.setAttribute('cx', cx + lx - p.erx * 0.35); hl.setAttribute('cy', 168 + ly - ry * 0.45);
      hl.setAttribute('opacity', clamp(1 - p.red * 1.5, 0, 1) * (ry > 6 ? 1 : 0));
    });

    // obočí
    this.brows.forEach((b, i) => {
      const side = i ? 1 : -1, cx = i ? 250 : 150, y = 130 + ly * 0.4 - (p.ery - 26) * 0.5;
      const a = p.brow * Math.PI / 180, len = 22;
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
    const upC = base + 1.5 * curve;
    const loC = upC + 2 * open + (open > 0 ? Math.max(0, curve) * 0.35 : 0);
    const d = `M${200 - w} ${yc} Q200 ${upC} ${200 + w} ${yc} Q200 ${loC} ${200 - w} ${yc}Z`;
    this.mouth.setAttribute('d', d);
    this.mouth.setAttribute('fill', '#2a0d00');
    this.mouth.setAttribute('stroke', mix('#1d1400', '#3a0000', p.red));
    this.mouth.setAttribute('stroke-width', 7);
    this.mouthClip.setAttribute('d', d);
    this.teeth.setAttribute('opacity', open > 4 ? clamp(p.teeth, 0, 1) : 0);

    requestAnimationFrame(t2 => this.frame(t2));
  }
}
