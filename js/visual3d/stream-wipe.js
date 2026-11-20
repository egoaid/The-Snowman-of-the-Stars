// stream-wipe.js (v1.107) — 録画のワイプ(画面の隅の小さな映像)「自動アバター」。
//   雪だるまが、自分の部屋で、ヘッドホンをつけて、パソコンの前で、もくもくと、このゲームを遊んでいる。
//   画面のパソコンには、いま録画しているゲーム画面そのものが映る(雪だるまが、雪だるまのゲームを遊んでいる)。
//   カメラ・マイクは、使わない。動きは、すべて自動。
//
//   ・ゲーム本体とは別の、小さな WebGL(ワイプ専用の部屋)。録画している間だけ作り、止めたら、すべて捨てる。
//   ・描くのは、録画が1コマ取り込まれる時だけ(30fps)。録画していない時は、何も動かない・何も描かない。
//   ・雪だるまは、本編と同じモデル(createSnowmanCharacter)。座る・口・まばたき・手の動きは、本編の仕組みをそのまま使う。
import * as THREE from 'three';
import { createSnowmanCharacter } from './snowman.js';
import { getSmoothGradientMap } from './shading.js';

const MAX_DT = 0.1; // 1コマの時間の上限(別のタブから戻った直後などに、動きが飛ばないように)

// ---- 固定カメラ(配信者の部屋に、固定カメラが3つあるという想定)。画角は、横長(16:9)での縦の画角(度)。 ----
//   room=部屋全体 / monitor=モニターを見ている雪だるま / face=顔のアップ。切り替えは「カット」だけ(パン・徐々にズームは、しない)。
export const WIPE_VIEWS = {
  room: { pos: [-0.45, 1.8, 5.2], target: [-0.3, 1.05, 0.5], fov: 38 },
  monitor: { pos: [0.05, 1.6, 3.7], target: [-0.35, 1.5, 0.55], fov: 36 },
  face: { pos: [-0.55, 1.62, 2.05], target: [0.3, 1.62, 0.4], fov: 34 },
};
const VIEW_LIMITS = { pos: [[-3.3, 3.5], [0.3, 3.6], [-2.0, 6.5]], target: [[-3.3, 3.5], [0.2, 3.2], [-2.0, 4.0]], fov: [12, 70] };
const clampN = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));
const cloneView = (v) => ({ pos: [...v.pos], target: [...v.target], fov: v.fov });
/** 設定の camCustom({px,py,pz,tx,ty,tz,fov})を、視点(pos・target・fov)へ。 */
export function viewFromCustom(c) { return c ? { pos: [c.px, c.py, c.pz], target: [c.tx, c.ty, c.tz], fov: c.fov } : cloneView(WIPE_VIEWS.monitor); }
/** 視点を、設定の camCustom の形へ。 */
export function customFromView(v) { return { px: v.pos[0], py: v.pos[1], pz: v.pos[2], tx: v.target[0], ty: v.target[1], tz: v.target[2], fov: v.fov }; }
/** 縦に長い形では、横に見える幅を、ほぼ保つよう、縦の画角を広げる(上限80度)。16:9より横長は、そのまま。 */
export function fitFov(baseFov, aspect) {
  if (aspect >= 16 / 9) return baseFov;
  return Math.min(80, Math.max(baseFov, (2 * Math.atan((Math.tan((baseFov * Math.PI) / 360) * (16 / 9) * 0.85) / aspect) * 180) / Math.PI));
}

