// tv-screen.js (v1.121) — 部屋のテレビデオ(ブラウン管)の画面。小さなキャンバス(128×96)に、映画のような映像・ゲームの映像を、絵で描く。
//   ・映画6本(夜のドライブ・夕焼けの海・宇宙・雪の森・雨の街・砂漠の列車)。黒帯と字幕つき。ビデオテープを替えると、別の映画になる。
//   ・ゲーム3種(横スクロールのアクション・ドライブ・落ちものパズル)。今は、映像だけ。将来、本当に遊べるようにする時は、ここの game を差し替える。
//   ・青い画面(テープを入れた直後。▶ PLAY)・砂嵐。
//   ・ブラウン管らしさ: 走査線・四隅の暗さ・ときどき走る、ノイズの帯(ビデオの、トラッキングの乱れ)。
//   実在の作品・キャラクター・ロゴは使わない。約12コマ/秒で描く(重くしない)。
import * as THREE from 'three';

export const FILM_COUNT = 6;
export const GAMES = ['platformer', 'racer', 'blocks'];
export const TV_W = 128, TV_H = 96;
const FPS = 12;

const rng = (seed) => { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };

/** 黒帯(映画の、上下の黒い帯)と字幕。 */
function letterbox(g, t, film) {
  g.fillStyle = '#000'; g.fillRect(0, 0, TV_W, 11); g.fillRect(0, TV_H - 11, TV_W, 11);
  const r = rng(film * 977 + Math.floor(t / 3.4) * 131), lines = r() < 0.7 ? 1 : 2; // 3.4秒ごとに、字幕が変わる
  g.fillStyle = 'rgba(255,255,235,0.92)';
  for (let l = 0; l < lines; l++) { const n = 4 + Math.floor(r() * 5); let x = 24 + r() * 14; const y = TV_H - 21 + l * 6; for (let i = 0; i < n; i++) { const w = 5 + Math.floor(r() * 12); g.fillRect(Math.round(x), y, w, 3); x += w + 3; } }
}

