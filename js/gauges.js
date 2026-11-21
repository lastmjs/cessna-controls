// Gauge faces, placards and displays, all drawn with the 2D canvas API.
// Angles are "clock degrees": 0 is 12 o'clock and they increase clockwise.
import * as THREE from 'three';

const WHITE = '#f2f0e8';
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
let maxAniso = 8;
export function setAnisotropy(a) { maxAniso = a; }

export function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const rad = d => (d - 90) * Math.PI / 180;

function polar(cx, cy, d, r) {
  const a = rad(d);
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
}

function face(ctx, S, color = '#121315') {
  const g = ctx.createRadialGradient(S / 2, S * 0.42, S * 0.05, S / 2, S / 2, S / 2);
  g.addColorStop(0, '#202124');
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); ctx.fill();
}

function tick(ctx, cx, cy, d, r0, r1, w, color = WHITE) {
  const [x0, y0] = polar(cx, cy, d, r0);
  const [x1, y1] = polar(cx, cy, d, r1);
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'butt';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
}

function band(ctx, cx, cy, d0, d1, r, w, color) {
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'butt';
  ctx.beginPath(); ctx.arc(cx, cy, r, rad(d0), rad(d1)); ctx.stroke();
}

function text(ctx, s, x, y, size, color = WHITE, weight = 'bold', align = 'center') {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}

function polarText(ctx, s, cx, cy, d, r, size, color = WHITE, weight = 'bold') {
  const [x, y] = polar(cx, cy, d, r);
  text(ctx, s, x, y, size, color, weight);
}

// Writes text along an arc (used for the VOR and heading cards).
function rotatedText(ctx, s, cx, cy, d, r, size, color = WHITE) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(d * Math.PI / 180);
  text(ctx, s, 0, -r, size, color);
  ctx.restore();
}

// ---------------- Airspeed (knots) ----------------
export const asiDeg = v => {
  if (v <= 40) return 12 + (v / 40) * 8;
  return 20 + (Math.min(v, 200) - 40) / 160 * 320;
};
export function asiFace() {
  const S = 1024, c = canvas(S), ctx = c.getContext('2d'), C = S / 2;
  face(ctx, S);
  // Colored arcs: white 40-85 (inner), green 48-129, yellow 129-163, red line 163.
  band(ctx, C, C, asiDeg(40), asiDeg(85), 392, 26, '#f4f4f4');
  band(ctx, C, C, asiDeg(48), asiDeg(129), 428, 40, '#1f9a3c');
  band(ctx, C, C, asiDeg(129), asiDeg(163), 428, 40, '#e5c21a');
  tick(ctx, C, C, asiDeg(163), 400, 470, 16, '#d8241f');
  for (let v = 40; v <= 200; v += 5) {
    const major = v % 10 === 0;
    tick(ctx, C, C, asiDeg(v), major ? 405 : 430, 470, major ? 9 : 5);
  }
  for (let v = 40; v <= 200; v += 20) polarText(ctx, String(v), C, C, asiDeg(v), 330, 74);
  // Inner miles-per-hour scale
  for (let mph = 50; mph <= 220; mph += 10) {
    const kt = mph * 0.868976;
    if (kt < 40 || kt > 200) continue;
    tick(ctx, C, C, asiDeg(kt), 250, 268, 4, '#cfcfcf');
    if (mph % 20 === 0) polarText(ctx, String(mph), C, C, asiDeg(kt), 222, 30, '#cfcfcf', 'normal');
  }
  text(ctx, 'AIRSPEED', C, C - 120, 44);
  text(ctx, 'KNOTS', C, C + 120, 44);
  text(ctx, 'MPH', C, C + 175, 28, '#bdbdbd', 'normal');
  return c;
}

