// copper-ore.js (v1.99) — 銅鉱石。岩場・丘の斜面・川辺の岩の近くに、ごく少なく落ちている。拾うだけ(採掘のゲームにしない)。
//   見た目: 暗い灰色の岩に、青緑(ターコイズ)の鉱脈が混じる。雪が積もっている間は、埋まって見えない(石炭と同じ)。
//   場所の選び方(pickCopperSpots)は three.js に依存しない(Nodeで試験できる)。
import * as THREE from 'three';
import { getToonGradientMap } from './shading.js';

const slopeAt = (heightAt, x, z, d = 0.7) => Math.hypot(heightAt(x + d, z) - heightAt(x - d, z), heightAt(x, z + d) - heightAt(x, z - d)) / (2 * d);

/**
 * 銅鉱石を置く場所を選ぶ。
 *  ・岩のすぐそば(岩場) / 斜面 / 川辺の岩のあたり、を好む。数は少なめ。互いに離す。
 * @returns {{x:number,z:number,pieces:{dx:number,dz:number,size:number,yaw:number}[]}[]}
 */
export function pickCopperSpots({ rng, count = 9, range, rocks = [], heightAt, bankDistanceAt, isBlocked, minSpacing = 9 }) {
  const cands = [];
  for (const rk of rocks) { // 岩場: 岩のまわり
    for (let k = 0; k < 4; k++) {
      const a = rng() * Math.PI * 2, r = rk.scale * 1.3 + 0.7 + rng() * 1.1;
      const x = rk.x + Math.cos(a) * r, z = rk.z + Math.sin(a) * r;
      cands.push({ x, z, score: 1.0 + rng() * 0.5 + (bankDistanceAt(x, z) < 3 ? 0.3 : 0) });
    }
  }
  for (let i = 0; i < 1500; i++) { // 斜面・川辺
    const x = (rng() * 2 - 1) * range, z = (rng() * 2 - 1) * range;
    const slope = slopeAt(heightAt, x, z), bank = bankDistanceAt(x, z);
    cands.push({ x, z, score: Math.min(1, slope / 0.55) * 0.7 + (bank >= 0.3 && bank <= 2.5 ? 0.4 : 0) + rng() * 0.2 });
  }
  cands.sort((a, b) => b.score - a.score);
  const out = [];
  for (const c of cands) {
    if (out.length >= count) break;
    if (Math.hypot(c.x, c.z) > range || isBlocked(c.x, c.z)) continue;
    if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < minSpacing)) continue;
    const n = 1 + (rng() < 0.4 ? 1 : 0); // 1〜2個
    const pieces = [];
    for (let k = 0; k < n; k++) { const a = rng() * Math.PI * 2, r = k === 0 ? 0 : 0.3 + rng() * 0.2; pieces.push({ dx: Math.cos(a) * r, dz: Math.sin(a) * r, size: 0.1 + rng() * 0.05, yaw: rng() * Math.PI * 2 }); }
    out.push({ x: c.x, z: c.z, pieces });
  }
  return out;
}

const ROCK_MAT = new THREE.MeshToonMaterial({ color: 0x4b4e53, gradientMap: getToonGradientMap() });
const VEIN_MAT = new THREE.MeshToonMaterial({ color: 0x2fc3a8, gradientMap: getToonGradientMap(), emissive: 0x0d4a40, emissiveIntensity: 0.5 });
function chunkGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 0), pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = Math.sin(Math.round(x * 1000) * 12.9898 + Math.round(y * 1000) * 78.233 + Math.round(z * 1000) * 37.719 + seed * 4.1414) * 43758.5453;
    const k = 0.78 + 0.4 * (n - Math.floor(n));
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals(); return g;
}
/** 銅鉱石1個ぶんの見た目(暗い灰色の岩+青緑の鉱脈)。拾った後の手持ち表示にも使う。 */
export function createCopperOreMesh(size = 1, seed = 1) {
  const g = new THREE.Group();
  const rock = new THREE.Mesh(chunkGeometry(seed), ROCK_MAT); rock.scale.set(size * 1.15, size * 0.72, size * 0.95); rock.castShadow = true; rock.receiveShadow = true; g.add(rock);
  for (let i = 0; i < 4; i++) { // 鉱脈: 岩の表面に埋め込んだ、青緑の細い板
    const v = new THREE.Mesh(new THREE.BoxGeometry(size * (0.55 + 0.25 * ((seed + i) % 3) / 2), size * 0.08, size * 0.17), VEIN_MAT);
    const a = (i / 4) * Math.PI * 2 + seed; v.position.set(Math.cos(a) * size * 0.42, size * (0.16 + 0.1 * (i % 2)), Math.sin(a) * size * 0.4);
    v.rotation.set(0.4 * Math.sin(a), -a, 0.5 * Math.cos(a)); g.add(v);
  }
  return g;
}

export function createCopperOreField({ scene, terrainHeightAt, rng, range, rocks, bankDistanceAt, isBlocked, count = 9 }) {
  const spots = pickCopperSpots({ rng, count, range, rocks, heightAt: terrainHeightAt, bankDistanceAt, isBlocked });
  const group = new THREE.Group(), pieces = []; let seed = 0;
  for (const o of spots) for (const p of o.pieces) {
    const x = o.x + p.dx, z = o.z + p.dz, y = terrainHeightAt(x, z);
    const mesh = createCopperOreMesh(p.size, ++seed); mesh.position.set(x, y + p.size * 0.1, z); mesh.rotation.y = p.yaw;
    group.add(mesh); pieces.push({ index: pieces.length, x, z, y, mesh, taken: false, iid: null });
  }
  scene.add(group);
  let hiddenBySnow = false;
  return {
    group, pieces, spots,
    setSnowDepth(d) { const hide = d > 0.1; if (hide === hiddenBySnow) return; hiddenBySnow = hide; for (const p of pieces) p.mesh.visible = !hide && !p.taken; },
    isHidden: () => hiddenBySnow,
    take(index) { const p = pieces[index]; if (!p || p.taken) return false; p.taken = true; p.mesh.visible = false; return true; },
    remaining: () => pieces.filter((p) => !p.taken).length,
  };
}
