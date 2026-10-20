// fallen-log-system.js
// 既存の倒木(fallenLogs。createFallenTreeで作った、横に倒れた針葉樹)を、物理(physics.js)に
// つなぐ。倒木は普段は静的な見た目のまま。編集モードで持ち上げた倒木だけが、離すと動的になり、
// 落ちて転がって止まり、静的に戻る(「静的 → 持ち上げ → 動的 → スリープ → 静的」)。
//
// 倒木のメッシュは「幹の根元」が原点で、幹はローカルY軸方向に伸びている(createPineTreeと同じ)。
// cannon-esのCylinderも軸がY方向なので、物理ボディの向き = メッシュの向き。
// 物理の位置は幹の中心(根元から L/2 先)。メッシュの位置 = 中心 - R(向き)*(0, L/2, 0)。

import * as THREE from 'three';

export const LOG_DIMENSIONS = (scale) => ({ length: 1.6 * scale, radius: 0.18 * scale }); // createPineTreeの幹と同じ
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** メッシュの姿勢から、幹の中心位置を求める。 */
export function logCenterOf(mesh, length) {
  mesh.updateMatrixWorld(true);
  return new THREE.Vector3(0, length / 2, 0).applyQuaternion(mesh.quaternion).add(mesh.position);
}
/** 物理の姿勢(中心+向き)を、メッシュへ反映する。 */
export function applyPoseToMesh(mesh, length, position, quaternion) {
  mesh.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  _v.set(0, length / 2, 0).applyQuaternion(mesh.quaternion);
  mesh.position.set(position.x - _v.x, position.y - _v.y, position.z - _v.z);
}
/** 幹の軸の向き(水平)から、その向きにそろえた姿勢を作る。yaw=軸が+x方向から何ラジアン回っているか。 */
export function levelQuaternion(yaw, out = new THREE.Quaternion()) {
  return out.setFromUnitVectors(UP, _v.set(Math.cos(yaw), 0, -Math.sin(yaw)).normalize());
}
/** 姿勢から、幹の軸が水平面上で向いている角度(yaw)を求める。 */
export function yawOfQuaternion(q) {
  _v.set(0, 1, 0).applyQuaternion(_q.set(q.x, q.y, q.z, q.w));
  return Math.atan2(-_v.z, _v.x);
}

/** 丸太の軸(根元→先)に沿った点を等間隔に返す。{x,y,z} の配列(中心位置と向きから)。 */
export function logAxisSamples(position, quaternion, length, step = 0.5) {
  const n = Math.max(2, Math.ceil(length / step) + 1);
  const ax = _v.set(0, 1, 0).applyQuaternion(_q.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w));
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1) - 0.5) * length;
    out.push({ x: position.x + ax.x * t, y: position.y + ax.y * t, z: position.z + ax.z * t });
  }
  return out;
}
/**
 * 丸太の上面が、その場所の地面から見て最大どれだけの高さにあるか(m)。雪の深さがこれを超えると、丸太は雪の下に隠れる。
 * 川にかけた丸太は、河床から高い位置にあるので、その高さのまま計算する(川の上に浮いた丸太は、雪が深くならないと隠れない)。
 */
export function logBuryHeight(position, quaternion, length, radius, groundAt) {
  let need = 0.05;
  for (const p of logAxisSamples(position, quaternion, length)) need = Math.max(need, p.y + radius - groundAt(p.x, p.z));
  return need;
}
/** 丸太の一番低い所が、その場所の地面(雪面)からどれだけ離れているか(m)。負なら地面に埋まっている。 */
export function logMinClearance(position, quaternion, length, radius, groundAt) {
  let m = Infinity;
  for (const p of logAxisSamples(position, quaternion, length)) m = Math.min(m, p.y - radius - groundAt(p.x, p.z));
  return m;
}

/**
 * @param {object} p
 * @param {Array} p.fallenLogs   { x, z, scale, mesh } の配列(scene3dが作る。ここで x,z,id,物理の記録を足す)
 * @param {object} p.physics     createPhysics() の戻り値
 * @param {Array} [p.burialCandidates] 積雪で埋もれる物の一覧(静止後にbaseYを更新する)
 * @param {(x:number,z:number)=>number} [p.groundAt] v1.56-H4: 雪面を含む地面の高さ。雪に埋もれた丸太をつかんだ時に、雪面の上へ掘り出す(持ち上げる)ために使う
 */