// ---------------- Altimeter ----------------
export function altFace(baro = 29.92) {
  const S = 1024, c = canvas(S), ctx = c.getContext('2d'), C = S / 2;
  face(ctx, S);
  for (let i = 0; i < 50; i++) {
    const d = i * 7.2;
    const major = i % 5 === 0;
    tick(ctx, C, C, d, major ? 395 : 435, 478, major ? 12 : 6);
  }
  for (let n = 0; n < 10; n++) polarText(ctx, String(n), C, C, n * 36, 335, 96);
  // Kollsman window at 3 o'clock
  ctx.fillStyle = '#050505';
  ctx.fillRect(C + 120, C - 46, 190, 92);
  ctx.strokeStyle = '#555'; ctx.lineWidth = 4; ctx.strokeRect(C + 120, C - 46, 190, 92);
  ctx.fillStyle = '#ece6d2'; ctx.fillRect(C + 128, C - 38, 174, 76);
  text(ctx, baro.toFixed(2), C + 215, C + 2, 56, '#111', 'bold');
  text(ctx, 'ALT', C, C - 175, 50);
  text(ctx, '100 FEET', C, C + 150, 34, WHITE, 'normal');
  text(ctx, 'CALIBRATED TO', C, C + 205, 22, '#aaa', 'normal');
  text(ctx, '20,000 FEET', C, C + 232, 22, '#aaa', 'normal');
  // Low-altitude crosshatch flag window
  ctx.save();
  ctx.beginPath(); ctx.rect(C - 70, C - 115, 140, 40); ctx.clip();
  for (let x = -80; x < 80; x += 18) {
    ctx.fillStyle = x % 36 === 0 ? '#e2e2e2' : '#111';
    ctx.beginPath();
    ctx.moveTo(C + x, C - 115); ctx.lineTo(C + x + 18, C - 115); ctx.lineTo(C + x - 2, C - 75); ctx.lineTo(C + x - 20, C - 75);
    ctx.fill();
  }
  ctx.restore();
  return c;
}

// ---------------- Vertical speed (100 fpm) ----------------
export const vsiDeg = fpm => {
  const f = Math.max(-2000, Math.min(2000, fpm));
  const sign = Math.sign(f), a = Math.abs(f);
  // Expanded scale near zero, like the real instrument.
  const t = a <= 1000 ? (a / 1000) * 105 : 105 + ((a - 1000) / 1000) * 65;
  return 270 + sign * t;
};
export function vsiFace() {
  const S = 1024, c = canvas(S), ctx = c.getContext('2d'), C = S / 2;
  face(ctx, S);
  for (let f = -2000; f <= 2000; f += 100) {
    if (Math.abs(f) > 1000 && f % 500 !== 0) continue;
    const major = f % 500 === 0;
    tick(ctx, C, C, vsiDeg(f), major ? 400 : 435, 478, major ? 11 : 6);
  }
  for (const f of [0, 500, 1000, 1500, 2000, -500, -1000, -1500]) {
    polarText(ctx, String(Math.abs(f / 100)), C, C, vsiDeg(f), 335, 82);
  }
  text(ctx, 'UP', C - 210, C - 150, 46);
  text(ctx, 'DOWN', C - 200, C + 150, 46);
  text(ctx, 'VERTICAL SPEED', C + 60, C - 90, 34, WHITE, 'normal');
  text(ctx, '100 FEET PER MINUTE', C + 60, C + 90, 30, WHITE, 'normal');
  return c;
}

// ---------------- Turn coordinator ----------------
export function tcFace() {
  const S = 1024, c = canvas(S), ctx = c.getContext('2d'), C = S / 2;
  face(ctx, S);
  // Wing level and standard-rate marks
  for (const d of [270, 90]) tick(ctx, C, C, d, 360, 470, 16);
  for (const d of [270 - 20, 90 + 20]) tick(ctx, C, C, d, 360, 470, 16);
  polarText(ctx, 'L', C, C, 270 - 20, 300 - 20, 70);
  polarText(ctx, 'R', C, C, 90 + 20, 300 - 20, 70);
  text(ctx, 'TURN COORDINATOR', C, C - 300, 36, WHITE, 'normal');
  text(ctx, '2 MIN', C, C + 200, 40);
  text(ctx, 'NO PITCH', C, C + 380, 28, WHITE, 'normal');
  text(ctx, 'INFORMATION', C, C + 414, 28, WHITE, 'normal');
  text(ctx, 'D.C. ELEC.', C, C - 250, 26, '#aaa', 'normal');
  // Inclinometer tube
  const tubeY = C + 285;
  const g = ctx.createLinearGradient(0, tubeY - 45, 0, tubeY + 45);
  g.addColorStop(0, '#ddd8c6'); g.addColorStop(0.5, '#fbf7e8'); g.addColorStop(1, '#b8b2a0');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(C, tubeY - 330, 340, 380, 0, Math.PI * 0.34, Math.PI * 0.66);
  ctx.ellipse(C, tubeY - 330, 260, 300, 0, Math.PI * 0.66, Math.PI * 0.34, true);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#111'; ctx.lineWidth = 10;
  for (const dx of [-44, 44]) {
    ctx.beginPath(); ctx.moveTo(C + dx, tubeY - 52); ctx.lineTo(C + dx, tubeY + 40); ctx.stroke();
  }
  return c;
}