// ---------------------------------------------------------------- 映画
function drawFilm(g, t, film) {
  const W = TV_W, H = TV_H;
  if (film === 0) { // 夜のドライブ: 道が、まっすぐ、のびて、街灯が、流れてくる
    const sky = g.createLinearGradient(0, 0, 0, H * 0.55); sky.addColorStop(0, '#1a1038'); sky.addColorStop(1, '#e0703a'); g.fillStyle = sky; g.fillRect(0, 0, W, H * 0.55);
    g.fillStyle = '#10101a'; g.fillRect(0, H * 0.55, W, H * 0.45);
    g.fillStyle = '#080810'; g.beginPath(); g.moveTo(W * 0.48, H * 0.55); g.lineTo(W * 0.52, H * 0.55); g.lineTo(W * 0.95, H); g.lineTo(W * 0.05, H); g.closePath(); g.fill();
    for (let i = 0; i < 6; i++) { const k = ((t * 0.6 + i / 6) % 1), y = H * 0.55 + (H * 0.45) * k * k, w = 1 + 5 * k * k; g.fillStyle = '#e8e0b0'; g.fillRect(W / 2 - w / 2, y, w, 1 + 4 * k * k); g.fillStyle = '#ffd070'; g.fillRect(W * 0.1 - 8 * k + W * 0.38 * (1 - k) - 2, H * 0.4 + H * 0.35 * k * k, 2 + 3 * k, 2 + 3 * k); g.fillRect(W * 0.9 + 8 * k - W * 0.38 * (1 - k), H * 0.4 + H * 0.35 * k * k, 2 + 3 * k, 2 + 3 * k); }
    g.fillStyle = '#d02828'; g.fillRect(W / 2 - 9, H * 0.66, 4, 3); g.fillRect(W / 2 + 5, H * 0.66, 4, 3); g.fillStyle = '#1c1c28'; g.fillRect(W / 2 - 11, H * 0.64, 22, 5);
  } else if (film === 1) { // 夕焼けの海: 水平線に、ゆっくり、船が横ぎる
    const sky = g.createLinearGradient(0, 0, 0, H * 0.5); sky.addColorStop(0, '#e98a5c'); sky.addColorStop(1, '#f6d58a'); g.fillStyle = sky; g.fillRect(0, 0, W, H * 0.5);
    g.fillStyle = '#fff2c0'; g.beginPath(); g.arc(W * 0.62, H * 0.47, 9, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2a4a7a'; g.fillRect(0, H * 0.5, W, H * 0.5);
    for (let i = 0; i < 14; i++) { const y = H * 0.5 + 3 + i * 3.2 + Math.sin(t * 1.3 + i) * 0.8, w = 8 + i * 2; g.fillStyle = i % 3 === 0 ? '#f4c27a' : '#3c6aa0'; g.fillRect(W * 0.62 - w / 2 + Math.sin(t * 1.7 + i * 1.9) * 3, y, w, 1); }
    const sx = ((t * 3) % (W + 40)) - 20; g.fillStyle = '#10182a'; g.fillRect(sx, H * 0.5 - 5, 16, 4); g.fillRect(sx + 6, H * 0.5 - 10, 4, 5); g.fillRect(sx + 11, H * 0.5 - 8, 1, 3);
  } else if (film === 2) { // 宇宙: 星がゆっくり流れ、大きな惑星と、小さな宇宙船
    g.fillStyle = '#04040c'; g.fillRect(0, 0, W, H); const r = rng(5);
    for (let i = 0; i < 46; i++) { const x = ((r() * W - t * (2 + r() * 6)) % W + W) % W, y = r() * H; g.fillStyle = r() < 0.3 ? '#ffffff' : '#8a96c8'; g.fillRect(Math.floor(x), Math.floor(y), 1, 1); }
    g.fillStyle = '#6a4a9a'; g.beginPath(); g.arc(W * 0.72, H * 0.56, 26, 0, Math.PI * 2); g.fill(); g.fillStyle = '#8a6ac0'; g.beginPath(); g.arc(W * 0.72 - 6, H * 0.56 - 6, 17, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#d8c8f0'; g.lineWidth = 2; g.beginPath(); g.ellipse(W * 0.72, H * 0.56, 38, 8, -0.3, 0, Math.PI * 2); g.stroke();
    const px = 20 + ((t * 5) % 70), py = H * 0.42 + Math.sin(t * 0.9) * 6; g.fillStyle = '#c8ccd8'; g.fillRect(px, py, 10, 3); g.fillRect(px + 8, py - 1, 4, 5); g.fillStyle = '#ffa040'; g.fillRect(px - 4, py + 1, 4, 1);
  } else if (film === 3) { // 雪の森: 青白い夜。松の木と、降る雪と、小屋の灯り
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#223a5e'); sky.addColorStop(1, '#8aa6c8'); g.fillStyle = sky; g.fillRect(0, 0, W, H);
    for (let layer = 0; layer < 2; layer++) { g.fillStyle = layer ? '#102a3a' : '#2a4a5e'; for (let i = -1; i < 9; i++) { const x = i * 18 + (layer ? 6 : 0) - ((t * (layer ? 1.4 : 0.6)) % 18), h = layer ? 34 : 24, y = H * 0.7; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 9, y - h); g.lineTo(x + 18, y); g.closePath(); g.fill(); } }
    g.fillStyle = '#e6eef8'; g.fillRect(0, H * 0.7, W, H * 0.3); g.fillStyle = '#3a2a24'; g.fillRect(W * 0.3, H * 0.6, 16, 11); g.fillStyle = '#ffd070'; g.fillRect(W * 0.3 + 4, H * 0.63, 4, 4);
    const r = rng(9); g.fillStyle = '#fff'; for (let i = 0; i < 40; i++) { const x = (r() * W + Math.sin(t + i) * 3 + W) % W, y = (r() * H + t * (10 + r() * 14)) % H; g.fillRect(Math.floor(x), Math.floor(y), 1, 1); }
  } else if (film === 4) { // 雨の街: ネオンがにじむ夜。傘の人が、歩く
    g.fillStyle = '#0c1a24'; g.fillRect(0, 0, W, H); const cols = ['#ff3aa0', '#2ae0ff', '#ffb02e'];
    for (let i = 0; i < 7; i++) { g.fillStyle = cols[i % 3]; g.globalAlpha = 0.55; g.fillRect(8 + i * 18, 14 + (i % 2) * 6, 3, 26 + (i % 3) * 8); g.globalAlpha = 0.22; g.fillRect(6 + i * 18, 14 + (i % 2) * 6, 7, 26 + (i % 3) * 8); } g.globalAlpha = 1;
    g.fillStyle = '#162a38'; g.fillRect(0, H * 0.68, W, H * 0.32);
    for (let i = 0; i < 7; i++) { g.fillStyle = cols[i % 3]; g.globalAlpha = 0.25; g.fillRect(8 + i * 18, H * 0.7, 3, 14); } g.globalAlpha = 1;
    const wx = ((t * 6) % (W + 30)) - 15; g.fillStyle = '#05080c'; g.fillRect(wx, H * 0.5, 3, 14); g.beginPath(); g.arc(wx + 1, H * 0.5 - 1, 7, Math.PI, 0); g.fill();
    const r = rng(3); g.fillStyle = 'rgba(190,220,240,0.7)'; for (let i = 0; i < 34; i++) { const x = r() * W, y = (r() * H + t * 70) % H; g.fillRect(Math.floor(x), Math.floor(y), 1, 3); }
  } else { // 砂漠の列車
    const sky = g.createLinearGradient(0, 0, 0, H * 0.6); sky.addColorStop(0, '#6aa8d8'); sky.addColorStop(1, '#f2d9a0'); g.fillStyle = sky; g.fillRect(0, 0, W, H * 0.6);
    g.fillStyle = '#e0b66a'; g.beginPath(); g.moveTo(0, H * 0.62); for (let x = 0; x <= W; x += 8) g.lineTo(x, H * 0.55 + Math.sin(x * 0.07 + t * 0.1) * 5); g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill();
    g.fillStyle = '#c8964a'; g.fillRect(0, H * 0.72, W, H * 0.28); g.fillStyle = '#4a3a2a'; g.fillRect(0, H * 0.7, W, 2);
    const tx = ((t * 9) % (W + 70)) - 70; g.fillStyle = '#7a2a22'; g.fillRect(tx + 44, H * 0.58, 16, 12); for (let i = 0; i < 3; i++) { g.fillStyle = '#3a4a6a'; g.fillRect(tx + i * 14, H * 0.6, 12, 10); g.fillStyle = '#ffe3a0'; g.fillRect(tx + i * 14 + 2, H * 0.62, 8, 3); }
    g.fillStyle = 'rgba(240,240,240,0.6)'; g.fillRect(tx + 52, H * 0.5 - (t * 6) % 8, 5, 4);
  }
  letterbox(g, t, film);
}

// ---------------------------------------------------------------- ゲーム(映像だけ)
function drawGame(g, t, kind) {
  const W = TV_W, H = TV_H;
  if (kind === 'platformer') { // 横スクロールのアクション
    g.fillStyle = '#5c94fc'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff'; for (let i = 0; i < 3; i++) { const x = ((i * 50 - t * 5) % (W + 40) + W + 40) % (W + 40) - 20; g.fillRect(x, 14 + i * 8, 18, 5); g.fillRect(x + 4, 11 + i * 8, 10, 4); }
    g.fillStyle = '#2a8a2a'; for (let i = 0; i < 5; i++) { const x = ((i * 40 - t * 12) % (W + 40) + W + 40) % (W + 40) - 20; g.fillRect(x, H - 40, 26, 8); g.fillRect(x + 4, H - 44, 18, 5); }
    g.fillStyle = '#b8601c'; g.fillRect(0, H - 22, W, 22); g.fillStyle = '#e09040'; const off = Math.floor(t * 40) % 16; for (let x = -off; x < W; x += 16) { g.fillRect(x, H - 22, 15, 1); g.fillRect(x + 8, H - 11, 7, 1); g.fillRect(x, H - 11, 1, 11); } g.fillStyle = '#4ac04a'; g.fillRect(0, H - 22, W, 3);
    for (let i = 0; i < 4; i++) { const x = ((i * 36 - t * 40) % (W + 40) + W + 40) % (W + 40) - 16, y = H - 58 + Math.sin(t * 4 + i) * 2; g.fillStyle = '#ffd030'; g.fillRect(x, y, 5, 7); g.fillStyle = '#c89010'; g.fillRect(x + 1, y + 1, 1, 5); }
    const ex = W - ((t * 22) % (W + 20)); g.fillStyle = '#8a4a1a'; g.fillRect(ex, H - 31, 9, 9); g.fillStyle = '#e8d0a0'; g.fillRect(ex + 1, H - 24, 7, 2); g.fillStyle = '#000'; g.fillRect(ex + 2, H - 29, 1, 2); g.fillRect(ex + 6, H - 29, 1, 2);
    const cyc = (t % 1.9) / 1.9, jump = cyc < 0.45 ? Math.sin((cyc / 0.45) * Math.PI) * 26 : 0, hy = H - 22 - 12 - jump, leg = Math.floor(t * 8) % 2; // 主人公: ときどき、跳ぶ
    g.fillStyle = '#e03030'; g.fillRect(34, hy, 9, 4); g.fillRect(36, hy - 2, 6, 2); g.fillStyle = '#f0c090'; g.fillRect(35, hy + 4, 8, 4); g.fillStyle = '#2a4ad0'; g.fillRect(34, hy + 8, 9, 3); g.fillStyle = '#5a3a1a'; g.fillRect(jump > 0 ? 33 : leg ? 33 : 37, hy + 11, 4, 2); g.fillRect(jump > 0 ? 40 : leg ? 40 : 36, hy + 11, 4, 2);
    g.fillStyle = '#fff'; g.font = 'bold 8px monospace'; g.fillText('SCORE ' + String(150 + Math.floor(t * 10) * 10).padStart(6, '0'), 6, 10);
  } else if (kind === 'racer') { // ドライブ: 道が、右へ左へ、カーブする
    const sky = g.createLinearGradient(0, 0, 0, H * 0.45); sky.addColorStop(0, '#2a1a6a'); sky.addColorStop(1, '#ff8a4a'); g.fillStyle = sky; g.fillRect(0, 0, W, H * 0.45);
    g.fillStyle = '#3a2a5a'; g.beginPath(); g.moveTo(0, H * 0.45); for (let x = 0; x <= W; x += 8) g.lineTo(x, H * 0.45 - 10 - Math.abs(Math.sin(x * 0.09)) * 12); g.lineTo(W, H * 0.45); g.closePath(); g.fill();
    const curve = Math.sin(t * 0.5) * 30; g.fillStyle = '#1a7a2a'; g.fillRect(0, H * 0.45, W, H * 0.55);
    for (let y = Math.floor(H * 0.45); y < H; y++) { const k = (y - H * 0.45) / (H * 0.55), z = 1 / (k + 0.04), bend = curve * (1 - k) * (1 - k), cx = W / 2 + bend, hw = 6 + 56 * k, stripe = Math.floor(z * 1.2 + t * 8) % 2 === 0; g.fillStyle = stripe ? '#c83030' : '#e8e8e8'; g.fillRect(cx - hw - 4 * k - 2, y, 4 * k + 2, 1); g.fillRect(cx + hw, y, 4 * k + 2, 1); g.fillStyle = stripe ? '#58585c' : '#505054'; g.fillRect(cx - hw, y, hw * 2, 1); if (Math.floor(z * 0.6 + t * 4) % 2 === 0) { g.fillStyle = '#f0f0f0'; g.fillRect(cx - 1 * (1 + k * 2), y, 1 + k * 2, 1); } }
    const oy = H * 0.5 + ((t * 9) % 1) * (H * 0.4), ok = (oy - H * 0.45) / (H * 0.55); g.fillStyle = '#2a60d0'; g.fillRect(W / 2 + curve * (1 - ok) * (1 - ok) - 6 * ok - 4 + Math.sin(t) * 10 * ok, oy, 12 * ok + 4, 6 * ok + 3);
    const sway = Math.sin(t * 1.3) * 3; g.fillStyle = '#d82828'; g.fillRect(W / 2 - 11 + sway, H - 22, 22, 9); g.fillStyle = '#f8f8f8'; g.fillRect(W / 2 - 8 + sway, H - 26, 16, 5); g.fillStyle = '#101018'; g.fillRect(W / 2 - 13 + sway, H - 15, 6, 4); g.fillRect(W / 2 + 7 + sway, H - 15, 6, 4);
    g.fillStyle = '#fff'; g.font = 'bold 8px monospace'; g.fillText(String(180 + Math.floor(Math.sin(t) * 12)) + ' KM/H', 6, 10);
  } else { // 落ちものパズル
    g.fillStyle = '#101028'; g.fillRect(0, 0, W, H); g.fillStyle = '#1c1c40'; g.fillRect(34, 6, 44, 84); g.fillStyle = '#080818'; g.fillRect(36, 8, 40, 80);
    const r = rng(21), cols = ['#e03a3a', '#3ab0e0', '#e0c030', '#4ac05a', '#b05ad8', '#e08a30'];
    for (let c = 0; c < 10; c++) { const h = Math.floor(r() * 5); for (let y = 0; y < h; y++) { g.fillStyle = cols[Math.floor(r() * cols.length)]; g.fillRect(36 + c * 4, 88 - (y + 1) * 4, 3, 3); } }
    const step = Math.floor(t * 2.6), shape = Math.floor(step / 14) % 4, base = step % 14, sx = 4 + ((Math.floor(step / 14) * 3) % 5); const cells = [[[0, 0], [1, 0], [2, 0], [3, 0]], [[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [2, 0], [1, 1]], [[0, 0], [0, 1], [1, 1], [2, 1]]][shape];
    g.fillStyle = cols[(shape * 2 + 1) % cols.length]; for (const [cx, cy] of cells) g.fillRect(36 + (sx + cx) * 4, 8 + (base + cy) * 4, 3, 3);
    if (Math.floor(t * 0.8) % 5 === 4) { g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(36, 72, 40, 4); }
    g.fillStyle = '#1c1c40'; g.fillRect(86, 14, 30, 28); g.fillStyle = '#fff'; g.font = 'bold 7px monospace'; g.fillText('NEXT', 90, 12); g.fillStyle = cols[(shape * 2 + 3) % cols.length]; g.fillRect(94, 22, 12, 4); g.fillRect(94, 26, 8, 4);
    g.fillStyle = '#fff'; g.fillText('LINES', 88, 58); g.fillText(String(12 + Math.floor(t / 6) % 90), 88, 68);
  }
}

// ---------------------------------------------------------------- 青い画面・砂嵐
function drawBlue(g, t, k) {
  g.fillStyle = '#1030a8'; g.fillRect(0, 0, TV_W, TV_H); g.fillStyle = '#fff'; g.font = 'bold 9px monospace'; g.fillText('\u25B6 PLAY', 10, 16);
  const r = rng(Math.floor(t * 12) + 7); g.fillStyle = 'rgba(255,255,255,0.35)'; const y0 = TV_H - 14 - Math.floor(k * 4); for (let i = 0; i < 90; i++) g.fillRect(Math.floor(r() * TV_W), y0 + Math.floor(r() * 6), 2 + Math.floor(r() * 8), 1);
}
function drawStatic(g, t) {
  const r = rng(Math.floor(t * 24) + 3); g.fillStyle = '#707078'; g.fillRect(0, 0, TV_W, TV_H);
  for (let i = 0; i < 260; i++) { const v = 40 + Math.floor(r() * 200); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.floor(r() * TV_W), Math.floor(r() * TV_H), 2 + Math.floor(r() * 6), 1 + Math.floor(r() * 2)); }
}

/** ブラウン管の仕上げ: 走査線・四隅の暗さ・ときどき走るノイズの帯。 */
function crt(g, t, tracking) {
  g.fillStyle = 'rgba(0,0,0,0.17)'; for (let y = 0; y < TV_H; y += 2) g.fillRect(0, y, TV_W, 1);
  const v = g.createRadialGradient(TV_W / 2, TV_H / 2, 24, TV_W / 2, TV_H / 2, 84); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.5)'); g.fillStyle = v; g.fillRect(0, 0, TV_W, TV_H);
  if (tracking) { const y = ((t * 26) % (TV_H + 40)) - 20, r = rng(Math.floor(t * 20)); for (let i = 0; i < 44; i++) { const a = 90 + Math.floor(r() * 150); g.fillStyle = `rgba(${a},${a},${a},0.5)`; g.fillRect(Math.floor(r() * TV_W), Math.floor(y + r() * 5), 3 + Math.floor(r() * 14), 1); } }
}

