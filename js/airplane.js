// The outside of the airplane, built from code in the same "three local" coordinates as the
// cockpit (X right, Y up, Z aft, origin at the instrument panel). Moving parts are returned as
// handles so the simulator can animate them.
import * as THREE from 'three';
import * as G from './gauges.js';

const PI = Math.PI;

// ---------------------------------------------------------------- geometry helpers
// NACA 4-digit airfoil. Returns points around the section: upper surface from x1 back to x0,
// then lower surface from x0 to x1 (x is chord fraction, y is thickness fraction).
function airfoil(m, p, t, x0 = 0, x1 = 1, n = 18) {
  const yt = (x) => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const yc = (x) => m === 0 ? 0 : x < p ? m / (p * p) * (2 * p * x - x * x) : m / ((1 - p) ** 2) * ((1 - 2 * p) + 2 * p * x - x * x);
  const xs = [];
  for (let i = 0; i <= n; i++) { const b = i / n; xs.push(x0 + (x1 - x0) * (1 - Math.cos(b * PI)) / 2); }
  const up = [], lo = [];
  for (const x of xs) { const c = yc(x), h = yt(x); up.push([x, c + h]); lo.push([x, c - h]); }
  return [...up.reverse(), ...lo.slice(1)];
}

// Builds a surface through a list of rings (each ring: array of [x,y,z], all the same length).
function loft(rings, { closeRing = false, capStart = false, capEnd = false } = {}) {
  const nr = rings.length, np = rings[0].length;
  const pos = [], idx = [], uv = [];
  rings.forEach((r, i) => r.forEach((p, j) => { pos.push(...p); uv.push(j / (np - 1), i / (nr - 1)); }));
  const segs = closeRing ? np : np - 1;
  for (let i = 0; i < nr - 1; i++) for (let j = 0; j < segs; j++) {
    const a = i * np + j, b = i * np + (j + 1) % np, c = (i + 1) * np + j, d = (i + 1) * np + (j + 1) % np;
    idx.push(a, c, b, b, c, d);
  }
  const cap = (ri, flip) => {
    const base = pos.length / 3;
    const r = rings[ri];
    const cx = r.reduce((s, p) => s + p[0], 0) / np, cy = r.reduce((s, p) => s + p[1], 0) / np, cz = r.reduce((s, p) => s + p[2], 0) / np;
    pos.push(cx, cy, cz); uv.push(0.5, 0.5);
    r.forEach(p => { pos.push(...p); uv.push(0, 0); });
    for (let j = 0; j < np - 1 + (closeRing ? 1 : 0); j++) {
      const a = base + 1 + j, b = base + 1 + (j + 1) % np;
      if (flip) idx.push(base, a, b); else idx.push(base, b, a);
    }
  };
  if (capStart) cap(0, false);
  if (capEnd) cap(nr - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Ensures a surface faces outward: flips the winding if most normals point toward the centroid.
function orientOutward(g, center) {
  g.computeBoundingBox();
  const c = center || g.boundingBox.getCenter(new THREE.Vector3());
  const p = g.attributes.position, n = g.attributes.normal;
  let score = 0;
  for (let i = 0; i < p.count; i += 3) score += (p.getX(i) - c.x) * n.getX(i) + (p.getY(i) - c.y) * n.getY(i) + (p.getZ(i) - c.z) * n.getZ(i);
  if (score < 0) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    g.computeVertexNormals();
  }
  return g;
}

// ---------------------------------------------------------------- the airplane
export function buildExterior() {
  const root = new THREE.Group();
  root.name = 'exterior';
  const H = { lights: {} };

  const std = (o) => new THREE.MeshStandardMaterial(o);
  const M = {
    paint: std({ color: 0xf4f4f2, roughness: 0.3, metalness: 0.05, envMapIntensity: 0.9 }),
    paintDark: std({ color: 0x1c2f5c, roughness: 0.35, envMapIntensity: 0.8 }),
    glass: std({ color: 0x1a2430, roughness: 0.04, metalness: 0.6, transparent: true, opacity: 0.45, envMapIntensity: 1.4, depthWrite: false }),
    rubber: std({ color: 0x151515, roughness: 0.9 }),
    hub: std({ color: 0xb8bcc0, roughness: 0.35, metalness: 0.9 }),
    chrome: std({ color: 0xe8e8e8, roughness: 0.15, metalness: 1 }),
    steelDark: std({ color: 0x3a3c3f, roughness: 0.5, metalness: 0.7 }),
    black: std({ color: 0x0c0c0d, roughness: 0.5 }),
    prop: std({ color: 0x18191b, roughness: 0.55, metalness: 0.2 }),
    propTip: std({ color: 0xf2f2f0, roughness: 0.4 }),
    propTipRed: std({ color: 0xc41e1a, roughness: 0.4 }),
    intake: std({ color: 0x050505, roughness: 1 }),
    exhaust: std({ color: 0x4a3a2e, roughness: 0.6, metalness: 0.6 }),
  };
  const lightMat = (color) => std({ color, emissive: color, emissiveIntensity: 0, roughness: 0.2 });

  const add = (parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const group = (parent, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
  const lathe = (profile, segs = 32) => { const g = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), segs); g.rotateX(PI / 2); return g; };

  // ------------------------------------------------------------ fuselage
  // Stations: z, half width, top, bottom, squareness (higher = boxier)
  const ST = [
    [-1.97, 0.22, 0.12, -0.40, 2.4],
    [-1.90, 0.31, 0.20, -0.56, 2.6],
    [-1.70, 0.42, 0.30, -0.66, 2.8],
    [-1.30, 0.48, 0.36, -0.70, 3.0],
    [-0.80, 0.53, 0.40, -0.71, 3.2],
    [-0.45, 0.57, 0.42, -0.71, 3.4],
    [-0.31, 0.60, 0.445, -0.71, 3.6],
    [-0.20, 0.61, 0.56, -0.71, 3.6],
    [-0.05, 0.615, 0.72, -0.71, 3.6],
    [0.10, 0.615, 0.87, -0.71, 3.6],
    [0.25, 0.615, 1.01, -0.71, 3.6],
    [0.60, 0.615, 1.015, -0.71, 3.6],
    [1.10, 0.61, 1.015, -0.70, 3.6],
    [1.60, 0.60, 1.01, -0.67, 3.5],
    [1.95, 0.585, 1.00, -0.63, 3.4],
    [2.30, 0.53, 0.86, -0.57, 3.2],
    [2.70, 0.47, 0.72, -0.50, 3.0],
    [3.20, 0.39, 0.60, -0.40, 2.8],
    [3.80, 0.31, 0.49, -0.29, 2.6],
    [4.40, 0.24, 0.40, -0.17, 2.5],
    [5.00, 0.18, 0.33, -0.06, 2.4],
    [5.55, 0.13, 0.28, 0.03, 2.3],
    [6.00, 0.07, 0.25, 0.10, 2.2],
    [6.12, 0.02, 0.22, 0.14, 2.0],
  ];
  const NR = 40;
  const ringAt = ([z, w, top, bot, n]) => {
    const yc = bot + (top - bot) * 0.46;
    const pts = [];
    for (let j = 0; j < NR; j++) {
      const a = j / NR * PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const ex = 2 / n;
      const x = w * Math.sign(c) * Math.abs(c) ** ex;
      const hy = s >= 0 ? top - yc : yc - bot;
      const y = yc + hy * Math.sign(s) * Math.abs(s) ** ex;
      pts.push([x, y, z]);
    }
    return pts;
  };
  const rings = ST.map(ringAt);
  const fus = loft(rings, { closeRing: true, capStart: true, capEnd: true });
  // Side-projected UVs for the paint scheme: left side uses the left half of the texture.
  {
    const p = fus.attributes.position, uv = fus.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const along = (z + 2.0) / 8.2;
      uv.setXY(i, x <= 0 ? along * 0.5 : 0.5 + (1 - along) * 0.5, (y + 0.8) / 2.0);
    }
  }
  // Split faces into painted skin and window glass.
  const isGlass = (x, y, z) => {
    const ax = Math.abs(x);
    // Windshield: the slanted part between the cowling and the roof
    if (z > -0.29 && z < 0.24 && y > 0.47 && ax < 0.56) return true;
    // Front door windows and rear side windows
    if (ax > 0.45 && y > 0.27 && y < 0.93) {
      if (z > -0.08 && z < 0.96) return true;
      if (z > 1.06 && z < 1.88) return true;
    }
    // Rear "omni-vision" window behind the wing
    if (z > 2.02 && z < 2.62 && y > 0.6 && ax < 0.44) return true;
    return false;
  };
  {
    const ix = fus.index.array, p = fus.attributes.position;
    const skin = [], glass = [];
    for (let i = 0; i < ix.length; i += 3) {
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 3; k++) { cx += p.getX(ix[i + k]); cy += p.getY(ix[i + k]); cz += p.getZ(ix[i + k]); }
      (isGlass(cx / 3, cy / 3, cz / 3) ? glass : skin).push(ix[i], ix[i + 1], ix[i + 2]);
    }
    const skinG = fus.clone(); skinG.setIndex(skin);
    const glassG = fus.clone(); glassG.setIndex(glass);
    orientOutward(skinG, new THREE.Vector3(0, 0.15, 1.5));
    const skinMat = M.paint.clone();
    skinMat.map = G.tex(liveryCanvas());
    const sk = add(root, skinG, skinMat);
    sk.name = 'fuselage';
    // Glass: same winding check
    orientOutward(glassG, new THREE.Vector3(0, 0.3, 0.8));
    const gl = add(root, glassG, M.glass);
    gl.castShadow = false; gl.raycast = () => {};
    // Window frames: thin dark outlines around the side windows
    for (const s of [-1, 1]) {
      for (const [z0, z1] of [[-0.08, 0.96], [1.06, 1.88]]) {
        const fr = new THREE.Shape();
        fr.moveTo(z0, 0.27); fr.lineTo(z1, 0.27); fr.lineTo(z1, 0.93); fr.lineTo(z0, 0.93); fr.closePath();
        const hole = new THREE.Path(); hole.moveTo(z0 + 0.012, 0.282); hole.lineTo(z0 + 0.012, 0.918); hole.lineTo(z1 - 0.012, 0.918); hole.lineTo(z1 - 0.012, 0.282); hole.closePath();
        fr.holes.push(hole);
        const fg = new THREE.ShapeGeometry(fr); fg.rotateY(-PI / 2);
        const m = add(root, fg, M.black, s * 0.619, 0, 0);
        m.scale.x = -s; // left side faces -x; the right side is a mirror image
        m.castShadow = false;
      }
    }
  }

  // ------------------------------------------------------------ cowling details, spinner, propeller
  for (const s of [-1, 1]) {
    const intake = new THREE.CircleGeometry(0.075, 24); intake.scale(1, 0.75, 1);
    add(root, intake, M.intake, s * 0.17, 0.02, -1.955, 0, PI, 0);
  }
  add(root, new THREE.BoxGeometry(0.16, 0.06, 0.02), M.intake, 0, -0.45, -1.88);
  // Exhaust stack
  const ex = add(root, new THREE.CylinderGeometry(0.03, 0.035, 0.22, 12), M.exhaust, 0.12, -0.74, -0.95, 0.5, 0, 0);
  ex.castShadow = false;
  // Oil door on the cowl top
  add(root, new THREE.BoxGeometry(0.2, 0.004, 0.16), M.black, 0, 0.405, -0.9).material = std({ color: 0xdcdcda, roughness: 0.35 });

  const spinnerZ = -2.0;
  const spin = add(root, lathe([[0, -0.24], [0.05, -0.215], [0.1, -0.15], [0.13, -0.07], [0.142, 0.0], [0.142, 0.03]], 40), M.paint, 0, -0.04, spinnerZ + 0.03);
  spin.rotation.x = 0;
  const prop = group(root, 0, -0.04, spinnerZ - 0.05);
  H.prop = prop;
  const blades = group(prop);
  for (const sgn of [1, -1]) {
    // Twisted blade: a loft of thin airfoil sections from hub to tip
    const rs = [];
    for (let i = 0; i <= 10; i++) {
      const rr = 0.13 + (0.9525 - 0.13) * i / 10;
      const chord = 0.17 * (1 - 0.45 * (i / 10) ** 1.6) * (i === 10 ? 0.6 : 1);
      const twist = (38 - 24 * (i / 10)) * PI / 180;
      const sec = airfoil(0.03, 0.4, 0.12 - 0.06 * i / 10, 0, 1, 7).map(([x, y]) => {
        const cx = (x - 0.4) * chord, cy = y * chord;
        // section plane: chord along prop rotation direction (x), thickness along axis (z)
        const px = cx * Math.cos(twist) - cy * Math.sin(twist);
        const pz = cx * Math.sin(twist) + cy * Math.cos(twist);
        return [px * sgn, rr * sgn, pz];
      });
      rs.push(sec);
    }
    const bg = orientOutward(loft(rs, { closeRing: true, capEnd: true }));
    add(blades, bg, M.prop);
    add(blades, new THREE.BoxGeometry(0.1, 0.045, 0.02), M.propTip, 0, sgn * 0.905, 0);
    add(blades, new THREE.BoxGeometry(0.09, 0.03, 0.02), M.propTipRed, 0, sgn * 0.87, 0);
  }
  H.propBlades = blades;
  // Motion-blurred disc shown when the engine is running
  const discMat = new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const disc = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.95, 48), discMat);
  disc.position.set(0, -0.04, spinnerZ - 0.05);
  root.add(disc);
  H.propDisc = disc;

  // ------------------------------------------------------------ wings
  const WING = {
    rootX: 0.58, breakX: 2.6, tipX: 5.42,
    rootChord: 1.63, tipChord: 1.13, le: 0.22, rootY: 1.12, dihedral: 1.73 * PI / 180,
    incRoot: 1.5 * PI / 180, incTip: -1.5 * PI / 180,
  };
  const wingSection = (ax, x0, x1) => { // ax = |x| span position; returns ring of 3D points for the left wing (x positive, mirrored later)
    const chord = ax <= WING.breakX ? WING.rootChord : WING.rootChord + (WING.tipChord - WING.rootChord) * (ax - WING.breakX) / (WING.tipX - WING.breakX);
    const le = WING.le + (ax > WING.breakX ? 0.06 * (ax - WING.breakX) / (WING.tipX - WING.breakX) : 0);
    const inc = WING.incRoot + (WING.incTip - WING.incRoot) * Math.max(0, ax - WING.rootX) / (WING.tipX - WING.rootX);
    const y0 = WING.rootY + Math.max(0, ax - WING.rootX) * Math.tan(WING.dihedral);
    return { chord, le, inc, y0, pts: airfoil(0.02, 0.4, 0.12, x0, x1, 14).map(([x, y]) => [ax, y0 + (y * Math.cos(inc) - x * Math.sin(inc)) * chord, le + (x * Math.cos(inc) + y * Math.sin(inc)) * chord]) };
  };
  const span = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);
  const FLAP = [0.66, 2.55], AIL = [2.62, 5.05], CUT = 0.74;
  const wingFixed = [];
  {
    // Inner full-chord stub, the main box (cut at 74% chord), the tip region, and a rounded tip cap
    wingFixed.push(loft(span(WING.rootX, FLAP[0], 1).map(x => wingSection(x, 0, 1).pts)));
    wingFixed.push(loft(span(FLAP[0], AIL[1], 12).map(x => wingSection(x, 0, CUT).pts), { capStart: false }));
    wingFixed.push(loft(span(FLAP[1], AIL[0], 1).map(x => wingSection(x, CUT, 1).pts)));
    const tipRings = span(AIL[1], WING.tipX, 2).map(x => wingSection(x, 0, 1).pts);
    // Rounded tip: shrink the last ring toward its chord line
    const last = wingSection(WING.tipX, 0, 1);
    const tip2 = last.pts.map(([x, y, z]) => [x + 0.05, last.y0 + (y - last.y0) * 0.3, z]);
    tipRings.push(tip2);
    wingFixed.push(loft(tipRings, { capEnd: true }));
    wingFixed.forEach(g => orientOutward(g));
  }
  const wingMat = M.paint;
  for (const side of [-1, 1]) {
    const w = group(root);
    w.scale.x = side;
    for (const g of wingFixed) {
      const m = add(w, side < 0 ? g : g, wingMat);
      if (side < 0) m.material = wingMat; // mirrored meshes need flipped faces
    }
    if (side < 0) w.children.forEach(m => { m.material = flipMat(wingMat); });
    // Control surfaces: built in place, then moved into a hinge group
    const surface = (xr, name) => {
      const rings = span(xr[0], xr[1], 6).map(x => wingSection(x, CUT, 1).pts);
      const g = orientOutward(loft(rings, { capStart: true, capEnd: true }));
      const a = wingSection(xr[0], CUT, CUT), b = wingSection(xr[1], CUT, CUT);
      const ha = new THREE.Vector3(...a.pts[0]), hb = new THREE.Vector3(...b.pts[0]);
      const hinge = new THREE.Group();
      hinge.position.copy(ha);
      const axis = hb.clone().sub(ha).normalize();
      hinge.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), axis);
      g.translate(-ha.x, -ha.y, -ha.z);
      g.applyQuaternion(hinge.quaternion.clone().invert());
      add(hinge, g, side < 0 ? flipMat(wingMat) : wingMat);
      w.add(hinge);
      return hinge;
    };
    const flap = surface(FLAP, 'flap'), ail = surface(AIL, 'aileron');
    if (side < 0) { H.flapL = flap; H.ailL = ail; } else { H.flapR = flap; H.ailR = ail; }
    // Fuel cap on top of each wing
    const capS = wingSection(1.05, 0.3, 0.3);
    add(w, new THREE.CylinderGeometry(0.035, 0.035, 0.012, 20), M.chrome, 1.05, capS.pts[0][1] + 0.012, capS.pts[0][2] - 0.25);
    H['fuelCap' + (side < 0 ? 'L' : 'R')] = new THREE.Vector3(side * 1.05, capS.pts[0][1] + 0.02, capS.pts[0][2] - 0.25);
    // Wingtip lights: red on the left, green on the right, white strobes
    const tip = wingSection(WING.tipX, 0.05, 0.05);
    const navMat = lightMat(side < 0 ? 0xff2010 : 0x10ff40);
    add(w, new THREE.SphereGeometry(0.03, 12, 8), navMat, WING.tipX + 0.06, tip.y0, WING.le + 0.12);
    const strobeMat = lightMat(0xffffff);
    add(w, new THREE.SphereGeometry(0.022, 10, 8), strobeMat, WING.tipX + 0.05, tip.y0, WING.le + 0.3);
    H.lights[side < 0 ? 'navL' : 'navR'] = navMat;
    (H.lights.strobes ||= []).push(strobeMat);
    // Wing strut (streamlined), from the lower fuselage to the wing
    const a = new THREE.Vector3(0.6, -0.46, 0.98), b = new THREE.Vector3(2.62, wingSection(2.62, 0.35, 0.35).y0 - 0.06, 0.98);
    const strutG = new THREE.CylinderGeometry(0.045, 0.045, a.distanceTo(b), 14); strutG.scale(1, 1, 0.38);
    const sm = add(w, strutG, side < 0 ? flipMat(M.paint) : M.paint, (a.x + b.x) / 2, (a.y + b.y) / 2, a.z);
    sm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    // Pitot tube and landing/taxi light on the left wing only
    if (side < 0) {
      const pit = group(w, 2.7, wingSection(2.7, 0.2, 0.2).y0 - 0.09, WING.le + 0.15);
      add(pit, new THREE.BoxGeometry(0.012, 0.08, 0.03), M.steelDark, 0, 0.04, 0);
      add(pit, new THREE.CylinderGeometry(0.008, 0.008, 0.28, 10), M.chrome, 0, 0, -0.1, PI / 2, 0, 0);
      const ll = lightMat(0xfff4d8);
      add(w, new THREE.CircleGeometry(0.06, 20), ll, 2.05, wingSection(2.05, 0, 0).y0 - 0.01, WING.le - 0.002, 0, PI, 0);
      H.lights.landing = ll;
      H.lights.taxi = ll;
    }
  }

  // ------------------------------------------------------------ tail
  // Horizontal stabilizer (symmetric airfoil) with a straight elevator hinge line
  const HZ = { y: 0.2, rootLe: 5.02, rootChord: 1.08, tipLe: 5.33, tipChord: 0.77, half: 1.72, hinge: 5.72 };
  const stabSec = (x, x0, x1) => {
    const t = x / HZ.half; const le = HZ.rootLe + (HZ.tipLe - HZ.rootLe) * t, ch = HZ.rootChord + (HZ.tipChord - HZ.rootChord) * t;
    const hf = (HZ.hinge - le) / ch;
    const a = x0 === 'h' ? hf : x0, b = x1 === 'h' ? hf : x1;
    return airfoil(0, 0.4, 0.11, a, b, 12).map(([cx, cy]) => [x, HZ.y + cy * ch, le + cx * ch]);
  };
  const elevator = group(root, 0, HZ.y, HZ.hinge);
  H.elevator = elevator;
  for (const side of [-1, 1]) {
    const st = orientOutward(loft(span(0.1, HZ.half, 8).map(x => stabSec(x, 0, 'h')), { capEnd: true }));
    const el = orientOutward(loft(span(0.12, HZ.half - 0.02, 8).map(x => stabSec(x, 'h', 1)), { capStart: true, capEnd: true }));
    el.translate(0, -HZ.y, -HZ.hinge);
    const g1 = group(root); g1.scale.x = side;
    add(g1, st, side < 0 ? flipMat(M.paint) : M.paint);
    const g2 = group(elevator); g2.scale.x = side;
    add(g2, el, side < 0 ? flipMat(M.paint) : M.paint);
  }
  // Trim tab on the right elevator
  const trimTab = group(elevator, 0.55, 0, 0.3);
  H.trimTab = trimTab;
  add(trimTab, new THREE.BoxGeometry(0.62, 0.012, 0.09), M.paint, 0, 0, 0.045);
  // Vertical fin and rudder
  const VF = { rootY: 0.24, topY: 1.56, rootLe: 4.72, rootChord: 1.36, tipLe: 5.52, tipChord: 0.58, hinge: 5.74 };
  const finSec = (y, x0, x1) => {
    const t = (y - VF.rootY) / (VF.topY - VF.rootY);
    const le = VF.rootLe + (VF.tipLe - VF.rootLe) * t, ch = VF.rootChord + (VF.tipChord - VF.rootChord) * t;
    const hf = (VF.hinge - le) / ch;
    const a = x0 === 'h' ? hf : x0, b = x1 === 'h' ? hf : x1;
    return airfoil(0, 0.4, 0.1, a, b, 12).map(([cx, cy]) => [cy * ch, y, le + cx * ch]);
  };
  add(root, orientOutward(loft(span(VF.rootY, VF.topY, 8).map(y => finSec(y, 0, 'h')), { capEnd: true })), M.paint);
  const rudder = group(root, 0, 0, VF.hinge);
  H.rudder = rudder;
  const rg = loft(span(VF.rootY - 0.1, VF.topY + 0.04, 8).map(y => finSec(Math.min(y, VF.topY), 'h', 1)), { capStart: true, capEnd: true });
  rg.translate(0, 0, -VF.hinge);
  add(rudder, orientOutward(rg), M.paint);
  // Dorsal fin fillet
  {
    const s = new THREE.Shape(); s.moveTo(3.7, 0.5); s.lineTo(4.8, 0.36); s.lineTo(4.95, 0.62); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.015, bevelSegments: 2 });
    g.rotateY(-PI / 2); g.translate(0.025, 0, 0);
    add(root, g, M.paint);
  }
  // Beacon on top of the fin, white tail light at the rudder
  const beaconMat = lightMat(0xff1a00);
  add(root, new THREE.CylinderGeometry(0.03, 0.035, 0.06, 16), beaconMat, 0, VF.topY + 0.05, VF.tipLe + 0.25);
  H.lights.beacon = beaconMat;
  const tailMat = lightMat(0xffffff);
  add(rudder, new THREE.SphereGeometry(0.02, 10, 8), tailMat, 0, 0.6, 6.12 - VF.hinge);
  H.lights.tail = tailMat;

  // ------------------------------------------------------------ antennas
  add(root, new THREE.BoxGeometry(0.008, 0.2, 0.08), M.black, 0, 1.12, 1.55, -0.3, 0, 0);
  for (const s of [-1, 1]) add(root, new THREE.CylinderGeometry(0.004, 0.004, 0.6, 6), M.black, s * 0.18, 0.75, 5.0, 0, 0, -s * 1.1);

  // ------------------------------------------------------------ landing gear
  const tireGeo = lathe([[0.1, -0.075], [0.17, -0.07], [0.19, -0.03], [0.19, 0.03], [0.17, 0.07], [0.1, 0.075]].map(([r, z]) => [r, z]), 32);
  tireGeo.rotateY(PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.13, 24); hubGeo.rotateZ(PI / 2);
  const pantGeo = (() => {
    const g = lathe([[0, -0.62], [0.06, -0.58], [0.11, -0.45], [0.14, -0.25], [0.15, 0.0], [0.13, 0.25], [0.08, 0.42], [0.0, 0.48]], 24);
    g.scale(0.62, 1.15, 1);
    return g;
  })();
  H.wheels = [];
  const wheel = (x, yAxle, z, scale, isNose) => {
    const susp = group(root, 0, 0, 0);    // moves up as the gear compresses
    const steer = group(susp, x, yAxle, z);
    const spinG = group(steer);
    add(spinG, tireGeo, M.rubber).scale.setScalar(scale);
    add(spinG, hubGeo, M.hub).scale.setScalar(scale);
    // Speed fairing around the wheel
    const pant = add(steer, pantGeo, M.paint, isNose ? 0 : Math.sign(x) * 0.0, 0.03, -0.02);
    pant.scale.multiplyScalar(isNose ? 0.92 : 1);
    H.wheels.push({ susp, steer, spin: spinG, r: 0.19 * scale });
    return { susp, steer };
  };
  // Main gear: tapered spring-steel legs
  for (const s of [-1, 1]) {
    const { susp } = wheel(s * 1.27, -1.01, 1.05, 1, false);
    const a = new THREE.Vector3(s * 0.52, -0.6, 1.05), b = new THREE.Vector3(s * 1.2, -1.0, 1.05);
    const leg = new THREE.BoxGeometry(0.06, a.distanceTo(b), 0.035);
    const lm = add(root, leg, M.paint, (a.x + b.x) / 2, (a.y + b.y) / 2, a.z);
    lm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    if (s < 0) add(root, new THREE.BoxGeometry(0.12, 0.012, 0.08), M.steelDark, -0.85, -0.79, 0.88); // boarding step
  }
  // Nose gear: oleo strut, torque link and fork
  {
    const { susp, steer } = wheel(0, -1.02, -0.6, 0.9, true);
    add(root, new THREE.CylinderGeometry(0.04, 0.045, 0.22, 16), M.paint, 0, -0.72, -0.62);
    const ole = add(steer, new THREE.CylinderGeometry(0.028, 0.028, 0.26, 16), M.chrome, 0, 0.2, 0.0);
    add(steer, new THREE.BoxGeometry(0.2, 0.03, 0.05), M.steelDark, 0, 0.1, 0);
    H.noseSteer = steer;
  }

  // ------------------------------------------------------------ doors: handles and seams are painted; add handles
  for (const s of [-1, 1]) add(root, new THREE.BoxGeometry(0.01, 0.025, 0.1), M.chrome, s * 0.622, 0.18, 0.75);

  // ------------------------------------------------------------ tie-down chocks (shown when parked)
  const chocks = group(root);
  for (const s of [-1, 1]) for (const dz of [-0.26, 0.26]) {
    const c = new THREE.Shape(); c.moveTo(-0.08, 0); c.lineTo(0.08, 0); c.lineTo(0.0, 0.09); c.closePath();
    const g = new THREE.ExtrudeGeometry(c, { depth: 0.22, bevelEnabled: false }); g.rotateY(PI / 2); g.translate(-0.11, 0, 0);
    add(chocks, g, std({ color: 0xffc400, roughness: 0.7 }), s * 1.27, -1.15, 1.05 + dz);
  }
  H.chocks = chocks;

  // Shadow and depth settings for everything outside
  root.traverse(o => { if (o.isMesh && o.material !== M.glass && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; } });
  disc.castShadow = false;

  // Animate moving parts. s: fdm state, c: cockpit control state, dt: seconds
  H.update = (fs, c, dt, simLights) => {
    const D = PI / 180;
    // Linked to the controls (yoke etc.) directly so they move even on the ground
    H.ailL.rotation.x = c.yokeRoll * 18 * D;
    H.ailR.rotation.x = -c.yokeRoll * 18 * D;
    const fl = (fs ? fs.flaps : c.flaps || 0) * D;
    H.flapL.rotation.x = fl; H.flapR.rotation.x = fl;
    H.elevator.rotation.x = -c.yokePitch * (c.yokePitch > 0 ? 25 : 20) * D;
    H.trimTab.rotation.x = (c.trim - 0.2) * 22 * D;
    H.rudder.rotation.y = c.rudder * 17 * D;
    H.noseSteer.rotation.y = -c.rudder * 10 * D;
    const rpm = fs ? fs.rpm : 0;
    H.prop.rotation.z -= rpm / 60 * PI * 2 * dt;
    const blur = THREE.MathUtils.clamp((rpm - 250) / 600, 0, 1);
    H.propBlades.visible = blur < 0.98;
    H.propBlades.children.forEach(m => { if (m.material.transparent !== true) { /* keep */ } });
    H.propDisc.material.opacity = blur * 0.22;
    if (fs) {
      fs.gearComp.forEach((cmp, i) => { const w = H.wheels[i === 0 ? 2 : i - 1]; if (w) w.susp.position.y = cmp; });
      H.wheels[2].spin.rotation.x = -fs.wheelRot[0]; H.wheels[0].spin.rotation.x = -fs.wheelRot[1]; H.wheels[1].spin.rotation.x = -fs.wheelRot[2];
    }
    const L = simLights || {};
    H.lights.navL.emissiveIntensity = H.lights.navR.emissiveIntensity = H.lights.tail.emissiveIntensity = L.nav ? 3 : 0;
    H.lights.beacon.emissiveIntensity = L.beacon ? 4 : 0;
    H.lights.strobes.forEach(m => { m.emissiveIntensity = L.strobe ? 8 : 0; });
    H.lights.landing.emissiveIntensity = L.landing ? 4 : 0;
  };
  return { root, H };
}

