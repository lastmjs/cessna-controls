import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildCockpit } from './cockpit.js';
import { buildExterior } from './airplane.js';
import { createSim } from './sim.js';
import { setAnisotropy, canvas as mkCanvas } from './gauges.js';
import { createUI } from './ui.js';

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('viewport').appendChild(renderer.domElement);
setAnisotropy(renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

// ------------------------------------------------------------------ sky and ground
{
  const skyGeo = new THREE.SphereGeometry(3000, 48, 24);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x3d78c9) }, mid: { value: new THREE.Color(0xa9c9ea) }, bottom: { value: new THREE.Color(0xdfe9f1) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
      void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h,0.0,1.0), 0.6)) : mix(mid, bottom, clamp(-h*4.0,0.0,1.0));
      gl_FragColor = vec4(c, 1.0); }`,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  scene.fog = new THREE.Fog(0xc4d8ea, 60, 1800);

  const groundY = -1.15;
  const gc = mkCanvas(256), g = gc.getContext('2d');
  g.fillStyle = '#5d7a3a'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(${40 + Math.random() * 60},${70 + Math.random() * 60},${20 + Math.random() * 30},0.5)`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
  const gt = new THREE.CanvasTexture(gc); gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(400, 400); gt.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ map: gt, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = groundY; ground.receiveShadow = true;
  scene.add(ground);
  // Ramp and taxiway with a yellow centerline
  const tc = mkCanvas(128, 512), t = tc.getContext('2d');
  t.fillStyle = '#4a4a4c'; t.fillRect(0, 0, 128, 512);
  for (let i = 0; i < 3000; i++) { t.fillStyle = `rgba(${60 + Math.random() * 60},${60 + Math.random() * 60},${60 + Math.random() * 60},0.35)`; t.fillRect(Math.random() * 128, Math.random() * 512, 1.5, 1.5); }
  t.fillStyle = '#e6b82a'; t.fillRect(60, 0, 8, 512);
  const tt = new THREE.CanvasTexture(tc); tt.wrapS = tt.wrapT = THREE.RepeatWrapping; tt.repeat.set(1, 60); tt.colorSpace = THREE.SRGBColorSpace;
  tt.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const twy = new THREE.Mesh(new THREE.PlaneGeometry(16, 900), new THREE.MeshStandardMaterial({ map: tt, roughness: 0.9 }));
  twy.rotation.x = -Math.PI / 2; twy.position.set(0, groundY + 0.01, -440); twy.receiveShadow = true;
  scene.add(twy);
  const ramp = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), new THREE.MeshStandardMaterial({ color: 0x55565a, roughness: 0.95 }));
  ramp.rotation.x = -Math.PI / 2; ramp.position.set(0, groundY + 0.005, 8); ramp.receiveShadow = true;
  scene.add(ramp);
  // A few hangars and a tree line on the horizon
  const hangarMat = new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.6, metalness: 0.3 });
  for (const [x, z, w] of [[-45, -70, 24], [-75, -60, 20], [40, -110, 30]]) {
    const h = new THREE.Group();
    h.add(new THREE.Mesh(new THREE.BoxGeometry(w, 7, 18), hangarMat)); h.children[0].position.y = 3.5;
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, 18, 24, 1, false, -Math.PI / 2, Math.PI), hangarMat);
    roof.rotation.x = Math.PI / 2; roof.scale.set(1, 1, 0.25); roof.position.y = 7; h.add(roof);
    h.position.set(x, groundY, z); scene.add(h);
  }
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x2f4a26, roughness: 1 });
  for (let i = 0; i < 160; i++) {
    const a = (i / 160) * Math.PI * 2, r = 500 + Math.random() * 250;
    const tr = new THREE.Mesh(new THREE.ConeGeometry(6 + Math.random() * 8, 14 + Math.random() * 20, 7), treeMat);
    tr.position.set(Math.cos(a) * r, groundY + 10, Math.sin(a) * r);
    scene.add(tr);
  }
}

