// edit-mode.js
// 編集(観察)モード: 斜め上から世界を見下ろし、倒木をつかんで動かす。
// プレイヤーは雪だるまを直接操作せず、環境(倒木など)を変える。雪だるまは自律的に歩き続ける。
//
// ■ カメラ(一般的な3Dエディタの操作)
//   右ドラッグ=回転(オービット) / 中ドラッグ=パン(平行移動) / ホイール=ズーム / 左ドラッグ=つかむ・動かす。
//   中ボタンのないマウス・キーボード向けに、W/A/S/D・矢印キーでもパンできる(Shiftで速く)。
//   パンは地面と平行に動き(高さが変わらない)、世界全体(地形の端まで)を見て回れる。
//
// ■ 倒木の操作(つかんでいる間だけ、小さな操作用の矢印/輪=ギズモが出る)
//   倒木をクリック=つかむ。離した直後で動いている最中の丸太も、すぐにつかめる(止まるのを待たない)。
//   つかんでいる間は、ボタンを離してもつかんだまま。
//   移動モード(Gキー): 赤=X・緑=Y(高さ)・青=Z の矢印をドラッグで、その軸に沿って動かす。
//                     丸太そのものをドラッグすると、今の高さのまま水平に動く(水の上でも同じ)。
//   回転モード(Rキー): 赤・緑・青の輪をドラッグで、X・Y・Z軸まわりに回す(Shiftで15度刻み)。
//   離す: 何もない所をクリック / Space / Enter / Esc。離すと落ちて、転がって、止まる。
//   (v1.46の「左ボタンを離したら落とす」「ホイールで回転」「Q/E」は廃止した)
//
// このモジュールは入力と見た目(ギズモ・枠・落下点の輪)・カメラだけ。物理はfallen-log-system/physics側。

import * as THREE from 'three';

export const EDIT = {
  viewDistance: 26,         // 編集モードに入った時の、見下ろすカメラの距離
  viewDir: new THREE.Vector3(0.55, 0.8, 0.55).normalize(), // 斜め上(仰角約53度)から
  minDistance: 3, maxDistance: 160,
  maxPolar: Math.PI * 0.47, // 地平線より下には回り込まない
  panKeySpeed: 0.9,         // キーのパン速度(カメラ距離の何倍/秒)
  panKeyFast: 3,
  gizmoScreenSize: 0.12,    // ギズモの大きさ(カメラ距離に対する比。画面上で一定の大きさに見える)
  rotateSnap: Math.PI / 12, // Shift併用時の回転刻み(15度)
  minClearance: 0.3,        // つかんだ丸太の中心が、地面より下(半径×この値)へは入らない
  colors: { x: 0xff5a5a, y: 0x5aff7a, z: 0x5a8cff },
};

const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

// ---- 純粋な計算(単体でテストできる) ----

/** 視線(origin,dir)に最も近い、軸(点p・単位ベクトルa)上の位置のパラメータt。軸と視線が平行ならnull。 */
export function closestParamOnAxis(origin, dir, p, a) {
  const w0 = new THREE.Vector3().subVectors(p, origin);
  const b = a.dot(dir), c = a.dot(w0), e = dir.dot(w0);
  const denom = 1 - b * b;
  if (denom < 1e-4) return null;
  return (b * e - c) / denom;
}
/** 軸aまわりの、ベクトルv0からv1への符号つき角度(ラジアン)。 */
export function signedAngleAboutAxis(a, v0, v1) {
  const cross = new THREE.Vector3().crossVectors(v0, v1);
  return Math.atan2(a.dot(cross), v0.dot(v1));
}
/** 視線と、点c・法線nの平面の交点。平行ならnull。 */
export function rayPlaneHit(origin, dir, c, n) {
  const d = dir.dot(n);
  if (Math.abs(d) < 1e-4) return null;
  const t = new THREE.Vector3().subVectors(c, origin).dot(n) / d;
  if (!(t > 0)) return null;
  return new THREE.Vector3().copy(origin).addScaledVector(dir, t);
}

