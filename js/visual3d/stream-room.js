// stream-room.js (v1.112 / v1.113: omit・shelves・kb を足した。録画のワイプには影響なし) — ワイプの「配信者(雪だるま)の部屋」の、壁・天井・本棚・飾り。
//   窓の反対側(手前の壁・左右の壁・天井)まで、ぜんぶ作り込む。自分で決めた画角で、どちらを向いても、何かが映るように。
//   読書家の部屋: 大きな本棚(本が、ぎっしり)・ゲームの中で使うMIDIキーボードが、壁に立てかけてある。
//   壁には、動画サイトの「銀の盾」のような、記念の盾(銀色の板に、赤い再生ボタンの絵)。
//   部屋の広さ: x -3.6〜3.9、z -2.3〜7.0、高さ 0〜3.3(メートル)。
import * as THREE from 'three';
import { createMidiKeyboard } from './midi-keyboard.js';

export const ROOM = { x0: -3.6, x1: 3.9, z0: -2.3, z1: 7.0, h: 3.3 };

function rng(seed) { // 毎回、同じ並びになる乱数(プレビューと録画で、本の並びが違わないように)
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const BOOK_COLORS = ['#8c3b3b', '#3b5c8c', '#3f7a55', '#c9a24a', '#6b4a8c', '#d27a3a', '#2f2f3a', '#b8b0a0', '#7a4a2a', '#4a8c8c', '#a04a6a', '#5a6a3a', '#e0d6bc'];

/**
 * 部屋の飾りを作って、scene へ足す。
 * ctx = { scene, toon(色) → 材質, keep(捨てるもの), box(w,h,d,材質,x,y,z,親), wallMat, trimMat, woodMat, darkMat }
 * 戻り値: { ceilingLight, floorLampLight, shelves(本棚4つ), kb(MIDIキーボード), update(t) }
 */
export function buildStreamRoom(ctx) {
  const { scene, toon, keep, box, wallMat, trimMat, woodMat, darkMat } = ctx;
  const omit = ctx.omit || {}; // v1.113: 置かない物の指定(例: { bean: true })。部屋の演出(intro-room.js)が、ソファを置く場所をあけるのに使う。録画のワイプは、何も指定しない=いままでどおり
  const W = ROOM.x1 - ROOM.x0, D = ROOM.z1 - ROOM.z0, cx = (ROOM.x0 + ROOM.x1) / 2, cz = (ROOM.z0 + ROOM.z1) / 2, H = ROOM.h;
  const add = (o) => { scene.add(o); return o; };

  // ---- 壁・床・天井(部屋を、箱として閉じる) ----
  const floorMat = toon(0x8b6b4e); keep(floorMat);
  const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(W, D)), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.set(cx, 0, cz); add(floor);
  if (!omit.backWall) box(W + 0.2, H, 0.1, wallMat, cx, H / 2, ROOM.z0 - 0.05); // 奥(窓の壁)。部屋の演出では、窓の穴をあけた壁を、自分で作る(omit.backWall)
  box(W + 0.2, H, 0.1, wallMat, cx, H / 2, ROOM.z1 + 0.05); // 手前(窓の反対側)
  box(0.1, H, D, wallMat, ROOM.x0 - 0.05, H / 2, cz); // 左
  box(0.1, H, D, wallMat, ROOM.x1 + 0.05, H / 2, cz); // 右
  const ceilMat = toon(0xd9d0c6); keep(ceilMat); box(W + 0.2, 0.1, D + 0.2, ceilMat, cx, H + 0.05, cz); // 天井
  // 幅木(奥以外にも、ぐるりと)と、腰板(左右・手前の壁の、下のほう)
  const panelMat = toon(0x5a4a42); keep(panelMat);
  box(W, 0.14, 0.05, trimMat, cx, 0.07, ROOM.z1 - 0.025); box(0.05, 0.14, D, trimMat, ROOM.x0 + 0.025, 0.07, cz); box(0.05, 0.14, D, trimMat, ROOM.x1 - 0.025, 0.07, cz);
  box(W, 0.9, 0.04, panelMat, cx, 0.45, ROOM.z1 - 0.02); box(0.04, 0.9, D, panelMat, ROOM.x0 + 0.02, 0.45, cz); box(0.04, 0.9, D, panelMat, ROOM.x1 - 0.02, 0.45, cz);
  box(W, 0.04, 0.07, woodMat, cx, 0.92, ROOM.z1 - 0.035); box(0.07, 0.04, D, woodMat, ROOM.x0 + 0.035, 0.92, cz); box(0.07, 0.04, D, woodMat, ROOM.x1 - 0.035, 0.92, cz); // 腰板の上の縁
  // 手前の敷物(四角)
  const rug2 = new THREE.Mesh(keep(new THREE.PlaneGeometry(2.6, 1.7)), toon(0x3f6a7a)); keep(rug2.material); rug2.rotation.x = -Math.PI / 2; rug2.position.set(0.2, 0.011, 4.7); add(rug2);
  const rug2b = new THREE.Mesh(keep(new THREE.PlaneGeometry(2.3, 1.4)), toon(0xd8c79a)); keep(rug2b.material); rug2b.rotation.x = -Math.PI / 2; rug2b.position.set(0.2, 0.014, 4.7); add(rug2b);

  // ---- 本棚(本が、ぎっしり。1つの InstancedMesh) ----
  function makeBookshelf(w, h, d, rows, seed) {
    const g = new THREE.Group(), rand = rng(seed), t = 0.035;
    box(t, h, d, woodMat, -w / 2 + t / 2, h / 2, 0, g); box(t, h, d, woodMat, w / 2 - t / 2, h / 2, 0, g); // 側板
    box(w, h, 0.02, darkMat, 0, h / 2, -d / 2 + 0.01, g); // 背板
    box(w, t, d, woodMat, 0, h - t / 2, 0, g); box(w, 0.1, d, woodMat, 0, 0.05, 0, g); // 天板・台
    const inner = h - 0.1 - t, rowH = inner / rows, shelfYs = [];
    for (let r = 0; r < rows; r++) {
      const y0 = 0.1 + r * rowH; shelfYs.push(y0);
      if (r > 0) box(w - 2 * t, t, d - 0.02, woodMat, 0, y0, 0.0, g); // 棚板
    }
    const mat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: ctx.grad }); keep(mat);
    const geo = keep(new THREE.BoxGeometry(1, 1, 1)); const maxN = Math.ceil((w / 0.04) * rows * 1.3);
    const im = new THREE.InstancedMesh(geo, mat, maxN); let n = 0; const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), col = new THREE.Color(), eul = new THREE.Euler();
    const put = (x, y, z, bw, bh, bd, rz, color) => { if (n >= maxN) return; eul.set(0, 0, rz); q.setFromEuler(eul); pos.set(x, y, z); sc.set(bw, bh, bd); m4.compose(pos, q, sc); im.setMatrixAt(n, m4); im.setColorAt(n, col.set(color)); n++; };
    for (let r = 0; r < rows; r++) {
      const base = shelfYs[r] + (r > 0 ? t / 2 : 0), maxH = rowH - 0.05; let x = -w / 2 + t + 0.02; const xEnd = w / 2 - t - 0.02;
      const lieEnd = rand() < 0.45; // 棚の端に、横に積んだ本
      const stackW = lieEnd ? 0.3 : 0; const xStop = xEnd - stackW;
      while (x < xStop - 0.03) {
        if (rand() < 0.07) { x += 0.04 + rand() * 0.16; continue; } // あき
        const bw = 0.022 + rand() * 0.034, bh = maxH * (0.55 + 0.42 * rand()), bd = d * (0.62 + 0.28 * rand()), color = BOOK_COLORS[Math.floor(rand() * BOOK_COLORS.length)];
        if (rand() < 0.04 && x + bh < xStop) { put(x + bh / 2, base + bw / 2, d * 0.04, bh, bw, bd, 0, color); x += bh + 0.01; continue; } // 1冊だけ、横に寝かせる
        put(x + bw / 2, base + bh / 2, d * 0.05 - (d * 0.62 - bd) * 0.3, bw, bh, bd, rand() < 0.03 ? 0.18 : 0, color); x += bw + 0.002; // 立てた本(たまに、少し傾く)
      }
      if (lieEnd) { let y = base; const bw0 = 0.2 + rand() * 0.06; for (let k = 0; k < 2 + Math.floor(rand() * 3); k++) { const bh = 0.03 + rand() * 0.025; put(xStop + 0.04 + bw0 / 2 + (rand() - 0.5) * 0.02, y + bh / 2, d * 0.04, bw0, bh, d * 0.6, 0, BOOK_COLORS[Math.floor(rand() * BOOK_COLORS.length)]); y += bh; } } // 横に積んだ本
    }
    im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; g.add(im); keep({ dispose: () => im.dispose() });
    return g;
  }
  // 右の壁: 大きな本棚(7段)。ほぼ、壁いっぱい。
  const shelfR = makeBookshelf(3.6, 2.6, 0.38, 7, 11); shelfR.position.set(ROOM.x1 - 0.19, 0, 1.6); shelfR.rotation.y = -Math.PI / 2; add(shelfR);
  // 手前の壁: 本棚2つ(ドアの両側)。左の壁: 低めの本棚
  const shelfF1 = makeBookshelf(1.5, 2.3, 0.34, 6, 23); shelfF1.position.set(-2.75, 0, ROOM.z1 - 0.17); shelfF1.rotation.y = Math.PI; add(shelfF1);
  const shelfF2 = makeBookshelf(1.2, 2.0, 0.32, 5, 37); shelfF2.position.set(3.0, 0, ROOM.z1 - 0.16); shelfF2.rotation.y = Math.PI; add(shelfF2);
  const shelfL = makeBookshelf(2.4, 1.5, 0.34, 4, 51); shelfL.position.set(ROOM.x0 + 0.17, 0, 4.7); shelfL.rotation.y = Math.PI / 2; add(shelfL);
  // 低い本棚の上: 地球儀と、観葉植物、積んだ本
  const globe = new THREE.Group(); globe.position.set(ROOM.x0 + 0.2, 1.5, 4.2); add(globe);
  { const b = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.07, 0.08, 0.03, 10)), darkMat); b.position.y = 0.015; globe.add(b); const s = new THREE.Mesh(keep(new THREE.SphereGeometry(0.11, 12, 9)), keep(toon(0x3f7aa8))); s.position.y = 0.18; globe.add(s);
    const land = new THREE.Mesh(keep(new THREE.SphereGeometry(0.112, 6, 5, 0.3, 1.4, 0.9, 1.2)), keep(toon(0x5aa05a))); land.position.y = 0.18; globe.add(land); }

  // ---- 手前の壁(窓の反対側): ドア・MIDIキーボード・額・床の植物 ----
  const doorMat = toon(0x7a5238); keep(doorMat);
  box(1.0, 2.1, 0.06, doorMat, 1.35, 1.05, ROOM.z1 - 0.05); box(1.12, 0.06, 0.08, woodMat, 1.35, 2.13, ROOM.z1 - 0.05); box(0.06, 2.1, 0.08, woodMat, 0.82, 1.05, ROOM.z1 - 0.05); box(0.06, 2.1, 0.08, woodMat, 1.88, 1.05, ROOM.z1 - 0.05);
  { const k = new THREE.Mesh(keep(new THREE.SphereGeometry(0.035, 8, 6)), keep(toon(0xd9b45a))); k.position.set(1.7, 1.0, ROOM.z1 - 0.1); add(k); }
  box(0.7, 0.5, 0.025, toon(0x2a2f55), 1.35, 1.7, ROOM.z1 - 0.09).material; // ドアの飾り板(ガラス窓の代わり)
  // 壁に立てかけた、ゲームの中の MIDIキーボード(本物と同じ形)
  let kb = null;
  if (!omit.kb) { // 部屋の演出では、縦に立てかける(自分で置く)ので、省く
  kb = createMidiKeyboard(); kb.group.scale.setScalar(1.45); kb.group.rotation.set(-(Math.PI / 2 - 0.2), 0, 0); // 長い辺を壁にそって、立てる。上の縁が、壁にもたれる
  kb.group.position.set(-0.25, 0.145, ROOM.z1 - 0.16); add(kb.group);
  { const fl = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.1, 0.5)), keep(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }))); fl.rotation.x = -Math.PI / 2; fl.position.set(-0.25, 0.013, ROOM.z1 - 0.3); add(fl); } // 足もとの影
  }
  // 額(ドット絵ふう)
  function pictureTexture(draw) { const c = document.createElement('canvas'); c.width = 48; c.height = 32; draw(c.getContext('2d')); const t = keep(new THREE.CanvasTexture(c)); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; return t; }
  function frame(w, h, tex, x, y, z, ry) {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; add(g);
    box(w + 0.06, h + 0.06, 0.04, woodMat, 0, 0, 0, g);
    const p = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, h)), keep(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }))); p.position.z = 0.022; g.add(p); return g;
  }
  const picMountain = pictureTexture((c) => { const g = c.createLinearGradient(0, 0, 0, 32); g.addColorStop(0, '#f2a65a'); g.addColorStop(1, '#f7e0a8'); c.fillStyle = g; c.fillRect(0, 0, 48, 32); c.fillStyle = '#fff3c4'; c.beginPath(); c.arc(34, 11, 4, 0, 7); c.fill(); c.fillStyle = '#5a6a8c'; c.beginPath(); c.moveTo(0, 32); c.lineTo(14, 12); c.lineTo(26, 32); c.fill(); c.fillStyle = '#3f4a6a'; c.beginPath(); c.moveTo(16, 32); c.lineTo(32, 16); c.lineTo(48, 32); c.fill(); });
  const picSea = pictureTexture((c) => { c.fillStyle = '#9fd0e8'; c.fillRect(0, 0, 48, 32); c.fillStyle = '#2f6aa0'; c.fillRect(0, 18, 48, 14); c.fillStyle = '#e8f4ff'; for (let i = 0; i < 6; i++) c.fillRect(4 + i * 8, 22 + (i % 3) * 3, 5, 1); c.fillStyle = '#fff'; c.fillRect(30, 6, 8, 3); c.fillRect(33, 4, 8, 3); });
  const picCat = pictureTexture((c) => { c.fillStyle = '#e7d9bd'; c.fillRect(0, 0, 48, 32); c.fillStyle = '#4a4a55'; c.fillRect(14, 12, 20, 14); c.fillRect(14, 8, 5, 5); c.fillRect(29, 8, 5, 5); c.fillStyle = '#f2d34f'; c.fillRect(18, 16, 3, 3); c.fillRect(27, 16, 3, 3); c.fillStyle = '#e88a9a'; c.fillRect(23, 21, 2, 2); });
  frame(0.62, 0.42, picMountain, -1.25, 2.0, ROOM.z1 - 0.05, Math.PI); frame(0.42, 0.62, picSea, -0.55, 2.0, ROOM.z1 - 0.05, Math.PI); frame(0.5, 0.34, picCat, 0.15, 2.05, ROOM.z1 - 0.05, Math.PI);
  frame(0.7, 0.46, picMountain, ROOM.x0 + 0.04, 2.1, 1.0, Math.PI / 2); frame(0.46, 0.46, picCat, ROOM.x0 + 0.04, 2.0, 2.0, Math.PI / 2); // 左の壁の額

  // ---- 左の壁: 星のランプのひも(電球が、ゆるく弧を描く)・コルクボード ----
  const bulbMat = keep(new THREE.MeshBasicMaterial({ color: 0xffd98a, toneMapped: false }));
  const bulbs = [];
  for (let i = 0; i < 14; i++) { const u = i / 13, z = 0.2 + u * 5.0, y = 2.95 - Math.sin(u * Math.PI) * 0.28; const bl = new THREE.Mesh(keep(new THREE.SphereGeometry(0.03, 6, 5)), bulbMat); bl.position.set(ROOM.x0 + 0.08, y, z); add(bl); bulbs.push(bl); }
  box(0.02, 0.01, 5.1, darkMat, ROOM.x0 + 0.07, 2.84, 2.75); // ひも(細い板で代用)
  box(0.03, 0.62, 0.9, woodMat, ROOM.x0 + 0.04, 1.75, 3.0); // コルクボード
  { const cork = toon(0xb98a52); keep(cork); box(0.02, 0.54, 0.82, cork, ROOM.x0 + 0.06, 1.75, 3.0); const memo = [[0xf2d34f, 2.8, 1.9], [0xe88a9a, 3.1, 1.8], [0x8fd0a0, 3.0, 1.62], [0xffffff, 3.25, 1.95]]; for (const [c, z, y] of memo) { box(0.012, 0.11, 0.1, toon(c), ROOM.x0 + 0.075, y, z); } }

  // ---- 奥の壁: 銀の盾(動画サイトの「銀の盾」のような、記念の盾) ----
  function plaqueTexture() {
    const c = document.createElement('canvas'); c.width = 192; c.height = 128; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 192, 128); gr.addColorStop(0, '#f4f6fa'); gr.addColorStop(0.35, '#b9c0cc'); gr.addColorStop(0.55, '#eef1f6'); gr.addColorStop(1, '#9aa3b2'); g.fillStyle = gr; g.fillRect(0, 0, 192, 128);
    g.strokeStyle = 'rgba(80,90,105,0.55)'; g.lineWidth = 3; g.strokeRect(6, 6, 180, 116); g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1.5; g.strokeRect(11, 11, 170, 106);
    g.fillStyle = '#d8232a'; g.beginPath(); g.roundRect ? g.roundRect(54, 22, 84, 56, 14) : g.rect(54, 22, 84, 56); g.fill(); // 赤い、再生ボタンの絵
    g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(88, 36); g.lineTo(88, 64); g.lineTo(112, 50); g.closePath(); g.fill();
    g.fillStyle = 'rgba(70,78,92,0.9)'; g.font = 'bold 13px sans-serif'; g.textAlign = 'center'; g.fillText('SILVER  AWARD', 96, 98); g.font = '11px sans-serif'; g.fillText('100,000  FOLLOWERS', 96, 113);
    const t = keep(new THREE.CanvasTexture(c)); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  if (!omit.plaque) {
  { const g = new THREE.Group(); g.position.set(-2.72, 2.32, ROOM.z0 + 0.06); add(g);
    box(0.78, 0.58, 0.05, toon(0x2b2f3a), 0, 0, 0, g); // 黒い額ぶち
    const plate = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.7, 0.5)), keep(new THREE.MeshBasicMaterial({ map: plaqueTexture(), color: 0xc9ccd6, toneMapped: false }))); plate.position.z = 0.027; g.add(plate);
    const shine = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.7, 0.5)), keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false }))); shine.position.z = 0.03; g.add(shine); }
  }

  // ---- 椅子・サイドテーブル・フロアスタンド・観葉植物・ビーンバッグ ----
  const fabric = toon(0x8c4a3a), cushion = toon(0xd2a05a), potMat = toon(0xb0653a), leafMat = toon(0x3f8a4f), leafMat2 = toon(0x5aa86a); keep(fabric); keep(cushion); keep(potMat); keep(leafMat); keep(leafMat2);
  const arm = new THREE.Group(); arm.position.set(2.7, 0, 4.3); arm.rotation.y = -Math.PI / 2 - 0.45; add(arm); // 読書用の安楽椅子(左手前へ向く)
  box(0.9, 0.3, 0.85, fabric, 0, 0.3, 0, arm); box(0.9, 0.7, 0.18, fabric, 0, 0.68, -0.34, arm); box(0.16, 0.34, 0.85, fabric, -0.5, 0.5, 0, arm); box(0.16, 0.34, 0.85, fabric, 0.5, 0.5, 0, arm); box(0.7, 0.1, 0.65, cushion, 0, 0.5, 0.05, arm);
  for (const [lx, lz] of [[-0.38, -0.34], [0.38, -0.34], [-0.38, 0.34], [0.38, 0.34]]) box(0.06, 0.15, 0.06, darkMat, lx, 0.075, lz, arm);
  const sideT = new THREE.Group(); sideT.position.set(3.45, 0, 3.2); add(sideT); box(0.45, 0.05, 0.45, woodMat, 0, 0.55, 0, sideT); box(0.05, 0.55, 0.05, darkMat, 0, 0.275, 0, sideT);
  { const b1 = box(0.3, 0.045, 0.22, toon(0x3b5c8c), 0, 0.597, 0, sideT); b1.rotation.y = 0.2; const b2 = box(0.27, 0.04, 0.2, toon(0xc9a24a), 0.01, 0.64, 0, sideT); b2.rotation.y = -0.15; const cup = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.045, 0.04, 0.085, 10)), keep(toon(0xf3efe6))); cup.position.set(-0.1, 0.66, 0.08); sideT.add(cup); } // 読みかけの本と、ティーカップ
  const fl = new THREE.Group(); fl.position.set(3.5, 0, 4.9); add(fl); // フロアスタンド
  { const base = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.16, 0.18, 0.04, 12)), darkMat); base.position.y = 0.02; fl.add(base); const pole = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.015, 0.015, 1.6, 6)), darkMat); pole.position.y = 0.82; fl.add(pole);
    const shade = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.15, 0.22, 0.28, 12, 1, true)), keep(new THREE.MeshBasicMaterial({ color: 0xffdca0, side: THREE.DoubleSide, toneMapped: false }))); shade.position.y = 1.72; fl.add(shade); }
  function plant(x, z, s) { const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); add(g); const pot = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.2, 0.15, 0.3, 10)), potMat); pot.position.y = 0.15; g.add(pot);
    for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2, leaf = new THREE.Mesh(keep(new THREE.ConeGeometry(0.1, 0.62 + (i % 3) * 0.12, 5)), i % 2 ? leafMat : leafMat2); leaf.position.set(Math.cos(a) * 0.1, 0.55 + (i % 3) * 0.06, Math.sin(a) * 0.1); leaf.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); g.add(leaf); } return g; }
  plant(-3.2, 6.4, 1.15); plant(ROOM.x1 - 0.35, -1.7, 1.0); plant(-3.2, -1.7, 0.9);
  if (!omit.bean) { // ビーンバッグ(部屋の演出では、ソファを置くので、省く)
    const bean = new THREE.Mesh(keep(new THREE.SphereGeometry(0.5, 12, 9)), keep(toon(0x4a8c8c))); bean.scale.set(1, 0.62, 0.95); bean.position.set(-2.6, 0.31, 2.9); add(bean); // ビーンバッグ
    const bean2 = new THREE.Mesh(keep(new THREE.SphereGeometry(0.22, 8, 6)), keep(toon(0xf2d34f))); bean2.scale.set(1, 0.5, 0.9); bean2.position.set(-2.5, 0.64, 2.8); add(bean2);
  }

  // ---- 天井の明かり(つり下げ電球) ----
  const pend = new THREE.Group(); pend.position.set(0.4, H, 3.6); add(pend);
  { const cord = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 4)), darkMat); cord.position.y = -0.25; pend.add(cord); const sh = new THREE.Mesh(keep(new THREE.ConeGeometry(0.2, 0.18, 14, 1, true)), keep(new THREE.MeshBasicMaterial({ color: 0xffd9a0, side: THREE.DoubleSide, toneMapped: false }))); sh.position.y = -0.56; pend.add(sh); const bu = new THREE.Mesh(keep(new THREE.SphereGeometry(0.06, 8, 6)), keep(new THREE.MeshBasicMaterial({ color: 0xfff1c8, toneMapped: false }))); bu.position.y = -0.6; pend.add(bu); }
  const ceilingLight = new THREE.PointLight(0xffd9a8, 5.2, 11, 1.4); ceilingLight.position.set(0.4, H - 0.7, 3.6); scene.add(ceilingLight);
  const floorLampLight = new THREE.PointLight(0xffc27a, 3.2, 6, 1.6); floorLampLight.position.set(3.3, 1.65, 4.7); scene.add(floorLampLight);
  const sideLight = new THREE.PointLight(0xbfd2ff, 2.2, 7, 1.5); sideLight.position.set(-2.6, 2.4, 1.6); scene.add(sideLight); // 左がわを、うっすら青白く(窓の月明かり)

  return { ceilingLight, floorLampLight, shelves: [shelfR, shelfF1, shelfF2, shelfL], kb, update(t) { for (let i = 0; i < bulbs.length; i++) bulbs[i].scale.setScalar(0.92 + 0.1 * Math.sin(t * 2 + i * 1.3)); } };
}
