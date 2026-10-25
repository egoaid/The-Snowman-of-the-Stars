// walk-controls.js
// プレイヤー操作(WASD+マウス視点、および2026-09(v1.37)からはスマホ向けの
// 画面上コントローラ=ジョイスティック+A/Bボタンにも対応)。
//
// 2026-09: 三人称視点(前方/後方)を追加するにあたり、設計を変更した。
// 以前は「PointerLockControlsが実際の描画用カメラを直接回転・移動させる」
// 一人称専用の作りだったが、これだと三人称視点(カメラがキャラクターから
// 離れた位置にいる)を両立できない。
//
// そこで、
//   - lookRig: マウスの視点(ヨー・ピッチ)だけを保持するダミーのカメラ
//              (実際には描画しない。PointerLockControlsはこれを回転させる)
//   - playerPos: キャラクター(雪だるま)の位置(x,z)。WASD入力を
//                lookRigの向きに対して相対的に適用して動かす
// の2つをこのモジュールが管理し、実際の描画用カメラ(scene3d.js側の
// `camera`)をどこに置くか(一人称/三人称-後方/三人称-前方)は、
// 呼び出し側(scene3d.js)がlookRigとplayerPosを見て毎フレーム決める。
//
// 2026-09(v1.37)追記: スマホには物理マウスが無く、Pointer Lock API自体
// タッチ操作では実用的に機能しない(視点をドラッグで動かす仕組みが無い)。
// そのため、画面上のジョイスティック入力は「マウスで見ている向き」とは
// 独立に、以下の方針で扱う。
//   - 移動: ジョイスティックの向きを、そのままlookRig(=カメラの向き)を
//     基準にした前後・左右の移動量として扱う(WASDと同じ計算式を共有)。
//   - 向き: マウスによる視点操作が無いため、雪だるま自身の向き
//     (lookRigのヨー)を「実際に移動している方向」へ自動的に合わせる。
//     一般的な三人称アクションゲームの「スティックを倒した方向へ歩く」
//     操作感に近い。デスクトップのマウス視点操作時はこの自動追従は
//     行わない(enableVirtualControls()を呼んだ場合のみ有効になる)。
//   - ジャンプ・走る: A/Bボタン(タッチ)とSpace/Shift(キーボード)の
//     両方から同じ内部状態を操作する。どちらから操作しても同じに動く。

import * as THREE from 'three';
import { PointerLockControls } from '../../vendor/PointerLockControls.js'; // v1.57: CDNをやめて同梱(three.js r160のもの)
import { createVerticalState, createClimbController, AUTO_ASSIST, ACTION } from './traversal.js';

export const EYE_HEIGHT = 1.7;
// 2026-09: ソフト減速(境界に近づくほど遅くなる)は「気持ち悪い」との
// フィードバックにより撤廃。境界線までは常に同じ速度で歩けるようにし、
// 境界で単純に止める(ハードリミット)方式に戻した。
// また、Playable Area内の歩行速度をもう少し速くしてほしいとの要望を受け、
// 5.5 → 7.0 m/s に引き上げた。
const WALK_SPEED = 7.0;
// 2026-09(v1.37): Bボタン(タッチ)/Shiftキー(キーボード)で走れるように。
const RUN_MULTIPLIER = 1.7;
// 2026-09(v1.37): Aボタン(タッチ)/Spaceキー(キーボード)でジャンプ。
// 単純な放物運動(初速+重力)。ピーク高さ ≈ JUMP_SPEED^2 / (2*GRAVITY) ≈ 0.89m、
// 滞空時間 ≈ 2*JUMP_SPEED/GRAVITY ≈ 0.71秒(雪だるまサイズに対してテンポの良い、軽いホップ)。
// v1.53: ジャンプの定数と縦方向の状態は traversal.js に集約した(見守りモードの乗り降りと同じ計算を使う)。

/**
 * @param {HTMLElement} domElement
 * @param {() => void} onExit - Escでロック解除された時に呼ばれる
 * @param {number} [playableRadius] - この距離より先へは歩けないようにする
 *   (Boundary Zone=森の壁の内側で止める)。境界線までは常に同じ速度。
 */