// ------------------------------------------------------------------ lights
const hemi = new THREE.HemisphereLight(0xcfe2ff, 0x6b5a45, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dc, 3.2);
sun.position.set(-4.2, 2.6, 2.8);
sun.target.position.set(0, 0.1, 0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -1.4, right: 1.4, top: 1.4, bottom: -1.4, near: 0.5, far: 12 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.015;
scene.add(sun, sun.target);
const front = new THREE.DirectionalLight(0xe8f0ff, 0.9);
front.position.set(0.5, 3, -4); scene.add(front);
const fill = new THREE.PointLight(0xfff4e6, 0.35, 3, 2);
fill.position.set(0, 0.6, 1.0); scene.add(fill);

// ------------------------------------------------------------------ cockpit
const cockpit = buildCockpit();
scene.add(cockpit.root);
const exterior = buildExterior();
scene.add(exterior.root);
const sim = createSim(cockpit.H);

// ------------------------------------------------------------------ camera
const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.01, 4000);
export const VIEWS = {
  pilot: { pos: [-0.28, 0.56, 0.86], target: [-0.17, 0.17, 0.0] },
  panel: { pos: [0.0, 0.3, 0.92], target: [0.0, 0.16, 0.0] },
  floor: { pos: [-0.05, 0.18, 0.75], target: [-0.05, -0.38, -0.15] },
  copilot: { pos: [0.28, 0.56, 0.86], target: [0.12, 0.17, 0.0] },
};
camera.position.set(...VIEWS.pilot.pos);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(...VIEWS.pilot.target);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.06;
controls.maxDistance = 14.0;
controls.zoomSpeed = 0.9;
controls.panSpeed = 0.8;
controls.rotateSpeed = 0.6;
controls.screenSpacePanning = true;
controls.update();

let tween = null;
function flyTo(pos, target, dur = 0.9) {
  tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: new THREE.Vector3(...pos), t1: new THREE.Vector3(...target), t: 0, dur };
}
controls.addEventListener('start', () => { tween = null; });

function focusOn(id) {
  const objs = cockpit.parts[id];
  if (!objs) return;
  const box = new THREE.Box3();
  for (const o of objs) box.expandByObject(o);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const dist = THREE.MathUtils.clamp(size * 1.6 / freeFraction(), 0.14, 1.3);
  // Look from the seats, slightly above: never from behind the panel.
  const dir = camera.position.clone().sub(center).normalize();
  dir.lerp(new THREE.Vector3(center.x * 0.3, 0.45, 1).normalize(), 0.65).normalize();
  if (center.y < -0.2) dir.set(0, 0.85, 0.6).normalize();
  if (dir.z < 0.35) { dir.z = 0.35; dir.normalize(); }
  const pos = center.clone().add(dir.multiplyScalar(dist));
  // Stay inside the cabin
  pos.x = THREE.MathUtils.clamp(pos.x, -0.5, 0.5); pos.y = THREE.MathUtils.clamp(pos.y, -0.4, 0.9); pos.z = THREE.MathUtils.clamp(pos.z, 0.05, 1.5);
  flyTo(pos.toArray(), center.toArray());
}

// After a click, if the docked card (or sidebar) covers the part, slide the view sideways
// (same viewing angle and distance) until the part sits in the free area.
function ensureVisible(id) {
  const objs = cockpit.parts[id];
  if (!objs || tween) return;
  const box = new THREE.Box3();
  for (const o of objs) box.expandByObject(o);
  const center = box.getCenter(new THREE.Vector3());
  const W = window.innerWidth, H = window.innerHeight, ins = ui.insets();
  const p = center.clone().project(camera);
  const sx = (p.x + 1) / 2 * W, sy = (1 - p.y) / 2 * H;
  const m = 60;
  const inside = sx > ins.left + m && sx < W - ins.right - m && sy > 70 && sy < H - ins.bottom - m && p.z < 1;
  if (inside) return;
  const d = center.clone().sub(controls.target);
  flyTo(camera.position.clone().add(d).toArray(), center.toArray(), 0.7);
}

// ------------------------------------------------------------------ post-processing and highlight
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
const selPass = new OutlinePass(size, scene, camera);
Object.assign(selPass, { edgeStrength: 5, edgeGlow: 0.6, edgeThickness: 1.6, pulsePeriod: 2.4 });
selPass.visibleEdgeColor.set(0xffb21f); selPass.hiddenEdgeColor.set(0x6b4a10);
const hovPass = new OutlinePass(size, scene, camera);
Object.assign(hovPass, { edgeStrength: 3, edgeGlow: 0, edgeThickness: 1 });
hovPass.visibleEdgeColor.set(0xffffff); hovPass.hiddenEdgeColor.set(0x333333);
composer.addPass(hovPass);
composer.addPass(selPass);
composer.addPass(new OutputPass());

