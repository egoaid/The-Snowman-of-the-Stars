// intro-room.js (v1.113) — 起動の「部屋の演出」の、3Dの部屋と、雪だるま。
//   ・部屋は stream-room.js(録画のワイプと同じ部屋)を使う。ソファ(本棚のとなり)と机・椅子・モニターを足す。
//   ・雪だるまは、本編と同じモデル(createSnowmanCharacter)。最初は、ソファでくつろいでいる。
//   ・視点は、ドラッグで見まわす・ホイール/つまむ で寄り引き・WASD/矢印キーで、部屋の中を動く。
//   ・クリック: 本棚 → 本を取って、ソファで読む / MIDIキーボード → 取って、ソファで弾く / ソファ → 座ってくつろぐ /
//              モニター → 椅子に座り、ブラウザを開いてゲームのサイトへ(onLaunch が呼ばれ、部屋は右下のワイプになる)/ 雪だるま → ぴょん。
//   ・録画には、いっさい触れない(録画のワイプは、stream-wipe.js の、別の部屋。録画されるのは、ゲーム画面だけ)。
//   描画は、480×270 ふうの低解像度(呼び出し側が setSize で決める)。ピクセルの粗さは、ゲーム本編と同じ作品の表現。
import * as THREE from 'three';
import { createSnowmanCharacter } from './snowman.js';
import { createMidiKeyboard } from './midi-keyboard.js';
import { buildCity, createPendulumClock, createBigSynth, createDeskMic, createMiniMixer, createHeadset, createCup, createLampPumpkin, createSideTable, createBook } from './room-props.js';
import { buildStreamRoom, ROOM } from './stream-room.js';
import { getSmoothGradientMap } from './shading.js';
import { WIPE_VIEWS, fitFov, OP_TUNE } from './stream-wipe.js';
import { SPOTS, SHELVES, planAction, pathLength, pcSequence, pcTotal, drinkState, easeInOutCubic, smoothstep, clamp01, lerp, lerpAngle, angleDiff } from '../intro-room-core.js';

const MAX_DT = 0.1;
const WALK_SPEED = 1.25, WALK_HEAVY = 0.55; // m/s(大きなシンセ 14.2kg を抱えている間は、ゆっくり)
const DEFAULT_VIEW = { pos: [2.2, 1.6, 5.6], target: [-2.6, 0.75, 2.4], fov: 54 }; // 起動の画角: ソファ・低い本棚・机が、見える
const FOV_RANGE = [24, 80];
const ATOMIC = new Set(['sit', 'stand', 'pick', 'place', 'equip', 'toggle']); // 途中で止めない手順(立つ・座る・取る・置く)

