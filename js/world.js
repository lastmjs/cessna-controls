// The world: terrain with hills, mountains, a lake and a river, one airport with a hangar,
// fuel pump and FBO, a small town of blocky buildings, trees, roads, sky.
//
// World coordinates: x = east, z = south, y = height above mean sea level (meters).
// The airport is near the origin. Runway 18/36 runs north-south along x = RWY.x.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as G from './gauges.js';

export const FIELD = 463;            // airport elevation, m (1520 ft)
export const RWY = { x: 280, z0: -760, z1: 760, w: 30 };
export const TWY = { x: 150, w: 15 };
export const APRON = { x0: -60, x1: 60, z0: -45, z1: 45 };
export const HANGAR = { x0: -96, x1: -66, z0: -16, z1: 16, h: 9, door: 'east' };
export const PUMP = { x: 42, z: 34 };
export const SPAWN = { x: -79, z: 0, heading: 90 }; // inside the hangar, nose toward the door
export const VOR = { x: 9000, z: -14000, freq: '113.80' };

const EXTENT = 20480, CELL = 64;               // terrain grid: ±20.48 km at 64 m
const N = EXTENT * 2 / CELL + 1;               // 641
const NEAR = 6144;                             // detailed terrain: ±6.1 km

// ---------------------------------------------------------------- noise
function hash(ix, iz) {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}
function fbm(x, z, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * (vnoise(x * f, z * f) * 2 - 1); f *= 2.03; a *= 0.5; }
  return s;
}
function ridged(x, z, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * (1 - Math.abs(vnoise(x * f, z * f) * 2 - 1)) ** 2; f *= 2.1; a *= 0.5; }
  return s;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- river and lake layout
const LAKE = { x: -5200, z: 4600, r: 1350, level: 441 };
const lakeR = (a) => LAKE.r * (1 + 0.22 * Math.sin(a * 3 + 1) + 0.12 * Math.sin(a * 5 + 2.5) + 0.08 * Math.sin(a * 9));
function buildRiver() {
  const ctrl = [[-2600, -20500], [-2200, -14000], [-1500, -9000], [-2100, -4500], [-2600, -1200], [-3300, 2000], [-4300, 3700],
    [LAKE.x, LAKE.z], [-5900, 7500], [-5000, 11500], [-3800, 15500], [-3500, 20500]];
  const pts = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const [x0, z0] = ctrl[i], [x1, z1] = ctrl[i + 1];
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(L / 120);
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const nx = -(z1 - z0) / L, nz = (x1 - x0) / L;
      const m = Math.sin((i * 7 + t * L / 900) * 2.1) * 180 * Math.sin(t * Math.PI);
      pts.push([x0 + (x1 - x0) * t + nx * m, z0 + (z1 - z0) * t + nz * m]);
    }
  }
  pts.push(ctrl[ctrl.length - 1]);
  return pts;
}
const RIVER = buildRiver();
const RIVER_W = 38;

// ---------------------------------------------------------------- height model
function baseHeight(x, z) {
  let h = 470 + 55 * fbm(x / 2600 + 3.1, z / 2600 - 1.7, 4) + 25 * fbm(x / 700, z / 700, 2);
  // Mountain range to the east and northeast
  const rx = 10500 + z * 0.15, d = (x - rx) / 3200;
  const range = Math.exp(-d * d) * (0.55 + 0.45 * vnoise(z / 5000 + 9, 3.3));
  h += range * (900 + 700 * ridged(x / 2200, z / 2200, 4));
  // Hills to the west
  const w = Math.exp(-(((x + 13000) / 3500) ** 2)) * 380 * (0.6 + 0.8 * vnoise(z / 4000, 1.3));
  h += w;
  // Lower ground in the river valley west of the airport
  h -= 30 * Math.exp(-(((x + 2600) / 1800) ** 2));
  return h;
}

// River distance lookup accelerated with a bucket grid
const RB = 800, riverBuckets = new Map();
const riverSeg = [];
{
  // Water level falls monotonically downstream; it is pinned to the lake level at the lake.
  let level = Infinity;
  const levels = RIVER.map(([x, z]) => { level = Math.min(level, baseHeight(x, z) - 6); return level; });
  const li = RIVER.findIndex(([x, z]) => x === LAKE.x && z === LAKE.z);
  for (let i = 0; i < RIVER.length; i++) levels[i] = i <= li ? Math.max(levels[i], LAKE.level + 0.3 + (li - i) * 0.02) : Math.min(levels[i], LAKE.level - (i - li) * 0.03);
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [x0, z0] = RIVER[i], [x1, z1] = RIVER[i + 1];
    const seg = { x0, z0, x1, z1, l0: levels[i], l1: levels[i + 1] };
    riverSeg.push(seg);
    const minx = Math.floor((Math.min(x0, x1) - 400) / RB), maxx = Math.floor((Math.max(x0, x1) + 400) / RB);
    const minz = Math.floor((Math.min(z0, z1) - 400) / RB), maxz = Math.floor((Math.max(z0, z1) + 400) / RB);
    for (let bx = minx; bx <= maxx; bx++) for (let bz = minz; bz <= maxz; bz++) {
      const k = bx + ',' + bz; if (!riverBuckets.has(k)) riverBuckets.set(k, []); riverBuckets.get(k).push(seg);
    }
  }
}
function riverQuery(x, z) {
  const segs = riverBuckets.get(Math.floor(x / RB) + ',' + Math.floor(z / RB));
  if (!segs) return null;
  let best = 1e9, lvl = 0;
  for (const s of segs) {
    const dx = s.x1 - s.x0, dz = s.z1 - s.z0, L2 = dx * dx + dz * dz;
    let t = ((x - s.x0) * dx + (z - s.z0) * dz) / L2; t = Math.max(0, Math.min(1, t));
    const px = s.x0 + dx * t, pz = s.z0 + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < best) { best = d; lvl = s.l0 + (s.l1 - s.l0) * t; }
  }
  return { d: best, level: lvl };
}
function lakeQuery(x, z) {
  const dx = x - LAKE.x, dz = z - LAKE.z, r = Math.hypot(dx, dz);
  return { r, edge: lakeR(Math.atan2(dz, dx)) };
}

