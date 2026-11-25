// room-props.js (v1.114) — 雪だるまの部屋の小物。intro-room.js が使う。
//   窓の外の3Dの街(実時間で昼夜が変わる)・振り子時計(実時間)・大きなシンセ(実寸)・卓上マイク・小型ミキサー・ヘッドセット・カップ・
//   ジャックオーランタンの小型ランプ・サイドテーブル・M字に開く本。
//   固有名詞(製品名・ロゴ)は、見た目にも、文字にも、出さない(形と大きさだけを、実物に近づける)。長さの単位は m。
import * as THREE from 'three';
import { createJackOLanternMesh } from './lantern.js';
import { skyState, clockAngles, pendulumAngle } from '../intro-room-core.js';

const SRGB = THREE.SRGBColorSpace;
const c3 = (a) => new THREE.Color(a[0] / 255, a[1] / 255, a[2] / 255);
function mkRng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function canvasTex(w, h, draw, { nearest = true, repeat = false } = {}) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = SRGB; if (nearest) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; }
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; } return t;
}

// ================================================================ 窓の外の街(3D)
/**
 * 窓の外の街(夜景ふうのビル群・電車・星と月)。窓の穴の外側(z < -2.4)に置く。実時間で、空と明かりが変わる。
 * ビルは3列(手前・中・奥)。足もとを y=-26 に置き、窓から「少し高いところから街を見下ろし、遠くの空まで見える」眺めにする。
 */
