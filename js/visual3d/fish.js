// fish.js
// 川の中を泳ぐ小さな魚を数匹だけ配置する。透明な水面の下に見えることで
// 「水の透明感」を演出する狙い。
// 軽量にするため:
// - 頂点数の少ない単純な形状(本体+尾びれの2パーツ)のみ
// - 匹数はごく少数(既定7匹)で、個別のMeshを直接動かすだけ
//   (草や落ち葉のような大量描画ではないのでInstancedMeshにする必要がない)
// - 毎フレームの計算は三角関数を数回呼ぶだけの軽いもの

import * as THREE from 'three';
import { getRiver } from './river.js';
import { makeRng, randRange } from './rng.js';
import { getToonGradientMap } from './shading.js';

const FISH_COLORS = [0x8a9a9c, 0x6b7a4a, 0x53656a, 0x7d8a52];

function createFishMesh(color) {
  const group = new THREE.Group();
  const material = new THREE.MeshToonMaterial({ color, gradientMap: getToonGradientMap() });

  const bodyGeo = new THREE.OctahedronGeometry(0.09, 0);
  bodyGeo.scale(1.0, 0.55, 2.3);
  const body = new THREE.Mesh(bodyGeo, material);
  body.castShadow = false;
  body.receiveShadow = false;
  group.add(body);

  const tailGeo = new THREE.ConeGeometry(0.08, 0.14, 4);
  tailGeo.rotateX(-Math.PI / 2);
  tailGeo.scale(1, 0.35, 1);
  const tail = new THREE.Mesh(tailGeo, material);
  tail.position.z = -0.17; // lookAt()ではローカル+Zが進行方向を向くため、尾は-Z側(後方)に置く
  tail.castShadow = false;
  tail.receiveShadow = false;
  group.add(tail);

  group.userData.tail = tail;
  return group;
}

/**
 * @param {(x:number,z:number)=>number} terrainHeightFn
 * @param {object} [options]
 * @param {number} [options.count]
 * @param {number} [options.maxRadius] - 原点からこの距離以内の川の区間にだけ魚を配置する
 *   (プレイヤーが歩ける範囲の外に魚がいても意味がないため)
 */
export function createFish(terrainHeightFn, options = {}) {
  const count = options.count ?? 9;
  const rng = makeRng(options.seed ?? 2024);
  const samples = getRiver().centerline;

  // プレイヤーが歩ける範囲(原点からmaxRadius以内)に収まる区間だけを使う
  let tMin = 0;
  let tMax = 1;
  if (options.maxRadius) {
    const validIdx = [];
    samples.forEach((s, i) => {
      if (Math.hypot(s.x, s.z) <= options.maxRadius) validIdx.push(i);
    });
    if (validIdx.length >= 2) {
      tMin = validIdx[0] / (samples.length - 1);
      tMax = validIdx[validIdx.length - 1] / (samples.length - 1);
    }
  }

  const group = new THREE.Group();
  const fishList = [];

  for (let i = 0; i < count; i++) {
    const mesh = createFishMesh(FISH_COLORS[i % FISH_COLORS.length]);
    const scale = randRange(rng, 0.8, 1.3);
    mesh.scale.set(scale, scale, scale);
    group.add(mesh);
    fishList.push({
      mesh,
      t: randRange(rng, tMin, tMax),
      dir: rng() < 0.5 ? 1 : -1,
      speed: randRange(rng, 0.006, 0.014),
      lateralPhase: rng() * Math.PI * 2,
      lateralSpeed: randRange(rng, 0.3, 0.6),
      lateralAmount: randRange(rng, 0.3, 0.7),
      depthOffset: randRange(rng, 0.05, 0.12),
      tailPhase: rng() * Math.PI * 2,
      paused: false,
      nextDecisionTime: randRange(rng, 1, 6), // 少しずつタイミングをずらす
    });
  }

  function sampleAt(t) {
    const clamped = Math.max(0, Math.min(1, t));
    const idx = clamped * (samples.length - 1);
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const frac = idx - i0;
    const a = samples[i0];
    const b = samples[i1];
    return {
      x: a.x + (b.x - a.x) * frac,
      z: a.z + (b.z - a.z) * frac,
      width: a.width + (b.width - a.width) * frac,
      tanX: b.x - a.x,
      tanZ: b.z - a.z,
    };
  }

  /** @param {number} time */
  function update(time) {
    for (const f of fishList) {
      // 一定時間ごとに「泳ぐ/静止する」を切り替える(ずっと泳ぎ続けないようにする)
      if (time >= f.nextDecisionTime) {
        f.paused = !f.paused && rng() < 0.4;
        f.nextDecisionTime = time + (f.paused ? randRange(rng, 1.5, 4) : randRange(rng, 3, 7));
      }

      if (!f.paused) {
        f.t += f.speed * f.dir * 0.02;
        if (f.t > tMax) { f.t = tMax; f.dir = -1; }
        if (f.t < tMin) { f.t = tMin; f.dir = 1; }
      }

      const s = sampleAt(f.t);
      const tLen = Math.hypot(s.tanX, s.tanZ) || 1;
      const tx = (s.tanX / tLen) * f.dir;
      const tz = (s.tanZ / tLen) * f.dir;
      const nx = -tz / f.dir; // 進行方向に垂直(向き反転の影響を受けない一定の左右方向)
      const nz = tx / f.dir;

      const maxLateral = Math.max(0.15, s.width * 0.5 - 0.35);
      const lateral = Math.sin(time * f.lateralSpeed + f.lateralPhase) * f.lateralAmount * maxLateral * 0.5;
      const x = s.x + nx * lateral;
      const z = s.z + nz * lateral;
      const y = terrainHeightFn(x, z) + f.depthOffset;

      f.mesh.position.set(x, y, z);
      f.mesh.lookAt(x + tx, y, z + tz);

      const tail = f.mesh.userData.tail;
      if (tail) {
        // 静止中は尾びれをゆっくり小さく、泳いでいる時は素早く大きく振る
        const wiggleSpeed = f.paused ? 3 : 7;
        const wiggleAmount = f.paused ? 0.2 : 0.6;
        tail.rotation.y = Math.sin(time * wiggleSpeed + f.tailPhase) * wiggleAmount;
      }
    }
  }

  return { group, update };
}
