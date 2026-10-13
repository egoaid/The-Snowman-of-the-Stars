// log-obstacles.js (v1.51)
// 倒木・枝を、雪だるまが通り抜けられない障害物にする。
//
// 既存の衝突(collisionObstacles: x-z平面の円)・見守りモードの回避ステアリング・目的地の押し出し・
// 星の落下位置の選定は、全て「円の一覧」だけを知っている。そこで倒木は、幹に沿って並べた円の列
// (数珠つなぎ)として登録する。こうすると歩行・自律移動・迂回の全てが、新しいコードなしでそのまま働く。
//
//  - 小さな小枝(WOOD_TYPES[type].walkOver)は障害物にしない = 上を歩ける。
//  - 動いている(持ち上げ中・落下中)丸太は障害物にしない。静止して(静的になって)から登録する。
//  - 拾われた(collected)丸太は外す。
import * as THREE from 'three';
import { WOOD_TYPES } from './fallen-wood.js';

export const LOG_CIRCLE_MIN_SPACING = 0.3;
export const LOG_CIRCLE_MAX_SPACING = 0.6;
const _axis = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _base = new THREE.Vector3();

/** この種類は歩いて乗り越えられる(障害物にしない)か。 */
export function isWalkOver(type) {
  const T = WOOD_TYPES[type];
  return !!(T && T.walkOver);
}

/**
 * 幹に沿った円の列を作る。
 * @param {THREE.Object3D} mesh 原点=根元、幹はローカルY軸(Phase Aの規約)
 * @param {{length:number, radius:number, radiusTop?:number}} dims
 * @returns {Array<{x:number,z:number,radius:number,low:true}>}
 */
export function buildLogCircles(mesh, dims) {
  mesh.updateMatrixWorld(true);
  _axis.copy(_up).applyQuaternion(mesh.quaternion);
  _base.copy(mesh.position);
  const L = dims.length;
  const r0 = dims.radius, r1 = dims.radiusTop ?? dims.radius * 0.7;
  const horiz = L * Math.hypot(_axis.x, _axis.z);
  const spacing = Math.min(LOG_CIRCLE_MAX_SPACING, Math.max(LOG_CIRCLE_MIN_SPACING, Math.max(r0, r1) * 1.2));
  // ほぼ垂直に立っている(水平の長さが短い)場合は、中心に1つだけ
  const n = Math.max(1, Math.ceil(horiz / spacing));
  const wall = { x1: _base.x, z1: _base.z, x2: _base.x + _axis.x * L, z2: _base.z + _axis.z * L, r: Math.max(r0, r1) }; // 迂回の経由点づくり用(planWallDetour)
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0.5 : i / n;
    const r = r0 + (r1 - r0) * t;
    out.push({ x: _base.x + _axis.x * L * t, z: _base.z + _axis.z * L * t, radius: Math.max(0.05, r), low: true, wall });
  }
  return out;
}

/**
 * collisionObstacles(配列)に倒木の円を出し入れする管理役。
 * sync(log) を毎フレーム(または姿勢が変わった時)に呼べばよい。状態が変わった時だけ作り直す。
 */
export function createLogObstacleManager(obstacles, isSolid = null) {
  const entries = new Map(); // log -> { circles, key }
  function removeEntries(log) {
    const e = entries.get(log);
    if (!e) return;
    for (const c of e.circles) { const i = obstacles.indexOf(c); if (i !== -1) obstacles.splice(i, 1); }
    entries.delete(log);
  }
  /** 現在の状態に合わせて、このログの円を作る/外す。 */
  function sync(log) {
    // v1.53: 通行できる倒木(歩いて乗れる/ジャンプで乗れる)は円の障害物にしない(traversal.jsが高さを考えて扱う)。
    const wanted = !log.collected && !isWalkOver(log.type) && log.physics && log.physics.physicsState === 'static' && (!isSolid || isSolid(log));
    if (!wanted) { removeEntries(log); return; }
    const p = log.mesh.position, q = log.mesh.quaternion;
    const key = `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)},${q.x.toFixed(3)},${q.y.toFixed(3)},${q.z.toFixed(3)},${q.w.toFixed(3)}`;
    const e = entries.get(log);
    if (e && e.key === key) return; // 変わっていない
    removeEntries(log);
    const circles = buildLogCircles(log.mesh, log.dims || { length: log.length, radius: log.radius });
    for (const c of circles) obstacles.push(c);
    entries.set(log, { circles, key });
  }
  return { sync, remove: removeEntries, count: () => [...entries.values()].reduce((s, e) => s + e.circles.length, 0), has: (log) => entries.has(log) };
}
