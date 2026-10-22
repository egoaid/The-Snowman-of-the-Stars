// shard-system.js (v1.69 / v1.71: 接着点・外す・再編集)
// 星のかけら・月のかけらで、倒木をくっつける/浮かせる。ゲーム側の決まりごと(物理エンジンは、決まりを知らない)。
//
// 星は重力を与える力を持つ。星のかけらは、倒木ほどの物をくっつけられる重力の力を持つ。
//   ・星のかけらを貼った倒木は、「くっつける力」を持つ。見た目は、倒木の真ん中あたりにかけらが付いている。
//   ・1本の倒木に付けられる星のかけらは、1つだけ。
//   ・1本ぶんの力はそれほど強くないので、2本をくっつけるには、2本のどちらにも星のかけらが要る。
//   ・v1.71: 接着は「接着モード」(glue-tool.js)で、位置と角度を決めて行う。接着した所は『接着点』(joints)として覚える。
//     (v1.69の『落ちて止まった所で触れていたら自動で接着』は、SHARDS.autoWeld=true の時だけ。既定はOFF)
//   ・v1.71: 星のかけら・月のかけらは外せる。接着点だけを外すこともできる。
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
import { segmentClosest } from './glue-math.js';

const _q = new THREE.Quaternion();
const _a = new THREE.Vector3();