/**
 * テレビの画面。mode: 'movie'(film 0〜5)/ 'game'(game: 'platformer'|'racer'|'blocks')/ 'blue' / 'static'。
 * texture を、画面の板に貼る。update(t, dt) を毎コマ呼ぶ(12コマ/秒で描き直す)。
 */
export function createTvScreen() {
  const cv = document.createElement('canvas'); cv.width = TV_W; cv.height = TV_H; const g = cv.getContext('2d');
  const texture = new THREE.CanvasTexture(cv); texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false;
  const S = { mode: 'movie', film: 0, game: 'platformer', blueT: 0, acc: 1, drawn: 0 };
  function draw(t) {
    if (S.mode === 'game') drawGame(g, t, S.game); else if (S.mode === 'blue') drawBlue(g, t, 0); else if (S.mode === 'static') drawStatic(g, t); else drawFilm(g, t, S.film % FILM_COUNT);
    crt(g, t, S.mode === 'movie' && Math.floor(t / 14) % 3 === 1 && (t % 14) < 0.7); S.drawn++; texture.needsUpdate = true;
  }
  draw(0);
  return {
    texture, canvas: cv, get mode() { return S.mode; }, get film() { return S.film; }, get game() { return S.game; }, get drawn() { return S.drawn; },
    setMode(mode, opt = {}) { const changed = mode !== S.mode || (opt.film != null && opt.film !== S.film) || (opt.game && opt.game !== S.game); if (opt.film != null) S.film = opt.film; if (opt.game) S.game = opt.game; S.mode = mode; if (changed) S.acc = 1; }, // 同じ指定を毎コマ呼んでも、描き直しは、12コマ/秒のまま
    /** 画面の、おおよその明るさと色(部屋のテレビの明かり用)。 */
    tint() { return S.mode === 'blue' ? [0.2, 0.35, 1] : S.mode === 'static' ? [0.8, 0.8, 0.85] : S.mode === 'game' ? [0.9, 0.85, 0.6] : [[1, 0.6, 0.35], [1, 0.75, 0.45], [0.55, 0.45, 0.9], [0.6, 0.75, 1], [0.35, 0.8, 0.9], [1, 0.85, 0.5]][S.film % FILM_COUNT]; },
    update(t, dt) { S.acc += dt; if (S.acc >= 1 / FPS) { S.acc = 0; draw(t); } },
  };
}