export function createWalkControls(domElement, onExit, playableRadius = Infinity) {
  // マウスの視点(ヨー・ピッチ)だけを保持するダミーのカメラ。
  // シーンには追加せず、描画にも一切使わない。
  const lookRig = new THREE.PerspectiveCamera();
  const controls = new PointerLockControls(lookRig, domElement);

  // ブラウザ(Chrome等)は、ポインターロックが解除された直後(だいたい1.3秒以内)に
  // 再度 requestPointerLock() を呼ぶと "Pointer lock cannot be acquired immediately
  // after the user has exited the lock." という例外でPromiseをrejectする。
  // PointerLockControls.lock() はこのPromiseを外に返さないため、素早く
  // Esc→再クリックすると未処理のPromise rejectionとしてエラーが表示されていた。
  // 対策として、解除直後は再ロックを少し遅らせてから実行する。
  const RELOCK_COOLDOWN_MS = 1300;
  let lastUnlockAt = 0;
  let pendingLockTimer = null;

  // 上記の対策をすり抜けるケースへの保険として、このメッセージに限り
  // 無視する(他の予期しないエラーは通常通り表示されるようにする)。
  window.addEventListener('unhandledrejection', (ev) => {
    const msg = ev && ev.reason && ev.reason.message;
    if (typeof msg === 'string' && msg.includes('Pointer lock cannot be acquired immediately')) {
      ev.preventDefault();
    }
  });

  const keys = { forward: false, back: false, left: false, right: false, run: false, jumpHeld: false };

  function onKeyDown(e) {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        keys.forward = true;
        break;
      case 'KeyS':
      case 'ArrowDown':
        keys.back = true;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        keys.left = true;
        break;
      case 'KeyD':
      case 'ArrowRight':
        keys.right = true;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        keys.run = true;
        break;
      case 'Space':
        // キーを押しっぱなしにするとブラウザがkeydownを連射するため、
        // 「今まさに押した瞬間」だけジャンプさせる(jumpHeldで多重発火を防ぐ)。
        if (!keys.jumpHeld) requestJump();
        keys.jumpHeld = true;
        e.preventDefault(); // ページが下にスクロールしてしまうのを防ぐ
        break;
    }
  }
  function onKeyUp(e) {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        keys.forward = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        keys.back = false;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        keys.left = false;
        break;
      case 'KeyD':
      case 'ArrowRight':
        keys.right = false;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        keys.run = false;
        break;
      case 'Space':
        keys.jumpHeld = false;
        break;
    }
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  // v1.43: インベントリ画面でマウスを使うため、ポインターロックを「UIのために」解放する。
  // この間のunlockは歩行モードの終了(Esc等)ではないので、onExitを呼ばない。
  // プログラムからの解除は、ブラウザの再ロック待ち時間(Escによる解除後の約1.3秒)の対象外。
  let uiRelease = false;
  controls.addEventListener('unlock', () => {
    if (uiRelease) return;
    lastUnlockAt = performance.now();
    if (onExit) onExit();
  });
  function releasePointerForUi() {
    uiRelease = true;
    if (controls.isLocked) controls.unlock();
  }
  /** UIを閉じた時。relock=trueなら(キー操作など、ユーザー操作の直後に)ポインターを取り戻す。 */
  function endUiRelease(relock = true) {
    if (!uiRelease) return;
    uiRelease = false;
    if (relock) lock();
  }

  // プレイヤー(雪だるま)の論理的な位置。yは常に呼び出し側が地形の高さで
  // 上書きする前提なので、ここでは0のまま使わない。
  const playerPos = new THREE.Vector3(0, 0, 0);

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const move = new THREE.Vector3();

  // --- v1.37: スマホの画面上コントローラ用の状態 ---
  // setVirtualMove()は毎フレーム(ジョイスティック操作中)呼ばれる想定。
  // x: 左右(-1〜1、右が正)、z: 前後(-1〜1、前が正)。カメラ(lookRig)基準。
  let virtualMoveX = 0;
  let virtualMoveZ = 0;
  let virtualRun = false;
  // enableVirtualControls()を呼ぶまでは一切関与しない(デスクトップの
  // 既存の挙動に影響を与えないため)。
  let virtualActive = false;

  function setVirtualMove(x, z) {
    virtualMoveX = Math.max(-1, Math.min(1, Number.isFinite(x) ? x : 0));
    virtualMoveZ = Math.max(-1, Math.min(1, Number.isFinite(z) ? z : 0));
  }
  function setVirtualRun(running) {
    virtualRun = !!running;
  }
  function enableVirtualControls() {
    if (!virtualActive) syncBodyYaw(); // 初めて有効になる時だけ、体の向きをカメラの向きに合わせる
    virtualActive = true;
  }

  // --- v1.37: ジャンプ(単純な放物運動) ---
  // v1.53: 縦方向は traversal.js の createVerticalState。y = 足元の絶対の高さ。
  // 足元を支える面(地面/倒木/岩)は通行層(supportAt)が答える。縁が高い面は、手で引き上げて登れる(findClimb)。
  const vertical = createVerticalState();
  const climb = createClimbController();
  let supportAt = null; // (x,z,feetY,airborne)=>{y,terrain,onSurface}。無ければ常にy=0
  let findClimb = null; // (x,z,feetY,dirX,dirZ)=>{x,z,y}|null
  let describeAhead = null; // (x,z,feetY,dirX,dirZ,maxDist)=>{dist,rise,action}|null (v1.54: 自動の跳ぶ/よじ登る補助)
  let assistCooldown = 0, assistPress = 0;
  function setTraversalHooks(h) {
    supportAt = h && typeof h.supportAt === 'function' ? h.supportAt : null;
    findClimb = h && typeof h.findClimb === 'function' ? h.findClimb : null;
    describeAhead = h && typeof h.describeAhead === 'function' ? h.describeAhead : null;
  }
  const lastMoveDir = new THREE.Vector3(0, 0, -1);
  let moveAge = 99; // 最後に移動入力があってからの秒数(止まっている時は、向いている方向を「前」とみなす)
  const lastPlayerXZ = new THREE.Vector2(NaN, NaN);

  // v1.38: ポーチを開いている間は移動・ジャンプを止める(キー入力の状態は保持するので、
  // 閉じた後にキーを離していれば止まったまま、押し続けていれば歩き出す)。
  let frozen = false;
  function setFrozen(f) { frozen = !!f; }

  function requestJump() {
    if (frozen || climb.active) return;
    // ジャンプでは乗れない高さでも、手で縁をつかめる面が目の前にあれば、よじ登る(物の種類は見ない)
    if (vertical.grounded && findClimb) {
      lookRig.getWorldDirection(forward); forward.y = 0;
      const d = moveAge < 0.25 && lastMoveDir.lengthSq() > 0.01 ? lastMoveDir : forward; // 歩いている最中は進行方向、止まっていれば向いている方向
      const t = findClimb(playerPos.x, playerPos.z, vertical.y, d.x, d.z);
      if (t) { climb.start(playerPos.x, playerPos.z, vertical.y, t.x, t.z, t.y); vertical.climbing = true; return; }
    }
    vertical.jump(); // 空中では二段ジャンプしない(vertical側で判定)
  }
  /** 外部(タッチのAボタン等)からジャンプを要求する。 */
  function triggerJump() {
    requestJump();
  }

  /** 縦方向の更新(ジャンプの放物運動+足元の面への乗り降り+引き上げ)。入力が無い(ポインター解除中)間も、地面・積雪の変化に足元を合わせる。 */
  function updateVertical(delta) {
    // 大きく位置が変わった(モード切替などのテレポート)時は、落ちずに足元へ合わせ直す
    if (Number.isFinite(lastPlayerXZ.x) && Math.hypot(playerPos.x - lastPlayerXZ.x, playerPos.z - lastPlayerXZ.y) > 3) { vertical.snap(); climb.cancel(); }
    if (climb.active) {
      const c = climb.update(delta);
      if (c) { playerPos.x = c.x; playerPos.z = c.z; vertical.forceY(c.y); if (c.done) vertical.climbing = false; }
    }
    if (!climb.active) {
      const sup = supportAt ? supportAt(playerPos.x, playerPos.z, vertical.inited ? vertical.y : Infinity, !vertical.grounded) : { y: 0, terrain: 0, onSurface: false };
      if (!vertical.inited && supportAt) { const g = supportAt(playerPos.x, playerPos.z, -Infinity, false); vertical.update(delta, g); } // 初回は地面へ合わせる
      else vertical.update(delta, sup);
    }
    lastPlayerXZ.set(playerPos.x, playerPos.z);
  }

  function update(delta) {
    const hasVirtualMove = Math.abs(virtualMoveX) > 0.001 || Math.abs(virtualMoveZ) > 0.001;
    // 実際のポインターロックが有効(デスクトップでマウス操作中)か、
    // タッチの仮想コントローラが有効化されているかのどちらかであれば動く。
    if (!controls.isLocked && !virtualActive) { updateVertical(delta); return; }

    lookRig.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, lookRig.up).normalize();

    move.set(0, 0, 0);
    if (keys.forward) move.add(forward);
    if (keys.back) move.sub(forward);
    if (keys.right) move.add(right);
    if (keys.left) move.sub(right);
    if (virtualActive) {
      // ジョイスティックの前後・左右を、キーボードと同じ「カメラ基準の
      // forward/right」へ射影して合成する(キーボードと同時に使っても破綻しない)。
      move.addScaledVector(forward, virtualMoveZ);
      move.addScaledVector(right, virtualMoveX);
    }

    if (frozen || climb.active) move.set(0, 0, 0);

    const running = keys.run || virtualRun;
    const speed = WALK_SPEED * (running ? RUN_MULTIPLIER : 1);

    if (move.lengthSq() > 0) {
      move.normalize();
      if (virtualActive && !controls.isLocked) {
        // v1.58: 以前は、移動方向で「カメラの向き(lookRig)」を直接書き換えていた。
        // スティックの向きはカメラ基準なので、横や後ろへ倒すと毎フレーム
        // 「今の向きからさらに90度」回り続け、画面が高速に回転して操作不能になっていた。
        // 今は、カメラの向き(lookRig)はそのままにして、雪だるまの体の向き(bodyYaw)だけを
        // 移動方向へなめらかに回す。カメラは、画面のドラッグ(addLook)で回す。
        turnBodyToward(Math.atan2(move.x, move.z), delta);
      }
      playerPos.addScaledVector(move, speed * delta);
      lastMoveDir.copy(move); moveAge = 0;
    } else {
      moveAge += delta;
    }

    // 境界線(Playable Area = playableRadius)までは常に同じ速度で歩け、
    // 境界を超えた瞬間だけ位置を境界線上へ戻す(シンプルなハードリミット)。
    const distFromCenter = Math.hypot(playerPos.x, playerPos.z);
    if (distFromCenter > playableRadius) {
      const scale = playableRadius / distFromCenter;
      playerPos.x *= scale;
      playerPos.z *= scale;
    }

    // v1.54: 丸太へ向かって歩くだけで、跳ぶ(ジャンプで乗れる高さ)・よじ登る(手の届く高さ。押し付けて0.3秒)。
    // 細かく狙ってジャンプボタンを押さなくても登れるようにする補助(AUTO_ASSIST.enabled で切れる)。
    assistCooldown = Math.max(0, assistCooldown - delta);
    if (AUTO_ASSIST.enabled && describeAhead && !frozen && !climb.active && vertical.grounded && move.lengthSq() > 0.01) {
      const a = describeAhead(playerPos.x, playerPos.z, vertical.y, move.x, move.z, AUTO_ASSIST.climbLookAhead);
      if (a && a.action === ACTION.JUMP && a.dist <= AUTO_ASSIST.jumpLookAhead && assistCooldown <= 0) {
        vertical.jump(); assistCooldown = AUTO_ASSIST.hopCooldownSec; assistPress = 0;
      } else if (a && a.action === ACTION.CLIMB) {
        assistPress += delta;
        if (assistPress >= AUTO_ASSIST.climbPressSec && findClimb) {
          const t = findClimb(playerPos.x, playerPos.z, vertical.y, move.x, move.z);
          if (t) { climb.start(playerPos.x, playerPos.z, vertical.y, t.x, t.z, t.y); vertical.climbing = true; }
          assistPress = 0;
        }
      } else assistPress = 0;
    } else assistPress = 0;

    updateVertical(delta);
  }

  // ---- v1.58: タッチ操作の「体の向き」と「カメラの向き」の分離 ----
  const BODY_TURN_RATE = 14; // rad/s: 体が歩く方向へ向き直る速さ
  let bodyYaw = 0;
  const lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  function lookRigYaw() {
    lookRig.getWorldDirection(lookEuler._dir || (lookEuler._dir = new THREE.Vector3()));
    return Math.atan2(lookEuler._dir.x, lookEuler._dir.z);
  }
  function syncBodyYaw() { bodyYaw = lookRigYaw(); }
  function turnBodyToward(target, dt) {
    let diff = target - bodyYaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // -π..π
    const step = BODY_TURN_RATE * dt;
    bodyYaw += Math.max(-step, Math.min(step, diff));
  }
  /** 雪だるまの向き。ポインターロック中(マウス)・キーボードはカメラの向き、画面のパッド操作中は体の向き。 */
  function getHeading() {
    return (virtualActive && !controls.isLocked) ? bodyYaw : lookRigYaw();
  }
  /** 向きを指定する(テレポート等)。カメラも体も同じ向きにそろえる。 */
  function setHeading(h) { lookRig.rotation.set(0, h, 0); syncBodyYaw(); } // 従来どおりlookRigへ設定し、体の向きもそこにそろえる
  /** 画面のドラッグで視点を回す(マウスと同じ向き: 右へドラッグ=右を向く)。dx,dyはラジアン。 */
  function addLook(dx, dy) {
    lookEuler.setFromQuaternion(lookRig.quaternion);
    lookEuler.y -= dx;
    lookEuler.x = Math.max(-1.4, Math.min(1.4, lookEuler.x - dy));
    lookRig.quaternion.setFromEuler(lookEuler);
  }

  // v1.58: iPhone(iOS Safari)などには Pointer Lock API(requestPointerLock)が無い。
  // 以前は無条件に呼んでいたため "requestPointerLock is not a function" で歩行モードへの
  // 切り替えが途中で止まり、バーチャルパッドも出なかった。APIの有無を先に調べ、
  // 無い端末では例外を出さずに、画面上のコントローラ(バーチャルパッド)方式へ切り替える。
  const pointerLockSupported = typeof domElement.requestPointerLock === 'function';

  /** ポインターロックを安全に要求する。使えない/失敗した場合は、バーチャルパッド方式で操作できるようにする。 */
  function safeLock() {
    if (!pointerLockSupported) {
      enableVirtualControls();
      return;
    }
    try {
      const r = domElement.requestPointerLock();
      // 新しいブラウザではPromiseが返り、拒否されることがある(ここで握りつぶして落とさない)
      if (r && typeof r.catch === 'function') r.catch(() => { enableVirtualControls(); });
    } catch (e) {
      enableVirtualControls();
    }
  }

  function lock() {
    if (!pointerLockSupported) { enableVirtualControls(); return; }
    if (pendingLockTimer) return; // 既に再試行待ちなら重複させない
    const elapsed = performance.now() - lastUnlockAt;
    if (elapsed < RELOCK_COOLDOWN_MS) {
      pendingLockTimer = setTimeout(() => {
        pendingLockTimer = null;
        safeLock();
      }, RELOCK_COOLDOWN_MS - elapsed + 30);
      return;
    }
    safeLock();
  }

  function dispose() {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    if (pendingLockTimer) { clearTimeout(pendingLockTimer); pendingLockTimer = null; }
    controls.dispose();
  }

  return {
    controls,
    lookRig,
    playerPos,
    lock,
    update,
    dispose,
    get isLocked() { return controls.isLocked; },
    pointerLockSupported, // v1.58: false=iPhone等(バーチャルパッドで操作)
    getHeading, setHeading, addLook, syncBodyYaw, // v1.58: 体の向き / カメラの向き(ドラッグ視点)の分離
    // 一人称視点の手・雪だるまキャラクターの歩行アニメーションを動かす
    // ために、現在いずれかの移動キー/仮想入力が押されているかを外部から
    // 参照できるようにする。
    setFrozen,
    isFrozen: () => frozen,
    releasePointerForUi,
    endUiRelease,
    isUiReleased: () => uiRelease,
    // v1.73: 移動・ジャンプの入力が「いま」あるか(凍結中でも見る)。座っている雪だるまが、歩こうとした時に立つのに使う。
    hasMoveInput: () => (controls.isLocked || virtualActive) && (
      keys.forward || keys.back || keys.left || keys.right || keys.jumpHeld ||
      Math.abs(virtualMoveX) > 0.001 || Math.abs(virtualMoveZ) > 0.001
    ),
    isMoving: () => !frozen && (controls.isLocked || virtualActive) && (
      keys.forward || keys.back || keys.left || keys.right ||
      Math.abs(virtualMoveX) > 0.001 || Math.abs(virtualMoveZ) > 0.001
    ),
    getSpeed: () => WALK_SPEED, // デバッグ表示用(設定上の歩行速度。m/s。走行中はRUN_MULTIPLIER倍になる)
    isRunning: () => keys.run || virtualRun,
    // --- v1.37: スマホの画面上コントローラ用API ---
    setVirtualMove,
    setVirtualRun,
    triggerJump,
    enableVirtualControls,
    isVirtualControlsEnabled: () => virtualActive,
    getFeetY: () => (vertical.inited ? vertical.y : NaN), // 足元の絶対の高さ(地面/面の上+ジャンプ+引き上げ)
    isClimbing: () => climb.active,
    getVerticalVelocity: () => vertical.vy,
    getClimbPose: () => climb.pose, // 引き上げ中の伸び縮み(デフォルメ用)
    getAirHeight: () => vertical.airHeight(), // 今の足元の面から見た、空中の高さ(伸び縮み用)
    isGrounded: () => vertical.grounded,
    isJumping: () => !vertical.grounded,
    setTraversalHooks,
  };
}