// ------------------------------------------------------------------ mini airplane (control surfaces)
const mini = (() => {
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
  const dl = new THREE.DirectionalLight(0xffffff, 2); dl.position.set(-2, 4, 3); sc.add(dl);
  const cam = new THREE.PerspectiveCamera(32, 1.4, 0.1, 100);
  cam.position.set(-7.6, 4.6, 9.4); cam.lookAt(0.9, -0.3, 0.3);
  const white = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5 });
  const hl = new THREE.MeshStandardMaterial({ color: 0xffb21f, roughness: 0.4, emissive: 0x442200 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x334, roughness: 0.4 });
  const ac = new THREE.Group(); sc.add(ac);
  const m = (geo, mat, x, y, z, parent = ac) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); parent.add(o); return o; };
  // Fuselage
  const fus = new THREE.CapsuleGeometry(0.42, 3.4, 8, 16); fus.rotateX(Math.PI / 2);
  const fp = fus.attributes.position;
  for (let i = 0; i < fp.count; i++) { const z = fp.getZ(i); const t = THREE.MathUtils.clamp((z + 0.4) / 2.5, 0, 1); fp.setX(i, fp.getX(i) * (1 - 0.75 * t)); fp.setY(i, fp.getY(i) * (1 - 0.6 * t) + 0.18 * t); }
  fus.computeVertexNormals();
  m(fus, white, 0, 0, 0.4);
  m(new THREE.BoxGeometry(0.6, 0.35, 0.5), dark, 0, 0.25, -0.65); // windshield area
  // Wing (fixed part) and moving surfaces
  m(new THREE.BoxGeometry(9, 0.1, 1.1), white, 0, 0.5, -0.15);
  const surf = {};
  const hinge = (x, y, z, w, chord, parent = ac) => { const h = new THREE.Group(); h.position.set(x, y, z); parent.add(h); m(new THREE.BoxGeometry(w, 0.06, chord), hl, 0, 0, chord / 2, h); return h; };
  surf.ailL = hinge(-3.1, 0.5, 0.4, 2.6, 0.38);
  surf.ailR = hinge(3.1, 0.5, 0.4, 2.6, 0.38);
  surf.flapL = hinge(-1.2, 0.48, 0.4, 1.9, 0.38);
  surf.flapR = hinge(1.2, 0.48, 0.4, 1.9, 0.38);
  // Tail
  m(new THREE.BoxGeometry(3.2, 0.06, 0.7), white, 0, 0.2, 2.75);
  surf.elev = hinge(0, 0.2, 3.1, 3.2, 0.5);
  surf.tab = hinge(0.55, 0, 0.5, 0.7, 0.14, surf.elev);
  surf.tab.children[0].material = dark;
  const fin = new THREE.Shape(); fin.moveTo(0, 0); fin.lineTo(0.9, 0); fin.lineTo(0.9, 1.25); fin.lineTo(0.45, 1.25); fin.closePath();
  const fg = new THREE.ExtrudeGeometry(fin, { depth: 0.06, bevelEnabled: false }); fg.rotateY(-Math.PI / 2); fg.translate(0.03, 0, 0);
  m(fg, white, 0, 0.25, 2.2);
  surf.rud = new THREE.Group(); surf.rud.position.set(0, 0.25, 3.1); ac.add(surf.rud);
  m(new THREE.BoxGeometry(0.06, 1.25, 0.45), hl, 0, 0.62, 0.22, surf.rud);
  // Struts and landing gear
  for (const s of [-1, 1]) {
    const st = m(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6), white, s * 1.2, -0.15, -0.1); st.rotation.z = s * 1.0;
    m(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 16), dark, s * 1.1, -0.95, 0.35).rotation.z = Math.PI / 2;
  }
  m(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 16), dark, 0, -0.95, -1.6).rotation.z = Math.PI / 2;
  // Propeller
  const prop = m(new THREE.BoxGeometry(0.12, 2.2, 0.04), dark, 0, 0, -1.65);
  const prevClear = new THREE.Color();
  return {
    render(s, x, y, w, h) {
      surf.ailL.rotation.x = s.yokeRoll * 0.4;
      surf.ailR.rotation.x = -s.yokeRoll * 0.4;
      surf.elev.rotation.x = -s.yokePitch * 0.45;
      surf.tab.rotation.x = s.trim * 0.6;
      surf.rud.rotation.y = s.rudder * 0.45;
      const f = s.flaps * Math.PI / 180;
      surf.flapL.rotation.x = f; surf.flapR.rotation.x = f;
      prop.rotation.z += s.rpm / 60 * 0.016 * Math.PI * 2 * 0.12;
      cam.aspect = w / h; cam.updateProjectionMatrix();
      renderer.setScissorTest(true);
      renderer.setScissor(x, y, w, h); renderer.setViewport(x, y, w, h);
      renderer.autoClear = false;
      renderer.getClearColor(prevClear); const prevAlpha = renderer.getClearAlpha();
      renderer.setClearColor(0x17212e, 1); renderer.clear(true, true, false);
      renderer.setClearColor(prevClear, prevAlpha);
      renderer.render(sc, cam);
      renderer.setScissorTest(false); renderer.autoClear = true;
      renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    },
  };
})();