function computeHeight(x, z) {
  let h = baseHeight(x, z);
  // Lake basin
  const lk = lakeQuery(x, z);
  if (lk.r < lk.edge + 700) {
    const bed = LAKE.level - 3 - 14 * smooth(lk.edge, 0, lk.r);
    const bank = LAKE.level + 2;
    const t = smooth(lk.edge - 40, lk.edge + 700, lk.r);
    const inner = lk.r < lk.edge ? bed : bank;
    h = lk.r < lk.edge ? Math.min(h, bed) : Math.min(h, lerp(bank, h, t)) ;
    if (lk.r >= lk.edge) h = Math.max(h, LAKE.level + 0.6);
    void inner;
  }
  // River channel
  const rv = riverQuery(x, z);
  if (rv && rv.d < 420) {
    if (rv.d < RIVER_W / 2 + 4) h = Math.min(h, rv.level - 2.5 * smooth(RIVER_W / 2 + 4, 0, rv.d) - 0.3);
    else {
      const bank = rv.level + 1.2 + (rv.d - RIVER_W / 2) * 0.03;
      h = Math.min(h, lerp(bank, h, smooth(RIVER_W / 2, 420, rv.d)));
      h = Math.max(h, rv.level + 0.4);
    }
  }
  // Airport: flatten to field elevation with a smooth shoulder
  const ax = Math.max(0, -150 - x, x - (RWY.x + 70)), az = Math.max(0, RWY.z0 - 90 - z, z - RWY.z1 - 90);
  const ad = Math.hypot(ax, az);
  if (ad < 600) h = lerp(FIELD, h, smooth(0, 600, ad));
  // Town plateau: gentle
  const tx = Math.hypot(Math.max(0, 1400 - x, x - 3600), Math.max(0, -1600 - z, z - 1600));
  if (tx < 500) h = lerp(FIELD + 12 + 10 * fbm(x / 900, z / 900, 2), h, smooth(0, 500, tx));
  return h;
}