export function createIntroRoom(opts = {}) {
  const rand = opts.rand || Math.random;
  const nowFn = opts.nowFn || (() => new Date()); // 実時間(窓の外の空・時計)。試験では、差し替える
  const labels = opts.labels || (() => ({}));
  const canvas = document.createElement('canvas');
  const renderer = opts.renderer || new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' }); // opts.renderer: 試験用(WebGLの無いNodeで、動きだけ確かめる)
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x1c1a24, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(54, 16 / 9, 0.1, 160);
  camera.rotation.order = 'YXZ';
  const grad = getSmoothGradientMap();
  const toon = (color) => new THREE.MeshToonMaterial({ color, gradientMap: grad });
  const owned = [];
  const keep = (x) => { owned.push(x); return x; };
  const box = (w, h, d, mat, x, y, z, parent = scene) => { const m = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, d)), mat); m.position.set(x, y, z); parent.add(m); return m; };
  const tag = (obj, pick) => { obj.userData.pick = pick; return obj; };
  const pickRoots = [];

  // ---- 明かり(録画のワイプの部屋と同じ。夜の部屋) ----
  scene.add(new THREE.HemisphereLight(0x8a9bd6, 0x4a3a30, 0.85));
  const lampLight = new THREE.PointLight(0xffc27a, 7, 6, 1.6); lampLight.position.set(-1.7, 1.55, 0.6); scene.add(lampLight);
  const screenLight = new THREE.PointLight(0x9fd0ff, 4.2, 4.5, 1.7); screenLight.position.set(-0.7, 1.1, 0.9); scene.add(screenLight);
  const key = new THREE.DirectionalLight(0xdfe6ff, 0.55); key.position.set(2.5, 3, 4); scene.add(key);

  // ---- 部屋 ----
  const wallMat = keep(toon(0x6f7fa8)), trimMat = keep(toon(0x3d3548)), woodMat = keep(toon(0x6a4a33)), darkMat = keep(toon(0x2b2f3a)); keep(toon(0x8b6b4e));
  const room = buildStreamRoom({ scene, toon, keep, box, wallMat, trimMat, woodMat, darkMat, grad, omit: { bean: true, plaque: true, kb: true, backWall: true } }); // ビーンバッグ(ソファの場所)・銀の盾・壁に立てかけたキーボード(縦に置き直す)・奥の壁(窓の穴をあけて作り直す)
  box(9, 0.18, 0.12, trimMat, -0.4, 0.09, -2.22);
  { const rug = new THREE.Mesh(keep(new THREE.CircleGeometry(1.25, 28)), keep(toon(0xb03a48))); rug.rotation.x = -Math.PI / 2; rug.position.set(0.1, 0.012, 0.35); scene.add(rug);
    const rugIn = new THREE.Mesh(keep(new THREE.CircleGeometry(0.8, 28)), keep(toon(0xe9d8b4))); rugIn.rotation.x = -Math.PI / 2; rugIn.position.set(0.1, 0.016, 0.35); scene.add(rugIn); }
  // 奥の壁: 窓の穴(幅1.5 × 高さ1.9)をあけた壁。穴の外側には、3Dの街がある(room-props.js の buildCity)
  { const H = ROOM.h, t = 0.1, zc = ROOM.z0 - t / 2, x0 = ROOM.x0 - 0.1, x1 = ROOM.x1 + 0.1;
    box(-1.7 - x0, H, t, wallMat, (x0 - 1.7) / 2, H / 2, zc); box(x1 + 0.2, H, t, wallMat, (x1 - 0.2) / 2, H / 2, zc); // 穴の左と右
    box(1.5, 0.8, t, wallMat, -0.95, 0.4, zc); box(1.5, H - 2.7, t, wallMat, -0.95, 2.7 + (H - 2.7) / 2, zc); // 穴の下と上
    box(1.66, 0.08, 0.1, woodMat, -0.95, 2.74, -2.2); box(1.66, 0.08, 0.1, woodMat, -0.95, 0.8, -2.2); box(0.08, 2, 0.1, woodMat, -1.78, 1.77, -2.2); box(0.08, 2, 0.1, woodMat, -0.12, 1.77, -2.2); box(0.05, 1.9, 0.08, woodMat, -0.95, 1.77, -2.2); // 窓枠(まんなかに桟)
    box(1.8, 0.04, 0.22, woodMat, -0.95, 0.78, -2.16); } // 窓の下の出っぱり
  const city = buildCity({ scene, keep });
  { const pm = keep(toon(0xf2d34f)); box(0.62, 0.8, 0.03, keep(toon(0x2a2f55)), 1.0, 2.0, -2.22); const st = new THREE.Mesh(keep(new THREE.CircleGeometry(0.2, 5)), pm); st.position.set(1.0, 2.04, -2.2); scene.add(st);
    box(1.0, 0.05, 0.28, woodMat, -2.7, 1.55, -2.1); box(0.16, 0.22, 0.16, keep(toon(0x4a9a63)), -2.95, 1.69, -2.1); box(0.2, 0.14, 0.18, keep(toon(0xd2693a)), -2.55, 1.64, -2.1); }

  // ---- ソファ(左の壁ぎわ。低い本棚のとなり。+x=部屋の中を向く) ----
  const sofa = new THREE.Group(); sofa.position.set(-3.05, 0, 2.5); sofa.rotation.y = Math.PI / 2; scene.add(sofa);
  { const fab = keep(toon(0x5f7f72)), fab2 = keep(toon(0x4d6a5e)), cush = keep(toon(0xd2a05a)), cush2 = keep(toon(0xc4604a));
    box(2.0, 0.3, 1.1, fab2, 0, 0.2, 0, sofa); // 土台
    box(1.74, 0.11, 0.84, fab, 0, 0.395, 0.1, sofa); // 座面のクッション(上面 y=0.45)
    box(2.0, 0.72, 0.2, fab2, 0, 0.71, -0.45, sofa); // 背もたれ
    box(0.9, 0.42, 0.14, fab, -0.45, 0.72, -0.3, sofa).rotation.x = -0.12; box(0.9, 0.42, 0.14, fab, 0.45, 0.72, -0.3, sofa).rotation.x = -0.12; // 背のクッション
    box(0.14, 0.4, 1.0, fab2, -0.93, 0.5, 0.03, sofa); box(0.14, 0.4, 1.0, fab2, 0.93, 0.5, 0.03, sofa); // ひじかけ
    for (const [lx, lz] of [[-0.9, -0.48], [0.9, -0.48], [-0.9, 0.48], [0.9, 0.48]]) box(0.07, 0.1, 0.07, darkMat, lx, 0.05, lz, sofa);
    const c1 = box(0.34, 0.34, 0.1, cush, -0.7, 0.66, -0.12, sofa); c1.rotation.set(-0.3, 0.2, 0.15); const c2 = box(0.3, 0.3, 0.1, cush2, 0.68, 0.64, -0.13, sofa); c2.rotation.set(-0.3, -0.25, -0.1); }
  tag(sofa, { type: 'sofa' }); pickRoots.push(sofa);
  // ソファのわきの、床置きの小さなランプ(くつろぐ場所の、暖かい明かり)
  { const g = new THREE.Group(); g.position.set(-3.4, 0, 0.35); scene.add(g); const base = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.13, 0.15, 0.04, 12)), darkMat); base.position.y = 0.02; g.add(base);
    const pole = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.012, 0.012, 1.25, 6)), darkMat); pole.position.y = 0.65; g.add(pole);
    const sh = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.13, 0.19, 0.24, 12, 1, true)), keep(new THREE.MeshBasicMaterial({ color: 0xffdca0, side: THREE.DoubleSide, toneMapped: false }))); sh.position.y = 1.32; g.add(sh); }
  const sofaLight = new THREE.PointLight(0xffc88a, 2.6, 5, 1.5); sofaLight.position.set(-3.0, 1.5, 1.2); scene.add(sofaLight);
  // サイドテーブル(ソファの、机がわの横)
  const sideTable = createSideTable({ toon, keep }); sideTable.group.position.set(-2.95, 0, 3.95); // 低い本棚の前・ソファの端のとなり scene.add(sideTable.group);

  // ---- 机・モニター・椅子・キーボード・マウス(録画のワイプの部屋と、同じ置き方。画角が、そのまま使える) ----
  const deskTopY = 0.78;
  const desk = new THREE.Group(); scene.add(desk);
  box(2.0, 0.06, 1.4, woodMat, -1.1, deskTopY, 0.75, desk);
  for (const [lx, lz] of [[-2.05, 0.12], [-0.2, 0.12], [-2.05, 1.38], [-0.2, 1.38]]) box(0.06, deskTopY, 0.06, darkMat, lx, deskTopY / 2, lz, desk);
  const monitor = new THREE.Group(); monitor.position.set(-1.2, deskTopY + 0.03, 0.82); monitor.rotation.y = 0.96; scene.add(monitor);
  box(0.26, 0.02, 0.18, darkMat, 0, 0.01, 0, monitor); box(0.04, 0.18, 0.04, darkMat, 0, 0.1, 0, monitor); box(0.86, 0.5, 0.05, darkMat, 0, 0.42, 0, monitor);
  const scr = document.createElement('canvas'); scr.width = 160; scr.height = 90; const sctx = scr.getContext('2d'); sctx.imageSmoothingEnabled = true;
  const scrTex = keep(new THREE.CanvasTexture(scr)); scrTex.colorSpace = THREE.SRGBColorSpace; scrTex.magFilter = THREE.NearestFilter; scrTex.minFilter = THREE.NearestFilter; scrTex.generateMipmaps = false;
  const screenMesh = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.78, 0.44)), keep(new THREE.MeshBasicMaterial({ map: scrTex, toneMapped: false }))); screenMesh.position.set(0, 0.42, 0.028); monitor.add(screenMesh);
  { const lb = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.09, 0.1, 0.03, 10)), darkMat); lb.position.set(-1.95, deskTopY + 0.045, 0.5); scene.add(lb);
    const la = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.012, 0.012, 0.62, 5)), darkMat); la.position.set(-1.95, deskTopY + 0.36, 0.5); la.rotation.z = -0.25; scene.add(la);
    const ls = new THREE.Mesh(keep(new THREE.ConeGeometry(0.12, 0.14, 10, 1, true)), keep(new THREE.MeshBasicMaterial({ color: 0xffd9a0, side: THREE.DoubleSide, toneMapped: false }))); ls.position.set(-1.83, deskTopY + 0.66, 0.5); ls.rotation.z = 0.5; scene.add(ls); }
  const seatY = SPOTS.chair.seatY, chairX = SPOTS.chair.seat.x, chairZ = SPOTS.chair.seat.z, faceYaw = SPOTS.chair.yaw;
  const chair = new THREE.Group(); chair.position.set(chairX, 0, chairZ); chair.rotation.y = faceYaw; scene.add(chair);
  { const cm = keep(toon(0x3b4a8a)); box(0.66, 0.08, 0.62, cm, 0, seatY - 0.04, 0, chair); box(0.6, 0.6, 0.08, cm, 0, seatY + 0.34, -0.34, chair).rotation.x = -0.08; box(0.05, seatY - 0.08, 0.05, darkMat, 0, (seatY - 0.08) / 2, 0, chair);
    for (let a = 0; a < 5; a++) { const w = box(0.34, 0.03, 0.04, darkMat, Math.cos(a * 1.2566) * 0.17, 0.03, Math.sin(a * 1.2566) * 0.17, chair); w.rotation.y = -a * 1.2566; } }
  const fx = Math.sin(faceYaw), fz = Math.cos(faceYaw), rx = -Math.cos(faceYaw), rz = Math.sin(faceYaw);
  const deskPoint = (f, r, y) => new THREE.Vector3(chairX + fx * f + rx * r, y, chairZ + fz * f + rz * r);
  const KB_F = 0.76, KB_Y = deskTopY + 0.045, MOUSE_F = 0.78, MOUSE_R = 0.43;
  const deskKb = new THREE.Group(); deskKb.position.copy(deskPoint(KB_F, 0, KB_Y)); deskKb.rotation.y = faceYaw; scene.add(deskKb);
  box(0.5, 0.025, 0.19, darkMat, 0, 0, 0, deskKb);
  const keys = []; { const km = keep(toon(0x59607a)); for (let r = 0; r < 4; r++) for (let c = 0; c < 12; c++) { const kx = (c - 5.5) * 0.039, kz = (r - 1.5) * 0.037; box(0.031, 0.012, 0.029, km, kx, 0.018, kz, deskKb); keys.push({ x: kx, z: kz }); } }
  const keyGlow = new THREE.Mesh(keep(new THREE.BoxGeometry(0.036, 0.016, 0.034)), keep(new THREE.MeshBasicMaterial({ color: 0x7fe8ff, toneMapped: false }))); keyGlow.visible = false; deskKb.add(keyGlow); // いま打っているキーの光
  const mouseP0 = deskPoint(MOUSE_F, MOUSE_R, deskTopY + 0.033);
  { const pad = box(0.26, 0.006, 0.22, keep(toon(0x3a3350)), mouseP0.x, mouseP0.y, mouseP0.z); pad.rotation.y = faceYaw; }
  const mouseMesh = box(0.07, 0.03, 0.11, keep(toon(0xe6e6ea)), mouseP0.x, deskTopY + 0.051, mouseP0.z); mouseMesh.rotation.y = faceYaw + 0.12;
  const mouseBtn = box(0.066, 0.004, 0.04, keep(toon(0x9aa0b0)), 0, 0.0155, 0.026, mouseMesh);
  tag(desk, { type: 'monitor' }); tag(monitor, { type: 'monitor' }); tag(chair, { type: 'monitor' }); tag(deskKb, { type: 'monitor' });
  pickRoots.push(desk, monitor, chair, deskKb);
  // ---- 机の上の小物: カップ(コーヒーか紅茶)・卓上マイク・小型ミキサー・ヘッドセット(録画のワイプと同じ形) ----
  const CUP_REST = deskPoint(0.92, -0.62, deskTopY + 0.042);
  const cup = createCup({ toon, keep, rand }); cup.root.position.copy(CUP_REST); cup.root.rotation.y = faceYaw; cup.saucer.position.set(CUP_REST.x, deskTopY + 0.036, CUP_REST.z); scene.add(cup.root, cup.saucer);
  const mic = createDeskMic({ toon, keep, P0: deskPoint(1.25, 0.58, deskTopY + 0.03), P1: (() => { const q = deskPoint(1.25, 0.58, 1.2); return q; })(), P3: deskPoint(0.98, 0.16, 1.1), M0: deskPoint(0.72, 0, 1.36) }); scene.add(mic.group);
  { const hitProxy = (parent, r) => { const m = new THREE.Mesh(keep(new THREE.SphereGeometry(r, 8, 6)), keep(new THREE.MeshBasicMaterial({ visible: false }))); m.visible = false; parent.add(m); return m; }; hitProxy(cup.root, 0.12); tag(cup.root, { type: 'cup' }); tag(cup.saucer, { type: 'cup' }); pickRoots.push(cup.root, cup.saucer); }
  const mixer = createMiniMixer({ keep }); mixer.group.position.set(-0.8, deskTopY + 0.03, 1.22); mixer.group.rotation.y = 0.15; scene.add(mixer.group);
  const headset = createHeadset({ toon, keep }); const HEADSET_REST_SCALE = 0.6; headset.group.scale.setScalar(HEADSET_REST_SCALE); headset.group.position.set(-1.55, deskTopY + 0.03 + 0.115 * HEADSET_REST_SCALE + 0.012, 1.15); headset.group.rotation.y = 0.4; scene.add(headset.group);
  const headsetRest = { p: headset.group.position.clone(), q: headset.group.quaternion.clone(), sc: headset.group.scale.clone() };

  // ---- 本棚・MIDIキーボード(stream-room.js が返す) ----
  const shelfGroups = new Map();
  room.shelves.forEach((g, i) => { const id = ['R', 'F1', 'F2', 'L'][i]; shelfGroups.set(id, g); tag(g, { type: 'book', shelf: id }); pickRoots.push(g); });
  // ---- MIDIキーボードと、大きなシンセ(実寸 幅1.018m・14.2kg): 手前の壁に、縦に立てかける ----
  /** 長辺がx・鍵盤が+y向きの部品を、長辺を縦に、鍵盤を部屋のほう(-z)へ向けて、壁(+z)へ、すこし寄りかからせる。 */
  function leanOnWall(obj, x, halfLen, lean = 0.1) {
    const stand = new THREE.Group(); stand.position.set(x, 0, ROOM.z1 - 0.12); scene.add(stand);
    const pivot = new THREE.Group(); pivot.rotation.x = lean; stand.add(pivot); // 足もとを軸に、上が壁へ傾く
    obj.rotation.order = 'YXZ'; obj.rotation.set(0, -Math.PI / 2, Math.PI / 2); obj.position.set(0, halfLen + 0.012, 0); pivot.add(obj); return { stand, pivot };
  }
  const midi = createMidiKeyboard(); const kbObj = midi.group; // 実寸(長さ0.66m)のまま。もとの1.45倍には、しない
  const kbLean = leanOnWall(kbObj, -0.25, 0.33, 0.1); tag(kbObj, { type: 'keyboard' }); pickRoots.push(kbObj);
  const bigSynth = createBigSynth({ keep }); const synthLean = leanOnWall(bigSynth.group, -0.95, 0.509, 0.09); // タグは、行動(運ぶ・床で弾く)を作る次の版で付ける
  const kbHome = { parent: kbLean.pivot, pos: kbObj.position.clone(), rot: kbObj.rotation.clone(), scale: kbObj.scale.clone() };
  { const fl = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.5, 0.35)), keep(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2, depthWrite: false }))); fl.rotation.x = -Math.PI / 2; fl.position.set(-0.6, 0.013, ROOM.z1 - 0.2); scene.add(fl); } // 足もとの影
  const synthHome = { parent: synthLean.pivot, pos: bigSynth.group.position.clone(), rot: bigSynth.group.rotation.clone(), scale: bigSynth.group.scale.clone() };
  tag(bigSynth.group, { type: 'synth' }); pickRoots.push(bigSynth.group);
  scene.updateMatrixWorld(true);
  const kbHomeWorld = kbObj.getWorldPosition(new THREE.Vector3());
  // ---- 低い本棚(ソファのとなり)の上の、ジャックオーランタンの小型ランプ(ゲームの中と同じ顔。はじめは、電源オフ) ----
  const lamp = createLampPumpkin({ keep, radius: 0.11 }); lamp.group.position.set(-3.4, 1.51, 5.35); scene.add(lamp.group);
  { const m = new THREE.Mesh(keep(new THREE.SphereGeometry(0.2, 8, 6)), keep(new THREE.MeshBasicMaterial({ visible: false }))); m.visible = false; m.position.y = 0.12; lamp.group.add(m); tag(lamp.group, { type: 'lamp' }); pickRoots.push(lamp.group); }
  const lampLightPt = new THREE.PointLight(0xffa640, 0, 7, 1.8); lampLightPt.position.set(-3.3, 1.7, 5.35); scene.add(lampLightPt);
  // ---- 壁の振り子時計(実時間。音は鳴らさない) ----
  const clock = createPendulumClock({ toon, keep }); clock.group.position.set(2.6, 0.95, ROOM.z0); scene.add(clock.group);

  // ---- 本(雪だるまが、棚から取る) ----
  const bookObj = createBook({ toon, keep, rand }); bookObj.randomize(rand); const book = bookObj.group; book.visible = false; scene.add(book); // M字に開く・色と大きさが、取るたびに変わる
  const flapPivot = bookObj.flapPivot;

  // ---- 雪だるま(本編と同じモデル)。rig = 置き場所と向き(座る時の前のめりも、ここ) ----
  const snow = createSnowmanCharacter(1);
  const rig = new THREE.Group(); rig.rotation.order = 'YXZ'; scene.add(rig); rig.add(snow.group);
  tag(snow.group, { type: 'snowman' }); pickRoots.push(snow.group);
  const armL = snow.torchSocket.parent, armR = snow.itemSocket.parent; // 左(モデルのx>0側)・右
  const ARM_LEN = 0.55, ARM_MAX = 1.5, ARM_MAX_PC = 2.1; // PC操作だけは、録画のワイプと同じ(机が近く、伸びすぎない配置)。 // 腕を伸ばす上限(1.5倍)。それより遠い所へは、届かせようとせず、近くへ立つ(以前は2.1倍まで伸びて、腕が異様に長くなった)
  const _lt = new THREE.Vector3(), _u = new THREE.Vector3(), _tip = new THREE.Vector3(), _tmp = new THREE.Vector3(), _tmp2 = new THREE.Vector3();
  const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  /** 腕を、狙いの点へ向ける(stream-wipe.js の aimArm と同じ式)。w=0〜1 で、ふだんの腕の動きと混ぜる。 */
  function aimArm(arm, tip, target, w, max = ARM_MAX) {
    const r0 = { x: arm.rotation.x, z: arm.rotation.z, sx: arm.scale.x, sy: arm.scale.y, sz: arm.scale.z };
    arm.parent.updateWorldMatrix(true, false);
    _lt.copy(target); arm.parent.worldToLocal(_lt); _u.copy(_lt).sub(arm.position);
    const dist = _u.length() || 1; _u.divideScalar(dist);
    const rz = clampN(-Math.asin(clampN(_u.x, -1, 1)), -2.6, 2.6), rx = Math.atan2(_u.z, _u.y);
    const sy = clampN(dist / ARM_LEN, 0.7, max), sxz = Math.sqrt(sy);
    arm.rotation.x = lerp(r0.x, rx, w); arm.rotation.z = lerp(r0.z, rz, w); arm.scale.set(lerp(r0.sx, sxz, w), lerp(r0.sy, sy, w), lerp(r0.sz, sxz, w));
    arm.updateMatrixWorld(true);
  }

  // ---- 雪だるまの、いまの状態 ----
  const me = { x: SPOTS.sofa.seat.x, z: SPOTS.sofa.seat.z, y: SPOTS.sofa.seatY, yaw: SPOTS.sofa.yaw, sitK: 1, seat: 'sofa', carry: null, walking: false, activity: 'idle', lean: 0 };
  let thirstT = 60; const ikErr = { L: 0, R: 0 };
  let launched = !!opts.launched; // もう、ゲームのサイトへ行ったか(2回目以降は、短い流れ)
  let t = 0, yawnT = -1, nextYawn = 12 + rand() * 14, joyT = 0, blinkTalk = 0;
  let queue = [], cur = null, curStep = null, pending = null;
  const armW = { L: 0, R: 0 }; const armTgt = { L: null, R: null }; // 腕の狙い(世界の点)と、混ぜる割合(なめらかに)
  const tipPos = { L: new THREE.Vector3(), R: new THREE.Vector3() }, tipInit = { L: false, R: false };

  // ---- カメラ(見まわす・動く・ゆっくり寄る) ----
  const cam = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, fov: 54, tween: null, locked: false };
  function viewToCam(v) {
    const pos = new THREE.Vector3(...v.pos), d = new THREE.Vector3(...v.target).sub(pos).normalize();
    return { pos, pitch: Math.asin(clampN(d.y, -1, 1)), yaw: Math.atan2(-d.x, -d.z), fov: v.fov };
  }
  function setView(v) { const c = viewToCam(v); cam.pos.copy(c.pos); cam.yaw = c.yaw; cam.pitch = c.pitch; cam.fov = c.fov; cam.tween = null; applyCamera(); }
  function tweenTo(v, dur = 1.2) { const c = viewToCam(v); cam.tween = { t: 0, dur, fp: cam.pos.clone(), tp: c.pos, fy: cam.yaw, ty: cam.yaw + angleDiff(cam.yaw, c.yaw), fpi: cam.pitch, tpi: c.pitch, ff: cam.fov, tf: c.fov }; }
  let size = { w: 480, h: 270 };
  function applyCamera() {
    camera.position.copy(cam.pos); camera.rotation.set(cam.pitch, cam.yaw, 0);
    camera.fov = fitFov(cam.fov, camera.aspect); camera.updateProjectionMatrix();
  }
  function updateCamera(dt) {
    if (cam.tween) {
      const tw = cam.tween; tw.t += dt; const k = easeInOutCubic(tw.t / tw.dur);
      cam.pos.lerpVectors(tw.fp, tw.tp, k); cam.yaw = lerp(tw.fy, tw.ty, k); cam.pitch = lerp(tw.fpi, tw.tpi, k); cam.fov = lerp(tw.ff, tw.tf, k);
      if (tw.t >= tw.dur) cam.tween = null;
    }
    // WASD/矢印: 部屋の中を動く(話の最中は、動かない)
    if (interactive && !cam.locked && !cam.tween && keysDown.size) {
      const sp = (keysDown.has('shift') ? 3.2 : 1.8) * dt, fwd = (keysDown.has('w') || keysDown.has('arrowup') ? 1 : 0) - (keysDown.has('s') || keysDown.has('arrowdown') ? 1 : 0), str = (keysDown.has('d') || keysDown.has('arrowright') ? 1 : 0) - (keysDown.has('a') || keysDown.has('arrowleft') ? 1 : 0);
      cam.pos.x += (-Math.sin(cam.yaw) * fwd + Math.cos(cam.yaw) * str) * sp; cam.pos.z += (-Math.cos(cam.yaw) * fwd - Math.sin(cam.yaw) * str) * sp;
    }
    cam.pos.x = clampN(cam.pos.x, ROOM.x0 + 0.25, ROOM.x1 - 0.25); cam.pos.z = clampN(cam.pos.z, ROOM.z0 + 0.3, ROOM.z1 - 0.25); cam.pos.y = clampN(cam.pos.y, 0.4, ROOM.h - 0.25);
    cam.pitch = clampN(cam.pitch, -1.25, 1.25); cam.fov = clampN(cam.fov, FOV_RANGE[0], FOV_RANGE[1]);
    applyCamera();
  }

  // ---- 見まわし・クリック(ポインタ) ----
  let interactive = true;
  const keysDown = new Set();
  const ptrs = new Map(); let drag = null, pinch = null, lastHoverAt = 0;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pickAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect(); if (!r.width || !r.height) return null;
    // canvas は、枠にあわせて、はみ出す(cover)ことがある。画面上の位置 → 描いた絵の中の位置
    const k = Math.max(r.width / size.w, r.height / size.h), iw = size.w * k, ih = size.h * k, ox = r.left + (r.width - iw) / 2, oy = r.top + (r.height - ih) / 2;
    ndc.set(((clientX - ox) / iw) * 2 - 1, -(((clientY - oy) / ih) * 2 - 1)); if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return null;
    scene.updateMatrixWorld(true); ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pickRoots, true);
    for (const h of hits) { let o = h.object; while (o) { if (o.userData && o.userData.pick) return { ...o.userData.pick, dist: h.distance }; o = o.parent; } }
    return null;
  }
  const labelOf = (p) => { if (!p) return null; const L = labels() || {}; if (p.type === 'lamp') return (world.lampOn ? L.lampOff : L.lamp) || null; return L[p.type] || null; };
  function onDown(e) {
    if (!interactive) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 取れなくても、動く */ }
    if (ptrs.size === 1) drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false };
    else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: cam.fov }; if (drag) drag.moved = true; }
    e.preventDefault();
  }
  function onMove(e) {
    if (!interactive) return;
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size >= 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y) || 1; if (!cam.locked) cam.fov = clampN(pinch.fov * (pinch.d / d), FOV_RANGE[0], FOV_RANGE[1]); return; }
    if (drag && drag.id === e.pointerId) {
      const dx = e.clientX - drag.lx, dy = e.clientY - drag.ly; drag.lx = e.clientX; drag.ly = e.clientY;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) drag.moved = true;
      if (drag.moved && !cam.locked) { const k = 0.0042 * (cam.fov / 54); cam.yaw += dx * k; cam.pitch += dy * k; cam.tween = null; }
      if (opts.onHover) opts.onHover(null, 0, 0);
      return;
    }
    const now = performance.now(); if (now - lastHoverAt < 70) return; lastHoverAt = now;
    const p = pickAt(e.clientX, e.clientY); canvas.style.cursor = p ? 'pointer' : 'grab';
    if (opts.onHover) opts.onHover(labelOf(p), e.clientX, e.clientY);
  }
  function onUp(e) {
    const was = drag && drag.id === e.pointerId ? drag : null;
    ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (ptrs.size === 0) drag = null; else if (drag && drag.id === e.pointerId) drag = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* もう、離れている */ }
    if (!interactive || !was || was.moved) return;
    const p = pickAt(e.clientX, e.clientY); if (p) api.act(p);
  }
  function onWheel(e) { if (!interactive || cam.locked) return; cam.fov = clampN(cam.fov * Math.exp(e.deltaY * 0.0012), FOV_RANGE[0], FOV_RANGE[1]); e.preventDefault(); }
  /** キー入力は、intro-layer.js が(ゲーム本編へ渡さずに)ここへ渡す。WASD/矢印で動く・Shiftで速く。 */
  function onKey(e, down) {
    if (!interactive) return; const tg = e.target; if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT' || tg.isContentEditable)) return;
    const k = (e.key || '').toLowerCase(); if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) { if (down) keysDown.add(k); else keysDown.delete(k); }
  }
  canvas.style.touchAction = 'none'; canvas.style.cursor = 'grab';
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false }); canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerleave', () => { if (opts.onHover) opts.onHover(null, 0, 0); });

  // ---- 行動(手順の実行) ----
  const world = { cupAt: 'desk', headset: 'desk', synthAt: 'wall', lampOn: false }; // もの、いまの置き場所(計画の材料)
  const stateNow = () => ({ x: me.x, z: me.z, seat: me.seat, carry: me.carry, launched, cupAt: world.cupAt, headset: world.headset, synthAt: world.synthAt });
  const V3 = THREE.Vector3, Q4 = THREE.Quaternion;
  const modelX = () => new V3(Math.cos(me.yaw), 0, -Math.sin(me.yaw)); // 雪だるまの左手がわ(モデルの x+)の、世界での向き
  const fwdV = () => new V3(Math.sin(me.yaw), 0, Math.cos(me.yaw));
  const tgtV = (o) => new V3(o.x, o.y, o.z);
  const armFor = (target) => (new V3(target.x - me.x, 0, target.z - me.z).dot(modelX()) >= 0 ? 'L' : 'R'); // 目標に近い肩の側の腕
  const gripV = () => modelX().multiplyScalar(0.0875).add(new V3(0, 0.0625, 0)); // カップの、持つ位置(録画のワイプと同じ)
  const smooth = smoothstep;
  /** ものの、世界での姿勢を控え、別の姿勢へ動かす(持つ・置く・かぶる)ための道具 */
  function grabPose(obj) { obj.updateWorldMatrix(true, false); const p = new V3(), q = new Q4(), sc = new V3(); obj.matrixWorld.decompose(p, q, sc); return { p, q, sc }; }
  function setWorld(obj, pose) { if (obj.parent !== scene) scene.add(obj); obj.position.copy(pose.p); obj.quaternion.copy(pose.q); obj.scale.copy(pose.sc); }
  function mixPose(a, b, k, lift = 0) { const p = a.p.clone().lerp(b.p, k); p.y += lift * Math.sin(Math.PI * k); return { p, q: a.q.clone().slerp(b.q, k), sc: a.sc.clone().lerp(b.sc, k) }; }
  function localPose(parent, lp, lq, ls) { parent.updateWorldMatrix(true, false); const m = new THREE.Matrix4().compose(lp, lq, ls).premultiply(parent.matrixWorld); const p = new V3(), q = new Q4(), sc = new V3(); m.decompose(p, q, sc); return { p, q, sc }; }
  function putLocal(obj, parent, lp, lq, ls) { parent.add(obj); obj.position.copy(lp); obj.quaternion.copy(lq); obj.scale.copy(ls); }
  const Q0 = new Q4(), ONE = new V3(1, 1, 1);
  const synthHoldQ = new Q4().setFromEuler(new THREE.Euler(0.12, 0, 0)), synthHoldP = new V3(0, 0.62, 0.8);
  const synthFloorPose = () => ({ p: new V3(SPOTS.floor.synth.x, 0.0, SPOTS.floor.synth.z), q: new Q4(), sc: ONE.clone() }); // 床に寝かせる(鍵盤は上)
  const headPose = () => localPose(snow.headGroup, new V3(), Q0, ONE);
  const handPose = (hscale = 0.45) => localPose(snow.itemSocket, new V3(0, 0.02, 0.08), Q0, new V3(hscale, hscale, hscale));
  const cupRestPose = () => ({ p: CUP_REST.clone(), yaw: faceYaw }), tableCupPose = () => ({ p: new V3(-2.95, 0.55, 3.95), yaw: Math.PI / 2 });
  const synthEnds = () => [bigSynth.group.localToWorld(new V3(0.42, 0.07, 0.05)), bigSynth.group.localToWorld(new V3(-0.42, 0.07, 0.05))];
  const cupHoldPos = () => { const f = fwdV(), mx = modelX(); return new V3(me.x + f.x * 0.55 + mx.x * 0.25, me.y + 0.78 - 0.23 * me.sitK, me.z + f.z * 0.55 + mx.z * 0.25); }; // 手に持った(飲まない時の)カップの位置
  const DUR = { cup: 0.6, headset: 0.7, synth: 1.9, book: 0.55, kb: 0.55 };

  function begin(step) {
    curStep = { ...step, k: 0 }; const s = curStep;
    switch (step.t) {
      case 'walk': s.pts = [{ x: me.x, z: me.z }, ...step.path]; s.seg = 1; break;
      case 'sit': { s.from = { x: me.x, z: me.z, yaw: me.yaw }; const S = SPOTS[step.seat]; s.to = { x: S.seat.x, z: S.seat.z, yaw: S.yaw, y: S.seatY }; s.dur = step.seat === 'floor' ? 1.3 : 1.15; if (step.seat === 'floor' && me.carry === 'synth') s.p0 = grabPose(bigSynth.group); break; }
      case 'stand': { const S = SPOTS[step.seat]; s.from = { x: me.x, z: me.z }; s.to = { ...(S.front || S.side) }; break; }
      case 'camera': cam.locked = true; cam.tween = null; tweenTo(step.view === 'monitor' ? { ...WIPE_VIEWS.monitor } : DEFAULT_VIEW, 1.3); break;
      case 'do': me.activity = step.what; s.dur = step.what === 'pc' ? pcTotal(!launched) : (step.dur || 60); s.fresh = !launched; s.fired = false; if (step.what === 'pc') cam.locked = true; if (step.what === 'read') thirstT = 40 + rand() * 50; break;
      case 'reach': { s.dur = 0.9; if (step.target) { s.tv = tgtV(step.target); s.arm = armFor(s.tv); } else { const nx = queue[0]; s.what = nx && nx.t === 'pick' ? nx.what : 'book'; s.shelf = nx && nx.shelf; } break; }
      case 'pick': { s.dur = DUR[step.what] || 0.55; s.done = false; if (step.what === 'synth') s.p0 = grabPose(bigSynth.group); if (step.what === 'headset') s.p0 = grabPose(headset.group); break; }
      case 'place': { s.dur = step.what === 'synth' ? 1.8 : 0.8; s.done = false; if (step.what === 'synth') s.p0 = grabPose(bigSynth.group); if (step.what === 'headset') s.p0 = grabPose(headset.group); if (step.what === 'cup') { s.p0 = grabPose(cup.root); s.spot = step.at === 'desk' ? cupRestPose() : tableCupPose(); } break; }
      case 'equip': { s.dur = 1.3; s.p0 = grabPose(headset.group); if (!step.on) { setWorld(headset.group, s.p0); } break; }
      case 'toggle': s.dur = 0.8; s.done = false; break;
      default: break;
    }
  }
  function finish() { curStep = null; }
  function setQueue(steps) { queue = steps.slice(); curStep = null; me.walking = false; if (queue.some((q) => q.t === 'stand' || q.t === 'walk')) { if (me.activity === 'pc' || me.activity === 'pcgame') pcReset(); me.activity = 'idle'; } } // 立つ・歩く手順があれば、いまの活動(読む・弾く・パソコン)は、終わり
  function stepDone() { return curStep === null; }

  function reachTarget(step) { // 本棚・キーボードへ手を伸ばす先(世界の点)
    if (step.what === 'kb') return kbHomeWorld.clone().add(new V3(0, 0.2, -0.05));
    const f = fwdV(), sR = modelX().multiplyScalar(-1); // 前と、右手のがわ
    return new V3(me.x + f.x * 0.64 + sR.x * 0.34, 1.1 + 0.12 * Math.sin(me.x * 1.7 + me.z), me.z + f.z * 0.64 + sR.z * 0.34); // 肩のすぐ前(腕が伸びすぎない近さ)
  }
  function runStep(dt) {
    const s = curStep; if (!s) return;
    s.k += dt; const u = s.dur ? clamp01(s.k / s.dur) : 0;
    switch (s.t) {
      case 'walk': {
        const target = s.pts[s.seg]; if (!target) { me.walking = false; return finish(); }
        const dx = target.x - me.x, dz = target.z - me.z, d = Math.hypot(dx, dz);
        const want = d > 0.02 ? Math.atan2(dx, dz) : me.yaw, diff = angleDiff(me.yaw, want);
        me.yaw += clampN(diff, -7 * dt, 7 * dt);
        if (Math.abs(diff) > 0.7) { me.walking = false; return; } // 向きが合うまでは、その場で回る
        const spd = me.carry === 'synth' ? WALK_HEAVY : WALK_SPEED; // 14.2kgのシンセを抱えている間は、ゆっくり
        me.walking = true; const step = Math.min(d, spd * dt); me.x += (dx / (d || 1)) * step; me.z += (dz / (d || 1)) * step;
        if (d - step < 0.03) { s.seg++; if (s.seg >= s.pts.length) { me.walking = false; finish(); } }
        break;
      }
      case 'face': { me.yaw += clampN(angleDiff(me.yaw, s.yaw), -5 * dt, 5 * dt); if (Math.abs(angleDiff(me.yaw, s.yaw)) < 0.03 && s.k > 0.15) finish(); break; }
      case 'reach': { if (s.tv) armTgt[s.arm] = s.tv; else armTgt.R = reachTarget(s); if (s.k >= s.dur) finish(); break; }
      case 'pick': {
        const what = s.what;
        if (what === 'kb') armTgt.L = armTgt.R = kbHomeWorld.clone().add(new V3(0, 0.2, -0.05));
        else if (what === 'book' && s.from === 'sofa') { const tv = new V3(-2.95, 0.5, 2.1); armTgt[armFor(tv)] = tv; }
        else if (what === 'book') armTgt.R = reachTarget({ what: 'book', shelf: s.shelf });
        else if (what === 'cup') { const sp = s.from === 'table' ? tableCupPose() : cupRestPose(); armTgt.L = sp.p.clone().add(gripV()); }
        else if (what === 'headset') armTgt.R = s.p0.p.clone();
        if (what === 'synth') { // ゆっくり持ち上げて、体の前へ(重そうに)
          const hold = localPose(snow.group, synthHoldP, synthHoldQ, ONE); setWorld(bigSynth.group, mixPose(s.p0, hold, smooth(u), 0.08)); const [a, b] = synthEnds(); armTgt.L = a; armTgt.R = b;
          if (u >= 1 && !s.done) { s.done = true; putLocal(bigSynth.group, snow.group, synthHoldP.clone(), synthHoldQ.clone(), ONE.clone()); me.carry = 'synth'; world.synthAt = 'hand'; }
        } else if (what === 'headset') { setWorld(headset.group, mixPose(s.p0, handPose(), smooth(u))); if (u >= 1 && !s.done) { s.done = true; me.carry = 'headset'; world.headset = 'hand'; const hp = handPose(); putLocal(headset.group, snow.itemSocket, new V3(0, 0.02, 0.08), Q0.clone(), hp.sc.clone().divideScalar(1)); headset.group.scale.setScalar(0.45); } }
        else if (u > 0.5 && !s.done) {
          s.done = true; me.carry = what;
          if (what === 'book') { if (!s.keep) bookObj.randomize(rand); bookObj.setOpen(false); book.visible = true; } // 別の本を取るたびに、色と大きさを変える。読みかけの本を取り直す時は、同じ本
          if (what === 'cup') world.cupAt = 'hand';
        }
        if (s.k >= s.dur) { if (!s.done) { s.done = true; me.carry = what; } finish(); }
        break;
      }
      case 'sit': {
        const k = smooth(s.k / s.dur), T = s.to, F = s.from;
        me.x = lerp(F.x, T.x, k); me.z = lerp(F.z, T.z, k); me.yaw = lerpAngle(F.yaw, T.yaw, k); me.sitK = k; me.y = T.y * k; me.walking = false;
        if (s.p0) { const tgt = synthFloorPose(); setWorld(bigSynth.group, mixPose(s.p0, tgt, k, 0.12)); const [a, b] = synthEnds(); armTgt.L = a; armTgt.R = b; } // 抱えていたシンセを、床へ寝かせる
        if (s.k >= s.dur) { me.seat = s.seat; me.sitK = 1; me.y = T.y; me.x = T.x; me.z = T.z; me.yaw = T.yaw; if (s.p0) { setWorld(bigSynth.group, synthFloorPose()); me.carry = null; world.synthAt = 'floor'; } finish(); }
        break;
      }
      case 'stand': {
        const k = smooth(s.k / 0.95), F = s.from, T = s.to, S = SPOTS[s.seat];
        me.x = lerp(F.x, T.x, k); me.z = lerp(F.z, T.z, k); me.sitK = 1 - k; me.y = S.seatY * (1 - k);
        if (s.k >= 0.95) { me.seat = null; me.sitK = 0; me.y = 0; me.x = T.x; me.z = T.z; finish(); }
        break;
      }
      case 'place': {
        const what = s.what;
        if (what === 'kb') armTgt.L = armTgt.R = kbHomeWorld.clone().add(new V3(0, 0.2, -0.05));
        else if (what === 'book' && s.at === 'sofa') { const tv = new V3(-2.65, 0.6, 2.05); armTgt[armFor(tv)] = tv; }
        else if (what === 'book' && s.at === 'shelf') armTgt.R = reachTarget({ what: 'book', shelf: s.shelf });
        else if (what === 'cup') armTgt.L = lerpV(s.p0.p, s.spot.p, smooth(u), 0.04).add(gripV());
        else if (what === 'headset') armTgt.R = s.target ? tgtV(s.target) : headsetRest.p.clone();
        if (what === 'cup') { const p = lerpV(s.p0.p, s.spot.p, smooth(u), 0.05); cup.root.position.copy(p); cup.root.rotation.y = lerpAngle(me.yaw, s.spot.yaw, smooth(u)); }
        if (what === 'synth') { const home = localPose(synthHome.parent, synthHome.pos, new Q4().setFromEuler(synthHome.rot), synthHome.scale); setWorld(bigSynth.group, mixPose(s.p0, home, smooth(u), 0.05)); const [a, b] = synthEnds(); armTgt.L = a; armTgt.R = b; }
        if (what === 'headset') setWorld(headset.group, mixPose(s.p0, headsetRest, smooth(u), 0.06));
        if (u >= 1 && !s.done) {
          s.done = true;
          if (what === 'kb') { kbHome.parent.add(kbObj); kbObj.position.copy(kbHome.pos); kbObj.rotation.copy(kbHome.rot); kbObj.scale.copy(kbHome.scale); }
          else if (what === 'book' && s.at === 'shelf') { book.visible = false; bookObj.setOpen(false); } // 本棚へ戻した
          else if (what === 'book') { scene.add(book); bookObj.setOpen(false); book.position.set(-2.95, 0.452, 2.05 + (rand() - 0.5) * 0.3); book.rotation.set(0, 0.6 + rand() * 0.5, 0); book.scale.setScalar(1); book.visible = true; }
          else if (what === 'cup') { world.cupAt = s.at; cup.root.position.copy(s.spot.p); cup.root.rotation.y = s.spot.yaw; }
          else if (what === 'synth') { synthHome.parent.add(bigSynth.group); bigSynth.group.position.copy(synthHome.pos); bigSynth.group.rotation.copy(synthHome.rot); bigSynth.group.scale.copy(synthHome.scale); world.synthAt = 'wall'; }
          else if (what === 'headset') { scene.add(headset.group); headset.group.position.copy(headsetRest.p); headset.group.quaternion.copy(headsetRest.q); headset.group.scale.copy(headsetRest.sc); world.headset = 'desk'; }
          me.carry = null;
        }
        if (s.k >= s.dur) finish(); break;
      }
      case 'equip': { // ヘッドセットを、両手で、頭にかける(外す)
        const hp = new V3(); snow.headGroup.getWorldPosition(hp); const mx = modelX(); armTgt.L = hp.clone().addScaledVector(mx, 0.5); armTgt.R = hp.clone().addScaledVector(mx, -0.5);
        if (s.on) { setWorld(headset.group, mixPose(s.p0, headPose(), smooth(u))); }
        else { setWorld(headset.group, mixPose(s.p0, handPose(), smooth(u))); }
        if (u >= 1 && !s.done) { s.done = true; if (s.on) { putLocal(headset.group, snow.headGroup, new V3(), Q0.clone(), ONE.clone()); world.headset = 'head'; me.carry = null; } else { putLocal(headset.group, snow.itemSocket, new V3(0, 0.02, 0.08), Q0.clone(), new V3(0.45, 0.45, 0.45)); world.headset = 'hand'; me.carry = 'headset'; } }
        if (s.k >= s.dur) finish(); break;
      }
      case 'toggle': { armTgt[armFor(tgtV(SPOTS.lamp.target))] = tgtV(SPOTS.lamp.target); if (u > 0.5 && !s.done) { s.done = true; lamp.setOn(!lamp.isOn()); world.lampOn = lamp.isOn(); } if (s.k >= s.dur) finish(); break; }
      case 'camera': { if (!cam.tween) finish(); break; }
      case 'do': {
        if (s.what === 'pc') {
          const seq = pcSequence(s.k, s.fresh); screenState.seq = seq; screenState.mode = seq.stage === 'game' ? 'game' : 'pc';
          if (seq.done && !s.fired) { s.fired = true; launched = true; screenState.mode = 'game'; me.activity = 'pcgame'; cam.locked = false; if (opts.onLaunch) opts.onLaunch(); finish(); }
        } else if (s.k >= s.dur) { me.activity = 'idle'; finish(); }
        break;
      }
      default: finish();
    }
  }
  const lerpV = (a, b, k, lift = 0) => { const p = a.clone().lerp(b, k); p.y += lift * Math.sin(Math.PI * k); return p; };
  function advance(dt) {
    if (!curStep && pending) { const a = pending; pending = null; setQueue(planAction(a, stateNow(), rand)); }
    if (!curStep && queue.length) begin(queue.shift());
    if (curStep) runStep(dt);
    if (!curStep && queue.length) begin(queue.shift()); // 手順の切れ目で、動きが止まらないように
  }

  // ---- パソコンの画面 ----
  const screenState = { mode: launched ? 'game' : 'desk', seq: null, gameFrame: null, cursor: { x: 80, y: 46 }, click: 0 };
  const FONT = '"Hiragino Sans","Noto Sans JP","Yu Gothic",sans-serif';
  function drawDesk(c) { const g = c.createLinearGradient(0, 0, 160, 90); g.addColorStop(0, '#1b2740'); g.addColorStop(1, '#2d3e66'); c.fillStyle = g; c.fillRect(0, 0, 160, 90);
    c.fillStyle = 'rgba(255,255,255,0.14)'; for (let i = 0; i < 3; i++) { c.fillRect(8, 8 + i * 17, 11, 11); } c.fillStyle = '#10151f'; c.fillRect(0, 82, 160, 8); c.fillStyle = '#7fb4ff'; c.fillRect(3, 84, 6, 4); }
  function drawPage(c, a = 1) { // ゲームの起動画面(ゲームのサイトの、見た目)
    const g = c.createLinearGradient(0, 0, 0, 90); g.addColorStop(0, '#08102a'); g.addColorStop(1, '#27346b'); c.globalAlpha = a; c.fillStyle = g; c.fillRect(0, 0, 160, 90);
    c.fillStyle = '#fff6c8'; for (const [x, y] of [[12, 10], [30, 24], [128, 8], [110, 30], [20, 52], [144, 50], [70, 8], [150, 24], [48, 14], [100, 14]]) c.fillRect(x, y, 2, 2);
    c.fillStyle = '#fff3b0'; c.beginPath(); c.arc(128, 22, 8, 0, Math.PI * 2); c.fill(); c.fillStyle = '#1a2552'; c.beginPath(); c.arc(131, 20, 7.2, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#eef3ff'; c.beginPath(); c.arc(14, 88, 22, 0, Math.PI * 2); c.arc(54, 92, 26, 0, Math.PI * 2); c.arc(110, 90, 24, 0, Math.PI * 2); c.arc(150, 88, 20, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fafaf8'; c.beginPath(); c.arc(80, 70, 11, 0, Math.PI * 2); c.fill(); c.beginPath(); c.arc(80, 55, 8, 0, Math.PI * 2); c.fill(); c.fillStyle = '#1a1612'; c.fillRect(74, 41, 12, 9); c.fillRect(72, 49, 16, 2); c.fillStyle = '#b03030'; c.fillRect(74, 47, 12, 2);
    c.fillStyle = '#e8700a'; c.fillRect(81, 55, 6, 1); c.fillStyle = '#2c2822'; c.fillRect(77, 53, 1.5, 1.5); c.fillRect(82, 53, 1.5, 1.5);
    c.fillStyle = '#ffffff'; c.font = `bold 13px ${FONT}`; c.textAlign = 'center'; c.fillText(opts.title || '星の雪だるま', 80, 30); c.font = `7px ${FONT}`; c.fillStyle = '#c9d6ff'; c.fillText(opts.titleEn || 'The Snowman of the Stars', 80, 40); c.globalAlpha = 1; }
  function drawBrowser(c, seq) {
    drawDesk(c); const k = easeInOutCubic(seq.open), w = lerp(40, 150, k), h = lerp(24, 80, k), x = 80 - w / 2, y = 44 - h / 2;
    c.fillStyle = '#e9edf5'; c.fillRect(x, y, w, h); c.fillStyle = '#39445f'; c.fillRect(x, y, w, 7); c.fillStyle = '#ff6b6b'; c.fillRect(x + 3, y + 2.5, 2, 2); c.fillStyle = '#ffd166'; c.fillRect(x + 7, y + 2.5, 2, 2); c.fillStyle = '#7ddc8a'; c.fillRect(x + 11, y + 2.5, 2, 2);
    if (seq.open < 0.85) return;
    const url = 'snowman-of-the-stars'; c.fillStyle = '#ffffff'; c.fillRect(x + 4, y + 9, w - 8, 8); c.strokeStyle = '#9aa6c0'; c.lineWidth = 0.6; c.strokeRect(x + 4, y + 9, w - 8, 8);
    const n = Math.floor(seq.typed * url.length); c.fillStyle = '#1c2438'; c.font = `6px ${FONT}`; c.textAlign = 'left'; c.fillText(url.slice(0, n) + (seq.stage === 'type' && Math.floor(t * 4) % 2 ? '|' : ''), x + 7, y + 15);
    if (seq.enter) { c.fillStyle = '#7fe8ff'; c.fillRect(x + w - 16, y + 10, 10, 6); c.fillStyle = '#10151f'; c.fillText('Enter', x + w - 15, y + 15); }
    if (seq.stage === 'load') { c.fillStyle = '#d5dbea'; c.fillRect(x + 4, y + 22, w - 8, h - 26); c.fillStyle = '#7fb4ff'; c.fillRect(x + 4, y + 18, (w - 8) * seq.load, 2); }
    if (seq.stage === 'page') { c.save(); c.beginPath(); c.rect(x + 4, y + 18, w - 8, h - 22); c.clip(); c.translate(x + 4 - 80 * (1 - 1) + 0, y + 18); c.scale((w - 8) / 160, (h - 22) / 90); drawPage(c, seq.page); c.restore(); }
  }
  function drawCursor(c, x, y, click) { x = Math.round(x); y = Math.round(y);
    if (click > 0.02) { c.strokeStyle = `rgba(255,255,255,${click})`; c.lineWidth = 1; c.beginPath(); c.arc(x, y, 3 + (1 - click) * 7, 0, Math.PI * 2); c.stroke(); }
    c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 10); c.lineTo(x + 2.6, y + 7.6); c.lineTo(x + 4.6, y + 12); c.lineTo(x + 6.4, y + 11.2); c.lineTo(x + 4.4, y + 6.9); c.lineTo(x + 7.6, y + 6.9); c.closePath(); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 1; c.strokeStyle = '#000'; c.stroke(); }
  let mouseDf = 0, mouseDr = 0, clickT = 9, nextClick = 1.3;
  function drawScreen(dt) {
    const sm = screenState; sctx.save();
    if (sm.mode === 'pc' && sm.seq) drawBrowser(sctx, sm.seq);
    else if (sm.mode === 'game') { if (sm.gameFrame && sm.gameFrame.width > 0) { try { sctx.drawImage(sm.gameFrame, 0, 0, 160, 90); } catch (e) { drawPage(sctx); } } else drawPage(sctx); }
    else drawDesk(sctx);
    if (sm.mode === 'game' || sm.mode === 'pc') { sm.cursor.x = 80 + mouseDr * 420; sm.cursor.y = 46 - mouseDf * 300; sm.click = Math.max(0, sm.click - dt * 4); if (!(sm.mode === 'pc' && sm.seq && sm.seq.stage !== 'open')) drawCursor(sctx, sm.cursor.x, sm.cursor.y, sm.click); }
    sctx.restore(); scrTex.needsUpdate = true;
  }

  // ---- 毎コマ ----
  function applyCarry() {
    if (me.carry === 'book') {
      if (me.activity === 'read' && me.seat === 'sofa') { if (book.parent !== snow.group) { snow.group.add(book); } bookObj.setOpen(true); book.position.set(0, 0.7, 0.5); book.rotation.set(-1.0, 0, 0); book.scale.setScalar(1.25); }
      else { if (book.parent !== snow.itemSocket) snow.itemSocket.add(book); bookObj.setOpen(false); book.position.set(0, 0.04, 0.07); book.rotation.set(-0.5, 0.3, 0.1); book.scale.setScalar(0.9); }
    } else if (me.carry === 'kb') {
      if (kbObj.parent !== snow.group) { snow.group.add(kbObj); kbObj.rotation.order = 'XYZ'; kbObj.rotation.set(0.18, 0, 0); kbObj.scale.setScalar(1); }
      kbObj.position.set(0, me.seat === 'sofa' ? 0.5 : 0.62, 0.58); kbObj.rotation.set(me.seat === 'sofa' ? 0.12 : 0.22, 0, 0);
    } else if (me.carry === 'synth' && bigSynth.group.parent === snow.group) {
      bigSynth.group.position.set(synthHoldP.x, synthHoldP.y + (me.walking ? -0.025 * (0.5 + 0.5 * Math.sin(t * 6.2)) : 0), synthHoldP.z); // 重くて、一歩ごとに、すこし沈む
    }
  }

  // ---- パソコンの操作: 録画のワイプ(stream-wipe.js)と同じ動き(キーを打つ・マウス・ときどきカップで飲む)をそのまま移植 ----
  const KEY_TOP = deskTopY + 0.07, hoverY = KEY_TOP + 0.03;
  const kbWorld = (x, z, y) => deskKb.localToWorld(new V3(x, y, z));
  const LEFT_KEYS = keys.filter((k) => k.x > 0.02 && k.x < 0.2), RIGHT_KEYS = keys.filter((k) => k.x < -0.02 && k.x > -0.2), WASD_KEYS = keys.filter((k) => k.x > 0.03 && k.x < 0.16 && k.z < 0.02);
  const pickOne = (arr) => arr[Math.floor(rand() * arr.length)];
  const pickNear = (arr, prev) => { const near = prev ? arr.filter((k) => k !== prev && Math.hypot(k.x - prev.x, (k.z - prev.z) * 1.4) < 0.085) : []; return near.length ? pickOne(near) : pickOne(arr); };
  const pcOp = { mode: 'game', modeT: 12 + rand() * 8, mouseDf: 0, mouseDr: 0, clickT: 99, nextClick: 1.2, tapNext: { L: 0.3, R: 0.6 }, press: { L: 0, R: 0 }, key: { L: null, R: null }, keyHold: 0, handLocal: { L: { x: 0.12, z: -0.02 }, R: { x: -0.12, z: 0.0 } }, cursorClick: 0, switchT: 0 };
  const pcDrink = { t: -1, next: 9 + rand() * 8, level: 1, settled: false };
  const pcBurst = { t: -1, next: 6 + rand() * 6, k: 0 };
  const D_REACH = 0.9, D_LIFT = 1.1, D_SIP = 1.7, D_LOWER = 1.1, D_REL = 0.7, D_ALL = D_REACH + D_LIFT + D_SIP + D_LOWER + D_REL;
  const armRate = { L: 12, R: 12 };
  let pcActive = false, pcHeadBack = 0, pcMouth = null;
  function pcReset() { pcDrink.t = -1; pcDrink.settled = false; pcDrink.next = 9 + rand() * 8; cup.root.position.copy(CUP_REST); cup.root.rotation.y = faceYaw; cup.tilt.rotation.x = 0; keyGlow.visible = false; pcMouth = null; pcHeadBack = 0; snow.setMouthOpen(null); pcOp.press.L = pcOp.press.R = 0; }
  function pcPre(dt) { // 勢い(10〜20秒に1回、2秒ほど、せわしなくなる)。雪だるまの update より前に決める
    pcBurst.next -= dt; if (pcBurst.t < 0 && pcBurst.next <= 0) pcBurst.t = 0;
    if (pcBurst.t >= 0) { pcBurst.t += dt; if (pcBurst.t > 2.2) { pcBurst.t = -1; pcBurst.next = 10 + rand() * 10; } }
    const bt = pcBurst.t >= 0 ? Math.sin(Math.min(1, pcBurst.t / 2.2) * Math.PI) : 0; pcBurst.k += (bt - pcBurst.k) * Math.min(1, dt * 8);
    snow.setIntensity(0.12 + 0.55 * pcBurst.k); snow.setPerform({ pat: 0.25 + 0.6 * pcBurst.k, sway: 0.25 + 0.6 * pcBurst.k, arms: 0, t: t * (1 + 0.6 * pcBurst.k) });
  }
  function pcPost(dt) { // 雪だるまの update のあと: 頭・マウス・キー・カップ・手の狙い
    const op = pcOp, burstK = pcBurst.k, nose = new V3(), mx = modelX(), f = fwdV();
    snow.headGroup.rotation.x += 0.1 - OP_TUNE.lean * 0.6 + 0.06 * Math.sin(t * 0.9) + 0.16 * burstK; snow.headGroup.rotation.y = Math.sin(t * 0.5) * 0.05 + 0.04 * burstK * Math.sin(t * 6);
    op.switchT = Math.max(0, op.switchT - dt);
    op.modeT -= dt; if (op.modeT <= 0) { op.mode = op.mode === 'game' ? 'type' : 'game'; op.modeT = op.mode === 'type' ? 3 + rand() * 3 : 10 + rand() * 12; op.tapNext.L = 0.1; op.tapNext.R = 0.25; op.switchT = 0.7; }
    const speed = 1 + 1.8 * burstK;
    if (op.mode === 'game') {
      const amp = 1 + 0.9 * burstK, tdf = (0.05 * Math.sin(t * 0.7 + 1) + 0.035 * Math.sin(t * 1.9)) * amp, tdr = (0.07 * Math.sin(t * 0.9) + 0.045 * Math.sin(t * 2.3 + 2)) * amp;
      op.mouseDf += (tdf - op.mouseDf) * Math.min(1, dt * 6); op.mouseDr += (tdr - op.mouseDr) * Math.min(1, dt * 6);
      op.nextClick -= dt * speed; if (op.nextClick <= 0) { op.clickT = 0; op.cursorClick = 1; op.nextClick = 0.8 + rand() * 2.2; }
    }
    op.clickT += dt; const click = op.clickT < 0.14 ? Math.sin((op.clickT / 0.14) * Math.PI) : 0; op.cursorClick = Math.max(0, op.cursorClick - dt * 4);
    const mouseP = deskPoint(MOUSE_F + op.mouseDf, MOUSE_R + op.mouseDr, deskTopY + 0.051);
    mouseMesh.position.set(mouseP.x, mouseP.y, mouseP.z); mouseMesh.rotation.y = faceYaw + 0.12 + op.mouseDr * 1.5; mouseBtn.position.y = 0.0155 - 0.003 * click;
    for (const h of ['L', 'R']) {
      const active = (op.mode === 'type' || h === 'L') && !(h === 'L' && pcDrink.t >= 0);
      op.press[h] = Math.max(0, op.press[h] - dt * 9);
      if (active) { op.tapNext[h] -= dt * speed; if (op.tapNext[h] <= 0) { const set = op.mode === 'type' ? (h === 'L' ? LEFT_KEYS : RIGHT_KEYS) : WASD_KEYS, k = pickNear(set, op.key[h]); op.key[h] = k; op.press[h] = 1; op.handLocal[h].x = k.x; op.handLocal[h].z = k.z; op.keyHold = 0.09; op.tapNext[h] = (op.mode === 'type' ? 0.11 + rand() * 0.2 : 0.22 + rand() * 0.75) + (h === 'R' ? 0.06 : 0); } }
    }
    op.keyHold -= dt; const shown = op.press.L > op.press.R ? 'L' : 'R'; keyGlow.visible = op.keyHold > 0 && !!op.key[shown]; if (keyGlow.visible) keyGlow.position.set(op.key[shown].x, 0.02, op.key[shown].z);
    // ときどき(game のあいだ)、左手でカップを取って飲む
    pcDrink.next -= dt; if (pcDrink.t < 0 && op.mode === 'game' && pcDrink.next <= 0 && world.cupAt === 'desk') { pcDrink.t = 0; }
    let drinkTgt = null, tilt = 0, headBack = 0, held = false, mouth = null;
    if (pcDrink.t >= 0) {
      pcDrink.t += dt; const T = pcDrink.t, tl = T - D_REACH, ts = tl - D_LIFT, td = ts - D_SIP, tr = td - D_LOWER;
      snow.getNoseTipWorld(nose); const S = new V3(nose.x + f.x * 0.14 - mx.x * 0.03, nose.y - 0.165, nose.z + f.z * 0.14 - mx.z * 0.03); const GRIP = gripV();
      let pos = CUP_REST.clone();
      if (T < D_REACH) drinkTgt = CUP_REST.clone().add(GRIP).add(new V3(0, 0.03 * (1 - T / D_REACH), 0));
      else if (tl < D_LIFT) { const k = smooth(tl / D_LIFT); pos.lerp(S, k); pos.y += 0.05 * Math.sin(Math.PI * k); tilt = 0.62 * k; headBack = k; held = true; }
      else if (ts < D_SIP) { pos.copy(S); pos.y += 0.005 * Math.sin(ts * 5); tilt = 0.62 + 0.1 * Math.sin(ts * 3); headBack = 1; held = true; if (ts > 0.3 && ts < 1.1) mouth = 0.2; }
      else if (td < D_LOWER) { const k = smooth(td / D_LOWER); pos.copy(S).lerp(CUP_REST, k); pos.y += 0.05 * Math.sin(Math.PI * k); tilt = 0.62 * (1 - k); headBack = 1 - k; held = true; }
      if (held) drinkTgt = pos.clone().add(GRIP);
      if (td >= D_LOWER && !pcDrink.settled) { pcDrink.settled = true; pcDrink.level -= 0.2; if (pcDrink.level < 0.3) pcDrink.level = 1; }
      if (T >= D_ALL) { pcDrink.t = -1; pcDrink.settled = false; op.switchT = 0.8; pcDrink.next = 25 + rand() * 30; }
    }
    snow.setMouthOpen(mouth); snow.headGroup.rotation.x -= 0.14 * headBack;
    if (pcDrink.t < 0 || !held) cup.root.position.copy(CUP_REST);
    cup.root.rotation.y = faceYaw; cup.tilt.rotation.x = -tilt; cup.liquid.position.y = 0.088 - (1 - pcDrink.level) * 0.03; cup.liquid.visible = tilt < 0.7;
    let tgtL = kbWorld(op.handLocal.L.x, op.handLocal.L.z, hoverY - KB_Y - 0.03 * op.press.L);
    const tgtR = op.mode === 'game' ? new V3(mouseP.x, deskTopY + 0.085 - 0.02 * click, mouseP.z) : kbWorld(op.handLocal.R.x, op.handLocal.R.z, hoverY - KB_Y - 0.03 * op.press.R);
    if (drinkTgt) tgtL = drinkTgt;
    armTgt.L = tgtL; armTgt.R = tgtR;
    armRate.L = op.switchT > 0 || (pcDrink.t >= 0 && (pcDrink.t < D_REACH || pcDrink.t > D_ALL - D_REL)) ? 5 : op.press.L > 0.5 ? 18 : 11; armRate.R = op.switchT > 0 ? 5 : op.press.R > 0.5 ? 18 : 11;
    pcHeldCup = held;
    mouseDf = op.mouseDf; mouseDr = op.mouseDr; screenState.click = op.cursorClick;
  }
  let pcHeldCup = false;

  function handTargets(dt) {
    const hold = (obj, lx, lz, ly = 0.02) => obj.localToWorld(new V3(lx, ly, lz));
    const inStep = curStep && (['reach', 'pick', 'place', 'equip', 'toggle'].includes(curStep.t) || (curStep.t === 'sit' && curStep.p0));
    armRate.L = armRate.R = 12;
    if (pcActive) { pcPost(dt); return; }
    if (inStep) return;
    armTgt.L = armTgt.R = null;
    if (me.carry === 'book' && me.activity === 'read' && me.seat === 'sofa') { const d = bookObj.dims; armTgt.L = hold(book, d.pw * 0.85, d.ph * 0.4, 0.03); armTgt.R = hold(book, -d.pw * 0.85, d.ph * 0.4, 0.03); }
    else if (me.carry === 'kb') {
      if (me.activity === 'play') { const a = Math.sin(t * 3.1), b = Math.sin(t * 2.6 + 1.3); armTgt.L = hold(kbObj, 0.14 + 0.1 * a, 0.0, 0.05); armTgt.R = hold(kbObj, -0.14 - 0.1 * b, 0.0, 0.05); }
      else { armTgt.L = hold(kbObj, 0.27, 0.0, 0.03); armTgt.R = hold(kbObj, -0.27, 0.0, 0.03); }
    } else if (me.carry === 'synth') { const [a, b] = synthEnds(); armTgt.L = a; armTgt.R = b; }
    else if (me.activity === 'floorplay' && me.seat === 'floor') { const a = Math.sin(t * 2.7), b = Math.sin(t * 2.2 + 1.1); armTgt.L = hold(bigSynth.group, 0.15 + 0.2 * a, 0.07, 0.09); armTgt.R = hold(bigSynth.group, -0.15 - 0.2 * b, 0.07, 0.09); }
    else if (me.carry === 'cup') {
      const ds = me.activity === 'drink' && curStep && curStep.t === 'do' ? drinkState(curStep.k) : { pos: 0, tilt: 0, headBack: 0, mouth: false };
      const nose = new V3(); snow.getNoseTipWorld(nose); const f = fwdV(), mx = modelX(); const S = new V3(nose.x + f.x * 0.14 - mx.x * 0.03, nose.y - 0.165, nose.z + f.z * 0.14 - mx.z * 0.03);
      const rest = cupHoldPos(), pos = rest.clone().lerp(S, ds.pos); pos.y += 0.2 * ds.pos * (1 - ds.pos);
      armTgt.L = pos.add(gripV()); sipTilt = 0.62 * ds.tilt; sipHeadBack = ds.headBack; sipMouth = ds.mouth ? 0.2 : null;
    }
  }
  let sipTilt = 0, sipHeadBack = 0, sipMouth = null;
  function updateSnowman(dt) {
    const onSofa = me.seat === 'sofa';
    pcActive = me.seat === 'chair' && !(curStep && curStep.t === 'stand');
    const heavy = me.carry === 'synth', floorplay = me.activity === 'floorplay' && me.seat === 'floor';
    rig.position.set(me.x, me.y + (heavy && me.walking ? 0 : 0), me.z); rig.rotation.y = me.yaw;
    const chairNow = me.seat === 'chair' || (curStep && curStep.t === 'sit' && curStep.seat === 'chair');
    const leanT = heavy ? -0.16 : floorplay ? 0.38 * me.sitK : chairNow ? OP_TUNE.lean * me.sitK : 0;
    me.lean += (leanT - me.lean) * Math.min(1, dt * 5); rig.rotation.x = me.lean + (pcActive ? 0.03 * Math.sin(t * 0.6) + 0.05 * pcBurst.k : 0) + (heavy && me.walking ? 0.03 * Math.sin(t * 3.1) : 0);
    let yawn = 0;
    if (yawnT >= 0) { yawnT += dt; yawn = Math.sin(clamp01(yawnT / 2.6) * Math.PI); if (yawnT > 2.6) { yawnT = -1; nextYawn = 18 + rand() * 20; } }
    else if (onSofa && me.activity === 'idle' && !curStep) { nextYawn -= dt; if (nextYawn <= 0) yawnT = 0; }
    const reading = me.activity === 'read', playing = me.activity === 'play' || floorplay;
    if (pcActive) { pcPre(dt); }
    else { snow.setIntensity(playing ? 0.5 : heavy ? 0.35 : joyT > 0 ? 0.5 : 0.08); snow.setPerform(playing ? { pat: 0.7, sway: 0.7, arms: 0, t } : null); }
    snow.setEmote({ sit: me.sitK, breath: 1, breathPhase: t, yawn: me.seat && !playing && !pcActive ? yawn : 0, drowsy: onSofa && me.activity === 'idle' && !curStep ? 0.25 : 0 });
    snow.setWalking(me.walking); snow.setJoyful(joyT > 0);
    joyT = Math.max(0, joyT - dt);
    snow.group.position.set(0, 0, 0); snow.update(dt, t); snow.group.rotation.y = Math.sin(t * 0.35) * 0.03;
    if (!pcActive) { snow.headGroup.rotation.y = 0; if (pcDrink.t >= 0 || pcHeldCup) pcReset(); } // 首の向きは、毎コマ、決め直す(モデルは y を元へ戻さない。足し算にすると、溜まって、ぐるぐる回った)
    sipTilt = 0; sipHeadBack = 0; sipMouth = null;
    rig.updateMatrixWorld(true); applyCarry(); book.updateMatrixWorld(true); kbObj.updateMatrixWorld(true); bigSynth.group.updateMatrixWorld(true); handTargets(dt);
    if (!pcActive) { if (reading) snow.headGroup.rotation.x += 0.28 + 0.02 * Math.sin(t * 0.7); if (playing) snow.headGroup.rotation.x += 0.16; snow.headGroup.rotation.x -= 0.14 * sipHeadBack; snow.setMouthOpen(sipMouth); }
    rig.updateMatrixWorld(true);
    const cap = pcActive ? ARM_MAX_PC : ARM_MAX;
    for (const [h, arm, tip] of [['L', armL, snow.torchSocket], ['R', armR, snow.itemSocket]]) {
      const tg = armTgt[h]; armW[h] += ((tg ? 1 : 0) - armW[h]) * Math.min(1, dt * 7);
      if (armW[h] < 0.01) { tipInit[h] = false; ikErr[h] = 0; continue; }
      if (tg) { if (!tipInit[h]) { tip.getWorldPosition(tipPos[h]); tipInit[h] = true; } tipPos[h].lerp(tg, Math.min(1, dt * armRate[h])); }
      aimArm(arm, tip, tipPos[h], armW[h], cap); tip.getWorldPosition(_tip); ikErr[h] = _tip.distanceTo(tipPos[h]); // 手の先と、狙いの、ずれ(試験用)
    }
    // カップ: 手に持っている間は、手(左)について行く(録画のワイプと同じ。カップは、傾いても、まっすぐのまま)
    if (world.cupAt === 'hand' && !(curStep && curStep.t === 'place' && curStep.what === 'cup')) { cup.root.position.copy(tipPos.L).sub(gripV()); cup.root.rotation.y = me.yaw; cup.tilt.rotation.x = -sipTilt; cup.liquid.visible = sipTilt < 0.7; }
    else if (pcActive && pcHeldCup) { cup.root.position.copy(tipPos.L).sub(gripV()); }
    else if (world.cupAt === 'hand') { /* 置いている最中は、手順が動かす */ }
    else if (world.cupAt !== 'hand' && !pcActive) { cup.tilt.rotation.x = 0; cup.liquid.visible = true; }
    if (me.carry === 'book' && me.activity === 'read') { // ときどき、ページをめくる
      const cycle = (t % 7.5); if (cycle < 0.6 && me.seat === 'sofa') { flapPivot.visible = true; flapPivot.rotation.z = Math.PI * easeInOutCubic(cycle / 0.6); } else flapPivot.visible = false; // ページが、背を軸に、上へ起きて、左へ倒れる
    }
    const lampTarget = lamp.isOn() ? 5.5 : 0; lampLightPt.intensity += (lampTarget * (0.92 + 0.08 * Math.sin(t * 7.3 + Math.sin(t * 2.1) * 2)) - lampLightPt.intensity) * Math.min(1, dt * 5);
  }

  function update(dtSec) {
    const dt = Math.max(0, Math.min(MAX_DT, +dtSec || 1 / 30)); t += dt;
    advance(dt); updateCamera(dt); updateSnowman(dt); drawScreen(dt);
    if (me.activity === 'read' && me.seat === 'sofa' && !curStep && !queue.length && !pending) { thirstT -= dt; if (thirstT <= 0) { thirstT = 50 + rand() * 50; api.act({ type: 'cup', thirst: true }); } } // 読書中に、ときどき、飲みたくなる
    const now = nowFn(); city.update(t, dt, now); clock.update(t, now); cup.update(t, 0);
    const glow = screenState.mode === 'game' ? 0.7 : 0.4; screenLight.intensity = 3.6 + 1.2 * glow + 0.3 * Math.sin(t * 9); lampLight.intensity = 6.5 + 0.2 * Math.sin(t * 1.3); room.update(t);
  }

  // ---- 外へ見せるもの ----
  const api = {
    canvas, renderer, scene, camera, snow, me,
    update,
    render() { renderer.render(scene, camera); },
    setSize(w, h) { size = { w: Math.max(2, w | 0), h: Math.max(2, h | 0) }; renderer.setSize(size.w, size.h, false); camera.aspect = size.w / size.h; applyCamera(); },
    keyEvent(e, down) { onKey(e, down); },
    clearKeys() { keysDown.clear(); },
    setInteractive(v) { interactive = !!v; if (!interactive) { drag = null; pinch = null; ptrs.clear(); keysDown.clear(); if (opts.onHover) opts.onHover(null, 0, 0); } canvas.style.cursor = interactive ? 'grab' : 'pointer'; },
    /** クリックされたもの { type:'book'|'keyboard'|'monitor'|'sofa'|'snowman', shelf? } に応じて、雪だるまを動かす。 */
    act(p) {
      if (!p) return;
      if (p.type === 'snowman') { if (!curStep && !queue.length) { joyT = 1.6; snow.triggerActionSwing(); } return; }
      if (curStep && curStep.t === 'do' && curStep.what === 'pc' && !(me.activity === 'pcgame')) return; // ゲームのサイトへ行く最中は、ほかの操作を受けない(数秒)
      let action = p;
      if (p.type === 'sofa') { if (me.seat === 'sofa' && !curStep && !queue.length) return; action = { type: 'sofa' }; }
      if (curStep && ATOMIC.has(curStep.t)) { pending = action; queue = []; return; } // 立つ・座る・取る・置く の途中は、終わってから
      const steps = planAction(action, stateNow(), rand);
      if (!steps.length) return;
      if (curStep && curStep.t === 'do' && curStep.what !== 'pc') me.activity = 'idle';
      cam.locked = false; setQueue(steps); pending = null;
    },
    /** ゲームの画面(160×90 の縮小コピー)を、パソコンの画面に映す。 */
    setGameFrame(c) { screenState.gameFrame = c; },
    /** ゲームを遊んでいる状態にする(部屋の演出を、とばして始める時)。雪だるまは、椅子に座って、ゲームを遊んでいる。 */
    startAtPc() {
      launched = true; screenState.mode = 'game'; Object.assign(me, { seat: 'chair', x: SPOTS.chair.seat.x, z: SPOTS.chair.seat.z, y: SPOTS.chair.seatY, yaw: SPOTS.chair.yaw, sitK: 1, activity: 'pcgame', carry: null, walking: false });
      putLocal(headset.group, snow.headGroup, new V3(), Q0.clone(), ONE.clone()); world.headset = 'head';
      queue = []; curStep = null; setView(WIPE_VIEWS.monitor); cam.locked = false;
    },
    isLaunched: () => launched,
    getActivity: () => me.activity,
    isBusy: () => !!curStep || queue.length > 0,
    /** カメラが、いま、決まった画角に固定されているか(モニターの場面)。 */
    isCameraLocked: () => cam.locked,
    debug: { world, ikErr, pcOp, pcDrink, synthHome, headsetRest, pickAt, setView, city, clock, bookObj, sideTable, bigSynth, lamp, lampLightPt, midi, headset, mixer, cup, nowFn, kbObj, book, kbHome, screenState, get launchedFlag() { return launched; }, get stepInfo() { return curStep && { t: curStep.t, what: curStep.what, at: curStep.at, from: curStep.from }; }, get queue() { return queue.map((s) => s.t); }, get step() { return curStep && curStep.t; }, cam, SHELVES, pathLength },
    dispose() {
      try { scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); for (const x of owned) if (x && x.dispose) x.dispose(); renderer.dispose(); renderer.forceContextLoss(); } catch (e) { /* もう、捨てられている */ }
    },
  };
  setView(DEFAULT_VIEW); api.setSize(size.w, size.h);
  if (opts.startAtPc) api.startAtPc();
  return api;
}