export function buildCity({ scene, keep, seed = 11 }) {
  const rand = mkRng(seed), root = new THREE.Group(); scene.add(root);
  const clampN = (v) => Math.max(0, Math.min(1, v)), smooth = (a, b, x) => { const k = clampN((x - a) / (b - a)); return k * k * (3 - 2 * k); };
  const _dir = new THREE.Vector3();
  // ---- 空(上から下へのグラデーション。地平線より下は、ビルの色にとけこむ) ----
  const skyCv = document.createElement('canvas'); skyCv.width = 4; skyCv.height = 128; const sg = skyCv.getContext('2d');
  const skyTex = keep(new THREE.CanvasTexture(skyCv)); skyTex.colorSpace = SRGB;
  const dome = new THREE.Mesh(keep(new THREE.SphereGeometry(100, 16, 12)), keep(new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, depthWrite: false, fog: false })));
  dome.position.set(0, 0, -30); dome.renderOrder = -10; root.add(dome);
  // ---- 星(夜だけ)・月と太陽 ----
  const starPos = new Float32Array(260 * 3);
  for (let i = 0; i < 260; i++) { const a = rand() * Math.PI * 2, e = 0.08 + rand() * 1.2, r = 92; starPos[i * 3] = Math.cos(a) * Math.cos(e) * r; starPos[i * 3 + 1] = Math.sin(e) * r; starPos[i * 3 + 2] = -30 - Math.abs(Math.sin(a)) * Math.cos(e) * r; }
  const starGeo = keep(new THREE.BufferGeometry()); starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = keep(new THREE.PointsMaterial({ color: 0xfff6d8, size: 0.7, transparent: true, opacity: 0, depthWrite: false, fog: false })); const stars = new THREE.Points(starGeo, starMat); stars.renderOrder = -9; root.add(stars);
  const moonTex = keep(canvasTex(64, 64, (g) => { g.fillStyle = '#fff3c4'; g.beginPath(); g.arc(32, 32, 24, 0, Math.PI * 2); g.fill(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(42, 27, 21, 0, Math.PI * 2); g.fill(); }, { nearest: false }));
  const moon = new THREE.Mesh(keep(new THREE.PlaneGeometry(9, 9)), keep(new THREE.MeshBasicMaterial({ map: moonTex, transparent: true, depthWrite: false, fog: false }))); moon.position.set(-13, 17, -76); moon.renderOrder = -8; root.add(moon);
  const sunTex = keep(canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 4, 32, 32, 32); r.addColorStop(0, 'rgba(255,248,214,1)'); r.addColorStop(0.35, 'rgba(255,226,150,0.85)'); r.addColorStop(1, 'rgba(255,220,140,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); }, { nearest: false }));
  const sun = new THREE.Mesh(keep(new THREE.PlaneGeometry(22, 22)), keep(new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }))); sun.position.set(-18, 16, -80); sun.renderOrder = -8; root.add(sun);
  // ---- ビル(v1.119: 列を、窓の外の遠くまで延ばし、列の両端に、大きな「端ブロック」を置いた。窓から斜めに覗いても、何もない空間が見えない) ----
  //   窓越しに見えないビルは、毎コマ、非表示にする(3Dカリング。cull())。ネオン看板・屋上の雪も、ビルの子として、いっしょに隠れる。
  const TILE = 7.2; // 窓の模様1枚(4×4個の窓)の、実際の大きさ
  const glassTile = keep(canvasTex(64, 64, (g) => { g.clearRect(0, 0, 64, 64); g.fillStyle = '#fff'; for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) g.fillRect(c * 16 + 4, r * 16 + 5, 8, 8); }, { repeat: true }));
  const litTiles = [];
  for (let v = 0; v < 6; v++) litTiles.push(keep(canvasTex(64, 64, (g) => { g.clearRect(0, 0, 64, 64); const dens = 0.28 + (v % 3) * 0.2; for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (rand() < dens) { g.fillStyle = rand() < 0.78 ? '#ffd98a' : rand() < 0.5 ? '#fff2c8' : '#bfe0ff'; g.fillRect(c * 16 + 4, r * 16 + 5, 8, 8); } }, { repeat: true })));
  const buildings = []; const baseY = -26;
  const VALLEY = [-22, 12]; // 夕陽が、窓から見えるように、この範囲の、奥の2列は、低くしておく(夕陽の通り道)
  const rows = [
    { z: -9, d: 4, hMin: 12, hMax: 19, wMin: 2.6, wMax: 4.4, x0: -60, x1: 60, shade: 1.0 },
    { z: -22, d: 5, hMin: 24, hMax: 36, wMin: 3.2, wMax: 5.6, x0: -80, x1: 80, shade: 0.9, valley: [18, 24] },
    { z: -44, d: 6, hMin: 34, hMax: 58, wMin: 4, wMax: 7.5, x0: -100, x1: 100, shade: 0.8, valley: [26, 33] },
  ];
  const CAP_W = 300; // 列の端の、大きなブロックの幅
  const capGeo = keep(new THREE.BoxGeometry(1, 1, 1)), snowMat = keep(new THREE.MeshBasicMaterial({ color: 0xf2f6ff, fog: false }));
  function addBuilding(row, x, w, h, litIdx, isCap) {
    const g = new THREE.Group(); g.position.set(x + w / 2, baseY + h / 2, row.z); root.add(g);
    const bodyMat = keep(new THREE.MeshBasicMaterial({ color: 0x1d2142 })); const body = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, row.d)), bodyMat); g.add(body);
    const gt = glassTile.clone(); gt.repeat.set(w / TILE, h / TILE); gt.needsUpdate = true; keep(gt);
    const lt = litTiles[litIdx].clone(); lt.repeat.set(w / TILE, h / TILE); lt.needsUpdate = true; keep(lt);
    const glassMat = keep(new THREE.MeshBasicMaterial({ map: gt, transparent: true, color: 0x232a52, depthWrite: false })), litMat = keep(new THREE.MeshBasicMaterial({ map: lt, transparent: true, opacity: 1, depthWrite: false, fog: false }));
    const gp = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, h)), glassMat); gp.position.z = row.d / 2 + 0.02; g.add(gp);
    const lp = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, h)), litMat); lp.position.z = row.d / 2 + 0.04; g.add(lp);
    const entry = { g, bodyMat, glassMat, litMat, sh: row.shade * (0.82 + rand() * 0.32), top: baseY + h, cx: x + w / 2, cz: row.z, hw: w / 2, hd: row.d / 2, bot: baseY, topY: baseY + h, h, cap: null, isCap: !!isCap };
    if (!isCap) { // 屋上の飾り(室外機・水槽・アンテナ)と、屋上の雪(冬・雪の日だけ、見える)
      const roofMat = keep(new THREE.MeshBasicMaterial({ color: 0x151833 })); const top = h / 2;
      const tank = new THREE.Mesh(keep(new THREE.BoxGeometry(w * 0.28, 1.4, row.d * 0.4)), roofMat); tank.position.set((rand() - 0.5) * w * 0.4, top + 0.7, 0); g.add(tank);
      if (rand() < 0.6) { const ant = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.05, 0.05, 3 + rand() * 3, 4)), roofMat); ant.position.set((rand() - 0.5) * w * 0.6, top + 2.2, 0); g.add(ant); }
      const sc = new THREE.Mesh(capGeo, snowMat); sc.scale.set(w * 0.98, 0.1, row.d * 0.98); sc.position.y = top + 0.05; sc.visible = false; g.add(sc); entry.cap = sc;
    }
    buildings.push(entry);
    return g;
  }
  let tallest = null;
  for (const row of rows) {
    let x = row.x0;
    while (x < row.x1) {
      const w = row.wMin + rand() * (row.wMax - row.wMin); let h = row.hMin + rand() * (row.hMax - row.hMin);
      const inValley = row.valley && x + w > VALLEY[0] && x < VALLEY[1]; if (inValley) h = row.valley[0] + rand() * (row.valley[1] - row.valley[0]);
      const g = addBuilding(row, x, w, h, Math.floor(rand() * 6)); if (row.z === -44 && !inValley && (!tallest || h > tallest.h)) tallest = { g, h, w }; x += w + 0.5 + rand() * 1.8;
    }
    addBuilding(row, row.x0 - CAP_W - 0.6, CAP_W, row.hMax, Math.floor(rand() * 6), true); addBuilding(row, x + 0.6, CAP_W, row.hMax, Math.floor(rand() * 6), true); // 列の両端の、大きなブロック
  }
  // 一番高い塔の先の、赤い点滅灯
  const beacon = new THREE.Mesh(keep(new THREE.SphereGeometry(0.35, 8, 6)), keep(new THREE.MeshBasicMaterial({ color: 0xff3030, fog: false }))); if (tallest) { beacon.position.set(0, tallest.h / 2 + 3.4, 0); tallest.g.add(beacon); }
  // 奥の、はるか遠くの街のシルエット(1枚の板)。列の向こうにも、街が続いて見える
  const farMat = keep(new THREE.MeshBasicMaterial({ color: 0x1d2142, transparent: true, depthWrite: false, fog: false }));
  { const far = new THREE.Mesh(keep(new THREE.PlaneGeometry(1400, 76)), farMat); far.position.set(0, baseY + 38, -112);
    farMat.map = keep(canvasTex(1024, 128, (g, W, H) => { g.clearRect(0, 0, W, H); g.fillStyle = '#fff'; let xx = 0; while (xx < W) { const bw = 10 + rand() * 26, bh = 24 + rand() * 80; g.fillRect(xx, H - bh, bw, bh); xx += bw + rand() * 4; } }, { nearest: false })); farMat.needsUpdate = true; root.add(far); }
  // 足もとの地面(ビルの根もと。窓から、急に見下ろしても、何もない空間にならない)
  const groundMat = keep(new THREE.MeshBasicMaterial({ color: 0x14172e, fog: false }));
  { const ground = new THREE.Mesh(keep(new THREE.PlaneGeometry(1800, 700)), groundMat); ground.rotation.x = -Math.PI / 2; ground.position.set(0, baseY - 0.02, -150); root.add(ground); }
  // ---- ネオン看板(サイバーパンク。実在の名前は使わない。夜に、強く光り、昼は、ほぼ消えている) ----
  const NEON = ['#ff2fa8', '#26e6ff', '#ffb02e', '#7dff5a', '#b46bff', '#ff4b4b'];
  const WORDS_V = ['電脳', '夜市', 'ネオン', '酒場', 'ホテル', '薬局', '未来', '麺', 'カラオケ', '占い', 'BAR', 'CLUB', '24H', 'ARCADE'];
  const WORDS_H = ['NEON NIGHT', 'CYBER BAR', '電脳ラーメン', 'HOTEL 未来', 'NOODLE 24H', 'ARCADE', 'ナイトクラブ', 'SAKE & SYNTH'];
  const FONT = '"Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif';
  function signTex(text, color, vertical) {
    const W = vertical ? 80 : 256, H = vertical ? 256 : 80;
    return keep(canvasTex(W, H, (g) => {
      g.clearRect(0, 0, W, H); g.fillStyle = 'rgba(10,6,24,0.84)'; g.fillRect(2, 2, W - 4, H - 4);
      g.strokeStyle = color; g.lineWidth = 3; g.shadowColor = color; g.shadowBlur = 8; g.strokeRect(5, 5, W - 10, H - 10);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      const chars = vertical ? [...text] : [text]; let fs = vertical ? Math.min(52, Math.floor((H - 24) / chars.length)) : 46;
      g.font = `bold ${fs}px ${FONT}`; if (!vertical) { while (g.measureText(text).width > W - 24 && fs > 10) { fs -= 2; g.font = `bold ${fs}px ${FONT}`; } }
      chars.forEach((ch, i) => { const y = vertical ? 12 + ((H - 24) * (i + 0.5)) / chars.length : H / 2 + 2; g.shadowBlur = 12; g.lineWidth = 5; g.strokeStyle = color; g.strokeText(ch, W / 2, y); g.shadowBlur = 0; g.fillStyle = '#fff'; g.fillText(ch, W / 2, y); });
    }, { nearest: false }));
  }
  const haloTex = keep(canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 2, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,0.9)'); r.addColorStop(0.4, 'rgba(255,255,255,0.35)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); }, { nearest: false }));
  const signs = [];
  function addSign(b, vertical) {
    const color = NEON[Math.floor(rand() * NEON.length)], words = vertical ? WORDS_V : WORDS_H, text = words[Math.floor(rand() * words.length)];
    const sw = vertical ? 1.1 : Math.min(b.hw * 2 * 0.85, 5.2), sh = vertical ? 4.2 : (sw * 80) / 256;
    const lx = (rand() - 0.5) * Math.max(0, b.hw * 2 - sw - 0.4), ly = vertical ? (-0.25 + rand() * 0.5) * b.h : b.h / 2 + sh / 2 + 0.3, lz = vertical ? b.hd + 0.12 : b.hd * 0.5;
    const mat = keep(new THREE.MeshBasicMaterial({ map: signTex(text, color, vertical), transparent: true, depthWrite: false, fog: false, toneMapped: false })); const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(sw, sh)), mat); m.position.set(lx, ly, lz + 0.02); m.renderOrder = 3; b.g.add(m);
    const hmat = keep(new THREE.MeshBasicMaterial({ map: haloTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false, opacity: 0 })); const hm = new THREE.Mesh(keep(new THREE.PlaneGeometry(sw * 2.4, sh * 1.5)), hmat); hm.position.set(lx, ly, lz - 0.02); hm.renderOrder = 2; b.g.add(hm);
    signs.push({ b, mat, hmat, flick: rand() < 0.3, phase: rand() * 10 });
  }
  for (const b of buildings) { if (b.isCap) continue; const near = b.cz > -30, pv = near ? 0.4 : 0.15, ph = near ? 0.22 : 0.1; if (rand() < pv) addSign(b, true); if (rand() < ph) addSign(b, false); }

  // ---- 電車(高架。ときどき、窓の前を通る。v1.120: 5種類 — 通勤・特急・貨物・高速・リニア。実在の名前・ロゴは使わない) ----
  const rail = new THREE.Group(); rail.position.set(0, 0, -16); root.add(rail);
  const railMat = keep(new THREE.MeshBasicMaterial({ color: 0x15182e }));
  const bed = new THREE.Mesh(keep(new THREE.BoxGeometry(150, 0.5, 3.2)), railMat); bed.position.y = -0.5; rail.add(bed);
  for (let x = -70; x <= 70; x += 14) { const p = new THREE.Mesh(keep(new THREE.BoxGeometry(1.1, 26, 1.1)), railMat); p.position.set(x, -13.5, 0); rail.add(p); }
  const train = new THREE.Group(); train.visible = false; rail.add(train);
  const stripMat = keep(new THREE.MeshBasicMaterial({ color: 0xffe3a0, fog: false })); // 窓の帯(夜は、あたたかい灯り。applyState が、色を変える)
  const bm = (c) => keep(new THREE.MeshBasicMaterial({ color: c, fog: false }));
  /** 種類ごとの、両数・車両の間隔(m)・速さ(m/秒)。音(room-audio.js)も、この値(車両の間隔÷速さ=継ぎ目の音の間隔)を使う。 */
  const TRAIN_KINDS = { commuter: { cars: 6, pitch: 3.6, speed: 9.5 }, express: { cars: 8, pitch: 3.6, speed: 13 }, freight: { cars: 11, pitch: 3.7, speed: 6 }, bullet: { cars: 8, pitch: 4.0, speed: 30 }, maglev: { cars: 5, pitch: 3.4, speed: 22 } };
  const trainLen = (k) => (TRAIN_KINDS[k].cars - 1) * TRAIN_KINDS[k].pitch + 3.4;
  const box3 = (par, w, h, d, m, x, y, z) => { const o = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, d)), m); o.position.set(x, y, z); par.add(o); return o; };
  /** 側面の形(+x が先)を、幅 w ぶん押し出した、先頭の形。 */
  function noseGeo(h, w, tip) { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.01, 0); sh.lineTo(tip, h * 0.38); sh.lineTo(tip * 0.55, h * 0.92); sh.lineTo(tip * 0.2, h); sh.lineTo(0, h); sh.closePath(); const g = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false }); g.translate(0, 0, -w / 2); return keep(g); }
  function addLamps(g, xFront, xBack, y) { const lw = bm(0xfff6d8), lr = bm(0xff3030), sg = keep(new THREE.SphereGeometry(0.22, 6, 4)); for (const zz of [-0.7, 0.7]) { const a = new THREE.Mesh(sg, lw); a.position.set(xFront, y, zz); g.add(a); const b2 = new THREE.Mesh(sg, lr); b2.position.set(xBack, y, zz); g.add(b2); } }
  function buildTrain(kind) {
    const g = new THREE.Group(), K = TRAIN_KINDS[kind], P = K.pitch, n = K.cars, xEnd = (n - 1) * P + (P - 0.15) / 2, xStart = -(P - 0.15) / 2;
    if (kind === 'commuter') { // 銀色の車体に、窓の帯(いまの電車)
      const cm = bm(0x3a3f66); for (let i = 0; i < n; i++) { box3(g, 3.4, 2.7, 2.5, cm, i * P, 1.1, 0); box3(g, 3.1, 0.8, 0.05, stripMat, i * P, 1.45, 1.27); box3(g, 3.1, 0.8, 0.05, stripMat, i * P, 1.45, -1.27); }
      addLamps(g, xEnd + 0.1, xStart - 0.1, 0.5);
    } else if (kind === 'express' || kind === 'bullet') { // 白い車体に、色の帯。先頭は流線形
      const fast = kind === 'bullet', bodyM = bm(fast ? 0xf4f6fb : 0xe9edf5), lineM = bm(fast ? 0x2a63c4 : 0xd23a3a), roofM = bm(fast ? 0x9aa6bd : 0xb7bfcc), h = fast ? 2.5 : 2.7, tip = fast ? 4.8 : 2.6, yb = 1.1 + (h - 2.7) / 2;
      for (let i = 0; i < n; i++) { box3(g, P - 0.15, h, 2.5, bodyM, i * P, yb, 0); box3(g, P - 0.35, 0.6, 0.05, stripMat, i * P, yb + 0.35, 1.27); box3(g, P - 0.35, 0.6, 0.05, stripMat, i * P, yb + 0.35, -1.27); box3(g, P - 0.15, fast ? 0.32 : 0.26, 2.54, lineM, i * P, yb - 0.55, 0); box3(g, P - 0.3, 0.12, 1.8, roofM, i * P, yb + h / 2 + 0.05, 0); }
      for (const sgn of [1, -1]) { const nose = new THREE.Mesh(noseGeo(h, 2.5, tip), bodyM); nose.position.set(sgn > 0 ? xEnd : xStart, yb - h / 2, 0); nose.scale.x = sgn; g.add(nose); const ws = box3(g, 0.9, 0.55, 1.5, bm(0x1c2236), sgn * (tip * 0.5) + (sgn > 0 ? xEnd : xStart), yb + h * 0.18, 0); ws.rotation.z = sgn > 0 ? -0.45 : 0.45; }
      addLamps(g, xEnd + tip * 0.62, xStart - tip * 0.62, yb - 0.3);
    } else if (kind === 'maglev') { // 暗い車体に、ネオンの線(サイバーパンク)。継ぎ目なし・足もとが光る
      const dark = bm(0x12131f), cy = bm(0x26e6ff), mg = bm(0xff2fa8), tip = 3.2;
      for (let i = 0; i < n; i++) { box3(g, P, 2.5, 2.4, dark, i * P, 1.05, 0); box3(g, P, 0.14, 2.46, cy, i * P, 0.25, 0); box3(g, P, 0.09, 2.46, mg, i * P, 1.85, 0); box3(g, P - 0.4, 0.5, 0.05, cy, i * P, 1.25, 1.22); box3(g, P - 0.4, 0.5, 0.05, cy, i * P, 1.25, -1.22); box3(g, P - 0.2, 0.1, 1.8, cy, i * P, -0.35, 0); }
      for (const sgn of [1, -1]) { const nose = new THREE.Mesh(noseGeo(2.5, 2.4, tip), dark); nose.position.set((sgn > 0 ? (n - 1) * P : 0) + sgn * P / 2, -0.2, 0); nose.scale.x = sgn; g.add(nose); }
      addLamps(g, (n - 1) * P + P / 2 + tip * 0.6, -P / 2 - tip * 0.6, 0.55);
    } else { // freight: 先頭に機関車、あとは、コンテナ車とタンク車
      const loco = bm(0x7a2a22), yel = bm(0xe0b030), flat = bm(0x23242c), tankM = bm(0x4a5060), cols = [0xb5472a, 0x2b6aa3, 0x3e7c4a, 0xc99a2e, 0x7c4a8f, 0x8a8d93].map(bm);
      for (let i = 0; i < n - 1; i++) { box3(g, 3.5, 0.35, 2.2, flat, i * P, 0.0, 0); if (i % 3 === 2) { const t = new THREE.Mesh(keep(new THREE.CylinderGeometry(1.0, 1.0, 3.2, 10)), tankM); t.rotation.z = Math.PI / 2; t.position.set(i * P, 1.25, 0); g.add(t); } else { box3(g, 3.3, 2.6, 2.3, cols[Math.floor(rand() * cols.length)], i * P, 1.5, 0); box3(g, 3.3, 0.05, 2.34, flat, i * P, 1.5, 0); } }
      const lx = (n - 1) * P + 0.5; box3(g, 4.6, 3.0, 2.6, loco, lx, 1.25, 0); box3(g, 4.6, 0.5, 2.64, yel, lx, 0.3, 0); box3(g, 1.6, 0.7, 2.7, bm(0x1c2236), lx + 1.3, 2.15, 0);
      addLamps(g, lx + 2.35, -1.8, 0.8);
    }
    g.visible = false; train.add(g); return g;
  }
  const trainModels = {}; for (const k of Object.keys(TRAIN_KINDS)) trainModels[k] = buildTrain(k);
  let trainX = 0, trainOn = false, nextTrain = 6 + rand() * 12, trainDir = 1, trainKind = 'commuter';
  /** どの電車が来るか。夜は、貨物が増え、リニアは、夜だけ。 */
  function pickTrain(night) { const w = { commuter: 4, express: 2, freight: 1.2 + 1.8 * night, bullet: 1, maglev: night > 0.4 ? 1 + 2.5 * night : 0 }; let sum = 0; for (const k in w) sum += w[k]; let r = rand() * sum; for (const k in w) { r -= w[k]; if (r <= 0) return k; } return 'commuter'; }
  function startTrain(kind, dir) { trainKind = kind; trainDir = dir; trainOn = true; trainX = dir > 0 ? -66 : 66; for (const k in trainModels) trainModels[k].visible = k === kind; train.visible = true; }
  // ---- 窓の外の天気(ゲーム本編の天候・季節と、同じ): 曇り・雨・雪・雷・屋上の雪 ----
  const outside = { weather: 'clear', season: 'summer' };
  let cloudK = 0, rainK = 0, snowK = 0, snowCover = 0, paintedCloud = -1, lastCover = -1, hourNow = 12, flashT = -1, nextFlash = 5, flash = 0, starBase = 0, moonBase = 0, sunBase = 0;
  const BOX = { x0: -12, x1: 10, y0: -8, y1: 14, z0: -34, z1: -2.6 };
  const NR = 460, NS = 360;
  const rainP = new Float32Array(NR * 3), snowP = new Float32Array(NS * 3);
  for (let i = 0; i < NR; i++) { rainP[i * 3] = BOX.x0 + rand() * (BOX.x1 - BOX.x0); rainP[i * 3 + 1] = BOX.y0 + rand() * (BOX.y1 - BOX.y0); rainP[i * 3 + 2] = BOX.z0 + rand() * (BOX.z1 - BOX.z0); }
  for (let i = 0; i < NS; i++) { snowP[i * 3] = BOX.x0 + rand() * (BOX.x1 - BOX.x0); snowP[i * 3 + 1] = BOX.y0 + rand() * (BOX.y1 - BOX.y0); snowP[i * 3 + 2] = BOX.z0 + rand() * (BOX.z1 - BOX.z0); }
  const rainGeo = keep(new THREE.BufferGeometry()); const rainSeg = new Float32Array(NR * 6); rainGeo.setAttribute('position', new THREE.BufferAttribute(rainSeg, 3)); rainGeo.setDrawRange(0, 0);
  const rainLines = new THREE.LineSegments(rainGeo, keep(new THREE.LineBasicMaterial({ color: 0xaec8e8, transparent: true, opacity: 0.5, depthWrite: false, fog: false }))); rainLines.frustumCulled = false; rainLines.visible = false; rainLines.renderOrder = 4; root.add(rainLines);
  const snowGeo = keep(new THREE.BufferGeometry()); const snowPos = new Float32Array(NS * 3); snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3)); snowGeo.setDrawRange(0, 0);
  const snowPts = new THREE.Points(snowGeo, keep(new THREE.PointsMaterial({ color: 0xffffff, size: 0.22, transparent: true, opacity: 0.9, depthWrite: false, fog: false }))); snowPts.frustumCulled = false; snowPts.visible = false; snowPts.renderOrder = 4; root.add(snowPts);
  function weatherTargets() {
    const w = outside.weather, s = outside.season; let cloud = w === 'drizzle' ? 0.55 : w === 'rain' ? 0.8 : w === 'storm' ? 1 : w === 'snow' ? 0.7 : 0;
    if (w === 'clear') { if (s === 'tsuyu') cloud = 0.35; else if (s === 'typhoon') cloud = 0.25; }
    return { cloud, rain: w === 'drizzle' ? 0.3 : w === 'rain' ? 0.7 : w === 'storm' ? 1 : 0, snow: w === 'snow' ? 0.85 : 0, cover: s === 'winter' || w === 'snow' ? 1 : 0 };
  }
  // ---- 色の更新(実時間) ----
  let lastHourKey = -1, state = skyState(12);
  const grey = (a, k) => { const l = 0.3 * a[0] + 0.59 * a[1] + 0.11 * a[2], g = l * 0.92 + 8; return [a[0] + (g - a[0]) * k, a[1] + (g - a[1]) * k, a[2] + (g - a[2]) * k]; };
  function paintSky(s) {
    const k = cloudK * 0.7, g = sg.createLinearGradient(0, 0, 0, 128); const css = (a) => { const c = grey(a, k); return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; };
    g.addColorStop(0, css(s.top)); g.addColorStop(0.28, css(s.mid)); g.addColorStop(0.49, css(s.hor)); g.addColorStop(0.5, css(s.bld)); g.addColorStop(1, css(s.bld)); sg.fillStyle = g; sg.fillRect(0, 0, 4, 128); skyTex.needsUpdate = true; paintedCloud = cloudK;
  }
  /** 太陽の高さ(度)。6時に出て、19時に沈む(部屋の西向きの窓から見た、ふつうの、夕方の沈み方)。 */
  const sunAlt = (h) => (h > 6 && h < 19 ? 70 * Math.sin((Math.PI * (h - 6)) / 13) : 0);
  function placeSun() {
    const alt = sunAlt(hourNow), vis = alt * 0.3, low = clampN((14 - alt) / 14); // 見かけの高さは低めにして、夕方だけ、窓から見える
    sun.position.set(-6 + (hourNow - 18) * 4, 1.8 + 80 * Math.tan((vis * Math.PI) / 180), -80); sun.material.color.setRGB(1, 1 - 0.38 * low, 1 - 0.7 * low); sun.scale.setScalar(1 + 0.7 * low);
  }
  function applyState(s) {
    state = s; paintSky(s); placeSun();
    for (const b of buildings) { const k = b.sh; b.bodyMat.color.setRGB(Math.min(1, s.bld[0] / 255 * k), Math.min(1, s.bld[1] / 255 * k), Math.min(1, s.bld[2] / 255 * k)); b.glassMat.color.copy(c3(s.glass)); b.litMat.opacity = Math.pow(s.night, 0.8); }
    groundMat.color.setRGB(Math.min(1, s.bld[0] / 255 * 0.55), Math.min(1, s.bld[1] / 255 * 0.55), Math.min(1, s.bld[2] / 255 * 0.6));
    farMat.color.setRGB(Math.min(1, s.bld[0] / 255 * 0.7), Math.min(1, s.bld[1] / 255 * 0.7), Math.min(1, s.bld[2] / 255 * 0.78));
    snowMat.color.setRGB(0.95 - 0.7 * s.night, 0.97 - 0.68 * s.night, 1 - 0.55 * s.night);
    starBase = Math.max(0, (s.night - 0.55) / 0.45); moonBase = s.night > 0.5 ? clampN((s.night - 0.5) / 0.4) : 0; sunBase = sunAlt(hourNow) > 0 ? clampN((0.8 - s.night) / 0.3) : 0;
    stripMat.color.setHex(s.night > 0.4 ? 0xffe3a0 : 0xb8c4d8);
  }
  function applyCloud() { starMat.opacity = starBase * (1 - cloudK * 0.9); moon.visible = moonBase > 0.01; moon.material.opacity = moonBase * (1 - cloudK * 0.85); sun.visible = sunBase > 0.01; sun.material.opacity = sunBase * (1 - cloudK * 0.95); }
  // ---- 3Dカリング: 窓の穴から見えるビルだけを、描く ----
  const WIN = { x0: -1.7, x1: -0.2, y0: 0.8, y1: 2.7, z: -2.3 }, WM = 0.5;
  function cull(cp) {
    if (!cp || cp.z <= WIN.z + 0.05) { for (const b of buildings) b.g.visible = true; return; }
    for (const b of buildings) {
      let vis = false;
      for (const zz of [b.cz + b.hd, b.cz - b.hd]) {
        const t = (WIN.z - cp.z) / (zz - cp.z); if (!(t > 0 && t <= 1)) { vis = true; break; }
        const xa = cp.x + (b.cx - b.hw - cp.x) * t, xb = cp.x + (b.cx + b.hw - cp.x) * t, ya = cp.y + (b.bot - cp.y) * t, yb = cp.y + (b.topY + 6 - cp.y) * t; // +6: 屋上の飾り・看板
        if (Math.max(xa, xb) >= WIN.x0 - WM && Math.min(xa, xb) <= WIN.x1 + WM && yb >= WIN.y0 - WM && ya <= WIN.y1 + WM) { vis = true; break; }
      }
      b.g.visible = vis;
    }
  }
  let culled = 0;
  return {
    root, buildings, signs, train, get state() { return state; },
    /** ゲーム本編の天気・季節(weather: clear/drizzle/rain/storm/snow, season: spring/tsuyu/summer/typhoon/autumn/winter)。 */
    setOutside(o) { if (!o) return; if (typeof o.weather === 'string') outside.weather = o.weather; if (typeof o.season === 'string') outside.season = o.season; },
    weatherState() { return { cloud: cloudK, rain: rainK, snow: snowK, cover: snowCover, flash }; },
    /** 西陽: power(0〜1。夕方の数時間に、山なり。曇りで弱まる)・alt(度)・flash(稲光 0〜1)。 */
    sunInfo() { return { power: smooth(15, 17.2, hourNow) * (1 - smooth(18.5, 19.3, hourNow)) * (1 - cloudK * 0.92), alt: sunAlt(hourNow), flash, cloud: cloudK, hour: hourNow }; },
    visibleCount() { let n = 0; for (const b of buildings) if (b.g.visible) n++; return n; },
    /** 実時間 date から、空と明かりを更新(15秒に1回ほど)。電車・天気・看板は、毎コマ。camera があれば、窓から見えないビルを隠す。 */
    update(t, dt, date, camera) {
      const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600, key = Math.floor(hour * 240); // 15秒ごと
      hourNow = hour; if (key !== lastHourKey) { lastHourKey = key; applyState(skyState(hour)); }
      let lookingOut = true;
      if (camera) { camera.getWorldDirection(_dir); lookingOut = _dir.z < 0.25; cull(lookingOut ? camera.position : null); if (!lookingOut) { for (const b of buildings) b.g.visible = false; } }
      // 天気を、ゆっくり近づける
      const tg = weatherTargets(), kk = Math.min(1, dt * 0.35);
      cloudK += (tg.cloud - cloudK) * kk; rainK += (tg.rain - rainK) * Math.min(1, dt * 0.5); snowK += (tg.snow - snowK) * Math.min(1, dt * 0.5); snowCover += Math.sign(tg.cover - snowCover) * Math.min(Math.abs(tg.cover - snowCover), dt * 0.08);
      if (Math.abs(cloudK - paintedCloud) > 0.02) paintSky(state); applyCloud();
      // 雷(雷雨の間だけ。稲光は、空を一瞬、明るくする)
      if (outside.weather === 'storm') { nextFlash -= dt; if (nextFlash <= 0 && flashT < 0) { flashT = 0; nextFlash = 3 + rand() * 9; } } else if (flashT < 0) nextFlash = 2 + rand() * 4;
      if (flashT >= 0) { flashT += dt; const e = flashT; flash = e < 0.08 ? 1 : e < 0.14 ? 0.15 : e < 0.24 ? 0.9 : e < 0.5 ? 0.9 * (1 - (e - 0.24) / 0.26) : 0; if (e > 0.5) { flashT = -1; flash = 0; } } else flash = 0;
      dome.material.color.setScalar(1 + 0.8 * flash);
      if (lookingOut) {
        // 雨・雪
        const wind = outside.weather === 'storm' ? 0.35 : 0.12;
        rainLines.visible = rainK > 0.01; if (rainLines.visible) { const n = Math.min(NR, Math.floor(NR * rainK)), v = 16 + 6 * rainK, len = 0.9; for (let i = 0; i < n; i++) { let x = rainP[i * 3], y = rainP[i * 3 + 1] - v * dt, z = rainP[i * 3 + 2]; x += wind * v * dt; if (y < BOX.y0 || x > BOX.x1) { y = BOX.y1 + rand() * 2; x = BOX.x0 + rand() * (BOX.x1 - BOX.x0); z = BOX.z0 + rand() * (BOX.z1 - BOX.z0); } rainP[i * 3] = x; rainP[i * 3 + 1] = y; rainP[i * 3 + 2] = z; rainSeg[i * 6] = x; rainSeg[i * 6 + 1] = y; rainSeg[i * 6 + 2] = z; rainSeg[i * 6 + 3] = x - wind * len; rainSeg[i * 6 + 4] = y + len; rainSeg[i * 6 + 5] = z; } rainGeo.setDrawRange(0, n * 2); rainGeo.attributes.position.needsUpdate = true; }
        snowPts.visible = snowK > 0.01; if (snowPts.visible) { const n = Math.min(NS, Math.floor((NS * snowK) / 0.85)); for (let i = 0; i < n; i++) { let x = snowP[i * 3] + (Math.sin(t * 0.7 + i) * 0.5 + wind) * dt, y = snowP[i * 3 + 1] - 1.3 * dt, z = snowP[i * 3 + 2]; if (y < BOX.y0 || x > BOX.x1 || x < BOX.x0) { y = BOX.y1 + rand() * 2; x = BOX.x0 + rand() * (BOX.x1 - BOX.x0); z = BOX.z0 + rand() * (BOX.z1 - BOX.z0); } snowP[i * 3] = x; snowP[i * 3 + 1] = y; snowP[i * 3 + 2] = z; snowPos[i * 3] = x; snowPos[i * 3 + 1] = y; snowPos[i * 3 + 2] = z; } snowGeo.setDrawRange(0, n); snowGeo.attributes.position.needsUpdate = true; }
        // 屋上の雪(積もり具合)
        if (Math.abs(snowCover - lastCover) > 0.004) { lastCover = snowCover; const on = snowCover > 0.03; for (const b of buildings) if (b.cap) { b.cap.visible = on; if (on) { b.cap.scale.y = 0.15 + 0.7 * snowCover; b.cap.position.y = b.h / 2 + b.cap.scale.y / 2; } } }
        // ネオン看板
        const nk = clampN((state.night - 0.2) / 0.6);
        for (const s of signs) { if (!s.b.g.visible) continue; const fl = s.flick ? (Math.sin(t * 17 + s.phase * 10) * Math.sin(t * 3.7 + s.phase) > -0.8 ? 1 : 0.25) : 1; s.mat.opacity = 0.14 + 0.86 * nk * fl; s.hmat.opacity = 0.6 * nk * fl * (1 - cloudK * 0.3); }
      }
      beacon.material.color.setHex(Math.sin(t * 3.1) > 0.2 ? 0xff3030 : 0x401010);
      nextTrain -= dt; if (!trainOn && nextTrain <= 0) startTrain(pickTrain(state.night), rand() < 0.5 ? 1 : -1);
      if (trainOn) { trainX += trainDir * TRAIN_KINDS[trainKind].speed * dt; train.position.x = trainX; train.scale.x = trainDir; if (trainX * trainDir > 66) { trainOn = false; train.visible = false; nextTrain = 40 + rand() * 70; } }
    },
    forceHour(h) { hourNow = h; lastHourKey = -1; applyState(skyState(h)); applyCloud(); },
    /** 電車の様子(音と合わせる): on=走っているか / x=電車の真ん中あたりの、世界のx / kind・speed・pitch(車両の間隔)・cars・dir。 */
    trainState() { const K = TRAIN_KINDS[trainKind]; return { on: trainOn, x: trainX + (trainDir * trainLen(trainKind)) / 2, kind: trainKind, speed: K.speed, pitch: K.pitch, cars: K.cars, dir: trainDir }; },
    trainKinds: Object.keys(TRAIN_KINDS),
    pickTrainForTest() { return pickTrain(state.night); }, // 試験用: 来る電車の種類を、いまの夜の度合いで、ひとつ選ぶ
    /** 試験・見た目の確認用: 指定した電車を、いま、走らせる。 */
    forceTrain(kind, dir = 1) { if (TRAIN_KINDS[kind]) startTrain(kind, dir < 0 ? -1 : 1); },
  };
}

