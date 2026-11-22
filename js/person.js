// A walking pilot: a simple jointed figure with a walk cycle.
import * as THREE from 'three';

export function buildPerson() {
  const root = new THREE.Group();
  const std = (color, rough = 0.8) => new THREE.MeshStandardMaterial({ color, roughness: rough });
  const skin = std(0xd9a47e, 0.7), shirt = std(0x8fb4d9), pants = std(0x2b3444), shoe = std(0x1a1a1a, 0.6), hair = std(0x3b2a1e), headset = std(0x222428, 0.5);
  const part = (geo, mat, parent, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  const joint = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };

  const hips = joint(root, 0, 0.95, 0);
  part(new THREE.CapsuleGeometry(0.17, 0.12, 4, 12), pants, hips, 0, 0.02, 0).scale.set(1, 1, 0.75);
  const torso = joint(hips, 0, 0.1, 0);
  part(new THREE.CapsuleGeometry(0.19, 0.36, 6, 14), shirt, torso, 0, 0.27, 0).scale.set(1, 1, 0.68);
  part(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 10), skin, torso, 0, 0.56, 0);
  const head = joint(torso, 0, 0.7, 0);
  part(new THREE.SphereGeometry(0.11, 20, 14), skin, head, 0, 0, 0).scale.set(0.92, 1.05, 1);
  part(new THREE.SphereGeometry(0.115, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, head, 0, 0.015, 0.01);
  // Headset around the neck
  const hs = new THREE.TorusGeometry(0.1, 0.012, 6, 20, Math.PI); hs.rotateX(Math.PI / 2);
  part(hs, headset, torso, 0, 0.56, 0.02).rotation.z = Math.PI;
  for (const s of [-1, 1]) part(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 14), headset, torso, s * 0.1, 0.56, 0.03).rotation.z = Math.PI / 2;
  // Arms
  const arms = [], legs = [];
  for (const s of [-1, 1]) {
    const sh = joint(torso, s * 0.23, 0.5, 0);
    part(new THREE.CapsuleGeometry(0.05, 0.24, 4, 10), shirt, sh, 0, -0.15, 0);
    const el = joint(sh, 0, -0.3, 0);
    part(new THREE.CapsuleGeometry(0.042, 0.22, 4, 10), skin, el, 0, -0.13, 0);
    part(new THREE.SphereGeometry(0.048, 10, 8), skin, el, 0, -0.28, 0);
    arms.push({ sh, el, s });
    const hip = joint(hips, s * 0.1, -0.03, 0);
    part(new THREE.CapsuleGeometry(0.075, 0.33, 4, 10), pants, hip, 0, -0.21, 0);
    const kn = joint(hip, 0, -0.43, 0);
    part(new THREE.CapsuleGeometry(0.06, 0.34, 4, 10), pants, kn, 0, -0.2, 0);
    part(new THREE.BoxGeometry(0.1, 0.07, 0.26), shoe, kn, 0, -0.43, -0.05);
    legs.push({ hip, kn, s });
  }
  let phase = 0;
  return {
    root,
    // speed in m/s; reach 0..1 raises the right arm (fueling)
    animate(dt, speed, reach = 0) {
      phase += dt * (speed > 0.05 ? 1.6 + speed * 1.9 : 0);
      const amp = Math.min(1, speed / 1.4) * (speed > 2.5 ? 1.3 : 0.9);
      const sw = Math.sin(phase * Math.PI);
      legs.forEach(({ hip, kn, s }) => {
        const a = sw * s * 0.5 * amp;
        hip.rotation.x = a;
        kn.rotation.x = Math.max(0, -Math.sin(phase * Math.PI + (s > 0 ? 0 : Math.PI)) * 0.9 * amp);
      });
      arms.forEach(({ sh, el, s }) => {
        sh.rotation.x = -sw * s * 0.45 * amp;
        el.rotation.x = -0.25 * amp - 0.1;
        if (s > 0 && reach > 0) { sh.rotation.x = -2.6 * reach; el.rotation.x = -0.3 * reach; }
      });
      hips.position.y = 0.95 + Math.abs(Math.cos(phase * Math.PI)) * 0.03 * amp;
      torso.rotation.y = sw * 0.08 * amp;
    },
  };
}