// ---------------- Tachometer ----------------
export const tachDeg = rpm => 210 + Math.max(0, Math.min(3500, rpm)) / 3500 * 300;
export function tachFace(hours = 3127.4) {
  const S = 1024, c = canvas(S), ctx = c.getContext('2d'), C = S / 2;
  face(ctx, S);
  band(ctx, C, C, tachDeg(2100), tachDeg(2700), 435, 40, '#1f9a3c');
  tick(ctx, C, C, tachDeg(2700), 400, 475, 16, '#d8241f');
  for (let r = 0; r <= 3500; r += 100) {
    const major = r % 500 === 0;
    tick(ctx, C, C, tachDeg(r), major ? 400 : 438, 475, major ? 10 : 5);
  }
  for (let r = 0; r <= 3500; r += 500) polarText(ctx, String(r / 100), C, C, tachDeg(r), 335, 80);
  text(ctx, 'RPM', C, C - 140, 50);
  text(ctx, 'HUNDREDS', C, C - 90, 30, WHITE, 'normal');
  // Recording tachometer hour counter
  ctx.fillStyle = '#000'; ctx.fillRect(C - 120, C + 120, 240, 66);
  const digits = hours.toFixed(1).padStart(6, '0').replace('.', '');
  for (let i = 0; i < 5; i++) {
    const x = C - 116 + i * 47;
    ctx.fillStyle = i === 4 ? '#ddd' : '#1a1a1a';
    ctx.fillRect(x, C + 124, 43, 58);
    text(ctx, digits[i], x + 21.5, C + 154, 46, i === 4 ? '#111' : '#eee');
  }
  text(ctx, 'HOURS', C, C + 220, 26, '#bbb', 'normal');
  return c;
}

// ---------------- Small gauges ----------------
export const suctionDeg = v => 225 + (Math.max(0, Math.min(10, v)) - 0) / 10 * 270;
export function suctionFace() {
  const S = 512, c = canvas(S), ctx = c.getContext('2d'), C = S / 2;
  face(ctx, S);
  band(ctx, C, C, suctionDeg(4.5), suctionDeg(5.5), 205, 26, '#1f9a3c');
  for (let v = 0; v <= 10; v += 0.5) {
    const major = v % 1 === 0;
    tick(ctx, C, C, suctionDeg(v), major ? 190 : 205, 238, major ? 6 : 3);
  }
  for (let v = 0; v <= 10; v += 2) polarText(ctx, String(v), C, C, suctionDeg(v), 150, 40);
  text(ctx, 'SUCTION', C, C + 70, 30);
  text(ctx, 'IN HG', C, C + 105, 22, WHITE, 'normal');
  return c;
}

export const ammDeg = a => Math.max(-60, Math.min(60, a)) / 60 * 110;
export function ammeterFace() {
  const S = 512, c = canvas(S), ctx = c.getContext('2d'), C = S / 2;
  face(ctx, S);
  for (let a = -60; a <= 60; a += 10) {
    const major = a % 30 === 0;
    tick(ctx, C, C, ammDeg(a), major ? 185 : 205, 238, major ? 6 : 3);
  }
  for (const a of [-60, -30, 0, 30, 60]) polarText(ctx, String(Math.abs(a)), C, C, ammDeg(a), 150, 38);
  text(ctx, '−', C - 150, C + 20, 60);
  text(ctx, '+', C + 150, C + 20, 60);
  text(ctx, 'AMPERES', C, C + 90, 28);
  return c;
}