// ================================================================ 振り子時計(実時間。音は鳴らさない)
/**
 * 壁掛けの振り子時計(vintage の、ウィーン・レギュレーター風)。原点=壁にふれる背面の中心の高さ0(下端)。+z=正面。高さ約1.3m。
 * v1.118: 作り直し。以前は、振り子が胴の箱の中に埋まって見えず、頭と胴が別々の箱で、屋根の三角もずれていた。
 *   いまは、胴の窓の「手前」に振り子をつるし(ガラスは、その、さらに手前)、頭と胴は、つなぎ目を、飾り縁(モールディング)でつなぐ。
 *   頭の上は、三角の破風(はふ)と、旋盤で挽いたような飾り(フィニアル)。
 */
export function createPendulumClock({ toon, keep }) {
  const g = new THREE.Group();
  const wood = keep(toon(0x6b4630)), wood2 = keep(toon(0x7a5238)), woodDark = keep(toon(0x4a2f1e)), brass = keep(new THREE.MeshBasicMaterial({ color: 0xd9b45a })), dark = keep(toon(0x15171c)), navy = keep(new THREE.MeshBasicMaterial({ color: 0x1b2230 }));
  const box = (w, h, d, m, x, y, z, p = g) => { const o = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, d)), m); o.position.set(x, y, z); p.add(o); return o; };
  // ---- 本体: 台 → 胴 → 頭(すき間なし。上下に少し重ねる) ----
  box(0.38, 0.05, 0.15, woodDark, 0, 0.025, 0.075); // 台(いちばん下)
  box(0.34, 0.03, 0.14, wood2, 0, 0.065, 0.07); // 台の上の縁
  box(0.32, 0.66, 0.13, wood, 0, 0.38, 0.065); // 胴(y 0.05〜0.71)
  box(0.37, 0.025, 0.145, wood2, 0, 0.7, 0.0725); // 胴と頭のつなぎ目の飾り縁
  box(0.4, 0.4, 0.15, wood2, 0, 0.9, 0.075); // 頭(文字盤の箱。y 0.70〜1.10)
  box(0.44, 0.03, 0.17, woodDark, 0, 1.105, 0.085); // 頭の上の飾り縁(コーニス)
  // ---- 頭の上: 三角の破風(はふ)・円盤の飾り・フィニアル ----
  { const sh = new THREE.Shape(); sh.moveTo(-0.215, 0); sh.lineTo(0.215, 0); sh.lineTo(0, 0.095); sh.closePath();
    const ped = new THREE.Mesh(keep(new THREE.ExtrudeGeometry(sh, { depth: 0.14, bevelEnabled: false })), wood); ped.position.set(0, 1.12, 0.015); g.add(ped); }
  { const med = new THREE.Mesh(keep(new THREE.CircleGeometry(0.02, 14)), brass); med.position.set(0, 1.147, 0.157); g.add(med); }
  { const prof = [[0.001, 0], [0.014, 0], [0.009, 0.018], [0.021, 0.036], [0.023, 0.056], [0.012, 0.078], [0.001, 0.09]].map(([x, y]) => new THREE.Vector2(x, y));
    const fin = new THREE.Mesh(keep(new THREE.LatheGeometry(prof, 8)), brass); fin.position.set(0, 1.208, 0.085); g.add(fin);
    for (const sx of [-1, 1]) { const ball = new THREE.Mesh(keep(new THREE.SphereGeometry(0.017, 8, 6)), brass); ball.position.set(sx * 0.2, 1.135, 0.085); g.add(ball); } }
  { const drop = new THREE.Mesh(keep(new THREE.ConeGeometry(0.02, 0.05, 8)), brass); drop.rotation.x = Math.PI; drop.position.set(0, -0.025, 0.075); g.add(drop); } // 下の飾り
  // ---- 文字盤(数字ではなく、目盛りの点だけ。文字は出さない)。真鍮の縁つき ----
  const faceTex = keep(canvasTex(128, 128, (c) => { c.fillStyle = '#f3ecd8'; c.beginPath(); c.arc(64, 64, 62, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#3b2c20'; c.lineWidth = 3; c.stroke(); c.fillStyle = '#2c2218'; for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2, r = 52; c.beginPath(); c.arc(64 + Math.sin(a) * r, 64 - Math.cos(a) * r, i % 3 === 0 ? 4.2 : 2.4, 0, Math.PI * 2); c.fill(); } }, { nearest: false }));
  const FY = 0.9, FZ = 0.152;
  const face = new THREE.Mesh(keep(new THREE.CircleGeometry(0.15, 30)), keep(new THREE.MeshBasicMaterial({ map: faceTex }))); face.position.set(0, FY, FZ); g.add(face);
  { const bez = new THREE.Mesh(keep(new THREE.TorusGeometry(0.157, 0.011, 6, 30)), brass); bez.position.set(0, FY, FZ); g.add(bez); }
  const hands = new THREE.Group(); hands.position.set(0, FY, FZ + 0.006); g.add(hands);
  const mkHand = (len, wd, mat, z) => { const piv = new THREE.Group(); const m = new THREE.Mesh(keep(new THREE.BoxGeometry(wd, len, 0.004)), mat); m.position.y = len / 2 - 0.012; piv.add(m); piv.position.z = z; hands.add(piv); return piv; };
  const hHour = mkHand(0.085, 0.014, dark, 0), hMin = mkHand(0.125, 0.01, dark, 0.003), hSec = mkHand(0.13, 0.004, keep(new THREE.MeshBasicMaterial({ color: 0xb03030 })), 0.006);
  { const cap = new THREE.Mesh(keep(new THREE.CircleGeometry(0.01, 10)), brass); cap.position.set(0, 0, 0.011); hands.add(cap); }
  // ---- 胴の窓: 暗い背板(胴の前面より少し手前) → 振り子(その手前) → 枠 → ガラス(いちばん手前) ----
  const WY = 0.38, WW = 0.24, WH = 0.56, PZ = 0.14;
  box(WW, WH, 0.004, navy, 0, WY, 0.132); // 背板
  const pend = new THREE.Group(); pend.position.set(0, WY + WH / 2 - 0.03, PZ); g.add(pend); // 吊り点は、窓の上の近く
  const rod = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.004, 0.004, 0.4, 5)), brass); rod.position.y = -0.2; pend.add(rod);
  const bob = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.046, 0.046, 0.012, 18)), brass); bob.rotation.x = Math.PI / 2; bob.position.y = -0.43; pend.add(bob);
  { const hub = new THREE.Mesh(keep(new THREE.CircleGeometry(0.014, 10)), brass); hub.position.set(0, 0, 0.002); pend.add(hub); }
  { const fz = 0.152, ft = 0.02; // 窓の枠(4本)
    box(WW + 2 * ft, ft, 0.022, woodDark, 0, WY + WH / 2 + ft / 2, fz); box(WW + 2 * ft, ft, 0.022, woodDark, 0, WY - WH / 2 - ft / 2, fz);
    box(ft, WH, 0.022, woodDark, -(WW / 2 + ft / 2), WY, fz); box(ft, WH, 0.022, woodDark, WW / 2 + ft / 2, WY, fz); }
  const glass = box(WW, WH, 0.003, keep(new THREE.MeshBasicMaterial({ color: 0x8fb4d8, transparent: true, opacity: 0.1, depthWrite: false })), 0, WY, 0.155);
  glass.raycast = () => {};
  return { group: g, pend, hands: { hour: hHour, minute: hMin, second: hSec },
    update(t, date) { const a = clockAngles(date); hHour.rotation.z = -a.hour; hMin.rotation.z = -a.minute; hSec.rotation.z = -a.second; pend.rotation.z = pendulumAngle(t, 0.15); } };
}