// ---------------------------------------------------------------- world
export function createWorld({ onProgress } = {}) {
  const group = new THREE.Group();
  group.name = 'world';

  // Height grid (shared by rendering and physics)
  const hgt = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const z = -EXTENT + j * CELL;
    for (let i = 0; i < N; i++) hgt[j * N + i] = computeHeight(-EXTENT + i * CELL, z);
  }
  if (onProgress) onProgress(0.5);
  function heightAt(x, z) {
    const fx = (x + EXTENT) / CELL, fz = (z + EXTENT) / CELL;
    const i = Math.max(0, Math.min(N - 2, Math.floor(fx))), j = Math.max(0, Math.min(N - 2, Math.floor(fz)));
    const tx = Math.min(1, Math.max(0, fx - i)), tz = Math.min(1, Math.max(0, fz - j));
    const a = hgt[j * N + i], b = hgt[j * N + i + 1], c = hgt[(j + 1) * N + i], d = hgt[(j + 1) * N + i + 1];
    // Match the triangle split used by the terrain mesh
    if (tx + tz <= 1) return a + (b - a) * tx + (c - a) * tz;
    return d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  }
  const onPavement = (x, z) =>
    (Math.abs(x - RWY.x) <= RWY.w / 2 && z >= RWY.z0 && z <= RWY.z1) ||
    (Math.abs(x - TWY.x) <= TWY.w / 2 && z >= RWY.z0 && z <= RWY.z1) ||
    (x >= APRON.x0 && x <= APRON.x1 && z >= APRON.z0 && z <= APRON.z1) ||
    (x >= HANGAR.x0 && x <= HANGAR.x1 + 8 && z >= HANGAR.z0 && z <= HANGAR.z1) ||
    (Math.abs(z - 0) <= 8 && x >= APRON.x1 && x <= TWY.x) ||
    ((Math.abs(z - RWY.z0 - 20) <= 8 || Math.abs(z - RWY.z1 + 20) <= 8 || Math.abs(z) <= 8) && x >= TWY.x && x <= RWY.x) ||
    (x >= PUMP.x - 10 && x <= PUMP.x + 10 && z >= APRON.z1 && z <= PUMP.z + 8);
  function groundAt(x, z) {
    if (onPavement(x, z)) return { h: FIELD + 0.05, type: (Math.abs(x - RWY.x) <= RWY.w / 2) ? 'runway' : 'pavement' };
    const h = heightAt(x, z);
    const lk = lakeQuery(x, z);
    if (lk.r < lk.edge && h < LAKE.level) return { h: LAKE.level, type: 'water' };
    const rv = riverQuery(x, z);
    if (rv && rv.d < RIVER_W / 2 && h < rv.level) return { h: rv.level, type: 'water' };
    return { h, type: 'grass' };
  }

  // ------------------------------------------------------------ terrain meshes
  const colorAt = (x, z, h, slope) => {
    const n1 = vnoise(x / 400, z / 400), n2 = vnoise(x / 90 + 7, z / 90 - 3);
    let c;
    // Farm fields in the lowlands: rectangular patches
    const fieldCell = hash(Math.floor((x + 13) / 420), Math.floor((z - 7) / 300));
    const low = h < 560 && slope < 0.12;
    if (low && fieldCell < 0.45) c = fieldCell < 0.15 ? [0.62, 0.58, 0.32] : fieldCell < 0.3 ? [0.45, 0.55, 0.25] : [0.52, 0.47, 0.32];
    else c = [0.30 + 0.08 * n2, 0.45 + 0.08 * n1, 0.20];
    // Forest: darker on hills and in patches
    const forest = smooth(0.55, 0.7, vnoise(x / 1100 + 4, z / 1100) + (h - 520) / 900);
    c = c.map((v, i) => lerp(v, [0.16, 0.27, 0.13][i], forest * (low && fieldCell < 0.45 ? 0.2 : 1)));
    // Rock on steep or high ground, snow on top
    const rock = Math.max(smooth(0.45, 0.85, slope), smooth(1300, 1650, h) * 0.8);
    c = c.map((v, i) => lerp(v, [0.46, 0.44, 0.42][i], rock));
    const snow = smooth(1680, 1780, h + 60 * n2) * smooth(0.9, 0.5, slope);
    c = c.map((v, i) => lerp(v, 0.93, snow));
    // Sand near water
    const lk = lakeQuery(x, z);
    if (lk.r < lk.edge + 60 && h < LAKE.level + 2.5) c = [0.66, 0.6, 0.45];
    // Mowed grass around the airport
    const ax = Math.max(0, -150 - x, x - (RWY.x + 70)), az = Math.max(0, RWY.z0 - 90 - z, z - RWY.z1 - 90);
    if (ax + az < 1) c = [0.36 + 0.04 * n2, 0.52 + 0.04 * n1, 0.24];
    return c;
  };
  function terrainMesh(x0, x1, z0, z1, step, lowerInside) {
    const nx = Math.round((x1 - x0) / step) + 1, nz = Math.round((z1 - z0) / step) + 1;
    const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      let h = heightAt(x, z);
      const k = (j * nx + i) * 3;
      const sl = Math.min(1, Math.hypot(heightAt(x + 32, z) - heightAt(x - 32, z), heightAt(x, z + 32) - heightAt(x, z - 32)) / 64);
      const c = colorAt(x, z, h, sl);
      if (lowerInside) {
        const m = Math.max(Math.abs(x), Math.abs(z));
        h -= 40 * smooth(NEAR, NEAR - 400, m);
      }
      pos[k] = x; pos[k + 1] = h; pos[k + 2] = z;
      col[k] = c[0]; col[k + 1] = c[1]; col[k + 2] = c[2];
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let q = 0;
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // World-space UVs for the detail texture
    const uv = new Float32Array(nx * nz * 2);
    for (let v = 0; v < nx * nz; v++) { uv[v * 2] = pos[v * 3] / 24; uv[v * 2 + 1] = pos[v * 3 + 2] / 24; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    return g;
  }
  const detail = (() => {
    const c = G.canvas(256), ctx = c.getContext('2d');
    const img = ctx.createImageData(256, 256);
    for (let i = 0; i < 256 * 256; i++) {
      const x = i % 256, y = (i / 256) | 0;
      const v = 200 + 55 * (0.6 * vnoise(x / 6, y / 6) + 0.4 * hash(x, y)) | 0;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: detail });
  const near = new THREE.Mesh(terrainMesh(-NEAR, NEAR, -NEAR, NEAR, CELL), terrainMat);
  near.receiveShadow = true;
  const far = new THREE.Mesh(terrainMesh(-EXTENT, EXTENT, -EXTENT, EXTENT, CELL * 4, true), terrainMat);
  group.add(near, far);
  if (onProgress) onProgress(0.7);

  // ------------------------------------------------------------ water
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x2d5f80, roughness: 0.12, metalness: 0.35, envMapIntensity: 1.2 });
  {
    const pts = [];
    for (let i = 0; i < 96; i++) { const a = i / 96 * Math.PI * 2, r = lakeR(a) + 25; pts.push(new THREE.Vector2(LAKE.x + Math.cos(a) * r, LAKE.z + Math.sin(a) * r)); }
    const g = new THREE.ShapeGeometry(new THREE.Shape(pts));
    g.rotateX(Math.PI / 2);
    const lake = new THREE.Mesh(g, waterMat);
    lake.position.y = LAKE.level;
    lake.material.side = THREE.DoubleSide;
    group.add(lake);
    // River ribbon
    const pos = [], idx = [];
    for (let i = 0; i < RIVER.length; i++) {
      const [x, z] = RIVER[i];
      const [xa, za] = RIVER[Math.max(0, i - 1)], [xb, zb] = RIVER[Math.min(RIVER.length - 1, i + 1)];
      const L = Math.hypot(xb - xa, zb - za) || 1, nx = -(zb - za) / L, nz = (xb - xa) / L;
      const s = riverSeg[Math.min(i, riverSeg.length - 1)];
      const lvl = i < riverSeg.length ? s.l0 : s.l1;
      const w = RIVER_W / 2 + 6;
      pos.push(x + nx * w, lvl, z + nz * w, x - nx * w, lvl, z - nz * w);
      if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); rg.setIndex(idx); rg.computeVertexNormals();
    group.add(new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: 0x2d5f80, roughness: 0.15, metalness: 0.3, side: THREE.DoubleSide })));
  }

  // ------------------------------------------------------------ airport pavement
  const Y = FIELD + 0.05;
  const paveTex = (w, h, draw, rep) => {
    const c = G.canvas(w, h), ctx = c.getContext('2d'); draw(ctx, w, h);
    const t = G.tex(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (rep) t.repeat.set(...rep); return t;
  };
  const grain = (ctx, w, h, base, n) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < n; i++) { const v = 70 + Math.random() * 70; ctx.fillStyle = `rgba(${v},${v},${v},0.25)`; ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
  };
  const flat = (w, l, cx, cz, mat, y = Y) => {
    const g = new THREE.PlaneGeometry(w, l); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat); m.position.set(cx, y, cz); m.receiveShadow = true; group.add(m); return m;
  };
  // Runway: repeating 50 m section with edge lines and a centerline dash
  const rwLen = RWY.z1 - RWY.z0;
  const rwTex = paveTex(128, 256, (ctx, w, h) => {
    grain(ctx, w, h, '#3e3f42', 1500);
    ctx.fillStyle = '#e9e9e4';
    ctx.fillRect(2, 0, 3, h); ctx.fillRect(w - 5, 0, 3, h);
    ctx.fillRect(w / 2 - 2, 0, 4, h * 0.6);
  }, [1, rwLen / 50]);
  flat(RWY.w, rwLen, RWY.x, (RWY.z0 + RWY.z1) / 2, new THREE.MeshLambertMaterial({ map: rwTex }));
  // Runway ends: threshold bars, numbers, aiming point
  const endTex = (num) => paveTex(512, 2048, (ctx, w, h) => {
    grain(ctx, w, h, '#3e3f42', 6000);
    ctx.fillStyle = '#ecece6';
    // Edge lines
    ctx.fillRect(8, 0, 10, h); ctx.fillRect(w - 18, 0, 10, h);
    // Threshold bars (8 bars) at the bottom (the approach end)
    for (let i = 0; i < 8; i++) { const x = 34 + i * 56 + (i >= 4 ? 30 : 0); ctx.fillRect(x - 14, h - 520, 24, 500); }
    // Runway number
    ctx.save(); ctx.translate(w / 2, h - 760); ctx.font = 'bold 300px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.scale(0.75, 1.5); ctx.fillText(num, 0, 0); ctx.restore();
    // Centerline dashes and aiming point markers
    for (let y = h - 1000; y > 0; y -= 340) ctx.fillRect(w / 2 - 6, y - 200, 12, 200);
    ctx.fillRect(70, 180, 70, 380); ctx.fillRect(w - 140, 180, 70, 380);
  });
  const endLen = 120;
  const e36 = flat(RWY.w, endLen, RWY.x, RWY.z1 - endLen / 2, new THREE.MeshLambertMaterial({ map: endTex('36'), polygonOffset: true, polygonOffsetFactor: -2 }), Y + 0.02);
  const e18 = flat(RWY.w, endLen, RWY.x, RWY.z0 + endLen / 2, new THREE.MeshLambertMaterial({ map: endTex('18'), polygonOffset: true, polygonOffsetFactor: -2 }), Y + 0.02);
  e18.rotation.y = Math.PI;
  // Taxiway with a yellow centerline
  const twTex = paveTex(64, 256, (ctx, w, h) => { grain(ctx, w, h, '#47484b', 600); ctx.fillStyle = '#e2b43a'; ctx.fillRect(w / 2 - 2, 0, 4, h); }, [1, rwLen / 30]);
  const twMat = new THREE.MeshLambertMaterial({ map: twTex });
  flat(TWY.w, rwLen, TWY.x, 0, twMat);
  // Connectors (taxiway centerline texture rotated)
  const connMat = (len) => { const t = twTex.clone(); t.needsUpdate = true; t.repeat.set(1, len / 30); return new THREE.MeshLambertMaterial({ map: t }); };
  const conn = (x0, x1, z) => { const m = flat(16, x1 - x0, (x0 + x1) / 2, z, connMat(x1 - x0)); m.rotation.y = Math.PI / 2; };
  conn(APRON.x1, TWY.x, 0); conn(TWY.x, RWY.x, RWY.z0 + 20); conn(TWY.x, RWY.x, RWY.z1 - 20); conn(TWY.x, RWY.x, 0);
  // Apron, hangar floor and fuel pad (concrete slabs)
  const conc = paveTex(256, 256, (ctx, w, h) => { grain(ctx, w, h, '#9a9a96', 2500); ctx.strokeStyle = 'rgba(40,40,40,0.35)'; ctx.lineWidth = 2; ctx.strokeRect(0, 0, w, h); }, [12, 9]);
  flat(APRON.x1 - APRON.x0, APRON.z1 - APRON.z0, 0, 0, new THREE.MeshLambertMaterial({ map: conc }), Y + 0.01);
  const conc2 = conc.clone(); conc2.needsUpdate = true; conc2.repeat.set(5, 4);
  flat(HANGAR.x1 - HANGAR.x0 + 8, HANGAR.z1 - HANGAR.z0, (HANGAR.x0 + HANGAR.x1 + 8) / 2, 0, new THREE.MeshLambertMaterial({ map: conc2 }), Y + 0.015);
  flat(20, PUMP.z + 8 - APRON.z1, PUMP.x, (APRON.z1 + PUMP.z + 8) / 2, new THREE.MeshLambertMaterial({ map: conc2 }), Y + 0.012);
  // Parking T and tie-down markings on the apron
  {
    const c = G.canvas(512, 512), ctx = c.getContext('2d');
    ctx.strokeStyle = '#e2b43a'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(256, 60); ctx.lineTo(256, 460); ctx.moveTo(150, 120); ctx.lineTo(362, 120); ctx.stroke();
    const t = G.tex(c);
    for (const x of [-30, 0, 30]) {
      const m = flat(14, 14, x, 10, new THREE.MeshLambertMaterial({ map: t, transparent: true, polygonOffset: true, polygonOffsetFactor: -3 }), Y + 0.02);
      m.castShadow = false;
    }
  }

  // ------------------------------------------------------------ buildings
  const colliders = []; // axis-aligned boxes: {x0,x1,y0,y1,z0,z1,en,es}
  const box = (w, h, d, x, y, z, mat, opts = {}) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z); m.castShadow = opts.cast !== false; m.receiveShadow = true; group.add(m);
    if (opts.collide) colliders.push({ x0: x - w / 2, x1: x + w / 2, y0: y, y1: y + h, z0: z - d / 2, z1: z + d / 2, en: opts.collide[0], es: opts.collide[1] });
    return m;
  };
  // Hangar: corrugated steel walls, gable roof, open door to the east
  {
    const corr = paveTex(256, 64, (ctx, w, h) => { for (let x = 0; x < w; x++) { const v = 150 + 40 * Math.sin(x / w * Math.PI * 16); ctx.fillStyle = `rgb(${v},${v + 4},${v + 8})`; ctx.fillRect(x, 0, 1, h); } }, [6, 1]);
    const wall = new THREE.MeshStandardMaterial({ map: corr, roughness: 0.55, metalness: 0.4, side: THREE.DoubleSide });
    const { x0, x1, z0, z1, h } = HANGAR, t = 0.3;
    const W = x1 - x0, D = z1 - z0;
    const hang = ['the hangar wall', 'la pared del hangar'];
    box(t, h, D, x0, Y, 0, wall, { collide: hang });
    box(W, h, t, (x0 + x1) / 2, Y, z0, wall, { collide: hang });
    box(W, h, t, (x0 + x1) / 2, Y, z1, wall, { collide: hang });
    // East wall above and beside the door opening (door is 26 m wide, 6 m tall)
    box(t, h - 6.2, D, x1, Y + 6.2, 0, wall, { collide: ['the hangar door frame', 'el marco de la puerta del hangar'] });
    for (const s of [-1, 1]) box(t, 6.2, 3, x1, Y, s * (D / 2 - 1.5), wall, { collide: hang });
    // Sliding door panels, open, outside the side walls
    for (const s of [-1, 1]) box(0.25, 6.2, 13, x1 + 0.4, Y, s * (D / 2 + 6.5), wall, { collide: ['the hangar door', 'la puerta del hangar'] });
    // Gable roof
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8b9097, roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.6, D / 2 / Math.cos(0.18) + 0.4), roofMat);
      r.rotation.set(-Math.PI / 2 + s * 0.18, 0, 0);
      r.position.set((x0 + x1) / 2, Y + h + D / 4 * Math.tan(0.18), s * D / 4);
      r.castShadow = true; r.receiveShadow = true; group.add(r);
    }
    for (const zz of [z0, z1]) {
      const tri = new THREE.Shape(); tri.moveTo(-D / 2, 0); tri.lineTo(D / 2, 0); tri.lineTo(0, D / 2 * Math.tan(0.18)); tri.closePath();
      const gm = new THREE.Mesh(new THREE.ShapeGeometry(tri), wall); gm.rotation.y = Math.PI / 2;
      gm.position.set(zz === z0 ? x0 : x1, Y + h, 0); void zz; group.add(gm);
    }
    // Ceiling lights
    const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3dc, emissiveIntensity: 1.5 });
    for (const lx of [x0 + 8, x0 + 20]) for (const lz of [-8, 0, 8]) box(1.4, 0.1, 0.4, lx, Y + h - 0.3, lz, lamp, { cast: false });
    // Workbench, tool chest and an oil drum
    const red = new THREE.MeshStandardMaterial({ color: 0xa81c18, roughness: 0.4, metalness: 0.3 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.8 });
    box(4, 0.9, 0.8, x0 + 6, Y, z0 + 1.2, wood, { collide: ['the workbench', 'el banco de trabajo'] });
    box(1.2, 1.1, 0.6, x0 + 10, Y, z0 + 0.9, red, { collide: ['the tool chest', 'la caja de herramientas'] });
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 16), new THREE.MeshStandardMaterial({ color: 0x2a5ea8, roughness: 0.5 }));
    drum.position.set(x0 + 1.2, Y + 0.45, z1 - 1.5); drum.castShadow = true; group.add(drum);
    colliders.push({ x0: x0 + 0.9, x1: x0 + 1.5, y0: Y, y1: Y + 0.9, z0: z1 - 1.8, z1: z1 - 1.2, en: 'an oil drum', es: 'un barril de aceite' });
    // Sign over the door
    const sign = G.placard(['HANGAR 3'], { w: 1024, h: 128, size: 90, bg: '#1c2f5c', color: '#fff' });
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(8, 1), new THREE.MeshLambertMaterial({ map: G.tex(sign) }));
    sm.position.set(x1 + 0.2, Y + 7.4, 0); sm.rotation.y = Math.PI / 2; group.add(sm);
  }
  // FBO building with windows
  {
    const win = paveTex(256, 128, (ctx, w, h) => {
      ctx.fillStyle = '#d8d2c4'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#334455';
      for (let x = 10; x < w; x += 50) ctx.fillRect(x, 30, 36, 60);
    }, [4, 1]);
    const mat = new THREE.MeshLambertMaterial({ map: win });
    box(30, 5, 14, -35, Y, -70, mat, { collide: ['the FBO building', 'el edificio del FBO'] });
    box(31, 0.4, 15, -35, Y + 5, -70, new THREE.MeshLambertMaterial({ color: 0x6b6f75 }));
    const sign = G.placard(['FBO · PILOT SHOP · 100LL'], { w: 1024, h: 96, size: 56, bg: '#ffffff', color: '#1c2f5c' });
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.3), new THREE.MeshLambertMaterial({ map: G.tex(sign) }));
    sm.position.set(-35, Y + 4, -62.9); group.add(sm);
  }
  // Fuel pump island
  {
    const base = new THREE.MeshLambertMaterial({ color: 0xbcbcb8 });
    box(3, 0.2, 1.6, PUMP.x, Y, PUMP.z, base);
    const pump = new THREE.MeshStandardMaterial({ color: 0xd0d4d8, roughness: 0.4, metalness: 0.3 });
    box(1.0, 1.8, 0.6, PUMP.x, Y + 0.2, PUMP.z, pump, { collide: ['the fuel pump', 'la bomba de combustible'] });
    const lbl = G.placard(['100LL', 'AVGAS'], { w: 256, h: 256, size: 70, bg: '#1d63c4', color: '#fff' });
    const lm = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshLambertMaterial({ map: G.tex(lbl) }));
    lm.position.set(PUMP.x, Y + 1.3, PUMP.z - 0.31); lm.rotation.y = Math.PI; group.add(lm);
    const lm2 = lm.clone(); lm2.position.z = PUMP.z + 0.31; lm2.rotation.y = 0; group.add(lm2);
    // Bollards
    const yel = new THREE.MeshLambertMaterial({ color: 0xf2c200 });
    for (const dx of [-1.8, 1.8]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1, 10), yel); b.position.set(PUMP.x + dx, Y + 0.5, PUMP.z); group.add(b);
      colliders.push({ x0: PUMP.x + dx - 0.15, x1: PUMP.x + dx + 0.15, y0: Y, y1: Y + 1, z0: PUMP.z - 0.15, z1: PUMP.z + 0.15, en: 'a bollard', es: 'un bolardo' });
    }
  }
  // Windsock on a pole near the runway
  const sock = new THREE.Group();
  {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 6, 8), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
    pole.position.set(RWY.x + 40, Y + 3, -150); group.add(pole);
    sock.position.set(RWY.x + 40, Y + 5.8, -150);
    const cone = new THREE.CylinderGeometry(0.15, 0.45, 3.6, 16, 5, true); cone.rotateX(Math.PI / 2); cone.translate(0, 0, 1.8);
    const c = G.canvas(64, 256), ctx = c.getContext('2d');
    for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? '#ffffff' : '#ff6a00'; ctx.fillRect(0, i * 51.2, 64, 51.2); }
    const sm = new THREE.Mesh(cone, new THREE.MeshLambertMaterial({ map: G.tex(c), side: THREE.DoubleSide }));
    sock.add(sm); group.add(sock);
  }

  // ------------------------------------------------------------ town and farm buildings (instanced)
  {
    const houses = [], roofs = [];
    const rnd = (i) => hash(i * 7 + 3, i * 13 + 5);
    let k = 0;
    for (let gx = 1500; gx < 3500; gx += 60) for (let gz = -1500; gz < 1500; gz += 60) {
      k++;
      if ((gx / 60) % 5 === 0 || (gz / 60) % 6 === 0) continue; // streets
      if (rnd(k) < 0.25) continue;
      const centre = Math.hypot(gx - 2500, gz) < 500;
      const w = 10 + rnd(k + 1) * 14, d = 10 + rnd(k + 2) * 14;
      const fl = centre ? 2 + Math.floor(rnd(k + 3) * 5) : 1 + Math.floor(rnd(k + 3) * 2);
      const x = gx + (rnd(k + 4) - 0.5) * 20, z = gz + (rnd(k + 5) - 0.5) * 20;
      houses.push({ x, z, w, d, h: fl * 3.2, c: centre ? 0.6 + rnd(k + 6) * 0.3 : 0.7 + rnd(k + 6) * 0.25, hue: rnd(k + 7), roof: !centre });
    }
    // Farmhouses and barns scattered in the lowlands
    for (let i = 0; i < 160; i++) {
      const x = (rnd(i + 900) - 0.5) * 22000, z = (rnd(i + 1900) - 0.5) * 22000;
      if (Math.abs(x - 100) < 1200 && Math.abs(z) < 1400) continue;
      const h = heightAt(x, z);
      if (h > 620 || groundAt(x, z).type === 'water') continue;
      houses.push({ x, z, w: 9 + rnd(i) * 8, d: 12 + rnd(i + 1) * 10, h: 4 + rnd(i + 2) * 3, c: 0.75, hue: rnd(i + 3) < 0.5 ? 0.02 : 0.1, roof: true, barn: rnd(i + 3) < 0.5 });
    }
    const bg = new THREE.BoxGeometry(1, 1, 1); bg.translate(0, 0.5, 0);
    const rg = new THREE.CylinderGeometry(0.72, 0.72, 1, 3, 1); rg.rotateZ(Math.PI / 2); rg.scale(1, 0.5, 1); rg.translate(0, 0.25, 0);
    const im = new THREE.InstancedMesh(bg, new THREE.MeshLambertMaterial({ map: (() => {
      const c = G.canvas(64, 64), ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = '#4a5866'; for (let y = 8; y < 64; y += 16) for (let x = 6; x < 64; x += 16) ctx.fillRect(x, y, 7, 8);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })() }), houses.length);
    const ir = new THREE.InstancedMesh(rg, new THREE.MeshLambertMaterial({ color: 0xffffff }), houses.length);
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    let nr = 0;
    houses.forEach((b, i) => {
      const y = heightAt(b.x, b.z) - 0.5;
      m4.makeScale(b.w, b.h + 0.5, b.d); m4.setPosition(b.x, y, b.z);
      im.setMatrixAt(i, m4);
      col.setHSL(b.barn ? 0.0 : 0.08 + b.hue * 0.06, b.barn ? 0.55 : 0.18, b.barn ? 0.35 : b.c * 0.85);
      im.setColorAt(i, col);
      colliders.push({ x0: b.x - b.w / 2, x1: b.x + b.w / 2, y0: y, y1: y + b.h + 0.5 + (b.roof ? b.w * 0.36 : 0), z0: b.z - b.d / 2, z1: b.z + b.d / 2, en: 'a building', es: 'un edificio' });
      if (b.roof) {
        m4.makeScale(b.d, b.w * 0.72, b.w); m4.setPosition(b.x, y + b.h + 0.5, b.z);
        const rot = new THREE.Matrix4().makeRotationY(Math.PI / 2);
        m4.multiply(rot);
        ir.setMatrixAt(nr, m4);
        col.setHSL(b.barn ? 0.0 : 0.02, b.barn ? 0.1 : 0.4, b.barn ? 0.25 : 0.3);
        ir.setColorAt(nr, col); nr++;
      }
    });
    ir.count = nr;
    im.castShadow = im.receiveShadow = true;
    group.add(im, ir);
  }

  // ------------------------------------------------------------ trees (instanced)
  {
    const trunk = new THREE.CylinderGeometry(0.25, 0.35, 3, 5); trunk.translate(0, 1.5, 0);
    const c1 = new THREE.ConeGeometry(2.6, 6, 7); c1.translate(0, 5.5, 0);
    const c2 = new THREE.ConeGeometry(1.9, 4.5, 7); c2.translate(0, 8, 0);
    const paint = (g, r, gg, b) => { const n = g.attributes.position.count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = r; a[i * 3 + 1] = gg; a[i * 3 + 2] = b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
    const tree = mergeGeometries([paint(trunk, 0.35, 0.25, 0.15), paint(c1, 0.2, 0.36, 0.18), paint(c2, 0.22, 0.4, 0.2)]);
    const COUNT = 4200;
    const im = new THREE.InstancedMesh(tree, new THREE.MeshLambertMaterial({ vertexColors: true }), COUNT);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    let n = 0, tries = 0;
    while (n < COUNT && tries < 60000) {
      tries++;
      const x = (hash(tries, 77) - 0.5) * 2 * 7000, z = (hash(tries, 991) - 0.5) * 2 * 7000;
      const h = heightAt(x, z);
      const forest = vnoise(x / 1100 + 4, z / 1100) + (h - 520) / 900;
      if (forest < 0.58 && hash(tries, 5) > 0.04) continue;
      if (h > 1500) continue;
      // Keep clear of the airport, town and water
      if (x > -250 && x < RWY.x + 200 && z > RWY.z0 - 350 && z < RWY.z1 + 350) continue;
      if (x > 1300 && x < 3700 && Math.abs(z) < 1700) continue;
      if (groundAt(x, z).type === 'water') continue;
      const rv = riverQuery(x, z); if (rv && rv.d < 30) continue;
      const sc = 0.7 + hash(tries, 3) * 0.9;
      s.set(sc, sc * (0.8 + hash(tries, 4) * 0.5), sc); p.set(x, h - 0.3, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(tries, 9) * 6.28);
      m4.compose(p, q, s); im.setMatrixAt(n, m4);
      col.setHSL(0.27 + hash(tries, 11) * 0.06, 0.4, 0.6 + hash(tries, 12) * 0.4); im.setColorAt(n, col);
      n++;
    }
    im.count = n;
    im.castShadow = false; im.receiveShadow = false;
    group.add(im);
  }

  // ------------------------------------------------------------ roads (draped ribbons)
  {
    const road = (pts, w) => {
      const pos = [], idx = [];
      for (let i = 0; i < pts.length; i++) {
        const [x, z] = pts[i], [xa, za] = pts[Math.max(0, i - 1)], [xb, zb] = pts[Math.min(pts.length - 1, i + 1)];
        const L = Math.hypot(xb - xa, zb - za) || 1, nx = -(zb - za) / L, nz = (xb - xa) / L;
        pos.push(x + nx * w / 2, heightAt(x + nx * w / 2, z + nz * w / 2) + 0.3, z + nz * w / 2, x - nx * w / 2, heightAt(x - nx * w / 2, z - nz * w / 2) + 0.3, z - nz * w / 2);
        if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x4a4a4c, polygonOffset: true, polygonOffsetFactor: -4 }));
      m.receiveShadow = true; group.add(m);
    };
    const line = (x0, z0, x1, z1, step = 25) => { const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step); return Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n]); };
    road(line(-40, -90, -40, -400).concat(line(-40, -400, 1500, -400).slice(1)), 8);       // airport access road to town
    road(line(1400, -1700, 1400, 1700), 10);                                              // town main street (north-south)
    road(line(-9000, -400, -40, -400).concat([]), 8);                                     // road west toward the river
    road(line(3600, 0, 9000, 2500, 40), 8);                                               // road east into the hills
    road(line(1400, 0, 3600, 0), 10);
  }

  // ------------------------------------------------------------ sky dome and clouds
  const sky = (() => {
    const g = new THREE.SphereGeometry(30000, 32, 16);
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x2f6fc4) }, mid: { value: new THREE.Color(0xa7c6e6) }, bottom: { value: new THREE.Color(0xc9d9e6) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
        void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h,0.0,1.0), 0.55)) : mix(mid, bottom, clamp(-h*6.0,0.0,1.0));
        gl_FragColor = vec4(c, 1.0); }`,
    });
    const s = new THREE.Mesh(g, m); s.renderOrder = -1; s.frustumCulled = false;
    return s;
  })();
  group.add(sky);
  // Fair-weather cumulus: soft billboards in a layer around 1700 m
  const clouds = (() => {
    const c = G.canvas(128), ctx = c.getContext('2d');
    for (let i = 0; i < 14; i++) {
      const x = 30 + Math.random() * 68, y = 50 + Math.random() * 30, r = 18 + Math.random() * 22;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: true, opacity: 0.95 });
    const g = new THREE.Group();
    for (let i = 0; i < 90; i++) {
      const sp = new THREE.Sprite(mat);
      const x = (hash(i, 501) - 0.5) * 36000, z = (hash(i, 777) - 0.5) * 36000;
      const s = 500 + hash(i, 4) * 900;
      sp.scale.set(s * 1.6, s, 1); sp.position.set(x, FIELD + 1250 + hash(i, 8) * 500, z);
      g.add(sp);
    }
    return g;
  })();
  group.add(clouds);

  if (onProgress) onProgress(1);

  // Obstacle test for the airplane's corner points (three-world coordinates in MSL)
  function collide(points) {
    for (const [x, y, z] of points) {
      for (const c of colliders) {
        if (x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1 && y > c.y0 && y < c.y1) return c;
      }
    }
    return null;
  }

  return {
    group, sky, clouds, sock, heightAt, groundAt, colliders, collide,
    update(camPos, windFromDeg, windKt) {
      sky.position.set(camPos.x, camPos.y, camPos.z);
      // Windsock points downwind and droops when the wind is light
      const a = (windFromDeg + 180) * Math.PI / 180;
      sock.rotation.y = Math.PI - a;
      sock.children[0].rotation.x = (1 - Math.min(1, windKt / 15)) * 1.1;
    },
  };
}