export const egtDeg = t => -60 + t * 120; // t in 0..1
export function egtFace() {
  const S = 512, c = canvas(S), ctx = c.getContext('2d'), C = S / 2;
  face(ctx, S);
  for (let i = 0; i <= 12; i++) {
    tick(ctx, C, C, egtDeg(i / 12), i % 3 === 0 ? 180 : 205, 238, i % 3 === 0 ? 6 : 3);
  }
  text(ctx, 'EGT', C, C + 80, 44);
  text(ctx, '°F', C, C + 125, 26, WHITE, 'normal');
  return c;
}

export const clockDeg = (v, max) => (v / max) * 360;
export function clockFace() {
  const S = 512, c = canvas(S), ctx = c.getContext('2d'), C = S / 2;
  face(ctx, S);
  for (let i = 0; i < 60; i++) tick(ctx, C, C, i * 6, i % 5 === 0 ? 195 : 218, 240, i % 5 === 0 ? 7 : 3);
  for (let h = 1; h <= 12; h++) polarText(ctx, String(h), C, C, h * 30, 160, 44);
  text(ctx, 'CLOCK', C, C + 70, 22, '#ccc', 'normal');
  return c;
}

// Generic small engine gauge used in the left cluster (fuel, oil temperature, oil pressure).
export const clusterDeg = t => -55 + Math.max(0, Math.min(1, t)) * 110;
export function clusterFace(kind) {
  const S = 512, c = canvas(S), ctx = c.getContext('2d'), C = S / 2;
  face(ctx, S);
  const cy = C + 70;
  const R = 210;
  if (kind === 'fuel') {
    band(ctx, C, cy, clusterDeg(0), clusterDeg(0.08), R, 22, '#d8241f');
    for (let i = 0; i <= 8; i++) tick(ctx, C, cy, clusterDeg(i / 8), i % 2 ? 195 : 175, 225, i % 2 ? 4 : 7);
    polarText(ctx, 'E', C, cy, clusterDeg(0), 140, 46);
    polarText(ctx, 'F', C, cy, clusterDeg(1), 140, 46);
    polarText(ctx, '½', C, cy, clusterDeg(0.5), 140, 34);
  } else if (kind === 'oilt') {
    band(ctx, C, cy, clusterDeg(0.3), clusterDeg(0.85), R, 22, '#1f9a3c');
    tick(ctx, C, cy, clusterDeg(0.85), 170, 232, 10, '#d8241f');
    for (let i = 0; i <= 10; i++) tick(ctx, C, cy, clusterDeg(i / 10), 180, 225, 4);
  } else {
    tick(ctx, C, cy, clusterDeg(0.1), 170, 232, 10, '#d8241f');
    band(ctx, C, cy, clusterDeg(0.3), clusterDeg(0.8), R, 22, '#1f9a3c');
    tick(ctx, C, cy, clusterDeg(0.97), 170, 232, 10, '#d8241f');
    for (let i = 0; i <= 10; i++) tick(ctx, C, cy, clusterDeg(i / 10), 180, 225, 4);
  }
  return c;
}

// Placard plate behind the 4-gauge engine cluster.
export function clusterPlate() {
  const W = 1024, H = 384, c = canvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#16171a'; ctx.fillRect(0, 0, W, H);
  const labels = [['FUEL', 'L'], ['FUEL', 'R'], ['OIL', 'TEMP'], ['OIL', 'PRESS']];
  labels.forEach(([a, b], i) => {
    const x = (i + 0.5) * W / 4;
    text(ctx, a, x, H - 66, 34);
    text(ctx, b, x, H - 30, 30, WHITE, 'normal');
  });
  return c;
}

// ---------------- Rotating cards ----------------
export function hiCard() {
  const S = 1024, c = canvas(S), ctx = c.getContext('2d'), C = S / 2;
  face(ctx, S, '#0e0f10');
  for (let d = 0; d < 360; d += 5) {
    const major = d % 10 === 0;
    ctx.save(); ctx.translate(C, C); ctx.rotate(d * Math.PI / 180);
    ctx.fillStyle = WHITE; ctx.fillRect(-(major ? 5 : 2.5), -470, major ? 10 : 5, major ? 60 : 32);
    ctx.restore();
  }
  const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  for (let d = 0; d < 360; d += 30) {
    rotatedText(ctx, names[d] || String(d / 10), C, C, d, 352, names[d] ? 92 : 74);
  }
  return c;
}