// ================================================================ 大きなシンセ(61鍵。実寸 W1.018 × D0.329 × H0.102 m、14.2kg)
export const SYNTH = { w: 1.018, d: 0.329, h: 0.102, kg: 14.2, keys: 61 };
/** 原点=底面の中心。x=長辺。y=上。+z=手前(鍵盤のほう)。ロゴも文字も無い。 */
export function createBigSynth({ keep }) {
  const g = new THREE.Group(); const W = SYNTH.w, D = SYNTH.d;
  const mat = (c, o = {}) => keep(new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.1, ...o }));
  const body = mat(0x2a2c31), wood = mat(0x5a3b28, { roughness: 0.75, metalness: 0 }), panelM = mat(0x34363c), cream = mat(0xd8d2c0), redM = mat(0xa83a3a), blue = mat(0x4a6f9a);
  const box = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, d)), m); o.position.set(x, y, z); g.add(o); return o; };
  box(W - 0.12, 0.062, D, body, 0, 0.031, 0); // 下の箱
  box(0.06, SYNTH.h, D, wood, -W / 2 + 0.03, SYNTH.h / 2, 0); box(0.06, SYNTH.h, D, wood, W / 2 - 0.03, SYNTH.h / 2, 0); // 木の側板
  const rear = box(W - 0.12, 0.05, 0.135, panelM, 0, 0.082, -D / 2 + 0.0675); rear.rotation.x = 0.1; // 奥の操作パネル(すこし手前へ傾く)
  // パネル: 小さな画面(線だけ)・ボタンの列・スライダー
  const lcdTex = keep(canvasTex(64, 16, (c) => { c.fillStyle = '#6b8a5a'; c.fillRect(0, 0, 64, 16); c.fillStyle = '#243a22'; for (let i = 0; i < 9; i++) c.fillRect(4 + i * 6, 5, 4, 6); }));
  const lcd = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.075, 0.019)), keep(new THREE.MeshBasicMaterial({ map: lcdTex }))); lcd.position.set(-0.2, 0.111, -D / 2 + 0.07); lcd.rotation.x = -Math.PI / 2 + 0.1; g.add(lcd);
  for (let r = 0; r < 2; r++) for (let c = 0; c < 16; c++) { const m = [cream, cream, blue, redM][(c + r * 5) % 4]; box(0.024, 0.007, 0.014, m, -0.08 + c * 0.032 - (r ? 0.0 : 0.0), 0.113 - r * 0.004, -D / 2 + 0.105 - r * 0.036 + 0.02); }
  box(0.006, 0.006, 0.07, cream, 0.35, 0.114, -D / 2 + 0.07); box(0.018, 0.012, 0.02, redM, 0.35, 0.118, -D / 2 + 0.095); // スライダー
  // 左の側のホイール2つ
  for (let i = 0; i < 2; i++) { const w = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 14)), cream); w.rotation.z = Math.PI / 2; w.position.set(-W / 2 + 0.085, 0.085, 0.02 + i * 0.05); g.add(w); }
  // 鍵盤(61鍵=白36+黒25)。実際の寸法: 白鍵の幅0.0235 長さ0.13。InstancedMesh 2つ
  const wN = 36, kw = 0.0235, kLen = 0.135, x0 = -(wN * kw) / 2 + 0.0, zFront = D / 2 - 0.012;
  const whiteI = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(kw - 0.0016, 0.016, kLen)), mat(0xf2efe6, { roughness: 0.5, metalness: 0 }), wN);
  const blacks = []; let wi = 0; const m4 = new THREE.Matrix4();
  for (let i = 0; i < SYNTH.keys; i++) { const semi = i % 12; const isBlack = [1, 3, 6, 8, 10].includes(semi); if (!isBlack) { m4.setPosition(x0 + (wi + 0.5) * kw, 0.052, zFront - kLen / 2); whiteI.setMatrixAt(wi, m4); wi++; } else blacks.push(x0 + wi * kw); }
  g.add(whiteI);
  const blackI = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(0.0135, 0.02, 0.085)), mat(0x16181c, { roughness: 0.35 }), blacks.length);
  blacks.forEach((bx, i) => { m4.setPosition(bx, 0.064, zFront - 0.085 / 2 - kLen + 0.085 + 0.0); m4.setPosition(bx, 0.066, zFront - kLen + 0.085 / 2 + 0.0); blackI.setMatrixAt(i, m4); }); g.add(blackI);
  box(W - 0.12, 0.014, 0.012, body, 0, 0.065, zFront - kLen - 0.004); // 鍵盤の奥の帯
  return { group: g, whiteKeys: whiteI, blackKeys: blackI, size: SYNTH };
}