export function createStreamWipe(opts) {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x1c1a24, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 30);
  const grad = getSmoothGradientMap();
  const toon = (color) => new THREE.MeshToonMaterial({ color, gradientMap: grad });
  const owned = []; // あとで捨てるもの(ジオメトリ・マテリアル・テクスチャ)
  const keep = (x) => { owned.push(x); return x; };
  function box(w, h, d, mat, x, y, z, parent = scene) { const m = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, d)), mat); m.position.set(x, y, z); parent.add(m); return m; }

  // ---- 明かり: 夜の部屋。窓からの青い光(弱い)+ 電気スタンドの暖かい光 + パソコンの画面の光 ----
  scene.add(new THREE.HemisphereLight(0x8a9bd6, 0x4a3a30, 0.85));
  const lampLight = new THREE.PointLight(0xffc27a, 7, 6, 1.6); lampLight.position.set(-1.7, 1.55, 0.6); scene.add(lampLight);
  const screenLight = new THREE.PointLight(0x9fd0ff, 4.2, 4.5, 1.7); screenLight.position.set(-0.7, 1.1, 0.9); scene.add(screenLight);
  const key = new THREE.DirectionalLight(0xdfe6ff, 0.55); key.position.set(2.5, 3, 4); scene.add(key);

  // ---- 部屋: 床・奥の壁・左の壁・窓(夜空)・ラグ ----
  const wallMat = toon(0x6f7fa8), floorMat = toon(0x8b6b4e), trimMat = toon(0x3d3548), woodMat = toon(0x6a4a33), darkMat = toon(0x2b2f3a);
  keep(wallMat); keep(floorMat); keep(trimMat); keep(woodMat); keep(darkMat);
  const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(9, 7)), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.set(-0.4, 0, 0.5); scene.add(floor);
  box(14, 9, 0.1, wallMat, -0.4, 4.5, -2.3); // 奥の壁(縦に長い形でも、天井の外が見えないよう、高く広く)
  box(0.1, 9, 9, wallMat, -3.6, 4.5, 1.5); // 左の壁
  box(9, 0.18, 0.12, trimMat, -0.4, 0.09, -2.22); // 幅木
  const rug = new THREE.Mesh(keep(new THREE.CircleGeometry(1.25, 28)), toon(0xb03a48)); keep(rug.material); rug.rotation.x = -Math.PI / 2; rug.position.set(0.1, 0.012, 0.35); scene.add(rug);
  const rugIn = new THREE.Mesh(keep(new THREE.CircleGeometry(0.8, 28)), toon(0xe9d8b4)); keep(rugIn.material); rugIn.rotation.x = -Math.PI / 2; rugIn.position.set(0.1, 0.016, 0.35); scene.add(rugIn);
  // 窓(夜空に、月と星)。小さなキャンバスに描く。
  const winCanvas = document.createElement('canvas'); winCanvas.width = 64; winCanvas.height = 80;
  { const c = winCanvas.getContext('2d'); const g = c.createLinearGradient(0, 0, 0, 80); g.addColorStop(0, '#0b1230'); g.addColorStop(1, '#27346b'); c.fillStyle = g; c.fillRect(0, 0, 64, 80);
    c.fillStyle = '#fff6c8'; for (const [x, y] of [[8, 10], [22, 24], [48, 8], [40, 38], [14, 52], [54, 58], [30, 8], [58, 30]]) c.fillRect(x, y, 2, 2);
    c.fillStyle = '#fff3b0'; c.beginPath(); c.arc(44, 22, 7, 0, Math.PI * 2); c.fill(); c.fillStyle = '#27346b'; c.beginPath(); c.arc(47, 20, 6.2, 0, Math.PI * 2); c.fill(); // 三日月
    c.fillStyle = '#eef3ff'; c.beginPath(); c.arc(8, 74, 14, 0, Math.PI * 2); c.arc(30, 78, 16, 0, Math.PI * 2); c.arc(54, 76, 14, 0, Math.PI * 2); c.fill(); } // 雪の積もった丘
  const winTex = keep(new THREE.CanvasTexture(winCanvas)); winTex.colorSpace = THREE.SRGBColorSpace; winTex.magFilter = THREE.NearestFilter; winTex.minFilter = THREE.NearestFilter;
  const winMat = keep(new THREE.MeshBasicMaterial({ map: winTex, toneMapped: false }));
  const win = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.5, 1.9)), winMat); win.position.set(-0.95, 1.75, -2.23); scene.add(win);
  box(1.66, 0.08, 0.1, woodMat, -0.95, 2.74, -2.2); box(1.66, 0.08, 0.1, woodMat, -0.95, 0.8, -2.2); box(0.08, 2, 0.1, woodMat, -1.78, 1.77, -2.2); box(0.08, 2, 0.1, woodMat, -0.12, 1.77, -2.2); box(0.05, 1.9, 0.08, woodMat, -0.95, 1.77, -2.2); // 窓枠(まんなかに桟)
  // 壁の飾り: 星のポスターと、棚
  const posterMat = toon(0xf2d34f); keep(posterMat);
  box(0.62, 0.8, 0.03, toon(0x2a2f55), 1.0, 2.0, -2.22); // ポスターの台紙
  const star = new THREE.Mesh(keep(new THREE.CircleGeometry(0.2, 5)), posterMat); star.position.set(1.0, 2.04, -2.2); scene.add(star);
  box(1.0, 0.05, 0.28, woodMat, -2.7, 1.55, -2.1); // 棚
  box(0.16, 0.22, 0.16, toon(0x4a9a63), -2.95, 1.69, -2.1); box(0.2, 0.14, 0.18, toon(0xd2693a), -2.55, 1.64, -2.1); // 小物

  // ---- 机・パソコン・キーボード・マグカップ・スタンド ----
  const deskTopY = 0.78;
  box(1.8, 0.06, 0.85, woodMat, -1.25, deskTopY, 0.72); // 天板
  for (const [lx, lz] of [[-2.05, 0.34], [-0.45, 0.34], [-2.05, 1.1], [-0.45, 1.1]]) box(0.06, deskTopY, 0.06, darkMat, lx, deskTopY / 2, lz);
  // モニター: 画面は、いま録画しているゲーム画面(毎コマ、更新)。画面の向きは、雪だるまのほうへ。
  const monitor = new THREE.Group(); monitor.position.set(-1.2, deskTopY + 0.03, 0.82); monitor.rotation.y = 0.96; scene.add(monitor); // 画面は、雪だるまのほうへ、少しカメラ寄りに
  box(0.26, 0.02, 0.18, darkMat, 0, 0.01, 0, monitor); box(0.04, 0.18, 0.04, darkMat, 0, 0.1, 0, monitor);
  box(0.86, 0.5, 0.05, darkMat, 0, 0.42, 0, monitor); // ふち
  const gameCanvas2 = document.createElement('canvas'); gameCanvas2.width = 160; gameCanvas2.height = 90; // 画面の中身(ゲーム画面の縮小コピー)
  const gctx = gameCanvas2.getContext('2d', { alpha: false, willReadFrequently: true }); gctx.imageSmoothingEnabled = true; gctx.fillStyle = '#10151f'; gctx.fillRect(0, 0, 160, 90);
  const screenTex = keep(new THREE.CanvasTexture(gameCanvas2)); screenTex.colorSpace = THREE.SRGBColorSpace; screenTex.magFilter = THREE.NearestFilter; screenTex.minFilter = THREE.NearestFilter; screenTex.generateMipmaps = false;
  const screenMat = keep(new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
  const screen = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.78, 0.44)), screenMat); screen.position.set(0, 0.42, 0.028); monitor.add(screen);
  const kb = box(0.44, 0.025, 0.16, darkMat, -0.66, deskTopY + 0.045, 0.62); kb.rotation.y = 1.45;
  box(0.07, 0.03, 0.1, toon(0xdedede), -0.62, deskTopY + 0.05, 0.98); // マウス
  const mug = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.05, 0.045, 0.1, 10)), toon(0xe9d8b4)); keep(mug.material); mug.position.set(-1.85, deskTopY + 0.08, 1.0); scene.add(mug);
  const lampBase = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.09, 0.1, 0.03, 10)), darkMat); lampBase.position.set(-1.95, deskTopY + 0.045, 0.5); scene.add(lampBase);
  const lampArm = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.012, 0.012, 0.62, 5)), darkMat); lampArm.position.set(-1.95, deskTopY + 0.36, 0.5); lampArm.rotation.z = -0.25; scene.add(lampArm);
  const lampShade = new THREE.Mesh(keep(new THREE.ConeGeometry(0.12, 0.14, 10, 1, true)), keep(new THREE.MeshBasicMaterial({ color: 0xffd9a0, side: THREE.DoubleSide, toneMapped: false }))); lampShade.position.set(-1.83, deskTopY + 0.66, 0.5); lampShade.rotation.z = 0.5; scene.add(lampShade);

  // ---- 椅子(雪だるまの向きにあわせて回す。背もたれは、雪だるまの後ろ) ----
  const seatY = 0.42, chairX = 0.4, chairZ = 0.35;
  const faceYaw = Math.atan2(-1.2 - chairX, 0.82 - chairZ) + 0.05; // モニターのほうを向く
  const chair = new THREE.Group(); chair.position.set(chairX, 0, chairZ); chair.rotation.y = faceYaw; scene.add(chair);
  const chairMat = toon(0x3b4a8a); keep(chairMat);
  box(0.66, 0.08, 0.62, chairMat, 0, seatY - 0.04, 0, chair);
  box(0.6, 0.6, 0.08, chairMat, 0, seatY + 0.34, -0.34, chair).rotation.x = -0.08; // 背もたれ
  box(0.05, seatY - 0.08, 0.05, darkMat, 0, (seatY - 0.08) / 2, 0, chair);
  for (let a = 0; a < 5; a++) { const w = box(0.34, 0.03, 0.04, darkMat, Math.cos(a * 1.2566) * 0.17, 0.03, Math.sin(a * 1.2566) * 0.17, chair); w.rotation.y = -a * 1.2566; }

  // ---- 雪だるま(本編と同じモデル)+ ヘッドホン ----
  const snow = createSnowmanCharacter(1);
  const sg = snow.group; scene.add(sg);
  sg.rotation.y = faceYaw; sg.position.set(chairX, seatY, chairZ);
  const headR = 0.5 * 0.72;
  // ヘッドホン: 後ろへ回すバンド(帽子の邪魔をしない)+ 両耳のカップ + 口元のマイク
  const hpMat = toon(0x2b2f3a), hpAccent = toon(0xb03030); keep(hpMat); keep(hpAccent);
  const band = new THREE.Mesh(keep(new THREE.TorusGeometry(headR * 1.04, 0.026, 6, 22, Math.PI)), hpMat);
  band.rotation.x = Math.PI / 2; band.rotation.z = Math.PI; band.position.y = -0.02; // 耳から耳へ、頭の後ろを回る(上から見て、うしろ半分)
  snow.headGroup.add(band);
  for (const side of [-1, 1]) {
    const cup = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.115, 0.115, 0.075, 12)), hpMat); cup.rotation.z = Math.PI / 2; cup.position.set(side * (headR * 1.0 + 0.04), -0.02, -0.01); snow.headGroup.add(cup);
    const ring = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.075, 0.075, 0.085, 12)), hpAccent); ring.rotation.z = Math.PI / 2; ring.position.copy(cup.position); ring.position.x += side * 0.006; snow.headGroup.add(ring);
  }
  const boom = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.011, 0.011, 0.27, 5)), hpMat);
  boom.position.set(-(headR * 1.0 + 0.06) + 0.1, -0.12, headR * 0.5); boom.rotation.set(Math.PI / 2 - 0.45, 0, -1.0); snow.headGroup.add(boom); // 左のカップから、口元へ
  const mic = new THREE.Mesh(keep(new THREE.SphereGeometry(0.03, 7, 6)), hpAccent); mic.position.set(-0.06, -0.2, headR * 0.93); snow.headGroup.add(mic);
  snow.setEmote({ sit: 1, breath: 1, breathPhase: 0 });
  snow.setMouthOpen(null); // ふだんは、口を閉じて、時々、小さくもごもご(本編の「自律もごもご」)。しゃべらない。

  // ---- カメラ: 少し斜め前から。雪だるまの横顔と、モニターの画面が、両方見える ----

  // ---- 動き(すべて自動) ----
  let t = 0, burstT = -1, nextBurst = 6 + Math.random() * 6, burstK = 0, size = { w: 192, h: 108 };
  function animate(dt) {
    t += dt;
    // ときどき(10〜20秒に1回)、2秒ほど、夢中になる: 手が速く動き、頭が揺れ、少し前のめり
    nextBurst -= dt; if (burstT < 0 && nextBurst <= 0) { burstT = 0; }
    if (burstT >= 0) { burstT += dt; if (burstT > 2.2) { burstT = -1; nextBurst = 10 + Math.random() * 10; } }
    const burstTarget = burstT >= 0 ? Math.sin(Math.min(1, burstT / 2.2) * Math.PI) : 0;
    burstK += (burstTarget - burstK) * Math.min(1, dt * 8);
    snow.setIntensity(0.12 + 0.55 * burstK);
    snow.setPerform({ pat: 0.25 + 0.6 * burstK, sway: 0.25 + 0.6 * burstK, arms: 0.45 + 0.5 * burstK, t: t * (1 + 0.6 * burstK) });
    snow.setEmote({ sit: 1, breath: 1, breathPhase: t });
    sg.position.set(chairX, seatY, chairZ); // update() が、y に足し算するので、毎コマ、置き直す
    snow.update(dt, t);
    sg.rotation.y = faceYaw + Math.sin(t * 0.35) * 0.03; // 本編の update が、向き(y)には触らない
    snow.headGroup.rotation.x += 0.1 + 0.06 * Math.sin(t * 0.9) + 0.16 * burstK; // 画面をのぞきこむ
    snow.headGroup.rotation.y = Math.sin(t * 0.5) * 0.05 + 0.04 * burstK * Math.sin(t * 6);
    // 画面の光: ゲーム画面の明るさにあわせて、少しゆらぐ
    screenLight.intensity = 3.6 + 1.2 * glow + 0.3 * Math.sin(t * 9);
    lampLight.intensity = 6.5 + 0.2 * Math.sin(t * 1.3);
  }
  let glow = 0.5;

  // ---- カメラ(固定。切り替えは、カットだけ) ----
  let view = cloneView(WIPE_VIEWS.room), cam = 'room', camInterval = 15, autoNext = 0, autoCur = 'room';
  function applyView(v) {
    view = cloneView(v);
    camera.position.set(v.pos[0], v.pos[1], v.pos[2]); camera.lookAt(v.target[0], v.target[1], v.target[2]);
    camera.fov = fitFov(v.fov, camera.aspect); camera.updateProjectionMatrix();
  }
  /** 画角の設定を渡す。opts = { cam: 'room'|'monitor'|'face'|'custom'|'auto', camCustom, camInterval }(normalizeWipe の形) */
  function setCameraPlan(o) {
    o = o || {}; cam = o.cam || 'room'; camInterval = Math.max(3, +o.camInterval || 15);
    if (cam === 'auto') { autoCur = Object.keys(WIPE_VIEWS)[Math.floor(Math.random() * 3)]; applyView(WIPE_VIEWS[autoCur]); autoNext = camInterval * (0.7 + 0.6 * Math.random()); }
    else if (cam === 'custom') applyView(viewFromCustom(o.camCustom));
    else applyView(WIPE_VIEWS[cam] || WIPE_VIEWS.room);
  }
  function autoCut(dt) { // 3つの固定カメラの、どれかへ、カット(同じ画角が続けて出ない)。パン・ズームは、しない
    autoNext -= dt; if (autoNext > 0) return;
    const names = Object.keys(WIPE_VIEWS).filter((n) => n !== autoCur); autoCur = names[Math.floor(Math.random() * names.length)];
    applyView(WIPE_VIEWS[autoCur]); autoNext = camInterval * (0.7 + 0.6 * Math.random());
  }
  function setSize(w, h) {
    size = { w, h }; renderer.setSize(w, h, false);
    camera.aspect = w / h; applyView(view); // 形(縦横比)に合わせて、画角を調整
  }
  /** 1コマ進めて、描く。src = いま録画しているゲーム画面(あれば、パソコンの画面に映す)。 */
  function renderFrame(src, dtSec) {
    const dt = Math.max(0, Math.min(MAX_DT, +dtSec || 1 / 30));
    if (src && src.width > 0) {
      try {
        gctx.drawImage(src, 0, 0, gameCanvas2.width, gameCanvas2.height); screenTex.needsUpdate = true;
        const px = gctx.getImageData(40, 25, 1, 1).data; glow += (((px[0] + px[1] + px[2]) / 765) - glow) * 0.1; // 画面の明るさ(昼は明るく、夜は暗い)→ 光に反映
      } catch (e) { /* 取り込めない時は、前のコマのまま */ }
    }
    if (cam === 'auto') autoCut(dt);
    animate(dt);
    renderer.render(scene, camera);
  }
  function dispose() {
    try { scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); for (const x of owned) if (x && x.dispose) x.dispose(); renderer.dispose(); renderer.forceContextLoss(); } catch (e) { /* もう、捨てられている */ }
  }
  setSize(size.w, size.h); setCameraPlan(opts);
  return { canvas, setSize, renderFrame, dispose, setCameraPlan, getView: () => cloneView(view), setView: (v) => { cam = 'custom'; applyView({ pos: v.pos.map((x, i) => clampN(x, VIEW_LIMITS.pos[i])), target: v.target.map((x, i) => clampN(x, VIEW_LIMITS.target[i])), fov: clampN(v.fov, VIEW_LIMITS.fov) }); }, currentViewName: () => (cam === 'auto' ? autoCur : cam), snow, scene, camera, get size() { return { ...size }; } };
}

