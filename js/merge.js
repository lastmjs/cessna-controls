// Performance: merge every part of the airplane that never moves into one mesh per material.
// Study mode keeps the original separate parts (so each can be clicked and highlighted);
// the simulator shows the merged version, which needs far fewer draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Collects every Object3D referenced (up to a few levels deep) from handle objects.
export function collectObjects(...handles) {
  const out = new Set();
  const visit = (v, depth) => {
    if (!v || depth > 4) return;
    if (v.isObject3D) { out.add(v); return; }
    if (v.isMaterial || v.isTexture || typeof v !== 'object') return;
    for (const k of Object.keys(v)) visit(v[k], depth + 1);
  };
  handles.forEach(h => visit(h, 0));
  return out;
}

// Every mesh is merged into its nearest moving ancestor (or the root, for parts that never
// move), one merged mesh per material. Moving parts keep moving because their merged mesh is a
// child of the same group the simulator animates.
export function buildStaticMerge(root, dynamic) {
  root.updateMatrixWorld(true);
  const nearestDyn = (o) => { for (let p = o.parent; p && p !== root; p = p.parent) if (dynamic.has(p)) return p; return root; };
  const buckets = new Map();
  const replaced = [];
  const m4 = new THREE.Matrix4();
  root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || !o.visible || dynamic.has(o)) return;
    const mat = o.material;
    if (Array.isArray(mat) || (mat.transparent && !mat.userData.mergeable)) return;
    const owner = nearestDyn(o);
    // Skip parts whose own subtree is hidden (shown only in some states)
    for (let p = o.parent; p && p !== owner; p = p.parent) if (!p.visible) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    const keep = new THREE.BufferGeometry();
    keep.setAttribute('position', g.attributes.position);
    if (!g.attributes.normal) g.computeVertexNormals();
    keep.setAttribute('normal', g.attributes.normal);
    keep.setAttribute('uv', g.attributes.uv || new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    m4.copy(owner.matrixWorld).invert().multiply(o.matrixWorld);
    keep.applyMatrix4(m4);
    if (m4.determinant() < 0) {
      // Mirrored parts: reverse the triangle winding so they still face outward
      for (const name of ['position', 'normal', 'uv']) {
        const a = keep.attributes[name], sz = a.itemSize, arr = a.array;
        for (let i = 0; i < a.count; i += 3) for (let k = 0; k < sz; k++) { const t = arr[(i + 1) * sz + k]; arr[(i + 1) * sz + k] = arr[(i + 2) * sz + k]; arr[(i + 2) * sz + k] = t; }
      }
    }
    const key = owner.uuid + '|' + mat.uuid + (o.castShadow ? '|c' : '') + (o.receiveShadow ? '|r' : '');
    if (!buckets.has(key)) buckets.set(key, { owner, mat, cast: o.castShadow, receive: o.receiveShadow, geos: [] });
    buckets.get(key).geos.push(keep);
    replaced.push(o);
  });
  const added = [];
  for (const b of buckets.values()) {
    const geo = mergeGeometries(b.geos, false);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, b.mat);
    mesh.castShadow = b.cast; mesh.receiveShadow = b.receive;
    mesh.raycast = () => {};
    mesh.visible = false;
    b.owner.add(mesh);
    added.push(mesh);
  }
  return {
    count: added.length, replaced: replaced.length,
    setMerged(on) { for (const m of added) m.visible = on; for (const o of replaced) o.visible = !on; },
  };
}