// Mirrored geometry (scale.x = -1) needs its faces drawn from the other side.
const flipCache = new Map();
function flipMat(m) { return m; } // three.js already reverses culling for mirrored (negative scale) meshes

// Paint scheme: white with a dark blue and gold stripe and the registration on the tail cone.
function liveryCanvas() {
  const W = 2048, Hh = 512;
  const c = G.canvas(W, Hh), ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f4f2'; ctx.fillRect(0, 0, W, Hh);
  const toPx = (z, y, right) => {
    const along = (z + 2.0) / 8.2;
    const u = right ? 0.5 + (1 - along) * 0.5 : along * 0.5;
    return [u * W, (1 - (y + 0.8) / 2.0) * Hh];
  };
  for (const right of [false, true]) {
    const stripe = (yOf, h, color) => {
      ctx.fillStyle = color; ctx.beginPath();
      for (let z = -2.0; z <= 6.2; z += 0.1) { const [x, y] = toPx(z, yOf(z), right); z === -2.0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      for (let z = 6.2; z >= -2.0; z -= 0.1) { const [x, y] = toPx(z, yOf(z) - h, right); ctx.lineTo(x, y); }
      ctx.closePath(); ctx.fill();
    };
    // Main stripe low on the cowling and cabin, sweeping up toward the tail
    const base = (z) => z < 2.0 ? -0.22 : -0.22 + (z - 2.0) * 0.085;
    stripe(base, 0.11, '#1c2f5c');
    stripe((z) => base(z) - 0.135, 0.025, '#c7a14a');
    // Door seams
    ctx.strokeStyle = 'rgba(60,60,60,0.55)'; ctx.lineWidth = 2;
    for (const z of [-0.1, 0.98]) { const [x0, y0] = toPx(z, 0.27, right), [x1, y1] = toPx(z, -0.6, right); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
    { const [x0, y0] = toPx(-0.1, -0.6, right), [x1] = toPx(0.98, -0.6, right); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke(); }
    // Cowling panel line
    { const [x0, y0] = toPx(-0.47, 0.45, right), [, y1] = toPx(-0.47, -0.7, right); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke(); }
    // Registration (fictional), reading front to back on both sides
    const [rx, ry] = toPx(right ? 4.75 : 3.25, 0.2, right);
    ctx.save();
    ctx.fillStyle = '#1c2f5c';
    ctx.font = 'bold 52px "Helvetica Neue", Arial, sans-serif';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText('N172CC', rx, ry);
    ctx.restore();
  }
  return c;
}