/**
 * 設定画面のプレビュー用: キャンバスを、ドラッグで回す・右ドラッグ(か Shift+ドラッグ)で平行移動・ホイールでズームして、画角を決める。
 * 動かすたびに onChange(視点) を呼ぶ。録画の中では、カメラは動かさない(これは、設定画面の、画角を決める操作だけ)。
 * canEdit() が false の間(自動切り替え中など)は、動かさない。戻り値: 外す関数。
 */
export function attachViewControls(canvas, wipe, onChange, canEdit = () => true) {
  let drag = null;
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const down = (e) => { if (!canEdit()) return; drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey, v: wipe.getView() }; try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* なくても動く */ } e.preventDefault(); };
  const move = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y, v = drag.v, off = [v.pos[0] - v.target[0], v.pos[1] - v.target[1], v.pos[2] - v.target[2]], r = Math.hypot(off[0], off[1], off[2]) || 1;
    let nv;
    if (drag.pan) { // 画面の左右・上下へ、カメラと注目点を、いっしょに動かす
      const fwd = norm([-off[0], -off[1], -off[2]]), right = norm(cross(fwd, [0, 1, 0])), up = cross(right, fwd), k = r * 0.0022 * (v.fov / 38);
      const m = [(-dx * right[0] + dy * up[0]) * k, (-dx * right[1] + dy * up[1]) * k, (-dx * right[2] + dy * up[2]) * k];
      nv = { pos: [v.pos[0] + m[0], v.pos[1] + m[1], v.pos[2] + m[2]], target: [v.target[0] + m[0], v.target[1] + m[1], v.target[2] + m[2]], fov: v.fov };
    } else { // 注目点のまわりを回る
      let yaw = Math.atan2(off[0], off[2]) - dx * 0.008, pitch = Math.asin(Math.max(-1, Math.min(1, off[1] / r))) + dy * 0.006; pitch = Math.max(-0.5, Math.min(1.2, pitch));
      nv = { pos: [v.target[0] + r * Math.cos(pitch) * Math.sin(yaw), v.target[1] + r * Math.sin(pitch), v.target[2] + r * Math.cos(pitch) * Math.cos(yaw)], target: v.target, fov: v.fov };
    }
    wipe.setView(nv); onChange(wipe.getView());
  };
  const up = () => { drag = null; };
  const wheel = (e) => { if (!canEdit()) return; e.preventDefault(); const v = wipe.getView(); v.fov = v.fov * Math.exp(e.deltaY * 0.0012); wipe.setView(v); onChange(wipe.getView()); };
  const menu = (e) => e.preventDefault();
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('contextmenu', menu);
  return () => { canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('contextmenu', menu); };
}