// ================================================================ 卓上マイク(大型のダイナミックマイク風。本体 長さ0.19m・太さ0.064m)+ブームアーム
export function createDeskMic({ toon, keep, P0, P1, P3, M0 }) {
  const g = new THREE.Group(); const mm = keep(toon(0x1f232b)), metal = keep(toon(0x9aa0ac)), body = keep(toon(0x23262d)), foam = keep(toon(0x34363e));
  const cyl = (a, b, r, m) => { const d = new THREE.Vector3().subVectors(b, a), len = d.length(), o = new THREE.Mesh(keep(new THREE.CylinderGeometry(r, r, len, 8)), m); o.position.copy(a).addScaledVector(d, 0.5); o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); g.add(o); return o; };
  const clamp = new THREE.Mesh(keep(new THREE.BoxGeometry(0.08, 0.06, 0.08)), mm); clamp.position.copy(P0); g.add(clamp);
  cyl(P0, P1, 0.012, mm); const joint = new THREE.Mesh(keep(new THREE.SphereGeometry(0.02, 8, 6)), mm); joint.position.copy(P1); g.add(joint); cyl(P1, P3, 0.01, mm);
  const dir = new THREE.Vector3().subVectors(M0, P3).normalize();
  const back = P3.clone().addScaledVector(dir, -0.09), mid = P3.clone().addScaledVector(dir, 0.035), front = P3.clone().addScaledVector(dir, 0.1);
  cyl(back, mid, 0.032, body); cyl(mid, front, 0.036, foam); // 本体(長さ0.19)と、先のウインドスクリーン(灰色のフォーム)
  const cap = new THREE.Mesh(keep(new THREE.SphereGeometry(0.036, 10, 8)), foam); cap.position.copy(front); g.add(cap);
  // ヨーク(U字の金具)
  const yoke = new THREE.Mesh(keep(new THREE.TorusGeometry(0.048, 0.006, 6, 16, Math.PI)), metal); yoke.position.copy(P3).addScaledVector(dir, -0.01); yoke.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir); yoke.rotateZ(Math.PI); g.add(yoke);
  return { group: g, dir };
}

