// tent-bundle.js (v1.92)
// たたんで収納したテント(筒状の袋+ベルト+ペグ袋)。地面に落ちている時と、手に持つ時の見た目。原点は袋の底の中心。
import * as THREE from 'three';
import { getToonGradientMap } from './shading.js';

const toon = (c) => new THREE.MeshToonMaterial({ color: c, gradientMap: getToonGradientMap() });
const M = { bag: toon(0xa8562f), cap: toon(0x3f5c62), strap: toon(0x2b2b2b), pegs: toon(0x6b6558) };
export const TENT_BUNDLE = { length: 0.95, radius: 0.22 };

export function createTentBundleMesh() {
  const { length: L, radius: R } = TENT_BUNDLE;
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, rz = 0, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.z = rz; m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  add(new THREE.CylinderGeometry(R, R, L, 10), M.bag, 0, R, 0, Math.PI / 2);                        // 袋(横向き)
  for (const s of [-1, 1]) add(new THREE.CylinderGeometry(R * 0.96, R * 0.96, 0.02, 10), M.cap, s * (L / 2 + 0.005), R, 0, Math.PI / 2); // 両端のふた
  for (const x of [-0.26, 0.26]) add(new THREE.CylinderGeometry(R * 1.06, R * 1.06, 0.05, 10), M.strap, x, R, 0, Math.PI / 2);          // ベルト
  add(new THREE.BoxGeometry(0.2, 0.1, 0.12), M.pegs, 0.0, 0.05, R + 0.1, 0, 0.2);                   // ペグ袋(横に添える)
  return g;
}