export function vorCard() {
  const S = 1024, c = canvas(S), ctx = c.getContext('2d'), C = S / 2;
  ctx.clearRect(0, 0, S, S);
  // Ring only: center stays transparent so the needles behind/in front read cleanly.
  ctx.fillStyle = '#121315';
  ctx.beginPath(); ctx.arc(C, C, 512, 0, Math.PI * 2); ctx.arc(C, C, 380, 0, Math.PI * 2, true); ctx.fill();
  for (let d = 0; d < 360; d += 5) {
    const major = d % 10 === 0;
    ctx.save(); ctx.translate(C, C); ctx.rotate(d * Math.PI / 180);
    ctx.fillStyle = WHITE; ctx.fillRect(-(major ? 4 : 2), -500, major ? 8 : 4, major ? 44 : 26);
    ctx.restore();
  }
  const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  for (let d = 0; d < 360; d += 30) rotatedText(ctx, names[d] || String(d / 10), C, C, d, 418, 62);
  return c;
}

export function vorFace(gs) {
  const S = 1024, c = canvas(S), ctx = c.getContext('2d'), C = S / 2;
  face(ctx, S, '#0c0d0e');
  // Course deviation dots
  ctx.strokeStyle = WHITE; ctx.lineWidth = 6;
  for (let i = -5; i <= 5; i++) {
    if (i === 0) continue;
    ctx.beginPath(); ctx.arc(C + i * 60, C + 40, 13, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(C, C + 40, 70, 0, Math.PI * 2); ctx.stroke();
  if (gs) {
    for (let i = -4; i <= 4; i++) {
      if (i === 0) continue;
      ctx.beginPath(); ctx.arc(C + 300, C + i * 60, 11, 0, Math.PI * 2); ctx.stroke();
    }
  }
  // TO/FROM window
  ctx.fillStyle = '#000'; ctx.fillRect(C + 100, C - 200, 150, 80);
  text(ctx, gs ? 'NAV 1' : 'NAV 2', C - 170, C - 160, 34, '#bbb', 'normal');
  return c;
}

// ---------------- Attitude indicator ball (redrawn as pitch changes) ----------------
export function makeAI() {
  const S = 1024, c = canvas(S), ctx = c.getContext('2d');
  const t = tex(c);
  function draw(pitchDeg) {
    const C = S / 2, ppd = 9; // pixels per degree of pitch
    const hy = C + pitchDeg * ppd;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath(); ctx.arc(C, C, C, 0, Math.PI * 2); ctx.clip();
    const sky = ctx.createLinearGradient(0, hy - 500, 0, hy);
    sky.addColorStop(0, '#174f94'); sky.addColorStop(1, '#3b8ad8');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, S, hy);
    const gnd = ctx.createLinearGradient(0, hy, 0, hy + 500);
    gnd.addColorStop(0, '#8a5a2b'); gnd.addColorStop(1, '#4e3015');
    ctx.fillStyle = gnd; ctx.fillRect(0, hy, S, S - hy);
    ctx.fillStyle = WHITE; ctx.fillRect(0, hy - 4, S, 8);
    // Pitch ladder
    for (let p = -20; p <= 20; p += 5) {
      if (p === 0) continue;
      const y = hy - p * ppd;
      const w = p % 10 === 0 ? 170 : 80;
      ctx.fillRect(C - w / 2, y - 3, w, 6);
      if (p % 10 === 0) {
        text(ctx, String(Math.abs(p)), C - w / 2 - 36, y, 34);
        text(ctx, String(Math.abs(p)), C + w / 2 + 36, y, 34);
      }
    }
    // Ground perspective lines
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 5;
    for (const a of [-50, -25, 25, 50]) {
      ctx.beginPath(); ctx.moveTo(C, hy);
      ctx.lineTo(C + Math.tan(a * Math.PI / 180) * 500, hy + 500); ctx.stroke();
    }
    // Bank scale ring (rotates with the ball)
    ctx.restore();
    ctx.save();
    ctx.translate(C, C);
    ctx.strokeStyle = WHITE;
    for (const b of [-60, -30, -20, -10, 10, 20, 30, 60]) {
      const big = Math.abs(b) === 30 || Math.abs(b) === 60;
      ctx.save(); ctx.rotate(b * Math.PI / 180);
      ctx.fillStyle = WHITE;
      ctx.fillRect(-4, -505, 8, big ? 70 : 45);
      ctx.restore();
    }
    for (const b of [-45, 45]) {
      ctx.save(); ctx.rotate(b * Math.PI / 180);
      ctx.beginPath(); ctx.moveTo(0, -455); ctx.lineTo(-14, -500); ctx.lineTo(14, -500); ctx.closePath();
      ctx.fillStyle = WHITE; ctx.fill();
      ctx.restore();
    }
    ctx.beginPath(); ctx.moveTo(0, -440); ctx.lineTo(-26, -500); ctx.lineTo(26, -500); ctx.closePath();
    ctx.fillStyle = WHITE; ctx.fill();
    ctx.restore();
    t.needsUpdate = true;
  }
  draw(0);
  return { canvas: c, texture: t, draw };
}

// Fixed outer mask for the attitude indicator: black ring with the bank index at the top.
export function aiMask() {
  const S = 1024, c = canvas(S), ctx = c.getContext('2d'), C = S / 2;
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#111214';
  ctx.beginPath(); ctx.arc(C, C, 512, 0, Math.PI * 2); ctx.arc(C, C, 430, 0, Math.PI * 2, true); ctx.fill();
  ctx.fillStyle = '#ff8a1c';
  ctx.beginPath(); ctx.moveTo(C, 70); ctx.lineTo(C - 30, 18); ctx.lineTo(C + 30, 18); ctx.closePath(); ctx.fill();
  return c;
}

// ---------------- Placards and labels ----------------
export function placard(lines, { w = 512, h = 128, size = 56, color = WHITE, bg = null, weight = 'bold' } = {}) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  const arr = Array.isArray(lines) ? lines : [lines];
  const lh = h / arr.length;
  arr.forEach((s, i) => text(ctx, s, w / 2, lh * (i + 0.5), size, color, weight));
  return c;
}