// ================================================================ 小型ミキサー(幅0.152 × 奥行き0.201 × 高さ0.063 m)
export function createMiniMixer({ keep }) {
  const g = new THREE.Group(); const mat = (c, o = {}) => keep(new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.1, ...o }));
  const bodyM = mat(0x2b2e36), panelM = mat(0x3a3e49), knob = mat(0xc9ccd6), capM = mat(0xeeeeee), accent = mat(0x3fb3e0, { emissive: 0x1a5a78, emissiveIntensity: 0.6 }), red = mat(0xb03a3a);
  const box = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, d)), m); o.position.set(x, y, z); g.add(o); return o; };
  box(0.152, 0.04, 0.201, bodyM, 0, 0.02, 0);
  const top = box(0.15, 0.022, 0.19, panelM, 0, 0.046, 0); top.rotation.x = 0.1; // 手前が低く、奥が高い
  for (let i = 0; i < 3; i++) { const k = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.0095, 0.0095, 0.012, 12)), knob); k.position.set(-0.045 + i * 0.045, 0.067, -0.062 + i * 0.001); g.add(k); }
  for (let i = 0; i < 2; i++) { box(0.006, 0.004, 0.06, bodyM, -0.03 + i * 0.06, 0.059, 0.035); box(0.02, 0.008, 0.012, capM, -0.03 + i * 0.06, 0.063, 0.02 + i * 0.012); }
  { const big = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.015, 0.015, 0.012, 14)), knob); big.position.set(0.05, 0.062, 0.04); g.add(big); }
  box(0.01, 0.004, 0.01, accent, -0.055, 0.0625, -0.02); box(0.01, 0.004, 0.01, red, -0.04, 0.0625, -0.02);
  return { group: g };
}

