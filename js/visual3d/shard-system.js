// shard-system.js (v1.69)
// 星のかけら・月のかけらで、倒木をくっつける/浮かせる。ゲーム側の決まりごと(物理エンジンは、決まりを知らない)。
//
// 星は重力を与える力を持つ。星のかけらは、倒木ほどの物をくっつけられる重力の力を持つ。
//   ・星のかけらを貼った倒木は、「くっつける力」を持つ。見た目は、倒木の真ん中あたりにかけらが付いている。
//   ・1本の倒木に付けられる星のかけらは、1つだけ。
//   ・1本ぶんの力はそれほど強くないので、2本をくっつけるには、2本のどちらにも星のかけらが要る。
//   ・星のかけらを貼った倒木どうしが、止まった時に触れていると、その場所でくっつく(物理は physics.weld)。
// 月は反重力の力を持つ。月のかけらを、組んだ物(1本でもよい)のどこかに貼ると、その物が少し宙に浮く。
//   ・組んだ物ぜんたいに、月のかけらは1つだけ。
//   ・浮く時は、地面から hoverClearance の高さへ、ゆっくり持ち上がって止まる(静止すれば静的に戻る。物理は動き続けない)。
//
// 貼れるのは、編集モードでつかんでいる倒木だけ。かけらの個数の管理(持ち物・チェスト)は、呼ぶ側(scene3d)が行う。

import * as THREE from 'three';
import { applyPoseToMesh, logMinClearance } from './fallen-log-system.js';
import { createCrescentGeometry } from './moon-stone.js';
import { createStarGeometry } from './snowman.js';
import { SHARDS } from '../config.js';

const _q = new THREE.Quaternion();
const _a = new THREE.Vector3();

/** 2本の線分(3D)の最短距離。(Ericsonの方法) */
export function segmentDistance(p1, q1, p2, q2) {
  const d1 = { x: q1.x - p1.x, y: q1.y - p1.y, z: q1.z - p1.z };
  const d2 = { x: q2.x - p2.x, y: q2.y - p2.y, z: q2.z - p2.z };
  const r = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z };
  const dot = (u, v) => u.x * v.x + u.y * v.y + u.z * v.z;
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s, t;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) { s = t = 0; }
  else if (a <= EPS) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = dot(d1, r);
    if (e <= EPS) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = dot(d1, d2), denom = a * e - b * b;
      s = denom > EPS ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  const c1 = { x: p1.x + d1.x * s, y: p1.y + d1.y * s, z: p1.z + d1.z * s };
  const c2 = { x: p2.x + d2.x * t, y: p2.y + d2.y * t, z: p2.z + d2.z * t };
  return Math.hypot(c1.x - c2.x, c1.y - c2.y, c1.z - c2.z);
}

/** 物理の記録(位置=中心、向き)から、丸太の軸の両端を求める。 */
export function logEnds(rec) {
  _a.set(0, 1, 0).applyQuaternion(_q.set(rec.quaternion.x, rec.quaternion.y, rec.quaternion.z, rec.quaternion.w));
  const h = rec.length / 2;
  return {
    a: { x: rec.position.x - _a.x * h, y: rec.position.y - _a.y * h, z: rec.position.z - _a.z * h },
    b: { x: rec.position.x + _a.x * h, y: rec.position.y + _a.y * h, z: rec.position.z + _a.z * h },
  };
}

/** 2本の丸太が触れているか(軸どうしの距離 ≤ 半径の和 + すき間の許容)。 */
export function logsTouching(recA, recB, tol = SHARDS.contactTolerance) {
  const A = logEnds(recA), B = logEnds(recB);
  const ra = (recA.radiusTop + recA.radiusBottom) / 2, rb = (recB.radiusTop + recB.radiusBottom) / 2;
  return segmentDistance(A.a, A.b, B.a, B.b) <= ra + rb + tol;
}

/**
 * @param {object} p
 * @param {Array} p.fallenLogs  scene3dの倒木の配列(各要素に physics, physicsId, mesh, length, radius がある)
 * @param {object} p.physics    createPhysics() の戻り値
 * @param {object} p.logSystem  createFallenLogSystem() の戻り値(logOfPhysicsId を使う)
 * @param {(x:number,z:number)=>number} p.groundAt  雪面を含む地面の高さ
 * @param {() => void} [p.onChange] 貼った・くっついた・浮いた時に呼ぶ(UIの更新用)
 */