export function ignitionFace() {
  const S = 512, c = canvas(S), ctx = c.getContext('2d'), C = S / 2;
  ctx.fillStyle = '#18191b'; ctx.beginPath(); ctx.arc(C, C, C, 0, Math.PI * 2); ctx.fill();
  const pos = [['OFF', -70], ['R', -35], ['L', 0], ['BOTH', 35], ['START', 70]];
  for (const [s, d] of pos) {
    tick(ctx, C, C, d, 150, 185, 6);
    polarText(ctx, s, C, C, d, 220, s.length > 2 ? 30 : 38);
  }
  return c;
}

export function flapIndicatorFace() {
  const W = 128, H = 512, c = canvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H);
  const ys = [60, 175, 290, 405];
  ['0°', '10°', '20°', '30°'].forEach((s, i) => {
    ctx.fillStyle = WHITE; ctx.fillRect(84, ys[i] - 3, 40, 6);
    text(ctx, s, 46, ys[i], 36);
  });
  text(ctx, 'FLAP', W / 2, 480, 28);
  return c;
}

export function trimIndicatorFace() {
  const W = 128, H = 512, c = canvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#141414'; ctx.fillRect(0, 0, W, H);
  // Pointer y on this face: top (y=50) is full nose-up, bottom (y=460) is full nose-down.
  ctx.save(); ctx.translate(34, H / 2); ctx.rotate(-Math.PI / 2);
  text(ctx, 'NOSE UP', 150, 0, 30);
  text(ctx, 'NOSE DN', -150, 0, 30);
  ctx.restore();
  ctx.fillStyle = WHITE;
  for (let i = 0; i <= 10; i++) ctx.fillRect(76, 50 + i * 41, i % 5 ? 26 : 44, 5);
  // Takeoff band, slightly nose-up of neutral
  ctx.fillStyle = '#f2f0e8'; ctx.fillRect(60, 50 + 4 * 41 - 14, 66, 28);
  text(ctx, 'T.O.', 93, 50 + 4 * 41 + 1, 22, '#111');
  return c;
}

