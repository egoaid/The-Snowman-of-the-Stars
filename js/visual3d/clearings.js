// clearings.js (v1.91)
// 地形生成: テント・かまくら・焚き火・チェスト・作業台などを置ける「ひらけた場所」の位置を選ぶ。
//   ・もともと起伏の穏やかな所を選ぶ(川の近く・世界の端・大木・キャンプのそばは避ける)。
//   ・場所の選び方はシードから決まる(同じ世界なら毎回同じ場所)。three.js に依存しない(Nodeで試験できる)。
//   ・地面を平らにする強さは、地形側(terrain.js の strength)で決める。完全には平らにせず、緩やかな起伏を残す。
import { footprintRise } from '../placement.js';

export const CLEARING = { radius: 4.5, feather: 3.2, strength: 0.72 }; // 芯の半径・なだらかに戻す幅・平らにする強さ(1=完全に平ら)

/**
 * @param {object} o
 * @param {() => number} o.rng
 * @param {number} [o.count] 作る数
 * @param {number} o.range 世界の半径(m)
 * @param {(x:number,z:number)=>number} o.naturalHeightAt 平らにする前の、地面の高さ
 * @param {(x:number,z:number)=>number} o.riverEdgeDistanceAt 水際からの距離(m)。水の中は負
 * @param {(x:number,z:number)=>boolean} [o.isBlocked] 作ってはいけない所
 * @param {{x:number,z:number}[]} [o.existing] すでにある場所(キャンプなど)。ここから minSpacing 以上離す
 * @returns {{x:number,z:number,rise:number}[]}
 */
export function pickClearings({ rng, count = 5, range, naturalHeightAt, riverEdgeDistanceAt, isBlocked = () => false, existing = [], minSpacing = 22, radius = CLEARING.radius }) {
  const cands = [];
  for (let i = 0; i < 2600; i++) {
    const x = (rng() * 2 - 1) * range, z = (rng() * 2 - 1) * range;
    if (Math.hypot(x, z) > range) continue;
    if (isBlocked(x, z)) continue;
    if (riverEdgeDistanceAt(x, z) < radius + CLEARING.feather + 2) continue; // 川の谷の斜面にかからないよう、十分離す
    const rise = footprintRise(naturalHeightAt, x, z, radius + CLEARING.feather * 0.5);
    cands.push({ x, z, rise, score: rise + rng() * 0.15 });
  }
  cands.sort((a, b) => a.score - b.score);
  const out = [];
  for (const c of cands) {
    if (out.length >= count) break;
    if (existing.some((e) => Math.hypot(e.x - c.x, e.z - c.z) < minSpacing)) continue;
    if (out.some((e) => Math.hypot(e.x - c.x, e.z - c.z) < minSpacing)) continue;
    out.push({ x: c.x, z: c.z, rise: c.rise });
  }
  return out;
}
