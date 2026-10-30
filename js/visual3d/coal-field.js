// coal-field.js (v1.85)
// 木炭: 太古の山火事でできた炭が、地層から顔を出している。
//   ・出る場所: 急な斜面のふちと、川岸の削れた所に、かたまり(露頭)で出る。1かたまりに2〜4個、世界に約40個。
//   ・場所は、ワールドシードから決まる(同じ世界なら、毎回同じ所)。拾った分は保存して、戻らない。
//   ・雪が積もっている間は、埋まって見えず、拾えない。
//   ・場所を選ぶ処理(pickCoalOutcrops)は、three.js に依存しない(Nodeで試験できる)。
import * as THREE from 'three';
import { getToonGradientMap } from './shading.js';

/** 斜度(0=平ら)。中心差分。 */
export function slopeAt(heightAt, x, z, d = 0.7) {
  return Math.hypot(heightAt(x + d, z) - heightAt(x - d, z), heightAt(x, z + d) - heightAt(x, z - d)) / (2 * d);
}

/**
 * 露頭の場所を選ぶ。
 * @param {object} o
 * @param {() => number} o.rng
 * @param {number} o.outcrops 露頭の数
 * @param {number} o.range 世界の半径(m)
 * @param {(x:number,z:number)=>number} o.heightAt
 * @param {(x:number,z:number)=>number} o.bankDistanceAt 水際からの距離(m)。水の中は負
 * @param {(x:number,z:number)=>boolean} o.isBlocked 置いてはいけない所(水・キャンプ・木・岩の上など)
 * @param {number} [o.minSpacing] 露頭どうしの最小の間隔(m)
 * @returns {{x:number,z:number,score:number,pieces:{dx:number,dz:number,size:number,yaw:number}[]}[]}
 */
export function pickCoalOutcrops({ rng, outcrops = 14, range, heightAt, bankDistanceAt, isBlocked, minSpacing = 6 }) {
  const cands = [];
  for (let i = 0; i < 3200; i++) {
    const x = (rng() * 2 - 1) * range, z = (rng() * 2 - 1) * range;
    if (Math.hypot(x, z) > range) continue;
    if (isBlocked(x, z)) continue;
    const slope = slopeAt(heightAt, x, z);
    const bank = bankDistanceAt(x, z);
    // 急な斜面ほど高得点。川岸(水際から0.3〜2.5m)は、削れた所として加点。少しだけ運も混ぜる。
    const score = Math.min(1, slope / 0.6) + (bank >= 0.3 && bank <= 2.5 ? 0.45 : 0) + rng() * 0.25;
    cands.push({ x, z, score });
  }
  cands.sort((a, b) => b.score - a.score);
  const out = [];
  for (const c of cands) {
    if (out.length >= outcrops) break;
    if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < minSpacing)) continue;
    const n = 2 + Math.floor(rng() * 3); // 2〜4個
    const pieces = [];
    for (let k = 0; k < n; k++) {
      const a = rng() * Math.PI * 2, r = k === 0 ? 0 : 0.28 + rng() * 0.4;
      pieces.push({ dx: Math.cos(a) * r, dz: Math.sin(a) * r, size: 0.07 + rng() * 0.06, yaw: rng() * Math.PI * 2 });
    }
    out.push({ x: c.x, z: c.z, score: c.score, pieces });
  }
  return out;
}

const COAL_MAT = new THREE.MeshToonMaterial({ color: 0x24211e, gradientMap: getToonGradientMap() });
const SEAM_MAT = new THREE.MeshToonMaterial({ color: 0x38332d, gradientMap: getToonGradientMap() });

/** 角ばった炭のかたまり。面が閉じるよう、ずらし量は「位置」から決める(岩と同じ考え方)。 */
function chunkGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = Math.sin(Math.round(x * 1000) * 12.9898 + Math.round(y * 1000) * 78.233 + Math.round(z * 1000) * 37.719 + seed * 4.1414) * 43758.5453;
    const k = 0.78 + 0.4 * (n - Math.floor(n));
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}

export function createCoalField({ scene, terrainHeightAt, rng, range, bankDistanceAt, isBlocked, outcrops = 14 }) {
  const spots = pickCoalOutcrops({ rng, outcrops, range, heightAt: terrainHeightAt, bankDistanceAt, isBlocked });
  const group = new THREE.Group();
  const pieces = [];
  let seed = 0;
  for (const o of spots) {
    // 地層のしま: 薄い板が、斜めに少しずれて重なる(半分、地面に埋まっている)
    for (let s = 0; s < 2; s++) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(0.42 - s * 0.1, 0.045, 0.26 - s * 0.05), SEAM_MAT);
      slab.position.set(o.x + (s - 0.5) * 0.06, terrainHeightAt(o.x, o.z) - 0.012 + s * 0.045, o.z);
      slab.rotation.y = (o.x * 1.7 + o.z * 0.9) % Math.PI + s * 0.25;
      slab.castShadow = true; slab.receiveShadow = true;
      group.add(slab);
    }
    for (const p of o.pieces) {
      const x = o.x + p.dx, z = o.z + p.dz;
      const y = terrainHeightAt(x, z);
      const mesh = new THREE.Mesh(chunkGeometry(++seed), COAL_MAT);
      mesh.scale.set(p.size * 1.15, p.size * 0.62, p.size * 0.95);
      mesh.position.set(x, y + p.size * 0.12, z); // 半分、埋まる
      mesh.rotation.y = p.yaw;
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
      pieces.push({ index: pieces.length, x, z, y, mesh, taken: false, iid: null });
    }
  }
  scene.add(group);
  const slabs = group.children.filter((m) => !pieces.some((p) => p.mesh === m));
  let hiddenBySnow = false;
  return {
    group, pieces, outcrops: spots,
    /** 雪が積もっている間は、埋まって見えない(拾えない)。 */
    setSnowDepth(d) {
      const hide = d > 0.1;
      if (hide === hiddenBySnow) return;
      hiddenBySnow = hide;
      for (const m of slabs) m.visible = !hide;
      for (const p of pieces) p.mesh.visible = !hide && !p.taken;
    },
    isHidden: () => hiddenBySnow,
    take(index) {
      const p = pieces[index];
      if (!p || p.taken) return false;
      p.taken = true; p.mesh.visible = false;
      return true;
    },
    remaining: () => pieces.filter((p) => !p.taken).length,
  };
}