export function fuelSelectorPlate() {
  const S = 1024, c = canvas(S), ctx = c.getContext('2d'), C = S / 2;
  ctx.fillStyle = '#d8d4c8'; ctx.beginPath(); ctx.arc(C, C, C, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1b1b1b'; ctx.beginPath(); ctx.arc(C, C, C - 18, 0, Math.PI * 2); ctx.fill();
  // Positions (clock deg as seen from above, 0 = forward)
  const items = [['BOTH', 0, '#f2f0e8'], ['LEFT', 270, '#f2f0e8'], ['RIGHT', 90, '#f2f0e8'], ['OFF', 180, '#e33']];
  for (const [s, d, col] of items) {
    ctx.save(); ctx.translate(C, C); ctx.rotate(d * Math.PI / 180);
    text(ctx, s, 0, -390, 70, col);
    if (s !== 'OFF') text(ctx, s === 'BOTH' ? '53.0 GAL' : '26.5 GAL', 0, -320, 32, '#ccc', 'normal');
    ctx.restore();
  }
  text(ctx, 'FUEL', C, C + 260, 48, '#ddd');
  text(ctx, 'SELECTOR', C, C + 310, 40, '#ddd', 'normal');
  return c;
}

// ---------------- Radio displays ----------------
export function makeDisplay(w, h, render) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  const t = tex(c);
  return {
    texture: t,
    draw(on, ...args) {
      ctx.fillStyle = '#060606'; ctx.fillRect(0, 0, w, h);
      if (on) render(ctx, w, h, ...args);
      t.needsUpdate = true;
    },
  };
}

export function seg(ctx, s, x, y, size, color, align = 'left') {
  ctx.save();
  ctx.shadowColor = color; ctx.shadowBlur = size * 0.35;
  text(ctx, s, x, y, size, color, 'bold', align);
  ctx.restore();
  ctx.font = `bold ${size}px "Courier New", monospace`;
}

export function hobbsFace(hours) {
  const W = 512, H = 192, c = canvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#141414'; ctx.fillRect(0, 0, W, H);
  const d = hours.toFixed(1).padStart(6, '0').replace('.', '');
  for (let i = 0; i < 5; i++) {
    const x = 56 + i * 62;
    ctx.fillStyle = i === 4 ? '#e8e8e8' : '#000';
    ctx.fillRect(x, 30, 56, 86);
    text(ctx, d[i], x + 28, 74, 66, i === 4 ? '#000' : '#f2f2f2');
  }
  text(ctx, 'HOURS', W / 2, 150, 34);
  return c;
}

export function breakerLabels(names) {
  const W = 1024, H = 64, c = canvas(W, H), ctx = c.getContext('2d');
  names.forEach((s, i) => text(ctx, s, (i + 0.5) * W / names.length, H / 2, 20, WHITE, 'bold'));
  return c;
}

export function compassCard() {
  const W = 2048, H = 256, c = canvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#121212'; ctx.fillRect(0, 0, W, H);
  // Wraps around a cylinder: 360° across the full width.
  const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  // Seen from behind, the card reads "backwards": higher headings appear to the left.
  for (let d = 0; d < 360; d += 5) {
    const x = (((360 - d) % 360) / 360) * W;
    ctx.fillStyle = WHITE;
    ctx.fillRect(x - 2, 0, 4, d % 10 === 0 ? 60 : 36);
    if (d % 30 === 0) text(ctx, names[d] || String(d / 10), x, 140, names[d] ? 110 : 80);
  }
  return c;
}

// Fine noise used as a bump map for wrinkle paint, leather and fabric.
export function noiseTexture(size = 512, scale = 1, seed = 1) {
  const c = canvas(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  // Value noise with a few octaves
  const grid = (n) => {
    const g = new Float32Array((n + 1) * (n + 1));
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    return (x, y) => {
      const fx = x * n, fy = y * n, ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy;
      const a = g[iy * (n + 1) + ix], b = g[iy * (n + 1) + ix + 1];
      const c2 = g[(iy + 1) * (n + 1) + ix], d = g[(iy + 1) * (n + 1) + ix + 1];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      return (a + (b - a) * sx) * (1 - sy) + (c2 + (d - c2) * sx) * sy;
    };
  };
  const octs = [grid(8 * scale), grid(32 * scale), grid(128 * scale)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const n = octs[0](u, v) * 0.5 + octs[1](u, v) * 0.3 + octs[2](u, v) * 0.2;
    const i = (y * size + x) * 4;
    const val = Math.floor(n * 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = val; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
