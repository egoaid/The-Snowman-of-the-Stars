// crafting-table.js (v1.81)
// 世界に置く作業台のメッシュ。原点は「脚の根元の高さ」の中央(y=0 が地面)、正面は+z。
// 脚は地面の下まで少し伸ばしてあるので、緩い斜面でも宙に浮かない。
import * as THREE from 'three';
import { getToonGradientMap } from './shading.js';

export const CRAFTING_TABLE = {
  width: 0.95, depth: 0.6, height: 0.8,
  footprint: 0.55,   // 他の物と重ならないための円(m)
  pressRadius: 0.62, // 草が潰れる円(m)
  legSink: 0.4,      // 脚が地面の下へ伸びる長さ(m)
};

const toon = (c) => new THREE.MeshToonMaterial({ color: c, gradientMap: getToonGradientMap() });
const M = { top: toon(0x9a6a36), frame: toon(0x7a4f26), shelf: toon(0x8a5a2b), tool: toon(0x4a4a4a), plank: toon(0xc9a36a) };

export function createCraftingTableMesh() {
  const { width: W, depth: D, height: H, legSink } = CRAFTING_TABLE;
  const g = new THREE.Group();
  const box = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  };
  const topH = 0.07;
  box(W, topH, D, M.top, 0, H - topH / 2, 0);                       // 天板
  const legT = 0.08, legLen = H - topH + legSink;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(legT, legLen, legT, M.frame, sx * (W / 2 - legT / 2 - 0.03), (H - topH - legSink) / 2, sz * (D / 2 - legT / 2 - 0.03));
  }
  box(W - 0.14, 0.05, 0.04, M.frame, 0, H - topH - 0.06, D / 2 - 0.05); // 前の貫
  box(W - 0.14, 0.05, 0.04, M.frame, 0, H - topH - 0.06, -D / 2 + 0.05);
  box(W - 0.16, 0.035, D - 0.14, M.shelf, 0, 0.28, 0);              // 下の棚
  // 天板の上: 万力(すみ)と、材木の切れ端
  box(0.14, 0.09, 0.1, M.tool, W / 2 - 0.14, H + 0.045, -D / 2 + 0.12);
  const p1 = box(0.34, 0.025, 0.09, M.plank, -0.16, H + 0.0125, 0.06); p1.rotation.y = 0.25;
  const p2 = box(0.28, 0.025, 0.08, M.plank, -0.12, H + 0.0375, 0.04); p2.rotation.y = -0.2;
  return g;
}
