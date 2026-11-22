// Builds the whole cockpit from code. Units are meters.
// Axes: +x toward the right (copilot) side, +y up, +z aft (toward the pilot).
// The instrument panel face is the plane z = 0, centered on the aircraft centerline.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as G from './gauges.js';

const PI = Math.PI;

export function buildCockpit() {
  const root = new THREE.Group();
  const parts = {};          // component id -> [Object3D]
  const H = { needles: {}, knobs: {}, switches: {}, displays: {}, glowMats: [] };

  const reg = (id, obj) => {
    obj.userData.cid = id;
    (parts[id] ||= []).push(obj);
    return obj;
  };

  // ---------------------------------------------------------------- materials
  const fine = G.noiseTexture(512, 2, 3); fine.repeat.set(6, 6);
  const coarse = G.noiseTexture(512, 1, 7); coarse.repeat.set(3, 3);
  const fabricN = G.noiseTexture(256, 4, 11); fabricN.repeat.set(8, 8);
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const phys = (o) => new THREE.MeshPhysicalMaterial(o);
  const M = {
    panel: std({ color: 0x2c2e32, roughness: 0.78, metalness: 0.1, bumpMap: fine, bumpScale: 1.2 }),
    panelEdge: std({ color: 0x1d1e21, roughness: 0.7 }),
    glare: std({ color: 0x141416, roughness: 0.92, bumpMap: coarse, bumpScale: 2.5 }),
    black: phys({ color: 0x0d0d0e, roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.4 }),
    satin: std({ color: 0x1a1b1d, roughness: 0.55, metalness: 0.2 }),
    bezel: std({ color: 0x0f1011, roughness: 0.38, metalness: 0.3 }),
    recess: std({ color: 0x050505, roughness: 1 }),
    chrome: std({ color: 0xf0f0f0, roughness: 0.12, metalness: 1 }),
    steel: std({ color: 0xaab0b5, roughness: 0.35, metalness: 1 }),
    screw: std({ color: 0x8a8d90, roughness: 0.4, metalness: 0.9 }),
    red: phys({ color: 0xb3120f, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
    white: phys({ color: 0xe9e7e0, roughness: 0.35, clearcoat: 0.4 }),
    grey: phys({ color: 0x6d7074, roughness: 0.45, clearcoat: 0.2 }),
    needle: std({ color: 0xf6f4ec, roughness: 0.4, emissive: 0x222222 }),
    orange: std({ color: 0xff7a12, roughness: 0.45, emissive: 0x3a1600 }),
    glass: phys({ color: 0xffffff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.06,
      envMapIntensity: 0.25, specularIntensity: 0.6, depthWrite: false }),
    windshield: phys({ color: 0xd8f0ff, roughness: 0.02, transparent: true, opacity: 0.07,
      envMapIntensity: 0.6, depthWrite: false, side: THREE.DoubleSide }),
    headliner: std({ color: 0xc9c2b2, roughness: 0.9, bumpMap: coarse, bumpScale: 1 }),
    pedestal: std({ color: 0x3b3a38, roughness: 0.7, bumpMap: fine, bumpScale: 0.6 }),
    trim: std({ color: 0x8f877a, roughness: 0.65, bumpMap: fine, bumpScale: 0.5 }),
    carpet: std({ color: 0x3a3631, roughness: 1, bumpMap: fabricN, bumpScale: 3 }),
    fabric: std({ color: 0x5b5146, roughness: 0.95, bumpMap: fabricN, bumpScale: 3 }),
    leather: std({ color: 0x2a2420, roughness: 0.6, bumpMap: coarse, bumpScale: 1.5 }),
    paintWhite: phys({ color: 0xf3f3f0, roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.1 }),
    paintStripe: phys({ color: 0x1f3e7a, roughness: 0.3, clearcoat: 0.8 }),
    rubber: std({ color: 0x151515, roughness: 0.85 }),
    firewall: std({ color: 0x24221f, roughness: 0.9 }),
    amberLens: std({ color: 0x331a00, emissive: 0x000000, roughness: 0.2 }),
    redLens: std({ color: 0x330000, emissive: 0x000000, roughness: 0.2 }),
  };
  H.M = M;

  // ---------------------------------------------------------------- helpers
  const add = (parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    if (geo.userData.double) mat = dbl(mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const dblCache = new Map();
  const dbl = (mat) => {
    if (mat.side === THREE.DoubleSide) return mat;
    if (!dblCache.has(mat)) { const c = mat.clone(); c.side = THREE.DoubleSide; dblCache.set(mat, c); }
    return dblCache.get(mat);
  };
  const group = (parent, x = 0, y = 0, z = 0) => {
    const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g;
  };
  // A lathe whose axis is +z (points toward the pilot). profile: [[radius, z], ...]
  const lathe = (profile, segs = 48) => {
    const g = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), segs);
    g.rotateX(PI / 2);
    g.userData.double = true;
    return g;
  };
  const cylZ = (r, len, segs = 32, r2 = r) => {
    const g = new THREE.CylinderGeometry(r2, r, len, segs);
    g.rotateX(PI / 2);
    g.translate(0, 0, len / 2);
    return g;
  };
  const noRay = (m) => { m.raycast = () => {}; return m; };
  // Text plane on (or parallel to) a surface.
  const label = (parent, lines, x, y, w, h, opts = {}) => {
    const t = G.tex(G.placard(lines, { w: opts.pw || 512, h: Math.round((opts.pw || 512) * h / w), size: opts.size || 60, color: opts.color, bg: opts.bg, weight: opts.weight }));
    const mat = new THREE.MeshStandardMaterial({ map: t, transparent: !opts.bg, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: !!opts.bg });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, opts.z ?? 0.0006);
    if (opts.rot) m.rotation.set(...opts.rot);
    m.receiveShadow = true;
    noRay(m);
    parent.add(m);
    return m;
  };
  const texPlane = (parent, canvasEl, w, h, x, y, z, opts = {}) => {
    const t = G.tex(canvasEl);
    const mat = new THREE.MeshStandardMaterial({ map: t, transparent: !!opts.transparent, roughness: opts.rough ?? 0.55,
      emissive: opts.emissive ? 0xffffff : 0x000000, emissiveMap: opts.emissive ? t : null, emissiveIntensity: opts.emissive ? 0 : 1,
      polygonOffset: true, polygonOffsetFactor: -1, depthWrite: !opts.transparent });
    if (opts.emissive) H.glowMats.push(mat);
    const geo = opts.circle ? new THREE.CircleGeometry(w / 2, 96) : new THREE.PlaneGeometry(w, h);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // Tapered instrument pointer pointing along +y.
  const needleGeo = (len, tail = 0.18, w = 0.06, tip = 0.012) => {
    const s = new THREE.Shape();
    s.moveTo(-w * 0.35, -tail);
    s.lineTo(w * 0.35, -tail);
    s.lineTo(w * 0.5, 0);
    s.lineTo(tip, len * 0.92);
    s.lineTo(0, len);
    s.lineTo(-tip, len * 0.92);
    s.lineTo(-w * 0.5, 0);
    s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: 0.0007, bevelEnabled: false });
  };
  const makeNeedle = (parent, r, opts = {}) => {
    const pivot = group(parent, opts.x || 0, opts.y || 0, opts.z ?? -0.0085);
    const geo = needleGeo(r * (opts.len ?? 0.86), r * (opts.tail ?? 0.2), r * (opts.w ?? 0.08), r * (opts.tip ?? 0.012));
    add(pivot, geo, opts.mat || M.needle);
    if (!opts.noHub) add(pivot, cylZ(r * 0.09, 0.0018, 24), M.black, 0, 0, 0.0005);
    return pivot;
  };

  // ---------------------------------------------------------------- layout
  const GAUGES = [
    { id: 'clock', x: -0.468, y: 0.300, r: 0.030 },
    { id: 'asi', x: -0.374, y: 0.300, r: 0.040 },
    { id: 'ai', x: -0.280, y: 0.300, r: 0.040 },
    { id: 'alt', x: -0.186, y: 0.300, r: 0.040 },
    { id: 'suction', x: -0.468, y: 0.206, r: 0.030 },
    { id: 'tc', x: -0.374, y: 0.206, r: 0.040 },
    { id: 'hi', x: -0.280, y: 0.206, r: 0.040 },
    { id: 'vsi', x: -0.186, y: 0.206, r: 0.040 },
    { id: 'vor1', x: -0.078, y: 0.300, r: 0.040 },
    { id: 'vor2', x: -0.078, y: 0.206, r: 0.040 },
    { id: 'tach', x: -0.180, y: 0.110, r: 0.037 },
    { id: 'ammeter', x: -0.078, y: 0.112, r: 0.027 },
    { id: 'egt', x: 0.250, y: 0.215, r: 0.026 },
  ];
  const STACK = { x0: 0.02, x1: 0.18, y0: 0.085, y1: 0.378 };
  const CLUSTER = { x0: -0.537, x1: -0.353, y0: 0.074, y1: 0.152 };
  const GLOVE = { x0: 0.33, x1: 0.54, y0: 0.085, y1: 0.205 };
  const YOKE_Y = 0.138;
  const YOKES = [-0.28, 0.28];

  // ---------------------------------------------------------------- panel
  const panel = group(root);
  {
    const W = 0.56, top = 0.40, bot = -0.05, rr = 0.025;
    const s = new THREE.Shape();
    s.moveTo(-W + rr, bot);
    s.lineTo(W - rr, bot); s.quadraticCurveTo(W, bot, W, bot + rr);
    s.lineTo(W, top);
    s.lineTo(-W, top);
    s.lineTo(-W, bot + rr); s.quadraticCurveTo(-W, bot, -W + rr, bot);
    const hole = (x, y, r) => { const p = new THREE.Path(); p.absarc(x, y, r, 0, PI * 2, true); s.holes.push(p); };
    const rect = (x0, y0, x1, y1) => { const p = new THREE.Path(); p.moveTo(x0, y0); p.lineTo(x0, y1); p.lineTo(x1, y1); p.lineTo(x1, y0); p.closePath(); s.holes.push(p); };
    for (const g of GAUGES) hole(g.x, g.y, g.r);
    rect(STACK.x0, STACK.y0, STACK.x1, STACK.y1);
    rect(CLUSTER.x0, CLUSTER.y0, CLUSTER.x1, CLUSTER.y1);
    for (const x of YOKES) hole(x, YOKE_Y, 0.017);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 48 });
    geo.translate(0, 0, -0.010);
    // UVs from ExtrudeGeometry are in meters; scale up so the wrinkle paint is fine-grained.
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * 4);
    add(panel, geo, M.panel);
    // Back plate behind the panel so the holes do not look into empty space.
    add(panel, new THREE.PlaneGeometry(1.2, 0.5), M.recess, 0, 0.17, -0.06);
    // Lower lip (knee roll)
    const lip = new THREE.CylinderGeometry(0.012, 0.012, 1.1, 24); lip.rotateZ(PI / 2);
    add(panel, lip, M.panelEdge, 0, -0.05, -0.004);
  }

  // ---------------------------------------------------------------- glareshield
  {
    const gs = group(root);
    reg('glareshield', gs);
    const top = new RoundedBoxGeometry(1.16, 0.03, 0.36, 3, 0.012);
    add(gs, top, M.glare, 0, 0.412, -0.15);
    const lip = new THREE.CylinderGeometry(0.026, 0.026, 1.16, 32, 1, false, 0, PI * 1.15); lip.rotateZ(PI / 2);
    add(gs, lip, M.glare, 0, 0.402, 0.0, -PI * 0.08, 0, 0);
    // Front edge where the windshield meets
    add(gs, new THREE.BoxGeometry(1.14, 0.02, 0.03), M.rubber, 0, 0.42, -0.32);
  }

  // ---------------------------------------------------------------- instruments
  const screwGeo = lathe([[0, 0.0016], [0.0022, 0.0014], [0.0028, 0.0006], [0.0028, 0]], 16);
  // Neighboring instruments share mounting screws, so skip a screw if one is already close by.
  const screwSpots = [];
  const screw = (parent, x, y) => {
    parent.updateWorldMatrix(true, false);
    const wp = parent.localToWorld(new THREE.Vector3(x, y, 0));
    if (screwSpots.some(p => p.distanceTo(wp) < 0.012)) return null;
    screwSpots.push(wp);
    const s = add(parent, screwGeo, M.screw, x, y, 0.0002);
    add(parent, new THREE.BoxGeometry(0.0045, 0.0007, 0.0008), M.recess, x, y, 0.0016, 0, 0, Math.random() * PI);
    return s;
  };

  function instrument(g, faceCanvas, opts = {}) {
    const grp = group(panel, g.x, g.y, 0);
    reg(g.id, grp);
    const r = g.r;
    // Recess tube
    const tube = new THREE.CylinderGeometry(r, r, 0.03, 48, 1, true); tube.rotateX(PI / 2);
    add(grp, tube, M.recess, 0, 0, -0.015).material = new THREE.MeshStandardMaterial({ color: 0x070707, roughness: 1, side: THREE.BackSide });
    // Face
    const face = texPlane(grp, faceCanvas, r * 2, r * 2, 0, 0, -0.012, { circle: true, emissive: true, rough: 0.7 });
    // Bezel ring
    add(grp, lathe([[r - 0.0012, -0.004], [r - 0.0012, 0.0025], [r + 0.001, 0.0045], [r + 0.0045, 0.0035], [r + 0.0055, 0]], 64), M.bezel);
    // Glass
    const glass = add(grp, new THREE.CircleGeometry(r - 0.001, 64), M.glass, 0, 0, -0.0035);
    glass.castShadow = false; noRay(glass);
    // Mounting screws at the corners of the square case
    if (!opts.noScrews) {
      const k = r * 1.08;
      for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) screw(grp, sx * k, sy * k);
    }
    return { grp, face, r };
  }

  const byId = Object.fromEntries(GAUGES.map(g => [g.id, g]));

  // Airspeed
  {
    const g = instrument(byId.asi, G.asiFace());
    H.needles.asi = makeNeedle(g.grp, g.r, { len: 0.9 });
  }
  // Altimeter with three hands and a setting knob
  {
    const g = instrument(byId.alt, G.altFace(29.92));
    H.altFace = g.face;
    H.redrawAlt = (baro) => { const m = g.face.material; m.map.image = G.altFace(baro); m.map.needsUpdate = true; };
    H.needles.alt10k = makeNeedle(g.grp, g.r, { len: 0.95, w: 0.025, tail: 0.05, z: -0.0095, noHub: true });
    H.needles.alt1k = makeNeedle(g.grp, g.r, { len: 0.55, w: 0.14, tip: 0.04, z: -0.009, noHub: true });
    H.needles.alt100 = makeNeedle(g.grp, g.r, { len: 0.88, w: 0.08, z: -0.0085 });
    const k = group(panel, byId.alt.x - 0.036, byId.alt.y - 0.036, 0);
    reg('alt_knob', k);
    H.knobs.alt_knob = smallKnob(k, 0.0085, 0.012, M.black);
  }
  // Vertical speed
  {
    const g = instrument(byId.vsi, G.vsiFace());
    H.needles.vsi = makeNeedle(g.grp, g.r, { len: 0.9 });
  }
  // Attitude indicator
  {
    const g = instrument(byId.ai, G.canvas(4), { });
    g.face.visible = false;
    const ai = G.makeAI();
    const ballMat = new THREE.MeshStandardMaterial({ map: ai.texture, roughness: 0.5, emissive: 0xffffff, emissiveMap: ai.texture, emissiveIntensity: 0 });
    H.glowMats.push(ballMat);
    const ball = new THREE.Mesh(new THREE.CircleGeometry(g.r * 0.98, 96), ballMat);
    ball.position.z = -0.012; g.grp.add(ball);
    const ring = new THREE.Mesh(new THREE.CircleGeometry(g.r * 0.98, 64), new THREE.MeshStandardMaterial({ map: ai.ringTexture, transparent: true, depthWrite: false, roughness: 0.6 }));
    ring.position.z = 0.0004; ball.add(ring);
    const mask = texPlane(g.grp, G.aiMask(), g.r * 2, g.r * 2, 0, 0, -0.0095, { circle: true, transparent: true });
    mask.material.alphaTest = 0.1;
    // Fixed miniature airplane (orange)
    const plane = group(g.grp, 0, 0, -0.007);
    add(plane, new THREE.BoxGeometry(g.r * 0.55, g.r * 0.05, 0.0015), M.orange, -g.r * 0.45, 0, 0);
    add(plane, new THREE.BoxGeometry(g.r * 0.55, g.r * 0.05, 0.0015), M.orange, g.r * 0.45, 0, 0);
    add(plane, new THREE.SphereGeometry(g.r * 0.05, 16, 8), M.orange);
    const stem = add(g.grp, new THREE.BoxGeometry(g.r * 0.06, g.r * 0.5, 0.001), M.orange, 0, -g.r * 0.68, -0.0075);
    stem.userData.keep = true;
    H.ai = { ball, draw: ai.draw, plane };
    const k = group(panel, byId.ai.x, byId.ai.y - 0.031, 0.0);
    reg('ai_knob', k);
    H.knobs.ai_knob = smallKnob(k, 0.006, 0.008, M.black);
  }
  // Heading indicator: rotating card, fixed lubber line and airplane, two knobs
  {
    const g = instrument(byId.hi, G.canvas(4));
    g.face.visible = false;
    const cardMat = new THREE.MeshStandardMaterial({ map: G.tex(G.hiCard()), roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0 });
    cardMat.emissiveMap = cardMat.map; H.glowMats.push(cardMat);
    const card = new THREE.Mesh(new THREE.CircleGeometry(g.r * 0.98, 96), cardMat);
    card.position.z = -0.012; g.grp.add(card);
    // Heading bug on the card edge
    const bug = group(g.grp, 0, 0, -0.0105);
    add(bug, new THREE.BoxGeometry(g.r * 0.16, g.r * 0.07, 0.001), M.orange, 0, g.r * 0.9, 0);
    // Fixed aircraft symbol
    const sym = new THREE.Shape();
    const s = g.r;
    sym.moveTo(0, 0.55 * s); sym.lineTo(0.05 * s, 0.35 * s); sym.lineTo(0.05 * s, 0.1 * s); sym.lineTo(0.42 * s, -0.02 * s);
    sym.lineTo(0.42 * s, -0.1 * s); sym.lineTo(0.05 * s, -0.05 * s); sym.lineTo(0.04 * s, -0.32 * s); sym.lineTo(0.16 * s, -0.42 * s);
    sym.lineTo(0.16 * s, -0.48 * s); sym.lineTo(-0.16 * s, -0.48 * s); sym.lineTo(-0.16 * s, -0.42 * s); sym.lineTo(-0.04 * s, -0.32 * s);
    sym.lineTo(-0.05 * s, -0.05 * s); sym.lineTo(-0.42 * s, -0.1 * s); sym.lineTo(-0.42 * s, -0.02 * s); sym.lineTo(-0.05 * s, 0.1 * s);
    sym.lineTo(-0.05 * s, 0.35 * s); sym.closePath();
    add(g.grp, new THREE.ShapeGeometry(sym), M.orange, 0, 0, -0.008);
    // Lubber lines
    for (const d of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const lb = group(g.grp, 0, 0, -0.0078); lb.rotation.z = -d * PI / 180;
      add(lb, new THREE.BoxGeometry(d === 0 ? 0.0022 : 0.0012, g.r * 0.14, 0.0006), d === 0 ? M.orange : M.needle, 0, g.r * 0.93, 0);
    }
    H.hi = { card, bug };
    const k1 = group(panel, byId.hi.x - 0.035, byId.hi.y - 0.035, 0); reg('hi_knob', k1);
    H.knobs.hi_knob = smallKnob(k1, 0.0075, 0.011, M.black);
    const k2 = group(panel, byId.hi.x + 0.035, byId.hi.y - 0.035, 0); reg('hdgbug_knob', k2);
    H.knobs.hdgbug_knob = smallKnob(k2, 0.0075, 0.011, M.orange);
  }
  // Turn coordinator
  {
    const g = instrument(byId.tc, G.tcFace());
    const r = g.r;
    const pl = group(g.grp, 0, 0, -0.009);
    add(pl, new THREE.BoxGeometry(r * 1.45, r * 0.07, 0.001), M.needle, 0, 0, 0);
    add(pl, new THREE.CircleGeometry(r * 0.14, 32), M.needle, 0, 0, 0.0006);
    add(pl, new THREE.BoxGeometry(r * 0.05, r * 0.2, 0.001), M.needle, 0, r * 0.16, 0);
    add(pl, new THREE.BoxGeometry(r * 0.32, r * 0.05, 0.001), M.needle, 0, -r * 0.14, 0);
    const ball = add(g.grp, new THREE.SphereGeometry(r * 0.075, 20, 12), M.black, 0, -r * 0.6, -0.0105);
    H.tc = { plane: pl, ball, r };
  }
  // Tachometer
  {
    const g = instrument(byId.tach, G.tachFace());
    H.needles.tach = makeNeedle(g.grp, g.r, { len: 0.9 });
  }
  // Small gauges
  {
    let g = instrument(byId.suction, G.suctionFace());
    H.needles.suction = makeNeedle(g.grp, g.r, { len: 0.86 });
    g = instrument(byId.ammeter, G.ammeterFace());
    H.needles.ammeter = makeNeedle(g.grp, g.r, { len: 0.86 });
    g = instrument(byId.egt, G.egtFace());
    H.needles.egt = makeNeedle(g.grp, g.r, { len: 0.86 });
    H.needles.egtRef = makeNeedle(g.grp, g.r, { len: 0.86, w: 0.05, mat: M.orange, z: -0.009, noHub: true });
    g = instrument(byId.clock, G.clockFace());
    H.needles.clockH = makeNeedle(g.grp, g.r, { len: 0.55, w: 0.1, z: -0.0095, noHub: true });
    H.needles.clockM = makeNeedle(g.grp, g.r, { len: 0.85, w: 0.08, z: -0.009, noHub: true });
    H.needles.clockS = makeNeedle(g.grp, g.r, { len: 0.88, w: 0.03, mat: M.orange, z: -0.0085 });
  }
  // VOR indicators
  for (const [id, obs, gs] of [['vor1', 'obs1', true], ['vor2', 'obs2', false]]) {
    const g = instrument(byId[id], G.vorFace(gs));
    const r = g.r;
    const cardMat = new THREE.MeshStandardMaterial({ map: G.tex(G.vorCard()), transparent: true, roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0, depthWrite: false });
    cardMat.emissiveMap = cardMat.map; H.glowMats.push(cardMat);
    const card = new THREE.Mesh(new THREE.CircleGeometry(r * 0.99, 96), cardMat);
    card.position.z = -0.011; g.grp.add(card);
    // Course index triangle at top
    const tri = new THREE.Shape(); tri.moveTo(0, r * 0.72); tri.lineTo(-r * 0.07, r * 0.84); tri.lineTo(r * 0.07, r * 0.84); tri.closePath();
    add(g.grp, new THREE.ShapeGeometry(tri), M.orange, 0, 0, -0.0095);
    // CDI needle: hinged at the top, swings left/right
    const cdi = group(g.grp, 0, r * 0.66, -0.0088);
    add(cdi, new THREE.BoxGeometry(r * 0.045, r * 1.2, 0.0008), M.needle, 0, -r * 0.6, 0);
    let gsN = null;
    if (gs) {
      gsN = group(g.grp, -r * 0.66, 0, -0.0083);
      add(gsN, new THREE.BoxGeometry(r * 1.2, r * 0.045, 0.0008), M.needle, r * 0.6, 0, 0);
    }
    // TO/FROM flag (triangle) in the window
    const flag = add(g.grp, new THREE.ShapeGeometry((() => { const f = new THREE.Shape(); f.moveTo(0, r * 0.06); f.lineTo(-r * 0.07, -r * 0.05); f.lineTo(r * 0.07, -r * 0.05); f.closePath(); return f; })()), M.needle, r * 0.17, r * 0.31, -0.0092);
    H[id] = { card, cdi, gs: gsN, flag };
    const k = group(panel, byId[id].x - 0.036, byId[id].y - 0.036, 0); reg(obs, k);
    H.knobs[obs] = smallKnob(k, 0.0085, 0.012, M.black);
  }

  // Engine cluster: four small gauges in one case
  {
    const c = CLUSTER, w = c.x1 - c.x0, h = c.y1 - c.y0;
    const cg = group(panel, (c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2, 0);
    texPlane(cg, G.clusterPlate(), w, h, 0, 0, -0.012, { emissive: true });
    // Bezel frame around the case
    for (const [fx, fy, fw, fh] of [[0, h / 2 + 0.002, w + 0.012, 0.006], [0, -h / 2 - 0.002, w + 0.012, 0.006], [w / 2 + 0.003, 0, 0.006, h + 0.01], [-w / 2 - 0.003, 0, 0.006, h + 0.01]])
      add(cg, new RoundedBoxGeometry(fw, fh, 0.005, 2, 0.0015), M.bezel, fx, fy, 0.0005);
    const glass = add(cg, new THREE.PlaneGeometry(w, h), M.glass, 0, 0, 0.0018); noRay(glass); glass.castShadow = false;
    const kinds = ['fuel', 'fuel', 'oilt', 'oilp'];
    const fuel = group(cg), oil = group(cg);
    reg('fuelqty', fuel); reg('oilgauges', oil);
    // Hit target for each pair so clicks register on the face
    kinds.forEach((k, i) => {
      const x = -w / 2 + (i + 0.5) * w / 4, y = 0.006;
      const parent = i < 2 ? fuel : oil;
      const dial = texPlane(parent, G.clusterFace(k), 0.04, 0.04, x, y, -0.0115, { circle: true, emissive: true });
      const n = makeNeedle(parent, 0.017, { x, y: y - 0.006, z: -0.0105, len: 0.95, w: 0.12 });
      H.needles[['fuelL', 'fuelR', 'oilT', 'oilP'][i]] = n;
      dial.userData.dummy = true;
    });
    for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) screw(cg, sx * (w / 2 + 0.008), sy * (h / 2 + 0.002));
  }

  function smallKnob(parent, r, len, mat) {
    const k = group(parent, 0, 0, 0);
    add(k, cylZ(r * 0.45, 0.005, 16), M.steel);
    const knob = group(k, 0, 0, 0.004);
    // Knurled knob: ridged cylinder
    const g = new THREE.CylinderGeometry(r, r, len, 48, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), rr = Math.hypot(x, z);
      if (rr > r * 0.9) { const f = 1 + (Math.cos(a * 24) > 0 ? 0.06 : 0); p.setX(i, x * f); p.setZ(i, z * f); }
    }
    g.computeVertexNormals(); g.rotateX(PI / 2); g.translate(0, 0, len / 2);
    add(knob, g, mat);
    add(knob, new THREE.CircleGeometry(r * 0.98, 32), M.satin, 0, 0, len + 0.0002);
    // index line on the face so rotation is visible
    add(knob, new THREE.BoxGeometry(r * 0.15, r * 0.8, 0.0004), M.needle, 0, r * 0.45, len + 0.0005);
    return knob;
  }

  // ---------------------------------------------------------------- avionics stack
  {
    const S = STACK, w = S.x1 - S.x0, cx = (S.x0 + S.x1) / 2;
    const stack = group(panel, cx, 0, 0);
    // Rack interior
    add(stack, new THREE.BoxGeometry(w, S.y1 - S.y0, 0.004), M.recess, 0, (S.y0 + S.y1) / 2, -0.03);

    const unit = (id, y0, y1) => {
      const u = group(stack, 0, (y0 + y1) / 2, 0);
      reg(id, u);
      add(u, new RoundedBoxGeometry(w - 0.002, y1 - y0 - 0.002, 0.02, 2, 0.0025), M.satin, 0, 0, -0.008);
      for (const sx of [-1, 1]) add(u, cylZ(0.0018, 0.001, 10), M.screw, sx * (w / 2 - 0.005), 0, 0.002);
      return u;
    };
    const knobPair = (parent, x, y) => {
      const k = group(parent, x, y, 0.002);
      add(k, cylZ(0.0095, 0.007, 40), M.black);
      add(k, cylZ(0.0065, 0.013, 40), M.black);
      add(k, new THREE.CircleGeometry(0.0063, 32), M.satin, 0, 0, 0.0131);
      return k;
    };
    const button = (parent, x, y, w2 = 0.009, h2 = 0.006, mat = M.grey) => add(parent, new RoundedBoxGeometry(w2, h2, 0.004, 2, 0.001), mat, x, y, 0.004);
    const screenMat = (d) => {
      const m = new THREE.MeshStandardMaterial({ map: d.texture, emissive: 0xffffff, emissiveMap: d.texture, emissiveIntensity: 1.4, roughness: 0.25 });
      return m;
    };

    // Audio panel
    {
      const u = unit('audiopanel', 0.346, 0.378);
      const names = ['COM1', 'COM2', 'NAV1', 'NAV2', 'MKR', 'SPKR'];
      names.forEach((n, i) => {
        const x = -0.058 + i * 0.019;
        button(u, x, 0.002, 0.014, 0.008);
        label(u, n, x, -0.009, 0.018, 0.005, { size: 70, z: 0.0035 });
      });
      H.markers = [];
      [[0x2a4dff, 'O'], [0xffb000, 'M'], [0xffffff, 'I']].forEach(([col, n], i) => {
        const mat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: col, emissiveIntensity: 0, roughness: 0.2 });
        add(u, cylZ(0.0035, 0.003, 20), mat, 0.062, 0.009 - i * 0.008, 0.002);
        H.markers.push(mat);
      });
    }
    // NAV/COM radios
    const navcomRender = (ctx, W2, H2, com, comSb, nav, navSb) => {
      ctx.font = 'bold 90px "Courier New", monospace';
      const amber = '#ffb02e';
      ctx.shadowColor = amber; ctx.shadowBlur = 14;
      ctx.fillStyle = amber; ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(com, 16, H2 / 2); ctx.fillText(comSb, 330, H2 / 2);
      ctx.fillText(nav, 700, H2 / 2); ctx.fillText(navSb, 960, H2 / 2);
      ctx.shadowBlur = 0; ctx.font = 'bold 26px Arial'; ctx.fillStyle = '#c98a24';
      ctx.fillText('USE', 20, 22); ctx.fillText('STBY', 334, 22); ctx.fillText('USE', 704, 22); ctx.fillText('STBY', 964, 22);
    };
    const radios = [['navcom1', 0.287, 0.343, ['121.90', '118.30', '110.50', '113.80']], ['navcom2', 0.229, 0.285, ['124.75', '122.80', '115.70', '108.90']]];
    for (const [id, y0, y1, freqs] of radios) {
      const u = unit(id, y0, y1);
      const d = G.makeDisplay(1280, 160, navcomRender);
      const scr = add(u, new THREE.PlaneGeometry(0.128, 0.016), screenMat(d), 0, 0.009, 0.0025);
      noRay(scr); scr.castShadow = false;
      H.displays[id] = { d, freqs, scr };
      knobPair(u, -0.064, -0.012); knobPair(u, 0.064, -0.012);
      button(u, -0.038, -0.012, 0.01, 0.007); button(u, 0.038, -0.012, 0.01, 0.007);
      label(u, '⇄', -0.038, -0.0035, 0.01, 0.006, { size: 90, z: 0.0035 });
      label(u, '⇄', 0.038, -0.0035, 0.01, 0.006, { size: 90, z: 0.0035 });
      label(u, 'COMM', -0.012, -0.013, 0.02, 0.005, { size: 70, z: 0.0035 });
      label(u, 'NAV', 0.014, -0.013, 0.02, 0.005, { size: 70, z: 0.0035 });
      const vol = group(u, -0.0015, -0.016, 0.002);
      add(vol, cylZ(0.004, 0.008, 24), M.black);
      label(u, id === 'navcom1' ? '1' : '2', 0.0, 0.021, 0.008, 0.006, { size: 80, z: 0.0035, color: '#ccc' });
    }
    // Transponder
    {
      const u = unit('xpdr', 0.180, 0.226);
      const d = G.makeDisplay(512, 128, (ctx, W2, H2, code, mode) => {
        ctx.font = 'bold 96px "Courier New", monospace';
        ctx.fillStyle = '#ffb02e'; ctx.shadowColor = '#ffb02e'; ctx.shadowBlur = 12;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(code, 20, H2 / 2 + 4);
        ctx.font = 'bold 40px Arial'; ctx.fillText(mode, 300, H2 / 2 + 4);
      });
      const scr = add(u, new THREE.PlaneGeometry(0.06, 0.015), screenMat(d), -0.022, 0.006, 0.0025);
      noRay(scr);
      H.displays.xpdr = { d };
      const mode = group(u, -0.064, -0.002, 0.002);
      add(mode, cylZ(0.008, 0.008, 6), M.black);
      label(u, 'OFF SBY ON ALT', -0.064, 0.016, 0.03, 0.005, { size: 46, z: 0.0035 });
      for (let i = 0; i < 4; i++) {
        const kx = 0.022 + i * 0.012;
        add(u, cylZ(0.0045, 0.009, 24), M.black, kx, 0.004, 0.002);
      }
      const ident = button(u, 0.012, -0.013, 0.014, 0.007, M.white);
      H.identBtn = ident;
      label(u, 'IDENT', 0.012, -0.0195, 0.016, 0.005, { size: 70, z: 0.0035 });
      label(u, 'TRANSPONDER', -0.022, -0.014, 0.04, 0.006, { size: 46, z: 0.0035 });
    }
    // Blank plate under the radios
    {
      const plate = group(stack, 0, (0.085 + 0.178) / 2, 0);
      add(plate, new RoundedBoxGeometry(w - 0.002, 0.178 - 0.085 - 0.002, 0.006, 2, 0.002), M.panel, 0, 0, -0.004);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) add(plate, cylZ(0.0018, 0.001, 10), M.screw, sx * (w / 2 - 0.006), sy * 0.04, 0);
    }
  }

  // ---------------------------------------------------------------- rocker switches
  function rocker(parent, x, y, opts = {}) {
    const g = group(parent, x, y, 0);
    add(g, new RoundedBoxGeometry(opts.w || 0.014, 0.026, 0.004, 2, 0.0015), M.black, 0, 0, 0.001);
    const piv = group(g, 0, 0, 0.003);
    const rk = new RoundedBoxGeometry((opts.w || 0.014) - 0.003, 0.022, 0.008, 3, 0.002);
    add(piv, rk, opts.mat || M.grey, 0, 0, 0.002);
    // A white stripe shows on the "ON" (top) half
    add(piv, new THREE.BoxGeometry((opts.w || 0.014) - 0.006, 0.0015, 0.0005), M.needle, 0, 0.007, 0.0062);
    return piv;
  }

  // Master switch (split rocker: ALT left, BAT right)
  {
    const m = group(panel, -0.405, 0.022, 0);
    reg('master', m);
    add(m, new RoundedBoxGeometry(0.03, 0.03, 0.004, 2, 0.002), M.black, 0, 0, 0.001);
    const alt = group(m, -0.0068, 0, 0.003), bat = group(m, 0.0068, 0, 0.003);
    for (const piv of [alt, bat]) add(piv, new RoundedBoxGeometry(0.012, 0.026, 0.009, 3, 0.002), M.red, 0, 0, 0.002);
    label(panel, 'ALT   BAT', -0.405, 0.044, 0.034, 0.006, { size: 70 });
    label(panel, 'MASTER', -0.405, -0.0025, 0.03, 0.006, { size: 70 });
    H.switches.alt = alt; H.switches.bat = bat;
  }
  // Light / pitot switches
  const SW = [['sw_beacon', 'BCN'], ['sw_land', 'LAND'], ['sw_taxi', 'TAXI'], ['sw_nav', 'NAV'], ['sw_strobe', 'STROBE'], ['sw_pitot', 'PITOT HT']];
  SW.forEach(([id, txt], i) => {
    const x = -0.355 + i * 0.034;
    const g = group(panel, x, 0.022, 0);
    reg(id, g);
    H.switches[id] = rocker(g, 0, 0, { mat: M.white });
    label(panel, txt, x, -0.0025, 0.03, 0.006, { size: 70 });
  });
  label(panel, 'OFF ↓   ON ↑', -0.27, 0.044, 0.06, 0.006, { size: 60, color: '#aaa' });
  // Avionics master
  {
    const g = group(panel, 0.25, 0.325, 0);
    reg('avmaster', g);
    H.switches.avmaster = rocker(g, 0, 0, { mat: M.white, w: 0.016 });
    label(panel, ['AVIONICS', 'POWER'], 0.25, 0.293, 0.04, 0.012, { size: 66 });
  }
  // Low-voltage light
  {
    const g = group(panel, -0.42, 0.368, 0);
    reg('lowvolt', g);
    add(g, cylZ(0.0075, 0.004, 32), M.bezel);
    const lensMat = M.redLens;
    add(g, lathe([[0, 0.009], [0.004, 0.0085], [0.0058, 0.006], [0.006, 0.004]], 32), lensMat);
    H.lowVolt = lensMat;
    label(panel, ['LOW', 'VOLTAGE'], -0.42 + 0.025, 0.368, 0.03, 0.012, { size: 66 });
  }

  // ---------------------------------------------------------------- ignition
  {
    const g = group(panel, -0.468, 0.022, 0);
    reg('ignition', g);
    add(g, lathe([[0.024, 0], [0.024, 0.002], [0.022, 0.004], [0.0, 0.004]], 48), M.bezel);
    texPlane(g, G.ignitionFace(), 0.044, 0.044, 0, 0, 0.0042, { circle: true, emissive: true });
    add(g, cylZ(0.0085, 0.008, 40), M.chrome, 0, 0, 0.004);
    const key = group(g, 0, 0, 0.012);
    add(key, new THREE.BoxGeometry(0.0025, 0.013, 0.012), M.steel, 0, 0, 0.002);
    const head = new THREE.CylinderGeometry(0.011, 0.011, 0.003, 32); head.rotateZ(PI / 2);
    head.scale(1, 1, 1);
    add(key, new RoundedBoxGeometry(0.004, 0.024, 0.022, 3, 0.0018), M.black, 0, 0.0, 0.017);
    add(key, cylZ(0.0018, 0.0042, 16), M.chrome, 0, 0.007, 0.024).rotation.set(0, PI / 2, 0);
    H.key = key;
    label(panel, 'IGNITION', -0.468, -0.0025, 0.03, 0.006, { size: 70 });
  }
  // ---------------------------------------------------------------- push/pull knobs
  function pushPull(id, x, y, knobBuilder, travel, labelText, opts = {}) {
    const g = group(panel, x, y, 0);
    reg(id, g);
    // Panel bushing and nut
    add(g, lathe([[0.0075, 0], [0.0075, 0.002], [0.006, 0.0035], [0.0045, 0.0035]], 6), M.steel);
    const slider = group(g, 0, 0, 0);
    add(slider, cylZ(0.0032, 0.025 + travel, 16), M.chrome, 0, 0, -travel - 0.005);
    knobBuilder(slider);
    if (labelText) label(panel, labelText, x, y - (opts.labelDy ?? 0.024), opts.lw ?? 0.04, 0.007, { size: 64 });
    return { g, slider, travel };
  }
  const roundKnob = (mat, r = 0.0115, len = 0.02, ribs = 0) => (s) => {
    const prof = [[0, 0.02], [r * 0.55, 0.02], [r * 0.9, 0.0195], [r, 0.0175], [r, 0.006], [r * 0.75, 0.002], [0.0035, 0.0]];
    const g = lathe(prof.map(([a, b]) => [a, b * len / 0.02]), 64);
    if (ribs) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const xx = p.getX(i), yy = p.getY(i), rr = Math.hypot(xx, yy);
        if (rr > r * 0.95) { const a = Math.atan2(yy, xx); const f = 1 + (Math.cos(a * ribs) > 0.2 ? 0.07 : 0); p.setX(i, xx * f); p.setY(i, yy * f); }
      }
      g.computeVertexNormals();
    }
    add(s, g, mat, 0, 0, 0.006);
  };
  const tKnob = (mat) => (s) => {
    add(s, cylZ(0.004, 0.012, 16), mat, 0, 0, 0.004);
    add(s, new RoundedBoxGeometry(0.03, 0.011, 0.01, 3, 0.004), mat, 0, 0, 0.019);
  };

  H.throttle = pushPull('throttle', -0.04, 0.0, (s) => {
    roundKnob(M.black, 0.0125, 0.022)(s);
    // Friction lock ring at the panel
  }, 0.07, 'THROTTLE');
  add(H.throttle.g, lathe([[0.012, 0.0], [0.012, 0.006], [0.0045, 0.006]], 40), M.satin);
  H.mixture = pushPull('mixture', 0.04, 0.0, roundKnob(M.red, 0.0115, 0.02, 30), 0.07, ['MIXTURE'], { lw: 0.04 });
  label(panel, 'RICH  ⇧  LEAN', 0.04, -0.034, 0.045, 0.006, { size: 56, color: '#bbb' });
  H.carbheat = pushPull('carbheat', -0.115, 0.0, roundKnob(M.grey, 0.011, 0.018), 0.05, ['CARB', 'HEAT'], { lw: 0.024 });
  H.primer = pushPull('primer', -0.53, 0.022, (s) => {
    add(s, cylZ(0.0035, 0.012, 16), M.chrome, 0, 0, 0.004);
    roundKnob(M.chrome, 0.008, 0.012, 24)(s);
  }, 0.05, 'PRIMER', { lw: 0.03 });
  H.cabinheat = pushPull('cabinheat', 0.36, -0.028, tKnob(M.red), 0.05, null);
  label(panel, 'CABIN HT', 0.36, -0.012, 0.035, 0.006, { size: 64 });
  H.cabinair = pushPull('cabinair', 0.44, -0.028, tKnob(M.satin), 0.05, null);
  label(panel, 'CABIN AIR', 0.44, -0.012, 0.035, 0.006, { size: 64 });
  H.altstatic = pushPull('altstatic', 0.12, 0.03, roundKnob(M.red, 0.007, 0.012), 0.03, ['ALT', 'STATIC'], { lw: 0.02, labelDy: 0.02 });
  // Panel lights dimmer
  {
    const g = group(panel, -0.115, 0.06, 0);
    reg('dimmer', g);
    H.knobs.dimmer = smallKnob(g, 0.008, 0.012, M.black);
    label(panel, ['PANEL', 'LT'], -0.115, 0.04, 0.02, 0.01, { size: 70 });
  }

  // ---------------------------------------------------------------- flaps
  {
    const g = group(panel, 0.232, 0.068, 0);
    reg('flapswitch', g);
    add(g, new RoundedBoxGeometry(0.016, 0.085, 0.003, 2, 0.002), M.recess, 0, -0.005, 0.0005);
    const lever = group(g, 0, 0, 0);
    H.flapLever = lever;
    add(lever, new THREE.BoxGeometry(0.004, 0.004, 0.03), M.steel, 0, 0, 0.015);
    // Flap-shaped knob (white airfoil)
    const s = new THREE.Shape();
    s.moveTo(-0.014, 0); s.quadraticCurveTo(-0.012, 0.007, 0.004, 0.006); s.lineTo(0.016, 0.002); s.lineTo(0.016, -0.002); s.quadraticCurveTo(0.0, -0.004, -0.014, 0);
    const kg = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0012, bevelSegments: 3 });
    kg.translate(0, 0, -0.006); kg.rotateY(PI / 2); kg.rotateZ(PI / 2);
    add(lever, kg, M.white, 0, 0, 0.032);
    label(panel, ['WING', 'FLAPS'], 0.232, 0.122, 0.024, 0.012, { size: 70 });
    for (const [t, yy] of [['UP', 0.104], ['10°', 0.08], ['20°', 0.056], ['FULL', 0.032]]) label(panel, t, 0.252, yy, 0.016, 0.006, { size: 70, color: '#ccc' });
  }
  {
    const g = group(panel, 0.197, 0.07, 0);
    reg('flapind', g);
    texPlane(g, G.flapIndicatorFace(), 0.016, 0.064, 0, 0, 0.0008, { emissive: true });
    add(g, new RoundedBoxGeometry(0.022, 0.07, 0.003, 2, 0.002), M.bezel, 0, 0, -0.001);
    const ptr = group(g, 0, 0, 0.0015);
    const tri = new THREE.Shape(); tri.moveTo(0.008, 0); tri.lineTo(0.002, 0.003); tri.lineTo(0.002, -0.003); tri.closePath();
    add(ptr, new THREE.ShapeGeometry(tri), M.orange);
    H.flapPtr = ptr;
  }

  // ---------------------------------------------------------------- right panel: glove box, breakers, hobbs, placard
  {
    const w = GLOVE.x1 - GLOVE.x0, h = GLOVE.y1 - GLOVE.y0;
    const hinge = group(panel, (GLOVE.x0 + GLOVE.x1) / 2, GLOVE.y0, 0.004);
    reg('glovebox', hinge);
    H.gloveDoor = hinge;
    const gb = group(hinge, 0, h / 2, 0);
    add(gb, new RoundedBoxGeometry(w, h, 0.006, 3, 0.004), M.panel, 0, 0, -0.002);
    // Compartment behind the door, with a folded chart inside
    add(panel, new THREE.BoxGeometry(w - 0.01, h - 0.01, 0.002), M.recess, (GLOVE.x0 + GLOVE.x1) / 2, (GLOVE.y0 + GLOVE.y1) / 2, -0.12);
    add(panel, new THREE.BoxGeometry(0.12, 0.004, 0.09), new THREE.MeshStandardMaterial({ color: 0xd9cfa8, roughness: 0.9 }), (GLOVE.x0 + GLOVE.x1) / 2, GLOVE.y0 + 0.006, -0.05);
    add(gb, new RoundedBoxGeometry(0.03, 0.008, 0.006, 2, 0.003), M.chrome, 0, h / 2 - 0.014, 0.006);
    label(gb, 'MAP', 0, -0.01, 0.03, 0.008, { size: 70, z: 0.0052, color: '#888' });
  }
  {
    const cb = group(panel, 0, 0, 0);
    reg('breakers', cb);
    const names = [['FLAP', 'INST', 'ALT FLD', 'NAV LT', 'BCN', 'LAND LT', 'TAXI LT', 'STROBE'], ['PITOT', 'TURN CO', 'AVN BUS', 'COMM 1', 'COMM 2', 'XPDR', 'AUDIO', 'ALT']];
    names.forEach((row, ri) => {
      const y = 0.058 - ri * 0.03;
      row.forEach((n, i) => {
        const x = 0.342 + i * 0.027;
        add(cb, lathe([[0.0065, 0], [0.0065, 0.0015], [0.005, 0.0025], [0, 0.0025]], 24), M.steel, x, y, 0);
        const btn = group(cb, x, y, 0.002);
        add(btn, cylZ(0.0042, 0.007, 24), M.black);
        add(btn, new THREE.CircleGeometry(0.0038, 20), M.needle, 0, 0, 0.0071);
        (H.breakers ||= []).push(btn);
      });
      const lt = G.tex(G.breakerLabels(row));
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.216, 0.0135), new THREE.MeshStandardMaterial({ map: lt, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false }));
      m.position.set(0.342 - 0.0135 + 0.108, y - 0.012, 0.0006); noRay(m); panel.add(m);
    });
  }
  {
    const g = group(panel, 0.44, 0.255, 0);
    reg('hobbs', g);
    add(g, new RoundedBoxGeometry(0.046, 0.022, 0.004, 2, 0.002), M.bezel, 0, 0, 0.0);
    const hobbsTex = G.tex(G.hobbsFace(1184.3));
    H.hobbsCanvas = hobbsTex;
    add(g, new THREE.PlaneGeometry(0.04, 0.015), new THREE.MeshStandardMaterial({ map: hobbsTex, roughness: 0.5 }), 0, 0, 0.0021);
  }
  label(panel, ['THIS AIRPLANE MUST BE OPERATED IN THE NORMAL', 'OR UTILITY CATEGORY IN COMPLIANCE WITH THE', 'OPERATING LIMITATIONS STATED IN THE FORM OF', 'PLACARDS, MARKINGS AND MANUALS.'], 0.44, 0.33, 0.17, 0.034, { size: 32, pw: 1024, color: '#d9d9d9' });
  label(panel, ['NO ACROBATIC MANEUVERS, INCLUDING SPINS,', 'APPROVED IN NORMAL CATEGORY'], 0.44, 0.293, 0.17, 0.016, { size: 32, pw: 1024, color: '#d9d9d9' });

  // ---------------------------------------------------------------- yokes
  function yoke(id, x, isPilot) {
    const base = group(root, x, YOKE_Y, 0);
    reg(id, base);
    // Collar where the shaft enters the panel
    add(base, lathe([[0.03, 0], [0.03, 0.002], [0.022, 0.006], [0.015, 0.008]], 48), M.satin);
    const slide = group(base, 0, 0, 0);
    add(slide, cylZ(0.0125, 0.32, 32), M.chrome, 0, 0, -0.12);
    // Boot ring near the panel
    add(slide, lathe([[0.016, 0], [0.017, 0.004], [0.016, 0.008]], 32), M.rubber, 0, 0, 0.012);
    const roll = group(slide, 0, 0, 0.2);
    // Hub
    add(roll, new RoundedBoxGeometry(0.095, 0.06, 0.036, 4, 0.012), M.black, 0, -0.004, 0.0);
    add(roll, lathe([[0.02, 0], [0.02, 0.012], [0.014, 0.018]], 32), M.black, 0, 0, -0.03);
    // Blank emblem plate
    const plate = new THREE.CylinderGeometry(0.018, 0.018, 0.002, 48); plate.rotateX(PI / 2); plate.scale(1.5, 1, 1);
    add(roll, plate, M.satin, 0, -0.004, 0.0185);
    // Horns
    for (const side of [-1, 1]) {
      const pts = [[0.04, 0.0, 0.0], [0.085, -0.008, 0.004], [0.122, -0.002, 0.006], [0.148, 0.022, 0.006], [0.158, 0.055, 0.004]]
        .map(([a, b, c]) => new THREE.Vector3(a * side, b, c));
      const curve = new THREE.CatmullRomCurve3(pts);
      add(roll, new THREE.TubeGeometry(curve, 48, 0.0135, 20), M.black);
      const grip = new THREE.CapsuleGeometry(0.0175, 0.07, 10, 24);
      const gm = add(roll, grip, M.black, 0.16 * side, 0.095, 0.004, 0, 0, -0.1 * side);
      // Finger grooves on the grip
      for (let i = 0; i < 4; i++) {
        const t = new THREE.TorusGeometry(0.0178, 0.0018, 8, 32); t.rotateX(PI / 2);
        add(gm, t, M.black, 0, -0.025 + i * 0.016, 0);
      }
    }
    if (isPilot) {
      // Push-to-talk switch on the left horn
      const ptt = group(roll, -0.163, 0.145, 0.004);
      reg('ptt', ptt);
      add(ptt, cylZ(0.006, 0.004, 24), M.satin, 0, 0, 0).rotation.x = -PI / 2;
      const btn = add(ptt, new THREE.CylinderGeometry(0.0042, 0.0042, 0.005, 24), M.red, 0, 0.004, 0);
      H.pttBtn = btn;
      // Map light / trim are omitted on this classic model.
    }
    return { base, slide, roll };
  }
  H.yoke = yoke('yoke', YOKES[0], true);
  H.yoke2 = yoke('yoke2', YOKES[1], false);

  // ---------------------------------------------------------------- floor, firewall, pedals
  const FLOOR = -0.55;
  {
    const cab = group(root);
    // Firewall below the panel
    add(cab, new THREE.PlaneGeometry(1.12, 0.6), M.firewall, 0, -0.33, -0.48);
    // Underside of the panel
    const under = add(cab, new THREE.PlaneGeometry(1.12, 0.48), M.firewall, 0, -0.06, -0.24, PI / 2, 0, 0);
    under.material = new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 1, side: THREE.DoubleSide });
    // Floor with carpet
    add(cab, new THREE.PlaneGeometry(1.12, 2.3), M.carpet, 0, FLOOR, 0.65, -PI / 2, 0, 0);
    // Floor rise near the firewall where the pedals mount
    add(cab, new THREE.BoxGeometry(1.1, 0.06, 0.25), M.carpet, 0, FLOOR + 0.02, -0.36, -0.35, 0, 0);
  }

  function pedals(id, cx) {
    const g = group(root, cx, 0, 0);
    reg(id, g);
    const out = [];
    for (const side of [-1, 1]) {
      const piv = group(g, side * 0.085, FLOOR + 0.07, -0.38);
      // Arm
      add(piv, new THREE.BoxGeometry(0.012, 0.15, 0.012), M.steel, 0, 0.07, 0.01, -0.25, 0, 0);
      // Pedal plate (lower part: rudder)
      const plateGrp = group(piv, 0, 0.12, 0.04);
      plateGrp.rotation.x = -0.35;
      add(plateGrp, new RoundedBoxGeometry(0.08, 0.075, 0.01, 3, 0.004), M.satin, 0, -0.02, 0);
      for (let i = 0; i < 5; i++) add(plateGrp, new THREE.BoxGeometry(0.068, 0.004, 0.003), M.rubber, 0, -0.045 + i * 0.012, 0.006);
      // Toe brake (upper part), hinged at its lower edge
      const toe = group(plateGrp, 0, 0.02, 0.0);
      const toeMesh = add(toe, new RoundedBoxGeometry(0.08, 0.05, 0.012, 3, 0.004), M.steel, 0, 0.025, 0.002);
      for (let i = 0; i < 3; i++) add(toe, new THREE.BoxGeometry(0.068, 0.004, 0.003), M.rubber, 0, 0.012 + i * 0.012, 0.009);
      reg('toebrakes', toe);
      out.push({ piv, toe });
    }
    return out;
  }
  H.pedals = pedals('rudder', YOKES[0]);
  H.pedals2 = pedals('rudder2', YOKES[1]);

  // ---------------------------------------------------------------- center pedestal: trim, fuel selector, mic
  {
    const ped = group(root);
    add(ped, new RoundedBoxGeometry(0.11, 0.5, 0.3, 3, 0.01), M.pedestal, 0, -0.3, -0.12);
    // Trim wheel
    const tw = group(ped, 0, -0.21, 0.0);
    reg('trimwheel', tw);
    add(ped, new THREE.BoxGeometry(0.03, 0.16, 0.004), M.recess, 0, -0.21, 0.031);
    const wheel = group(tw, 0, 0, 0.0);
    const wg = new THREE.CylinderGeometry(0.075, 0.075, 0.022, 96); wg.rotateZ(PI / 2);
    add(wheel, wg, M.black);
    for (let i = 0; i < 48; i++) {
      const a = i / 48 * PI * 2;
      add(wheel, new THREE.BoxGeometry(0.024, 0.006, 0.004), M.black, 0, Math.cos(a) * 0.076, Math.sin(a) * 0.076, a, 0, 0);
    }
    // Painted takeoff stripe on the rim
    add(wheel, new THREE.BoxGeometry(0.0235, 0.004, 0.005), M.white, 0, 0, 0.0765);
    H.trimWheel = wheel;
    // Trim indicator
    const ti = group(ped, -0.04, -0.21, 0.031);
    reg('trimind', ti);
    texPlane(ti, G.trimIndicatorFace(), 0.024, 0.1, 0, 0, 0.0005, {});
    const ptr = group(ti, 0, 0, 0.002);
    const tri = new THREE.Shape(); tri.moveTo(0.012, 0); tri.lineTo(0.004, 0.003); tri.lineTo(0.004, -0.003); tri.closePath();
    add(ptr, new THREE.ShapeGeometry(tri), M.orange);
    add(ptr, new THREE.BoxGeometry(0.01, 0.0015, 0.001), M.orange, 0.0, 0, 0);
    H.trimPtr = ptr;

    // Fuel selector on the floor, aft of the pedestal
    const fs = group(root, 0, FLOOR, 0.16);
    reg('fuelsel', fs);
    add(fs, new RoundedBoxGeometry(0.17, 0.05, 0.2, 3, 0.01), M.trim, 0, 0.02, 0);
    const plate = texPlane(fs, G.fuelSelectorPlate(), 0.15, 0.15, 0, 0.0455, 0, { circle: true });
    plate.rotation.x = -PI / 2;
    const handle = group(fs, 0, 0.046, 0);
    const hs = new THREE.Shape();
    hs.moveTo(0, 0.075); hs.lineTo(0.012, 0.03); hs.lineTo(0.014, -0.035); hs.quadraticCurveTo(0, -0.05, -0.014, -0.035); hs.lineTo(-0.012, 0.03); hs.closePath();
    const hg = new THREE.ExtrudeGeometry(hs, { depth: 0.022, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 3 });
    hg.rotateX(-PI / 2);
    add(handle, hg, M.white);
    add(handle, new THREE.BoxGeometry(0.003, 0.002, 0.05), M.red, 0, 0.0265, -0.04);
    H.fuelHandle = handle;

    // Hand microphone on a hook at the side of the pedestal
    const mic = group(ped, -0.07, -0.1, -0.02);
    reg('mic', mic);
    add(mic, new THREE.BoxGeometry(0.01, 0.006, 0.03), M.steel, 0, 0.04, 0);
    add(mic, new RoundedBoxGeometry(0.034, 0.075, 0.03, 4, 0.012), M.black, -0.016, 0.0, 0.0);
    add(mic, new THREE.BoxGeometry(0.012, 0.02, 0.006), M.satin, -0.016, 0.005, 0.016);
    const helix = [];
    for (let i = 0; i <= 200; i++) {
      const t = i / 200, a = t * PI * 2 * 18;
      helix.push(new THREE.Vector3(-0.016 + Math.cos(a) * 0.006, -0.04 - t * 0.2, Math.sin(a) * 0.006 + t * 0.03));
    }
    add(mic, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helix), 600, 0.0016, 6), M.black);
  }

  // ---------------------------------------------------------------- parking brake
  {
    const g = group(panel, -0.16, -0.034, 0.0);
    reg('parkbrake', g);
    add(g, new THREE.BoxGeometry(0.03, 0.03, 0.01), M.panelEdge, 0, 0.004, -0.008);
    const slider = group(g, 0, 0, 0);
    add(slider, cylZ(0.003, 0.06, 12), M.chrome, 0, 0, -0.05);
    const rot = group(slider, 0, 0, 0.012);
    add(rot, new RoundedBoxGeometry(0.035, 0.012, 0.012, 3, 0.005), M.grey, 0, 0, 0);
    label(panel, ['PARK', 'BRAKE'], -0.205, -0.034, 0.024, 0.012, { size: 70 });
    H.parkbrake = { slider, rot };
  }

  // ---------------------------------------------------------------- magnetic compass
  {
    const g = group(root, 0, 0.84, 0.16);
    reg('compass', g);
    // Bracket up to the windshield frame
    add(g, new THREE.BoxGeometry(0.02, 0.05, 0.01), M.satin, 0, 0.035, -0.03, -0.75, 0, 0);
    add(g, new RoundedBoxGeometry(0.075, 0.06, 0.06, 4, 0.012), M.black, 0, 0, 0);
    const win = add(g, new THREE.PlaneGeometry(0.05, 0.026), new THREE.MeshPhysicalMaterial({ color: 0x223322, transparent: true, opacity: 0.25, roughness: 0.05, clearcoat: 1 }), 0, 0.004, 0.0302);
    noRay(win);
    const cardTex = G.tex(G.compassCard());
    const card = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.016, 64, 1, true), new THREE.MeshStandardMaterial({ map: cardTex, roughness: 0.5 }));
    card.position.set(0, 0.004, 0.0);
    g.add(card);
    H.compassCard = card;
    add(g, new THREE.BoxGeometry(0.0012, 0.03, 0.001), M.orange, 0, 0.004, 0.0298);
    // Deviation card
    label(g, ['FOR  N   30   60   E  120  150', 'STEER 0   30   59  89  119  150', 'FOR  S  210  240  W  300  330', 'STEER 180 210 241 271 301  329'], 0, -0.042, 0.075, 0.024, { size: 30, pw: 1024, bg: '#e8e4d6', color: '#111', z: 0.026, weight: 'bold' });
  }

  // ---------------------------------------------------------------- cabin shell
  {
    const cab = group(root);
    const W = 0.57, ROOF = 0.98;
    // Windshield
    const wsGeo = new THREE.PlaneGeometry(1.14, Math.hypot(0.56, 0.55), 1, 1);
    const ws = add(cab, wsGeo, M.windshield, 0, 0.7, -0.03, Math.atan2(0.56, 0.56), 0, 0);
    ws.castShadow = false; noRay(ws);
    // A-pillars
    for (const s of [-1, 1]) {
      const p = new THREE.CatmullRomCurve3([new THREE.Vector3(s * W, 0.42, -0.31), new THREE.Vector3(s * W, ROOF, 0.25)]);
      add(cab, new THREE.TubeGeometry(p, 4, 0.022, 12), M.trim);
    }
    // Top windshield frame
    add(cab, new THREE.BoxGeometry(1.16, 0.05, 0.06), M.trim, 0, ROOF - 0.01, 0.25);
    // Headliner
    add(cab, new THREE.PlaneGeometry(1.16, 1.6), M.headliner, 0, ROOF + 0.01, 1.05, PI / 2, 0, 0);
    // Overhead air vents
    for (const s of [-1, 1]) {
      const v = group(cab, s * 0.45, ROOF - 0.005, 0.45);
      add(v, new THREE.CylinderGeometry(0.03, 0.035, 0.02, 32), M.trim);
      add(v, new THREE.CylinderGeometry(0.018, 0.018, 0.05, 24), M.grey, 0, -0.03, 0);
    }
    // Side walls: lower door panels and window frames
    for (const s of [-1, 1]) {
      const side = group(cab, s * W, 0, 0);
      add(side, new THREE.BoxGeometry(0.02, 0.78, 1.7), M.trim, 0, -0.16, 0.7);
      // Armrest
      add(side, new RoundedBoxGeometry(0.06, 0.04, 0.45, 3, 0.012), M.leather, -s * 0.03, 0.08, 0.85);
      // Door handle
      add(side, new RoundedBoxGeometry(0.02, 0.02, 0.1, 2, 0.006), M.chrome, -s * 0.02, 0.15, 0.4);
      // Window frame: sill, post and top
      add(side, new THREE.BoxGeometry(0.03, 0.04, 1.7), M.trim, 0, 0.24, 0.7);
      add(side, new THREE.BoxGeometry(0.03, 0.74, 0.06), M.trim, 0, 0.6, 1.1);
      add(side, new THREE.BoxGeometry(0.03, 0.06, 1.7), M.trim, 0, ROOF - 0.02, 0.7);
      const win = add(side, new THREE.PlaneGeometry(1.4, 0.72), M.windshield, 0, 0.61, 0.6, 0, PI / 2, 0);
      win.castShadow = false; noRay(win);
    }
    // Sun visors
    const vis = group(cab);
    reg('visor', vis);
    for (const s of [-1, 1]) {
      const v = group(vis, s * 0.28, ROOF - 0.03, 0.26);
      add(v, new THREE.CylinderGeometry(0.004, 0.004, 0.34, 8), M.chrome, 0, 0, 0, 0, 0, PI / 2);
      add(v, new RoundedBoxGeometry(0.32, 0.012, 0.13, 3, 0.005), M.headliner, 0, -0.005, 0.07, -0.25, 0, 0);
    }
    H.visors = vis;
    // Rear wall
    add(cab, new THREE.PlaneGeometry(1.16, 1.55), M.trim, 0, 0.2, 2.2, 0, PI, 0);
  }

  // ---------------------------------------------------------------- seats
  function seat(id, x) {
    const g = group(root, x, FLOOR, 0.82);
    reg(id, g);
    (H.seats ||= {})[id] = g;
    for (const sx of [-1, 1]) add(g, new THREE.BoxGeometry(0.02, 0.02, 0.6), M.steel, sx * 0.15, 0.01, 0);
    add(g, new THREE.BoxGeometry(0.3, 0.2, 0.36), M.satin, 0, 0.13, 0.02);
    add(g, new RoundedBoxGeometry(0.46, 0.11, 0.48, 4, 0.04), M.fabric, 0, 0.29, 0.04);
    const back = group(g, 0, 0.32, 0.28);
    back.rotation.x = -0.22;
    add(back, new RoundedBoxGeometry(0.46, 0.66, 0.11, 4, 0.04), M.fabric, 0, 0.33, 0);
    add(back, new RoundedBoxGeometry(0.42, 0.03, 0.1, 3, 0.012), M.leather, 0, 0.665, 0);
    // Seat belt stripes
    for (const sx of [-1, 1]) add(back, new THREE.BoxGeometry(0.04, 0.6, 0.004), new THREE.MeshStandardMaterial({ color: 0x2a3446, roughness: 0.8 }), sx * 0.13, 0.33, -0.057);
  }
  seat('seat', YOKES[0]);
  seat('seat2', YOKES[1]);
  // Rear bench (not selectable)
  {
    const g = group(root, 0, FLOOR, 1.75);
    add(g, new RoundedBoxGeometry(1.0, 0.12, 0.45, 4, 0.04), M.fabric, 0, 0.3, 0);
    add(g, new RoundedBoxGeometry(1.0, 0.6, 0.12, 4, 0.04), M.fabric, 0, 0.62, 0.25, -0.15, 0, 0);
  }

  return { root, parts, H, M };
}
