// glue-tool.js (v1.71)
// 接着モード: 位置と角度を決めて、倒木どうしを接着する。接着したあとの再編集(角度を直す・接着を外す)もここ。
//
// 流れ(新しく接着する):
//   1. 編集モードで、星のかけらを貼った丸太をつかむ → 「接着モード」(Cキー/ボタン)
//   2. つなぐ相手の丸太をクリック(相手にも星のかけらが要る)。クリックした所が、相手の軸上の位置になる
//   3. 位置・角度のスライダーで調整(自分の丸太は、動かしながら見える)。「接着する」で確定。落下はさせない
// 再編集: 接着点(丸太に付いた金色の輪)をクリック → 「角度を直す」(その接着だけほどいて、同じ画面で直す)/「接着を外す」
// 位置と角度の計算は glue-math.js(画面に依存しない)。物理は physics.placeStatic / weld を使う。
import * as THREE from 'three';
import { logMinClearance } from './fallen-log-system.js';
import { SHARDS } from '../config.js';
import {
  GLUE_DEFAULTS, clampParam, frameOf, moverPose, inferParams, endsOf, segmentClosest, radiusOfRec,
} from './glue-math.js';

const ANGLE_PARAMS = new Set(['roll', 'psi', 'theta']);
const capture = (rec) => ({ pos: { ...rec.position }, quat: { x: rec.quaternion.x, y: rec.quaternion.y, z: rec.quaternion.z, w: rec.quaternion.w } });