const COARSE_POINTER = !!(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
function buildGizmo() {
  const group = new THREE.Group();
  group.visible = false;
  const mk = (color) => new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const orient = (obj, axis) => { // ジオメトリはY軸方向(円柱)/Z軸向き(輪)で作り、指定の軸へ向ける
    if (axis === 'x') obj.rotation.z = -Math.PI / 2;
    else if (axis === 'z') obj.rotation.x = Math.PI / 2;
  };
  const orientRing = (obj, axis) => { // 輪はZ軸が法線(XY平面)
    if (axis === 'x') obj.rotation.y = Math.PI / 2;
    else if (axis === 'y') obj.rotation.x = Math.PI / 2;
  };
  const move = new THREE.Group(), rotate = new THREE.Group();
  const handles = [];
  for (const axis of ['x', 'y', 'z']) {
    const color = EDIT.colors[axis];
    const arrow = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.8, 8), mk(color)); shaft.position.y = 0.4;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.26, 10), mk(color)); cone.position.y = 0.93;
    // 当たり判定は中心(丸太をつかむ所)を避けて、少し離れた所から始める(中心を押せば丸太を直接動かせる)
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.9, 6), hitMat); hit.position.y = 0.7;
    arrow.add(shaft, cone, hit); orient(arrow, axis);
    for (const m of [shaft, cone, hit]) { m.userData = { kind: 'move', axis, base: color, visual: m !== hit }; handles.push(m); }
    move.add(arrow);

    const ringGroup = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 8, 56), mk(color));
    const ringHit = new THREE.Mesh(new THREE.TorusGeometry(1, COARSE_POINTER ? 0.3 : 0.14, 6, 40), hitMat); // スマホは指が太いので当たり判定の管を太くする
    ringGroup.add(ring, ringHit); orientRing(ringGroup, axis);
    for (const m of [ring, ringHit]) { m.userData = { kind: 'rotate', axis, base: color, visual: m === ring }; handles.push(m); }
    rotate.add(ringGroup);
  }
  group.add(move, rotate);
  return { group, move, rotate, handles };
}