// ------------------------------------------------------------------ picking
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const pickables = [cockpit.root];
function pick(clientX, clientY) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(pickables, true);
  for (const h of hits) {
    let o = h.object;
    if (!o.visible) continue;
    while (o && !o.userData.cid) o = o.parent;
    return o ? o.userData.cid : null; // the nearest solid surface wins, even if it is not a component
  }
  return null;
}

const outlineObjects = (id) => (id ? cockpit.parts[id] || [] : []);

// ------------------------------------------------------------------ UI
const ui = createUI({
  sim,
  onSelect(id) { selPass.selectedObjects = outlineObjects(id); if (id) hovPass.selectedObjects = []; },
  onFocus: focusOn,
  onView(name) { const v = VIEWS[name]; if (v) flyTo(v.pos, v.target); },
  getCamera() { return { pos: camera.position.toArray(), target: controls.target.toArray() }; },
  setCamera(c) { camera.position.fromArray(c.pos); controls.target.fromArray(c.target); controls.update(); },
  controls,
});

let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (moved > 6) return;
  const id = pick(e.clientX, e.clientY);
  ui.picked(id);
  if (id && !document.body.classList.contains('quizzing')) setTimeout(() => ensureVisible(id), 450);
});
let hoverReq = null;
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  hoverReq = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('pointerleave', () => { hoverReq = null; ui.hover(null); hovPass.selectedObjects = []; });
let lastHover = null;
function doHover() {
  if (!hoverReq) return;
  const { x, y } = hoverReq; hoverReq = null;
  const id = down ? null : pick(x, y);
  if (id !== lastHover) { lastHover = id; hovPass.selectedObjects = id && id !== ui.selected ? outlineObjects(id) : []; renderer.domElement.style.cursor = id ? 'pointer' : ''; }
  ui.hover(id, x, y);
}

// ------------------------------------------------------------------ resize & loop
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  camera.aspect = w / h;
  // Portrait phones: widen the vertical field of view so the panel still fits across.
  camera.fov = w / h < 1 ? THREE.MathUtils.clamp(52 / (w / h) * 0.75, 52, 80) : 52;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const viewShift = { x: 0, y: 0 };
function applyViewShift(dt) {
  const W = window.innerWidth, H = window.innerHeight;
  const ins = ui.insets();
  const tx = (ins.left - ins.right) / 2, ty = -ins.bottom / 2;
  const k = Math.min(1, dt * 6);
  viewShift.x += (tx - viewShift.x) * k; viewShift.y += (ty - viewShift.y) * k;
  if (Math.abs(viewShift.x) < 0.5 && Math.abs(viewShift.y) < 0.5 && tx === 0 && ty === 0) {
    if (camera.view && camera.view.enabled) { camera.clearViewOffset(); }
    return;
  }
  camera.setViewOffset(W, H, -viewShift.x, -viewShift.y, W, H);
}
// Fraction of the screen that is free for the 3D view (used to back the camera off when framing).
function freeFraction() {
  const W = window.innerWidth, H = window.innerHeight, ins = ui.insets();
  return Math.max(0.35, Math.min((W - ins.left - ins.right) / W, (H - ins.bottom) / H));
}

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = clock.elapsedTime;
  if (tween) {
    tween.t += dt;
    const f = THREE.MathUtils.smootherstep(Math.min(tween.t / tween.dur, 1), 0, 1);
    camera.position.lerpVectors(tween.p0, tween.p1, f);
    controls.target.lerpVectors(tween.t0, tween.t1, f);
    if (tween.t >= tween.dur) { tween = null; ui.saveCamera(); }
  }
  applyViewShift(dt);
  controls.update();
  sim.update(dt, now);
  { const s = sim.state; exterior.H.update(null, s, dt, { nav: s.sw_nav, beacon: s.sw_beacon && Math.sin(now * 7) > 0.6, strobe: s.sw_strobe && (now % 1.2) < 0.06, landing: s.sw_land }); }
  doHover();
  ui.tick();
  composer.render(dt);
  if (ui.miniVisible) {
    const r = ui.miniRect();
    if (r) {
      const pr = renderer.getPixelRatio();
      const H = window.innerHeight;
      mini.render(sim.state, r.left, H - r.bottom, r.width, r.height, pr);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
document.getElementById('loading').classList.add('done');

// Exposed for debugging in the console
window.__cockpit = { scene, camera, controls, cockpit, sim, renderer };