export function createShardSystem({ fallenLogs, physics, logSystem, groundAt, onChange = null, cfg = SHARDS, log: dlog = null }) {
  const dbg = (kind, data) => { if (dlog) dlog(kind, data); }; // デバッグログ(省略可)
  const hasDOM = typeof document !== 'undefined';
  const starGeo = createStarGeometry(0.105);
  const moonGeo = createCrescentGeometry(0.14);
  const starMat = new THREE.MeshBasicMaterial({ color: 0xffe27a, fog: false });
  const moonMat = new THREE.MeshBasicMaterial({ color: 0xdcecff, fog: false });
  let time = 0;
  const changed = () => { if (onChange) onChange(); };

  const logOf = (physId) => logSystem.logOfPhysicsId(physId);
  const structureLogs = (log) => (physics.groupOf(log.physicsId) || [log.physicsId]).map(logOf).filter(Boolean);

  // ---- 見た目: かけらは、倒木のメッシュの子にする(倒木といっしょに動く)。倒木の真ん中あたり。 ----
  function addVisual(log, kind) {
    const s = log.mesh.scale.x || 1; // メッシュの拡大率を打ち消して、かけらの大きさを一定にする
    const mesh = new THREE.Mesh(kind === 'star' ? starGeo : moonGeo, kind === 'star' ? starMat : moonMat);
    const R = (log.radius || 0.18) * 1.04, mid = (log.length || 1.6) / 2;
    if (kind === 'star') { mesh.position.set(R / s, mid / s, 0); mesh.rotation.y = Math.PI / 2; }                 // +x側(星の面が外を向く)
    else { mesh.position.set(R / s, (mid + (log.length || 1.6) * 0.27) / s, 0); mesh.rotation.y = Math.PI / 2; }    // 星のかけらと同じ+x側、真ん中から少し先(三日月が外を向く)
    mesh.scale.setScalar(1 / s);
    mesh.userData.shard = kind;
    log.mesh.add(mesh);
    if (kind === 'star') log.starShardMesh = mesh; else log.moonShardMesh = mesh;
  }
  function removeVisual(log, kind) {
    const m = kind === 'star' ? log.starShardMesh : log.moonShardMesh;
    if (m && m.parent) m.parent.remove(m);
    if (kind === 'star') log.starShardMesh = null; else log.moonShardMesh = null;
  }

  // ---- 貼る ----
  const isHeld = (log) => !!log && !log.collected && log.physics && log.physics.physicsState === 'held';
  const structureHasMoon = (log) => structureLogs(log).some((l) => l.moonShard);
  function canAttachStar(log) { return isHeld(log) && !log.starShard; }
  function canAttachMoon(log) { return isHeld(log) && !structureHasMoon(log); }
  function attachStar(log) {
    if (!canAttachStar(log)) return false;
    log.starShard = true; addVisual(log, 'star'); changed();
    dbg('shard.attach', { kind: 'star', log: log.physicsId, structure: (physics.groupOf(log.physicsId) || [log.physicsId]).length });
    return true;
  }
  function attachMoon(log) {
    if (!canAttachMoon(log)) return false;
    log.moonShard = true; addVisual(log, 'moon'); changed();
    dbg('shard.attach', { kind: 'moon', log: log.physicsId, structure: (physics.groupOf(log.physicsId) || [log.physicsId]).length });
    return true;
  }

  // ---- くっつく: 止まった時に、星のかけらを持つ者どうしが触れていれば、その場所でくっつく ----
  /**
   * 静止した倒木(と、その塊の全員)が、星のかけらを持つ他の倒木に触れていれば、くっつける。
   * @returns {number} くっついた(新しく接着した)組の数
   */
  function tryWeld(log) {
    if (!log || log.collected || !log.physics || log.physics.physicsState !== 'static') return 0;
    let n = 0;
    const members = structureLogs(log);
    for (const m of members) {
      if (!m.starShard) continue;
      for (const x of fallenLogs) {
        if (x === m || x.collected || !x.starShard || !x.physics || x.physics.physicsState !== 'static') continue;
        const g = physics.groupOf(x.physicsId);
        if (g && g.includes(m.physicsId)) continue; // すでに同じ塊
        if (logsTouching(m.physics, x.physics, cfg.contactTolerance) && physics.weld(m.physicsId, x.physicsId)) {
          n++;
          dbg('shard.weld', { a: m.physicsId, b: x.physicsId, groupSize: (physics.groupOf(m.physicsId) || []).length });
        }
      }
    }
    if (n) changed();
    return n;
  }

  // ---- 浮く: 月のかけらを持つ物は、地面から hoverClearance の高さへ上がって止まる ----
  const isFloatingRec = (rec) => {
    const ids = rec.group ? rec.group.ids : [rec.id];
    for (const id of ids) { const l = logOf(id); if (l && l.moonShard) return true; }
    return false;
  };
  const hoverState = new Map(); // leaderId -> { err, speed, steady }
  physics.addForceField({
    id: 'moon-hover', sustains: true,
    appliesTo: isFloatingRec,
    force(rec, body) {
      const ids = rec.group ? rec.group.ids : [rec.id];
      let clr = Infinity;
      for (const id of ids) {
        const r = physics.get(id);
        clr = Math.min(clr, logMinClearance(r.position, r.quaternion, r.length, r.radiusBottom, groundAt));
      }
      const g = Math.abs(physics.gravity()), m = body.mass;
      const err = cfg.hoverClearance - clr;
      const st = hoverState.get(rec.id) || { steady: 0 };
      st.err = err; st.speed = body.velocity.length(); hoverState.set(rec.id, st);
      // 重力を打ち消し、目標の高さへ戻すバネ(固有振動 4rad/s)+ 減衰。横の動きも抑える。
      const ay = g + 16 * err - 7.2 * body.velocity.y;
      return { x: -m * 1.2 * body.velocity.x, y: m * ay, z: -m * 1.2 * body.velocity.z };
    },
  });

  /** 毎フレーム: 浮く高さで落ち着いたら静止(静的)に戻す。静止して浮いている物は、ゆっくり上下にゆれる(見た目だけ)。 */
  function update(dt) {
    time += dt;
    for (const [leaderId, st] of hoverState) {
      const rec = physics.get(leaderId);
      if (!rec || rec.physicsState !== 'dynamic') { hoverState.delete(leaderId); continue; }
      if (Math.abs(st.err) < 0.05 && st.speed < 0.08) st.steady += dt; else st.steady = 0;
      if (st.steady >= cfg.hoverSteadySec) {
        hoverState.delete(leaderId); physics.freeze(leaderId); changed();
        dbg('shard.hover.freeze', { leader: leaderId, err: +st.err.toFixed(3), members: (physics.groupOf(leaderId) || [leaderId]).length });
      }
    }
    for (const log of fallenLogs) {
      if (!log.moonShard && !log.moonFloat) continue;
      const rec = log.physics;
      if (!rec || rec.physicsState !== 'static') continue;
      if (!isFloatingRec(rec)) continue;
      const off = Math.sin(time * 1.1 + (log.physicsId.length * 1.7) + (rec.group ? rec.group.id.length : 0)) * 0.035;
      applyPoseToMesh(log.mesh, log.length, { x: rec.position.x, y: rec.position.y + off, z: rec.position.z }, rec.quaternion);
    }
  }

  // ---- 状態の問い合わせ ----
  /** 拾えない(世界に据え付けられた物)か。かけらを持つ倒木・塊の一員は、拾わない。 */
  function isLocked(log) { return !!(log && (log.starShard || log.moonShard || physics.groupOf(log.physicsId))); }
  function floating(log) { return !!log && structureLogs(log).some((l) => l.moonShard); }

  // ---- 保存 ----
  const indexOf = (log) => fallenLogs.indexOf(log);
  function serialize() {
    const s = [], m = [], g = [], seen = new Set();
    fallenLogs.forEach((l, i) => {
      if (l.collected) return;
      if (l.starShard) s.push(i);
      if (l.moonShard) m.push(i);
      const ids = physics.groupOf(l.physicsId);
      if (ids && !seen.has(ids[0])) { ids.forEach((x) => seen.add(x)); g.push(ids.map((x) => indexOf(logOf(x))).filter((i2) => i2 >= 0)); }
    });
    return { s, m, g };
  }
  function restore(d) {
    if (!d) return;
    for (const i of d.s || []) { const l = fallenLogs[i]; if (l && !l.collected && !l.starShard) { l.starShard = true; addVisual(l, 'star'); } }
    for (const i of d.m || []) { const l = fallenLogs[i]; if (l && !l.collected && !l.moonShard) { l.moonShard = true; l.moonFloat = true; addVisual(l, 'moon'); } }
    for (const grp of d.g || []) {
      const ls = grp.map((i) => fallenLogs[i]).filter((l) => l && !l.collected && l.physics && l.physics.physicsState === 'static');
      for (let k = 1; k < ls.length; k++) physics.weld(ls[0].physicsId, ls[k].physicsId);
    }
    changed();
    dbg('shard.restore', { star: (d.s || []).length, moon: (d.m || []).length, groups: (d.g || []).length });
  }

  return {
    canAttachStar, canAttachMoon, attachStar, attachMoon,
    tryWeld, update, isLocked, floating, serialize, restore,
    info(log) {
      return {
        held: isHeld(log), hasStar: !!(log && log.starShard), structureHasMoon: log ? structureHasMoon(log) : false,
        groupSize: log ? (physics.groupOf(log.physicsId) || [1]).length : 0,
      };
    },
    count: () => ({ star: fallenLogs.filter((l) => l.starShard && !l.collected).length, moon: fallenLogs.filter((l) => l.moonShard && !l.collected).length }),
    dispose() { starGeo.dispose(); moonGeo.dispose(); starMat.dispose(); moonMat.dispose(); physics.removeForceField('moon-hover'); },
  };
}