export function createEditMode({ camera, domElement, orbitControls, scene, logSystem, terrainHeightAt, clampXZ = (x, z) => ({ x, z }), bounds = 100, getFocus, onChange = null }) {
  let enabled = false;
  let hover = null;        // 枠を出している倒木
  let held = null;         // つかんでいる倒木
  let mode = 'move';       // 'move' | 'rotate'
  let drag = null;         // ドラッグ中の操作
  let hoverHandle = null;
  const pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() }; // つかんでいる丸太の姿勢(この値を物理へ渡す)
  const keys = new Set();
  let savedTouchAction = '';
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const saved = { buttons: { ...orbitControls.mouseButtons } };

  const gizmo = buildGizmo();
  const hitMeshes = gizmo.handles.filter((h) => !h.userData.visual);
  // v1.58: スマホは指が太いので、矢印・輪の当たり判定(見えない部分)を大きくする。見た目は変えない。
  if (COARSE_POINTER) {
    for (const h of hitMeshes) {
      if (h.userData.kind === 'move') h.scale.set(2.2, 1, 2.2); // 矢印の当たり判定を太く(輪はbuildGizmo側で太い管にしてある)
    }
  }
  scene.add(gizmo.group);
  gizmo.group.traverse((o) => { o.renderOrder = 1000; });
  const markerMat = new THREE.MeshBasicMaterial({ color: 0xffe066, wireframe: true, transparent: true, opacity: 0.85, depthTest: false });
  const marker = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), markerMat);
  marker.visible = false; marker.renderOrder = 999; scene.add(marker);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthTest: false, side: THREE.DoubleSide });
  const dropRing = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 24), ringMat);
  dropRing.rotation.x = -Math.PI / 2; dropRing.visible = false; dropRing.renderOrder = 998; scene.add(dropRing);

  const notify = () => { if (onChange) onChange({ editing: enabled, holding: !!held, mode }); };
  const setCursor = (c) => { domElement.style.cursor = c; };

  function pointerRay(e) {
    const r = domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray;
  }
  function pickLog(ray) {
    raycaster.ray.copy(ray);
    const hits = raycaster.intersectObjects(logSystem.meshes(), true);
    for (const h of hits) { const l = logSystem.logOfMesh(h.object); if (l && (l === held || l.physics.grabbable)) return l; } // つかんでいる丸太自身(ドラッグ用)、動いている最中の丸太もつかめる
    return null;
  }
  function pickHandle(ray) {
    if (!held) return null;
    raycaster.ray.copy(ray);
    // 見えている棒・円錐ではなく、専用の当たり判定(中心を避けてある)だけを調べる。
    // (棒は全て中心を通るので、丸太の中心を押しても矢印を拾ってしまう)
    const hits = raycaster.intersectObjects(hitMeshes.filter((h) => h.userData.kind === mode), false);
    return hits.length ? hits[0].object.userData : null;
  }

  // ---- 姿勢の適用 ----
  function clampPose() {
    const c = clampXZ(pose.pos.x, pose.pos.z);
    const lim = bounds - 2;
    pose.pos.x = Math.max(-lim, Math.min(lim, c.x)); pose.pos.z = Math.max(-lim, Math.min(lim, c.z));
    const floor = terrainHeightAt(pose.pos.x, pose.pos.z) + held.radius * EDIT.minClearance;
    if (pose.pos.y < floor) pose.pos.y = floor; // 地面の下へは入れない(水の上・空中は自由)
  }
  function applyPose() {
    clampPose();
    logSystem.moveHeldPose(held, pose.pos, pose.quat);
  }

  function grabLog(l) {
    if (!logSystem.grab(l)) return false;
    held = l; hover = null;
    pose.pos.set(l.physics.position.x, l.physics.position.y, l.physics.position.z);
    pose.quat.set(l.physics.quaternion.x, l.physics.quaternion.y, l.physics.quaternion.z, l.physics.quaternion.w);
    mode = 'move';
    notify();
    return true;
  }
  /** 離す: 動的になる(落ちて転がる)。離した直後でも、またすぐつかめる。 */
  function releaseHeld() {
    if (!held) return;
    logSystem.release(held);
    held = null; drag = null; hoverHandle = null;
    gizmo.group.visible = false; dropRing.visible = false;
    orbitControls.enabled = true;
    setCursor('');
    notify();
  }

  // ---- ドラッグの開始・更新 ----
  function beginDrag(type, ray, e, handle) {
    const start = { pos: pose.pos.clone(), quat: pose.quat.clone() };
    if (type === 'body') {
      const hit = rayPlaneHit(ray.origin, ray.direction, start.pos, AXES.y); // 今の高さの水平面(水の上でも同じ)
      if (!hit) return false;
      drag = { type, start, hit0: hit, pointerId: e.pointerId };
    } else if (type === 'move') {
      const a = AXES[handle.axis];
      const t0 = closestParamOnAxis(ray.origin, ray.direction, start.pos, a);
      if (t0 === null) return false;
      drag = { type, start, axis: a, t0, pointerId: e.pointerId };
    } else {
      const a = AXES[handle.axis];
      const hit = rayPlaneHit(ray.origin, ray.direction, start.pos, a);
      if (!hit) return false;
      drag = { type: 'rotate', start, axis: a, v0: hit.sub(start.pos).normalize(), pointerId: e.pointerId };
    }
    orbitControls.enabled = false; // ドラッグ中だけ視点を止める(離したら戻す。つかんだままは維持)
    try { domElement.setPointerCapture(e.pointerId); } catch (_) { /* 失敗しても動作に影響なし */ }
    return true;
  }
  function updateDrag(e) {
    const ray = pointerRay(e);
    if (drag.type === 'body') {
      const hit = rayPlaneHit(ray.origin, ray.direction, drag.start.pos, AXES.y);
      if (!hit) return;
      pose.pos.set(drag.start.pos.x + hit.x - drag.hit0.x, drag.start.pos.y, drag.start.pos.z + hit.z - drag.hit0.z);
    } else if (drag.type === 'move') {
      const t = closestParamOnAxis(ray.origin, ray.direction, drag.start.pos, drag.axis);
      if (t === null) return;
      pose.pos.copy(drag.start.pos).addScaledVector(drag.axis, t - drag.t0);
    } else {
      const hit = rayPlaneHit(ray.origin, ray.direction, drag.start.pos, drag.axis);
      if (!hit) return;
      let ang = signedAngleAboutAxis(drag.axis, drag.v0, hit.sub(drag.start.pos).normalize());
      if (e.shiftKey) ang = Math.round(ang / EDIT.rotateSnap) * EDIT.rotateSnap;
      pose.quat.copy(drag.start.quat).premultiply(new THREE.Quaternion().setFromAxisAngle(drag.axis, ang)); // ワールド軸まわりに回す
    }
    applyPose();
  }

  function onPointerDown(e) {
    if (!enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const ray = pointerRay(e);
    if (held) {
      const h = pickHandle(ray);
      if (h) { e.stopImmediatePropagation(); if (beginDrag(mode, ray, e, h)) setCursor('grabbing'); return; }
    }
    const l = pickLog(ray);
    if (l) {
      e.stopImmediatePropagation();
      if (l !== held) { if (held) releaseHeld(); if (!grabLog(l)) return; }
      if (beginDrag('body', ray, e)) setCursor('grabbing');
      return;
    }
    // v1.58: スマホでは、何もない所のドラッグは視点の回転に使うので、離さない(専用の「離す」ボタンで離す)
    if (held && e.pointerType !== 'touch') releaseHeld(); // 何もない所をクリック: 離す(落ちる)
  }
  function onPointerMove(e) {
    if (!enabled) return;
    if (drag) { if (e.pointerId === drag.pointerId) updateDrag(e); return; }
    if (e.pointerType === 'touch') return;
    const ray = pointerRay(e);
    const h = held ? pickHandle(ray) : null;
    hoverHandle = h;
    if (held) { setCursor(h ? 'pointer' : (pickLog(ray) === null && !h ? '' : 'grab')); return; }
    const l = pickLog(ray);
    if (l !== hover) { hover = l; setCursor(l ? 'grab' : ''); }
  }
  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag = null;
    orbitControls.enabled = true;
    setCursor(held ? 'grab' : '');
  }
  function onKeyDown(e) {
    if (!enabled) return;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { keys.add(e.code); return; } // パンを速くする修飾キー
    if (e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD' || e.code.startsWith('Arrow')) { keys.add(e.code); e.preventDefault && e.preventDefault(); return; }
    if (!held) return;
    if (e.code === 'KeyG') { mode = 'move'; notify(); }
    else if (e.code === 'KeyR') { mode = 'rotate'; notify(); }
    else if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') { e.preventDefault && e.preventDefault(); releaseHeld(); }
  }
  function onKeyUp(e) { keys.delete(e.code); }
  function onBlur() { keys.clear(); }

  function enable() {
    if (enabled) return;
    enabled = true;
    savedTouchAction = domElement.style.touchAction;
    domElement.style.touchAction = 'none'; // v1.58: ドラッグ中にブラウザのスクロール等が割り込まないようにする
    // 右ドラッグ=回転 / 中ドラッグ=パン / ホイール=ズーム / 左=つかむ(OrbitControlsは左を使わない)
    orbitControls.mouseButtons.LEFT = -1;
    orbitControls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    orbitControls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    saved.screenSpacePanning = orbitControls.screenSpacePanning;
    saved.minDistance = orbitControls.minDistance; saved.maxDistance = orbitControls.maxDistance;
    saved.maxPolarAngle = orbitControls.maxPolarAngle;
    orbitControls.screenSpacePanning = false; // 地面と平行にパン(高さが変わらない)
    orbitControls.minDistance = EDIT.minDistance; orbitControls.maxDistance = EDIT.maxDistance;
    orbitControls.maxPolarAngle = EDIT.maxPolar;
    const f = getFocus();
    orbitControls.target.set(f.x, f.y, f.z);
    camera.position.copy(orbitControls.target).addScaledVector(EDIT.viewDir, EDIT.viewDistance);
    orbitControls.update();
    domElement.addEventListener('pointerdown', onPointerDown, true);
    domElement.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    notify();
  }
  function disable() {
    if (!enabled) return;
    if (held) releaseHeld(); // つかんだまま抜けても、丸太は落として置かれる
    enabled = false; hover = null; drag = null; keys.clear();
    domElement.style.touchAction = savedTouchAction;
    marker.visible = false; dropRing.visible = false; gizmo.group.visible = false;
    orbitControls.mouseButtons.LEFT = saved.buttons.LEFT;
    orbitControls.mouseButtons.MIDDLE = saved.buttons.MIDDLE;
    orbitControls.mouseButtons.RIGHT = saved.buttons.RIGHT;
    orbitControls.screenSpacePanning = saved.screenSpacePanning;
    orbitControls.minDistance = saved.minDistance; orbitControls.maxDistance = saved.maxDistance;
    orbitControls.maxPolarAngle = saved.maxPolarAngle;
    orbitControls.enabled = true;
    domElement.removeEventListener('pointerdown', onPointerDown, true);
    domElement.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', onPointerUp, true);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    setCursor('');
    notify();
  }

  const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _d = new THREE.Vector3();
  /** 毎フレーム: キーでのパン、世界の端でのクランプ、ギズモ・枠・落下点の輪の更新。 */
  function update(dt = 1 / 60) {
    if (!enabled) return;
    // キーでパン(地面と平行。カメラの向きに対して前後左右)
    if (keys.size) {
      camera.getWorldDirection(_f); _f.y = 0;
      if (_f.lengthSq() < 1e-6) _f.set(0, 0, -1);
      _f.normalize(); _r.set(-_f.z, 0, _f.x);
      _d.set(0, 0, 0);
      if (keys.has('KeyW') || keys.has('ArrowUp')) _d.add(_f);
      if (keys.has('KeyS') || keys.has('ArrowDown')) _d.sub(_f);
      if (keys.has('KeyD') || keys.has('ArrowRight')) _d.add(_r);
      if (keys.has('KeyA') || keys.has('ArrowLeft')) _d.sub(_r);
      if (_d.lengthSq() > 0) {
        const dist = camera.position.distanceTo(orbitControls.target);
        const fast = keys.has('ShiftLeft') || keys.has('ShiftRight') ? EDIT.panKeyFast : 1;
        _d.normalize().multiplyScalar(dist * EDIT.panKeySpeed * fast * Math.min(dt, 0.1));
        orbitControls.target.add(_d); camera.position.add(_d);
      }
    }
    // 世界(地形)の端を越えてパンしない
    const lim = bounds;
    const t = orbitControls.target;
    const cx = Math.max(-lim, Math.min(lim, t.x)), cz = Math.max(-lim, Math.min(lim, t.z));
    if (cx !== t.x || cz !== t.z) { camera.position.x += cx - t.x; camera.position.z += cz - t.z; t.x = cx; t.z = cz; }

    // 枠・ギズモ・落下点の輪
    const target = held || hover;
    if (!target) { marker.visible = false; } else {
      const c = target.physics.position, q = target.physics.quaternion;
      marker.visible = true;
      marker.position.set(c.x, c.y, c.z); marker.quaternion.set(q.x, q.y, q.z, q.w);
      marker.scale.set(target.radius * 1.5 + 0.08, target.length * 1.02, target.radius * 1.5 + 0.08);
    }
    if (held) {
      gizmo.group.visible = true;
      gizmo.move.visible = mode === 'move'; gizmo.rotate.visible = mode === 'rotate';
      gizmo.group.position.copy(pose.pos);
      const s = camera.position.distanceTo(pose.pos) * EDIT.gizmoScreenSize; // 画面上で一定の大きさに見える
      gizmo.group.scale.setScalar(s);
      for (const h of gizmo.handles) {
        if (!h.userData.visual) continue;
        const on = hoverHandle && hoverHandle.axis === h.userData.axis && hoverHandle.kind === h.userData.kind || (drag && drag.axis && drag.axis === AXES[h.userData.axis] && drag.type === h.userData.kind);
        h.material.color.setHex(h.userData.base); if (on) h.material.color.lerp(new THREE.Color(0xffffff), 0.55);
      }
      dropRing.visible = true;
      dropRing.position.set(pose.pos.x, terrainHeightAt(pose.pos.x, pose.pos.z) + 0.06, pose.pos.z);
      const r = held.length * 0.5;
      dropRing.scale.set(r, r, r);
    } else { gizmo.group.visible = false; dropRing.visible = false; }
  }

  return {
    enable, disable, update,
    toggle() { if (enabled) disable(); else enable(); return enabled; },
    isEnabled: () => enabled,
    isHolding: () => !!held,
    getMode: () => mode,
    /** v1.58: スマホの画面ボタンから、移動/回転を切り替える(つかんでいる時だけ)。 */
    setMode(m) { if (!held || (m !== 'move' && m !== 'rotate')) return; mode = m; notify(); },
    /** v1.58: スマホの「離す」ボタン。つかんでいる丸太を離す(落ちて置かれる)。 */
    release() { releaseHeld(); },
    _internals: { grabLog, releaseHeld, onPointerMove, onPointerDown, onPointerUp, onKeyDown, onKeyUp, getHeld: () => held, getHover: () => hover, getPose: () => pose, getDrag: () => drag, gizmo, marker, dropRing },
  };
}