// ================================================================ ヘッドセット(録画のワイプの雪だるまが着けているものと、同じ形)
/** 頭の座標(headR=0.36。頭の中心が原点)で作る。雪だるまの頭(headGroup)へ add すれば着けた状態、机へ置けば置いた状態。 */
export function createHeadset({ toon, keep }) {
  const g = new THREE.Group(); const headR = 0.5 * 0.72;
  const hpMat = keep(toon(0x2b2f3a)), hpAccent = keep(toon(0xb03030));
  const band = new THREE.Mesh(keep(new THREE.TorusGeometry(headR * 1.04, 0.026, 6, 22, Math.PI)), hpMat);
  band.rotation.x = Math.PI / 2; band.rotation.z = Math.PI; band.position.y = -0.02; g.add(band);
  for (const side of [-1, 1]) {
    const cup = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.115, 0.115, 0.075, 12)), hpMat); cup.rotation.z = Math.PI / 2; cup.position.set(side * (headR * 1.0 + 0.04), -0.02, -0.01); g.add(cup);
    const ring = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.075, 0.075, 0.085, 12)), hpAccent); ring.rotation.z = Math.PI / 2; ring.position.copy(cup.position); ring.position.x += side * 0.006; g.add(ring);
  }
  const boom = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.011, 0.011, 0.27, 5)), hpMat); boom.position.set(-(headR * 1.0 + 0.06) + 0.1, -0.12, headR * 0.5); boom.rotation.set(Math.PI / 2 - 0.45, 0, -1.0); g.add(boom);
  const mic = new THREE.Mesh(keep(new THREE.SphereGeometry(0.03, 7, 6)), hpAccent); mic.position.set(-0.06, -0.2, headR * 0.93); g.add(mic);
  return { group: g, headR };
}

// ================================================================ カップ(コーヒーか紅茶)とソーサー。録画のワイプのカップと同じ形(1.25倍)
export function createCup({ toon, keep, rand = Math.random }) {
  const saucer = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.085, 0.07, 0.012, 14)), keep(toon(0xf3efe6))); saucer.scale.setScalar(1.25);
  const root = new THREE.Group(); root.scale.setScalar(1.25); const tilt = new THREE.Group(); root.add(tilt);
  const cupMat = keep(toon(0x4fa3b5)), liquidMat = keep(new THREE.MeshBasicMaterial({ color: rand() < 0.5 ? 0x3a2214 : 0xb8601c }));
  const body = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.052, 0.04, 0.095, 14)), cupMat); body.position.y = 0.0475; tilt.add(body);
  const handle = new THREE.Mesh(keep(new THREE.TorusGeometry(0.028, 0.0065, 6, 10, Math.PI)), cupMat); handle.position.set(0.054, 0.05, 0); handle.rotation.z = -Math.PI / 2; tilt.add(handle);
  const liquid = new THREE.Mesh(keep(new THREE.CircleGeometry(0.046, 14)), liquidMat); liquid.rotation.x = -Math.PI / 2; liquid.position.y = 0.088; tilt.add(liquid);
  const steam = []; for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(keep(new THREE.SphereGeometry(0.014, 6, 5)), keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false }))); root.add(m); steam.push(m); }
  return { root, saucer, tilt, liquid, steam, update(t, heldK = 0) { steam.forEach((m, i) => { const u = ((t * 0.18 + i / 3) % 1); m.position.set(Math.sin(t * 1.5 + i * 2) * 0.012, 0.1 + u * 0.16, 0); m.material.opacity = 0.32 * (1 - u) * (heldK ? 0.2 : 1); m.scale.setScalar(0.8 + u * 1.6); }); } };
}