/** 2本の線分(3D)の最短距離。(Ericsonの方法) */
export function segmentDistance(p1, q1, p2, q2) { return segmentClosest(p1, q1, p2, q2).dist; }

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

  // ---- v1.71: 接着点(どの丸太とどの丸太が、つながっているか)。物理の『塊』は、この一覧から作り直せる ----
  const joints = []; // { a, b } 物理のid
  const hasJoint = (a, b) => joints.some((j) => (j.a === a && j.b === b) || (j.a === b && j.b === a));
  const isStatic = (l) => !!l && !l.collected && !!l.physics && l.physics.physicsState === 'static';
  const jointsOfId = (id) => joints.filter((j) => j.a === id || j.b === id);
  /** ids(物理のid)の塊をほどいて、残っている接着点だけで、塊を作り直す。できた塊(idの配列)の一覧を返す。 */
  function rebuild(ids) {
    const set = new Set(ids);
    for (const id of ids) physics.dissolve(id);
    for (const j of joints) if (set.has(j.a) && set.has(j.b)) physics.weld(j.a, j.b);
    const seen = new Set(), comps = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      const g = physics.groupOf(id) || [id];
      g.forEach((x) => seen.add(x)); comps.push(g);
    }
    return comps;
  }
  const structureIds = (id) => physics.groupOf(id) || [id];
  /** 塊(や1本)を、動かし始める。浮く物は浮く高さへ、浮かない物は地面へ落ちて止まる。 */
  function wakeComps(comps) { for (const c of comps) physics.wake(c[0]); }
  /** 2本を、いまの姿勢のまま接着する(どちらも静止していること)。 */
  function addJoint(la, lb, { wake = true } = {}) {
    if (!la || !lb || la === lb || !isStatic(la) || !isStatic(lb)) return false;
    if (!physics.weld(la.physicsId, lb.physicsId)) return false;
    if (!hasJoint(la.physicsId, lb.physicsId)) joints.push({ a: la.physicsId, b: lb.physicsId });
    if (wake && structureHasMoon(la)) physics.wake(la.physicsId); // 月のかけらがあれば、浮く高さへ
    dbg('shard.joint.add', { a: la.physicsId, b: lb.physicsId, groupSize: structureIds(la.physicsId).length });
    changed();
    return true;
  }
  /**
   * 接着点を1つ外す。外したあとの塊(あれば2つ以上)を返す。全員が静止していなければ null。
   * @param {boolean} wake  外したあと、動かし始める(浮かない物は落ちて止まる)。再編集の途中は false
   */
  function removeJoint(a, b, { wake = true } = {}) {
    const k = joints.findIndex((j) => (j.a === a && j.b === b) || (j.a === b && j.b === a));
    if (k < 0) return null;
    const ids = [...new Set([...structureIds(a), ...structureIds(b)])];
    if (!ids.every((id) => isStatic(logOf(id)))) return null;
    joints.splice(k, 1);
    const comps = rebuild(ids);
    if (wake) wakeComps(comps);
    dbg('shard.joint.remove', { a, b, parts: comps.length });
    changed();
    return comps;
  }
  /** 星のかけらを外す。その丸太の接着点は、すべて外れる。(かけらを持ち物へ戻すのは、呼ぶ側) */
  function removeStar(log) {
    if (!log || log.collected || !log.starShard) return { ok: false, reason: 'no-star' };
    const mine = jointsOfId(log.physicsId);
    const st = log.physics.physicsState;
    let droppedHeld = false;
    if (mine.length) {
      if (st === 'held') { physics.placeStatic(log.physicsId); droppedHeld = true; } // 塊をその場で据えてから、ほどく
      else if (st !== 'static') return { ok: false, reason: 'moving' };
      const ids = [...new Set(mine.flatMap((j) => [...structureIds(j.a), ...structureIds(j.b)]))];
      for (const j of mine) joints.splice(joints.indexOf(j), 1);
      wakeComps(rebuild(ids));
    } else if (st !== 'held' && st !== 'static') return { ok: false, reason: 'moving' };
    log.starShard = false; removeVisual(log, 'star'); changed();
    dbg('shard.detach', { kind: 'star', log: log.physicsId, joints: mine.length });
    return { ok: true, droppedHeld, removedJoints: mine.length };
  }
  /** 月のかけらを外す。浮いていた物は、ゆっくり降りて止まる(つかんでいる間は、そのまま)。 */
  function removeMoon(log) {
    const m = log && structureLogs(log).find((l) => l.moonShard);
    if (!m) return { ok: false, reason: 'no-moon' };
    m.moonShard = false; m.moonFloat = false; removeVisual(m, 'moon');
    if (isStatic(log)) physics.wake(log.physicsId);
    changed();
    dbg('shard.detach', { kind: 'moon', log: m.physicsId });
    return { ok: true };
  }

  // ---- くっつく: 止まった時に、星のかけらを持つ者どうしが触れていれば、その場所でくっつく ----
  /**
   * 静止した倒木(と、その塊の全員)が、星のかけらを持つ他の倒木に触れていれば、くっつける。
   * @returns {number} くっついた(新しく接着した)組の数
   */
  function tryWeld(log) {
    if (!cfg.autoWeld) return 0; // v1.71: 既定では自動で接着しない(接着モードで位置と角度を決める)
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
          n++; if (!hasJoint(m.physicsId, x.physicsId)) joints.push({ a: m.physicsId, b: x.physicsId });
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
    // v1.70: 浮いている建造物は、塊ぜんたいが1つの剛体として、同じ位相でふわふわする(上下+ごくわずかな傾き)。
    // 以前は月のかけらを持つ1本だけが揺れて、つなぎ目がずれて見えていた。
    const done = new Set();
    for (const log of fallenLogs) {
      if (log.collected || done.has(log)) continue;
      const rec = log.physics;
      if (!rec || rec.physicsState !== 'static') continue;
      if (!log.moonShard && !rec.group) continue; // 単独で、月のかけらも無い物は、浮かない
      if (!isFloatingRec(rec)) continue;
      const members = structureLogs(log).filter((l) => !l.collected && l.physics && l.physics.physicsState === 'static');
      for (const m of members) done.add(m);
      bobStructure(members, rec.group ? rec.group.id : rec.id);
    }
  }
  const _qs = new THREE.Quaternion(), _qm = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();
  function bobStructure(members, key) {
    let ph = 0; for (let i = 0; i < key.length; i++) ph = (ph * 31 + key.charCodeAt(i)) % 628;
    ph /= 100; // 塊ごとに位相が違う(塊の中では全員同じ)
    const w = (Math.PI * 2) / cfg.bobPeriodSec;
    const dy = Math.sin(time * w + ph) * cfg.bobAmplitude;
    const tilt = (cfg.bobTiltDeg * Math.PI) / 180;
    _e.set(Math.sin(time * w * 0.8 + ph + 1.3) * tilt, 0, Math.cos(time * w * 0.7 + ph) * tilt);
    _qs.setFromEuler(_e);
    let cx = 0, cy = 0, cz = 0;
    for (const m of members) { cx += m.physics.position.x; cy += m.physics.position.y; cz += m.physics.position.z; }
    cx /= members.length; cy /= members.length; cz /= members.length;
    for (const m of members) {
      const r = m.physics;
      _v.set(r.position.x - cx, r.position.y - cy, r.position.z - cz).applyQuaternion(_qs);
      _qm.set(r.quaternion.x, r.quaternion.y, r.quaternion.z, r.quaternion.w).premultiply(_qs);
      applyPoseToMesh(m.mesh, m.length, { x: cx + _v.x, y: cy + _v.y + dy, z: cz + _v.z }, _qm);
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
    // v1.71: 接着点。(古い保存には j が無い。その時は g(塊)から、触れている組を接着点として作り直す)
    const j = joints.map((x) => [indexOf(logOf(x.a)), indexOf(logOf(x.b))]).filter((p2) => p2[0] >= 0 && p2[1] >= 0);
    return { s, m, g, j };
  }
  /** 古い保存(接着点なし)の塊から、接着点を作る: 触れている組を結び、つながらない所は、いちばん近い組で結ぶ。 */
  function deriveLegacyJoints(ls) {
    const parent = ls.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const pairs = [];
    for (let i = 0; i < ls.length; i++) for (let k = i + 1; k < ls.length; k++) {
      const A = logEnds(ls[i].physics), B = logEnds(ls[k].physics);
      pairs.push({ i, k, d: segmentDistance(A.a, A.b, B.a, B.b) });
    }
    pairs.sort((x, y) => x.d - y.d);
    const out = [];
    for (const p2 of pairs) { // 近い組から結ぶ(すでにつながっている組は結ばない)
      if (find(p2.i) === find(p2.k)) continue;
      parent[find(p2.i)] = find(p2.k); out.push([ls[p2.i], ls[p2.k]]);
    }
    return out;
  }
  function restore(d) {
    if (!d) return;
    for (const i of d.s || []) { const l = fallenLogs[i]; if (l && !l.collected && !l.starShard) { l.starShard = true; addVisual(l, 'star'); } }
    for (const i of d.m || []) { const l = fallenLogs[i]; if (l && !l.collected && !l.moonShard) { l.moonShard = true; l.moonFloat = true; addVisual(l, 'moon'); } }
    if (d.j && d.j.length) {
      for (const [ia, ib] of d.j) { const la = fallenLogs[ia], lb = fallenLogs[ib]; if (isStatic(la) && isStatic(lb)) addJoint(la, lb, { wake: false }); }
    } else {
      for (const grp of d.g || []) {
        const ls = grp.map((i) => fallenLogs[i]).filter((l) => isStatic(l));
        for (const [la, lb] of deriveLegacyJoints(ls)) addJoint(la, lb, { wake: false });
      }
    }
    changed();
    dbg('shard.restore', { star: (d.s || []).length, moon: (d.m || []).length, groups: (d.g || []).length, joints: joints.length });
  }

  return {
    canAttachStar, canAttachMoon, attachStar, attachMoon,
    tryWeld, update, isLocked, floating, serialize, restore,
    addJoint, removeJoint, removeStar, removeMoon, // v1.71
    joints: () => joints.map((j) => ({ a: j.a, b: j.b })),
    jointsOf: (log) => (log ? jointsOfId(log.physicsId).map((j) => ({ a: j.a, b: j.b })) : []),
    structureLogs, rebuild,
    info(log) {
      return {
        held: isHeld(log), hasStar: !!(log && log.starShard), structureHasMoon: log ? structureHasMoon(log) : false,
        groupSize: log ? (physics.groupOf(log.physicsId) || [1]).length : 0,
        hasMoon: !!(log && log.moonShard), joints: log ? jointsOfId(log.physicsId).length : 0,
      };
    },
    count: () => ({ star: fallenLogs.filter((l) => l.starShard && !l.collected).length, moon: fallenLogs.filter((l) => l.moonShard && !l.collected).length }),
    dispose() { starGeo.dispose(); moonGeo.dispose(); starMat.dispose(); moonMat.dispose(); physics.removeForceField('moon-hover'); },
  };
}
