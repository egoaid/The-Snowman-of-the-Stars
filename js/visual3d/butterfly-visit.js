// butterfly-visit.js (v1.78)
// 蝶のイベント: 晴れた昼、花畑の近くで仰向けに寝ている雪だるまの鼻先に、蝶がとまる。
// 雪だるまが寝返りを打つ(または起きる)と、蝶は飛び立って、花畑のほうへ飛んで消える。
//   ・見た目は、花畑の蝶と同じ(pollinators.js の createButterflyMesh)
//   ・流れ: approach(花畑から飛んでくる) → landed(鼻先にとまって、翅をゆっくり開閉) → leaving(飛び立つ) → 消える
//   ・いつ起こすか(晴れ・昼・花畑の近く・確率)と、寝返りを遅らせる処理は、呼び出し側(scene3d.js / emote-brain.js)が決める
import * as THREE from 'three';
import { createButterflyMesh, flapButterfly } from './pollinators.js';

export const BUTTERFLY_VISIT = {
  speed: 1.5,            // 飛んでくる速さ(m/s)
  minApproachSeconds: 3, // 近くても、最低これだけかけて、ひらひら飛んでくる
  descendSeconds: 1.5,   // 鼻のすぐ上から、そっと降りる時間
  hoverHeight: 0.45,     // 鼻の上で、降りる前に止まる高さ(m)
  restHeight: 0.035,     // とまった時の、鼻先からの高さ(m)
  leaveSeconds: 5,       // 飛び立って、花畑まで飛んで消えるまで
  scale: 0.9,
  flyFlapSpeed: 4.2,     // 花畑の蝶と同じ羽ばたき
  restFlapSpeed: 1.6,    // とまっている時の、ゆっくりした開閉
};

const ease = (x) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };

export function createButterflyVisit(scene) {
  const P = BUTTERFLY_VISIT;
  let phase = 'idle';
  let b = null; // createButterflyMesh() の結果
  let t0 = 0, dur = 1;
  const from = new THREE.Vector3(), to = new THREE.Vector3(), cur = new THREE.Vector3(), nose = new THREE.Vector3(), tmp = new THREE.Vector3();
  let flutterPhase = 0, yaw = 0, yawRest = 0, clock = 0;

  /** 花畑(from)から鼻先(nose)まで、飛んでくるのにかかる秒数。呼び出し側が、寝返りを遅らせる長さを決めるのに使う。 */
  function approachSeconds(fromPos, nosePos) {
    const d = Math.hypot(fromPos.x - nosePos.x, fromPos.y - nosePos.y, fromPos.z - nosePos.z);
    return Math.max(P.minApproachSeconds, d / P.speed) + P.descendSeconds;
  }

  function start(fromPos, nosePos) {
    cancel();
    b = createButterflyMesh();
    b.group.scale.setScalar(P.scale);
    scene.add(b.group);
    from.set(fromPos.x, fromPos.y, fromPos.z);
    nose.set(nosePos.x, nosePos.y, nosePos.z);
    cur.copy(from);
    b.group.position.copy(cur);
    flutterPhase = Math.random() * 6.28;
    yawRest = Math.random() * 6.28;
    dur = approachSeconds(from, nose);
    t0 = clock;
    phase = 'approach';
  }

  function leave(toPos) {
    if (phase !== 'approach' && phase !== 'landed') return;
    to.set(toPos.x, toPos.y, toPos.z);
    from.copy(cur);
    t0 = clock; dur = P.leaveSeconds;
    phase = 'leaving';
  }

  function cancel() {
    if (b) { scene.remove(b.group); b = null; }
    phase = 'idle';
  }

  /** 毎フレーム。nosePos = 今の鼻先の世界座標(息で動くので、毎フレーム渡す)。 */
  function update(dt, t, nosePos) {
    clock += dt;
    if (phase === 'idle' || !b) return;
    if (nosePos) nose.set(nosePos.x, nosePos.y, nosePos.z);
    const prevX = cur.x, prevZ = cur.z;
    if (phase === 'approach') {
      const u = (clock - t0) / dur;
      const hover = tmp.set(nose.x, nose.y + P.hoverHeight, nose.z);
      const flyU = Math.min(1, u / (1 - P.descendSeconds / dur));
      if (u < 1 - P.descendSeconds / dur) {
        cur.lerpVectors(from, hover, ease(flyU));
        cur.y += Math.sin(clock * 1.7 + flutterPhase) * 0.12 * (1 - flyU) + Math.sin(clock * P.flyFlapSpeed + flutterPhase) * 0.018; // ひらひらした上下
        cur.x += Math.sin(clock * 1.1 + flutterPhase) * 0.15 * (1 - flyU);
      } else {
        const k = ease((u - (1 - P.descendSeconds / dur)) / (P.descendSeconds / dur));
        cur.set(hover.x, hover.y + (nose.y + P.restHeight - hover.y) * k, hover.z);
        cur.y += Math.sin(clock * P.flyFlapSpeed + flutterPhase) * 0.012 * (1 - k);
      }
      flapButterfly(b, clock, flutterPhase, P.flyFlapSpeed, Math.PI * 0.85);
      if (u >= 1) { phase = 'landed'; }
    } else if (phase === 'landed') {
      cur.set(nose.x, nose.y + P.restHeight, nose.z);
      flapButterfly(b, clock, flutterPhase, P.restFlapSpeed, Math.PI * 0.55);
    } else if (phase === 'leaving') {
      const u = (clock - t0) / dur;
      cur.lerpVectors(from, to, ease(u));
      cur.y += Math.sin(Math.PI * Math.min(1, u)) * 1.4 + Math.sin(clock * P.flyFlapSpeed + flutterPhase) * 0.02;
      flapButterfly(b, clock, flutterPhase, P.flyFlapSpeed, Math.PI * 0.85);
      b.group.scale.setScalar(P.scale * (u > 0.8 ? Math.max(0.001, 1 - (u - 0.8) / 0.2) : 1)); // 花畑の近くで、小さくなって消える
      if (u >= 1) { cancel(); return; }
    }
    // 向き: 飛んでいる間は進む向き。とまっている間は、とまった時の向き
    const vx = cur.x - prevX, vz = cur.z - prevZ;
    if (phase === 'landed') yaw += (yawRest - yaw) * 0.1;
    else if (Math.hypot(vx, vz) > 1e-4) {
      const target = Math.atan2(vx, vz);
      let d = target - yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      yaw += d * 0.15; yawRest = yaw;
    }
    b.group.position.copy(cur);
    b.group.rotation.y = yaw;
  }

  return {
    start, leave, cancel, update, approachSeconds,
    get phase() { return phase; },
    get position() { return cur; },
    isActive: () => phase !== 'idle',
    isLanded: () => phase === 'landed',
  };
}