export function createGlueTool({ scene, domElement, editMode, logSystem, physics, shardSystem, groundAt, onChange = null, log: dlog = null, cfg = SHARDS }) {
  const dbg = (kind, data) => { if (dlog) dlog(kind, data); };
  const changed = () => { if (onChange) onChange(); };
  const raycaster = new THREE.Raycaster();
  const logOfId = (id) => logSystem.logOfPhysicsId(id);
  const heldLog = () => (editMode._internals && editMode._internals.getHeld ? editMode._internals.getHeld() : null);
  const membersOf = (log) => (physics.groupOf(log.physicsId) || [log.physicsId]).map(logOfId).filter(Boolean);

  let session = null;   // { kind:'new'|'edit', phase:'pick'|'adjust', mover, target, params, origPose, joint, warning, hint, snap }
  let selected = null;  // 選んだ接着点 { a, b }(物理のid)
  let message = '';     // 直近の失敗の理由など(画面に出す)

  // ---- 見た目: 接着点の輪(丸太のメッシュの子=浮く時も、いっしょに動く)と、接着モード中の接点 ----
  const ringMatBase = new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.95, depthTest: false });
  const ringMatSel = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthTest: false });
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const pivot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: 0x66e0ff, depthTest: false, transparent: true, opacity: 0.95 }));
  pivot.visible = false; pivot.renderOrder = 999; scene.add(pivot);
  const markers = new Map(); // 'a|b' -> Group
  let markersKey = '';

  function makeMarker(j) {
    const la = logOfId(j.a), lb = logOfId(j.b);
    if (!la || !lb || !la.physics || !lb.physics) return null;
    const A = endsOf(la.physics), B = endsOf(lb.physics);
    const cl = segmentClosest(A.a, A.b, B.a, B.b);
    const sc = la.mesh.scale.x || 1;
    const R = (la.radius || 0.2) * 1.15 + 0.03;
    const g = new THREE.Group();
    g.position.set(0, (cl.s * la.length) / sc, 0); g.scale.setScalar(1 / sc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.045, 6, 20), ringMatBase);
    ring.rotation.x = Math.PI / 2; ring.renderOrder = 997;
    const hit = new THREE.Mesh(new THREE.SphereGeometry(R + 0.12, 8, 6), hitMat);
    g.add(ring); g.add(hit);
    g.userData = { glueMarker: true, joint: { a: j.a, b: j.b }, ring };
    la.mesh.add(g);
    return g;
  }
  function disposeMarker(g) { if (g.parent) g.parent.remove(g); g.userData.ring.geometry.dispose(); g.children.forEach((c) => c.geometry && c.geometry.dispose()); }
  function syncMarkers(t) {
    const joints = shardSystem.joints();
    const key = joints.map((j) => j.a + '|' + j.b).join(',');
    if (key !== markersKey) {
      markersKey = key;
      const want = new Set(joints.map((j) => j.a + '|' + j.b));
      for (const [k, g] of markers) if (!want.has(k)) { disposeMarker(g); markers.delete(k); }
      for (const j of joints) { const k = j.a + '|' + j.b; if (!markers.has(k)) { const g = makeMarker(j); if (g) markers.set(k, g); } }
    }
    const show = editMode.isEnabled() && !session && !editMode.isHolding();
    for (const [k, g] of markers) {
      g.visible = show;
      const sel = selected && ((selected.a + '|' + selected.b) === k);
      g.userData.ring.material = sel ? ringMatSel : ringMatBase;
      const pulse = sel ? 1 + Math.sin(t * 6) * 0.08 : 1;
      g.userData.ring.scale.setScalar(pulse);
    }
  }

  // ---- ポインタ: 丸太・接着点を狙う ----
  function pickLogs(ray, exclude) {
    const meshToLog = new Map();
    for (const l of logSystem.logs()) if (l.mesh && l.mesh.visible && !(exclude && exclude.has(l))) meshToLog.set(l.mesh, l);
    raycaster.set(ray.origin, ray.direction);
    const hits = raycaster.intersectObjects([...meshToLog.keys()], true);
    for (const h of hits) {
      if (h.object.userData && h.object.userData.glueMarker) continue;
      let o = h.object;
      while (o && !meshToLog.has(o)) o = o.parent;
      if (o) return { log: meshToLog.get(o), point: h.point };
    }
    return null;
  }
  function pickMarker(ray) {
    const gs = [...markers.values()].filter((g) => g.visible);
    if (!gs.length) return null;
    raycaster.set(ray.origin, ray.direction);
    const hits = raycaster.intersectObjects(gs, true);
    for (const h of hits) { let o = h.object; while (o && !(o.userData && o.userData.glueMarker)) o = o.parent; if (o) return o.userData.joint; }
    return null;
  }
  function pointerHook(e, ray) {
    if (session) {
      const ex = new Set(membersOf(session.mover));
      const hit = pickLogs(ray, ex);
      if (hit) { pickTarget(hit.log, hit.point); return true; }
      return false; // 何もない所: 視点の回転などに使う(何も起きない)
    }
    if (editMode.isHolding()) return false;
    const j = pickMarker(ray);
    if (j) { selected = { a: j.a, b: j.b }; message = ''; changed(); return true; }
    if (selected) { selected = null; changed(); }
    return false;
  }

  // ---- 接着モード ----
  function begin() {
    if (session) return { ok: false, reason: 'busy' };
    const mover = heldLog();
    if (!mover || !mover.physics || mover.physics.physicsState !== 'held') return { ok: false, reason: 'not-held' };
    if (!mover.starShard) return { ok: false, reason: 'no-star' };
    session = { kind: 'new', phase: 'pick', mover, target: null, params: { ...GLUE_DEFAULTS }, origPose: capture(mover.physics), joint: null, warning: '', snap: false };
    selected = null; message = '';
    editMode.setGlueActive(true);
    dbg('glue.begin', { mover: mover.physicsId });
    changed();
    return { ok: true };
  }

  function pickTarget(log, point) {
    const s = session; if (!s) return false;
    if (!log || log.collected || !log.physics) return false;
    if (log.physics.physicsState !== 'static') { message = '動いている丸太です。止まってから選んでください'; changed(); return false; }
    if (!log.starShard) { message = '相手の丸太にも、星のかけらが要ります(2本とも)'; changed(); return false; }
    const T = endsOf(log.physics);
    const L = log.physics.length;
    const tb = Math.max(0, Math.min(1, ((point.x - T.a.x) * T.u.x + (point.y - T.a.y) * T.u.y + (point.z - T.a.z) * T.u.z) / L));
    const first = s.phase === 'pick' || s.target !== log;
    s.target = log;
    if (first) { s.params = { ...GLUE_DEFAULTS, tb }; } else { s.params.tb = tb; }
    s.phase = 'adjust'; message = '';
    applyPreview();
    dbg('glue.target', { target: log.physicsId, tb: +tb.toFixed(3) });
    changed();
    return true;
  }

  function applyPreview() {
    const s = session; if (!s || !s.target) return;
    const T = s.target.physics, p = s.params;
    const fr = frameOf(T, p.tb, p.roll);
    const pose = moverPose(fr, p, { length: s.mover.length, radius: radiusOfRec(s.mover.physics) }, radiusOfRec(T));
    logSystem.moveHeldPose(s.mover, pose.pos, pose.quat);
    editMode.syncPoseFromHeld();
    let minC = Infinity;
    for (const m of membersOf(s.mover)) { const r = m.physics; minC = Math.min(minC, logMinClearance(r.position, r.quaternion, m.length, m.radius, groundAt)); }
    s.warning = minC < -cfg.glueGroundSlack ? '地面にめり込んでいます。角度か位置を変えてください' : '';
    pivot.position.copy(fr.P); pivot.visible = true;
  }

  function setParam(name, value) {
    const s = session; if (!s || !(name in s.params) || !Number.isFinite(value)) return false;
    let v = clampParam(name, value);
    if (s.snap && ANGLE_PARAMS.has(name)) v = Math.round(v / cfg.glueRotateSnap) * cfg.glueRotateSnap;
    s.params[name] = v;
    if (s.target) applyPreview();
    changed();
    return true;
  }
  function setParams(obj) { for (const [k, v] of Object.entries(obj)) setParam(k, v); return true; }
  function setSnap(on) {
    const s = session; if (!s) return;
    s.snap = !!on;
    if (s.snap) for (const k of ANGLE_PARAMS) s.params[k] = Math.round(s.params[k] / cfg.glueRotateSnap) * cfg.glueRotateSnap;
    if (s.target) applyPreview();
    changed();
  }

  function endSession() { session = null; pivot.visible = false; changed(); }

  function confirm() {
    const s = session;
    if (!s || s.phase !== 'adjust' || !s.target) return { ok: false, reason: 'no-target' };
    if (s.warning) return { ok: false, reason: 'ground' };
    const { mover, target, params } = s;
    physics.placeStatic(mover.physicsId); // 落とさず、その場で据える
    editMode.forgetHeld();
    if (!shardSystem.addJoint(mover, target)) { // 通常は起きない。つかみ直して、続けられるようにする
      editMode._internals.grabLog(mover); editMode.setGlueActive(true);
      message = '接着できませんでした(相手が動いています)';
      changed();
      return { ok: false, reason: 'weld-failed' };
    }
    dbg('glue.confirm', { kind: s.kind, mover: mover.physicsId, target: target.physicsId, params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, +v.toFixed(3)])) });
    endSession();
    return { ok: true };
  }

  function cancel() {
    const s = session; if (!s) return { ok: false };
    const { mover, origPose } = s;
    if (mover.physics.physicsState === 'held') {
      logSystem.moveHeldPose(mover, origPose.pos, origPose.quat); // はじめの姿勢へ戻す
      if (s.kind === 'edit') { // 再編集をやめる: もとの姿勢へ戻して据え、もとの接着をつなぎ直す
        physics.placeStatic(mover.physicsId);
        editMode.forgetHeld();
        const otherId = s.joint.a === mover.physicsId ? s.joint.b : s.joint.a;
        shardSystem.addJoint(mover, logOfId(otherId), { wake: false });
      } else {
        editMode.syncPoseFromHeld(); editMode.setGlueActive(false); // つかんだまま、通常の編集に戻る
      }
    }
    dbg('glue.cancel', { kind: s.kind });
    endSession();
    return { ok: true };
  }

  // ---- 再編集 ----
  function beginEdit() {
    if (session || !selected) return { ok: false, reason: 'no-selection' };
    const { a, b } = selected;
    const la = logOfId(a), lb = logOfId(b);
    if (!la || !lb) return { ok: false, reason: 'gone' };
    const comps = shardSystem.removeJoint(a, b, { wake: false });
    if (!comps) { message = '動いている最中は直せません'; changed(); return { ok: false, reason: 'moving' }; }
    const ca = comps.find((c) => c.includes(a)), cb = comps.find((c) => c.includes(b));
    if (ca === cb) { // ほかの接着で輪になっている: 戻す
      shardSystem.addJoint(la, lb, { wake: false });
      message = 'ほかの接着で輪になっているので、そのままでは直せません。先に、ほかの接着を外してください';
      changed();
      return { ok: false, reason: 'loop' };
    }
    const moveA = ca.length <= cb.length; // 小さいほうを動かす(同じなら a 側=接着した時に動かしたほう)
    const mover = moveA ? la : lb, target = moveA ? lb : la;
    if (!editMode._internals.grabLog(mover)) {
      shardSystem.addJoint(la, lb, { wake: false });
      message = 'つかめませんでした'; changed();
      return { ok: false, reason: 'grab-failed' };
    }
    const params = inferParams(target.physics, mover.physics);
    session = { kind: 'edit', phase: 'adjust', mover, target, params, origPose: capture(mover.physics), joint: { a, b }, warning: '', snap: false };
    selected = null; message = '';
    editMode.setGlueActive(true);
    applyPreview();
    dbg('glue.edit', { mover: mover.physicsId, target: target.physicsId, params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, +v.toFixed(3)])) });
    changed();
    return { ok: true };
  }
  function detachSelected() {
    if (session || !selected) return { ok: false, reason: 'no-selection' };
    const comps = shardSystem.removeJoint(selected.a, selected.b, { wake: true }); // 外した部分は、落ちて止まる(月のかけらがあれば浮く)
    if (!comps) { message = '動いている最中は外せません'; changed(); return { ok: false, reason: 'moving' }; }
    dbg('glue.detach', { a: selected.a, b: selected.b });
    selected = null; message = ''; changed();
    return { ok: true };
  }
  function clearSelection() { selected = null; changed(); }

  // ---- 状態・更新・キー ----
  editMode.setPointerHook(pointerHook);
  editMode.setBeforeDisable(() => { if (session) cancel(); selected = null; });
  let t = 0;
  function update(dt) {
    t += dt;
    if (session && !editMode.isEnabled()) endSession();
    if (session && session.mover.physics.physicsState !== 'held') endSession(); // 何かで離れた
    syncMarkers(t);
    if (selected && !(logOfId(selected.a) && logOfId(selected.b) && shardSystem.joints().some((j) => (j.a === selected.a && j.b === selected.b)))) selected = null;
  }
  function onKey(e) {
    if (!editMode.isEnabled() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (session) {
      if (e.code === 'Escape') { e.preventDefault(); cancel(); }
      else if (e.code === 'Enter' && !(e.target && e.target.tagName === 'BUTTON')) { e.preventDefault(); confirm(); }
      return;
    }
    if (e.code === 'KeyC' && !e.repeat) begin();
  }
  window.addEventListener('keydown', onKey, true);

  function getState() {
    const held = heldLog();
    const s = session;
    let beginReason = '';
    if (!s) {
      if (!held) beginReason = 'not-held'; else if (!held.starShard) beginReason = 'no-star';
    }
    const sel = selected ? { a: selected.a, b: selected.b } : null;
    return {
      active: !!s, kind: s ? s.kind : null, phase: s ? s.phase : null,
      hasTarget: !!(s && s.target),
      params: s ? { ...s.params } : null, snap: !!(s && s.snap),
      warning: s ? s.warning : '', message,
      canConfirm: !!(s && s.phase === 'adjust' && !s.warning),
      canBegin: !s && !beginReason && editMode.isEnabled(), beginReason,
      selected: sel,
      hint: s ? (s.phase === 'pick' ? '相手にする丸太をクリック(星のかけらが付いた丸太)' : '位置と角度を調整して「接着する」') : '',
    };
  }

  return {
    begin, cancel, confirm, pickTarget, setParam, setParams, setSnap,
    beginEdit, detachSelected, clearSelection, selectJoint(j) { selected = j ? { a: j.a, b: j.b } : null; changed(); },
    update, getState, isActive: () => !!session,
    _internals: { applyPreview, getSession: () => session, getSelected: () => selected, pointerHook, markers },
    dispose() { window.removeEventListener('keydown', onKey, true); for (const g of markers.values()) disposeMarker(g); markers.clear(); scene.remove(pivot); pivot.geometry.dispose(); pivot.material.dispose(); ringMatBase.dispose(); ringMatSel.dispose(); hitMat.dispose(); },
  };
}