// ================================================================ ジャックオーランタンの小型ランプ(ゲームの中と同じ顔・同じ形)
/** 電源オフの時は、顔も皮も暗く、光の玉も出ない。オンで、ゲームの中と同じ光る見た目に。 */
export function createLampPumpkin({ keep, radius = 0.11 }) {
  const g = new THREE.Group(); const pump = createJackOLanternMesh(radius); pump.position.y = radius * 0.8; g.add(pump);
  const base = new THREE.Mesh(keep(new THREE.CylinderGeometry(radius * 0.9, radius, 0.02, 14)), keep(new THREE.MeshToonMaterial({ color: 0x3a2a20 }))); base.position.y = 0.01; g.add(base);
  const parts = []; // 各メッシュの「点灯の材質」と「消灯の材質(複製)」
  pump.traverse((o) => {
    if (o.isSprite) { parts.push({ o, sprite: true }); return; }
    if (!o.isMesh) return; const on = o.material; let off = on;
    if (on.isMeshBasicMaterial) { off = on.clone(); off.color = on.color.clone().multiplyScalar(0.22); }
    else if (on.emissive) { off = on.clone(); off.emissiveIntensity = 0; off.color = on.color.clone().multiplyScalar(0.8); }
    keep(off); parts.push({ o, on, off });
  });
  let isOn = true; function setOn(v) { isOn = !!v; for (const p of parts) { if (p.sprite) p.o.visible = isOn; else p.o.material = isOn ? p.on : p.off; } }
  setOn(false);
  return { group: g, setOn, isOn: () => isOn, radius };
}

// ================================================================ サイドテーブル(丸い天板。高さ0.55m)
export function createSideTable({ toon, keep }) {
  const g = new THREE.Group(); const wood = keep(toon(0x7a5238)), dark = keep(toon(0x2b2f3a));
  const top = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.27, 0.27, 0.035, 20)), wood); top.position.y = 0.5325; g.add(top);
  const pole = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 8)), dark); pole.position.y = 0.25; g.add(pole);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; const leg = new THREE.Mesh(keep(new THREE.BoxGeometry(0.2, 0.025, 0.04)), dark); leg.position.set(Math.cos(a) * 0.09, 0.02, Math.sin(a) * 0.09); leg.rotation.y = -a; g.add(leg); }
  return { group: g, topY: 0.55, radius: 0.27 };
}

// ================================================================ 本(閉じた形と、M字に開いた形)
/** 開いた本の、ページの断面: 背(中央)がくぼみ、ページがふくらんで、外の縁で、また下がる(「M」の字)。u=0(背)〜1(外の縁)。 */
export function pageCurveY(u, curveH) { return curveH * Math.sin(Math.PI * Math.pow(Math.max(0, Math.min(1, u)), 0.85)) + curveH * 0.12 * u; }
function curvedBlock(w, h, thick, curveH, side, keep, mat, nx = 12) {
  const pos = [], idx = []; const sgn = side; // side=+1: +x 側の半分、-1: -x 側
  for (let k = 0; k <= nx; k++) { const u = k / nx, x = sgn * u * w, yt = pageCurveY(u, curveH), yb = yt - thick; for (const z of [-h / 2, h / 2]) pos.push(x, yt, z); for (const z of [-h / 2, h / 2]) pos.push(x, yb, z); }
  const V = (k, j) => k * 4 + j; // j: 0=top-z0 1=top-z1 2=bot-z0 3=bot-z1
  for (let k = 0; k < nx; k++) {
    const a = V(k, 0), b = V(k, 1), c = V(k + 1, 0), d = V(k + 1, 1), e = V(k, 2), f = V(k, 3), gg = V(k + 1, 2), hh = V(k + 1, 3);
    idx.push(a, b, c, b, d, c); idx.push(e, gg, f, f, gg, hh); idx.push(a, c, e, c, gg, e); idx.push(b, f, d, d, f, hh); // 上面・下面・手前の側面・奥の側面
  }
  { const a = V(nx, 0), b = V(nx, 1), e = V(nx, 2), f = V(nx, 3); idx.push(a, e, b, b, e, f); } // 外の縁
  const geo = keep(new THREE.BufferGeometry()); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat); return m;
}
/**
 * 本。group の原点=背の中央の下。閉じた時: 幅 pw・厚み th・長さ ph の板。開いた時: 左右対称のM字(ページが、ふくらむ)。
 * randomize(rand) で、色・大きさを変える(別の本を取るたびに、呼ぶ)。
 */
export function createBook({ toon, keep, rand = Math.random }) {
  const group = new THREE.Group(), closed = new THREE.Group(), open = new THREE.Group(); group.add(closed, open); open.visible = false;
  const pageMat = keep(new THREE.MeshToonMaterial({ color: 0xf2ecd8, side: THREE.DoubleSide })); const coverMat = keep(toon(0x3b5c8c)); const flapMat = keep(new THREE.MeshToonMaterial({ color: 0xf7f3e4, side: THREE.DoubleSide }));
  const flapPivot = new THREE.Group(); flapPivot.visible = false; open.add(flapPivot);
  let dims = { pw: 0.2, ph: 0.28, th: 0.04 }, built = [];
  function clear() { for (const m of built) { m.parent && m.parent.remove(m); if (m.geometry) m.geometry.dispose(); } built = []; flapPivot.clear(); }
  function build() {
    clear(); const { pw, ph, th } = dims; const add = (parent, mesh) => { parent.add(mesh); built.push(mesh); return mesh; };
    // 閉じた本: 表紙・ページの束・背
    add(closed, new THREE.Mesh(new THREE.BoxGeometry(pw, th, ph), coverMat)).position.y = th / 2;
    const pb = add(closed, new THREE.Mesh(new THREE.BoxGeometry(pw - 0.012, th - 0.012, ph - 0.01), pageMat)); pb.position.set(0.004, th / 2, 0);
    // 開いた本: 左右のページの束(M字)と、その下の表紙・背
    const curveH = Math.min(0.07, pw * 0.34), thick = Math.max(0.012, th * 0.55);
    for (const side of [-1, 1]) {
      add(open, curvedBlock(pw, ph - 0.01, thick, curveH, side, (x) => x, pageMat));
      const cv = add(open, new THREE.Mesh(new THREE.BoxGeometry(pw + 0.006, 0.006, ph), coverMat)); cv.position.set(side * (pw / 2 + 0.002), -thick - 0.004 + curveH * 0.06, 0); cv.rotation.z = side * -0.1;
    }
    add(open, new THREE.Mesh(new THREE.BoxGeometry(0.014, thick + 0.012, ph), coverMat)).position.set(0, -thick / 2 - 0.002, 0);
    // めくるページ: 背を軸に、ひっくり返る薄い板
    const flap = add(flapPivot, new THREE.Mesh(new THREE.PlaneGeometry(pw, ph - 0.015), flapMat)); flap.rotation.x = -Math.PI / 2; flap.position.set(pw / 2, 0.004, 0);
    flapPivot.position.set(0, curveH * 0.1 + 0.002, 0);
  }
  function randomize(r = rand) {
    const hue = r(), col = new THREE.Color().setHSL(hue, 0.3 + r() * 0.35, 0.22 + r() * 0.22); coverMat.color.copy(col);
    dims = { pw: 0.15 + r() * 0.1, ph: 0.22 + r() * 0.12, th: 0.022 + r() * 0.04 }; build();
  }
  build();
  return { group, closed, open, flapPivot, get dims() { return dims; }, get color() { return coverMat.color.getHex(); }, randomize, setOpen(v) { open.visible = !!v; closed.visible = !v; if (!v) flapPivot.visible = false; }, isOpen: () => open.visible };
}