export function createFallenLogSystem({ fallenLogs, physics, burialCandidates = [], onSettled = null, groundAt = null }) {
  const byId = new Map();
  let nextId = 1;
  for (const log of fallenLogs) attach(log);

  function attach(log) {
    if (log.physicsId !== undefined) return log;
    // v1.48: 種類ごとに寸法が違う。log.dims({length,radius,radiusTop})があればそれを使う(物理の円柱)。
    // 無ければ従来の針葉樹の幹(scaleだけで決まる)。
    const dim = log.dims || LOG_DIMENSIONS(log.scale);
    log.physicsId = 'log-' + (nextId++);
    log.length = dim.length; log.radius = dim.radius;
    const c = logCenterOf(log.mesh, dim.length);
    const q = log.mesh.quaternion;
    log.physics = physics.register({
      id: log.physicsId, kind: 'log', length: dim.length,
      radiusTop: dim.radiusTop ?? dim.radius * 0.7, radiusBottom: dim.radius,
      position: { x: c.x, y: c.y, z: c.z }, quaternion: { x: q.x, y: q.y, z: q.z, w: q.w },
      physicalProperties: log.physicalProperties, // v1.52: 質量・重力の倍率・上向きの力・粘着(無ければ既定値)
    });
    byId.set(log.physicsId, log);
    return log;
  }

  function syncMesh(log) {
    const rec = log.physics;
    applyPoseToMesh(log.mesh, log.length, rec.position, rec.quaternion);
    log.x = rec.position.x; log.z = rec.position.z; // 「拾う」対象の位置(interactionが参照)
  }
  /** v1.69: 接着した塊の全員のメッシュを、物理の姿勢へ合わせる(塊でなければ、その1本だけ)。 */
  function syncGroup(log) {
    const ids = physics.groupOf(log.physicsId);
    if (!ids) { syncMesh(log); return; }
    for (const id of ids) { const l = byId.get(id); if (l) syncMesh(l); }
  }

  physics.on('settled', (rec) => {
    const log = byId.get(rec.id);
    if (!log) return;
    syncMesh(log);
    const c = burialCandidates.find((b) => b.mesh === log.mesh);
    if (c) c.baseY = log.mesh.position.y;
    if (onSettled) onSettled(log);
  });

  /**
   * つかむ。静止中でも、離した直後(動いている最中)でもつかめる。今の位置・向きのまま持ち上げる
   * (勝手に水平にそろえたり、高さを変えたりしない。動かすのは操作用の矢印・輪)。
   */
  function grab(log) {
    if (!log || log.collected || !log.physics.grabbable) return false;
    if (!physics.pickUp(log.physicsId)) return false;
    // v1.56-H4: 雪に埋もれている丸太は、つかんだ瞬間に雪面の上まで掘り出す(姿勢は変えず、真上へ持ち上げるだけ)。
    // 雪が無い時に地面へ少し埋まっている丸太は動かさない(0.04m以下の差は無視)。
    if (groundAt) {
      const r = log.physics, clearance = logMinClearance(r.position, r.quaternion, log.length, log.radius, groundAt);
      if (clearance < -0.04) {
        physics.setHeldPose(log.physicsId, { x: r.position.x, y: r.position.y - clearance + 0.03, z: r.position.z }, r.quaternion);
      }
    }
    syncGroup(log); // 動いている最中につかんだ場合も、つかんだ瞬間の姿勢を見た目に反映する(v1.69: 塊なら全員)
    return true;
  }
  /** 持ち上げ中の丸太を、中心の位置と向き(クォータニオン)で置く。X/Y/Z移動とX/Y/Z回転はこれで表す。 */
  function moveHeldPose(log, position, quaternion) {
    if (!log || log.physics.physicsState !== 'held') return false;
    physics.setHeldPose(log.physicsId, position, quaternion);
    syncGroup(log); // v1.69: 接着した塊なら、全員がいっしょに動く
    return true;
  }
  /** 互換: 位置と水平の向き(yaw)で置く。 */
  function moveHeld(log, x, y, z, yaw = log.heldYaw ?? 0) {
    log.heldYaw = yaw;
    return moveHeldPose(log, { x, y, z }, levelQuaternion(yaw));
  }
  /** 離す(動的になり、落ちて、止まったら静的へ戻る)。 */
  function release(log, opts) {
    if (!log || log.physics.physicsState !== 'held') return false;
    return physics.release(log.physicsId, opts);
  }
  /** 拾われた倒木など、物理から外す。 */
  function remove(log) {
    if (!log || log.physicsId === undefined) return;
    physics.unregister(log.physicsId);
    byId.delete(log.physicsId);
  }
  /** 毎フレーム。動いている丸太がある時だけ物理を進め、メッシュへ反映する。 */
  function update(dt) {
    if (physics.isIdle()) return 0;
    const n = physics.step(dt);
    for (const rec of physics.all()) {
      if (rec.physicsState === 'dynamic') { const log = byId.get(rec.id); if (log) syncMesh(log); }
    }
    return n;
  }

  return {
    attach, grab, moveHeld, moveHeldPose, release, remove, update,
    /** v1.56-H4: 物理の姿勢をメッシュへ反映し直す(雪が溶けて丸太が下がった時など)。 */
    syncPose: syncMesh,
    syncGroup, // v1.69
    /** v1.69: 物理のid → 倒木。 */
    logOfPhysicsId: (id) => byId.get(id) || null,
    logs: () => fallenLogs.filter((l) => !l.collected),
    meshes: () => fallenLogs.filter((l) => !l.collected).map((l) => l.mesh),
    logOfMesh(obj) {
      for (let o = obj; o; o = o.parent) { const l = fallenLogs.find((x) => x.mesh === o); if (l) return l; }
      return null;
    },
    isIdle: () => physics.isIdle(),
  };
}
