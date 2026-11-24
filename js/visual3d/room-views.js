// room-views.js (v1.117) — ワイプ(画面の隅の、部屋の映像)の「画角」の部品。three にも画面にも依存しない。
//   以前は、録画専用のワイプ(stream-wipe.js)の中にあったもの。ワイプを、起動の部屋(intro-room.js)に一本化したので、ここへ移した。
//   WIPE_VIEWS: 固定の3つの画角 / viewFromCustom・customFromView: 「自分で決めた画角」との変換 / clampView: 部屋の外へ出ない範囲に収める /
//   fitFov: 縦長の画面でも、部屋が見えるように、視野を広げる / OP_TUNE: パソコンを操作する時の姿勢の調整値 /
//   attachViewControls: 設定のプレビューの上で、ドラッグ・ホイールで、画角を決める操作。
import { ROOM } from '../intro-room-core.js';

// ---- 画角(固定の3つ。録画の映像(16:9)に収まるように、決めてある)----
//   room=部屋全体 / monitor=モニターを見ている雪だるま / face=顔のアップ
export const WIPE_VIEWS = {
  room: { pos: [-0.45, 1.8, 5.2], target: [-0.3, 1.05, 0.5], fov: 38 },
  monitor: { pos: [0.45, 1.65, 4.6], target: [-0.3, 1.38, 0.55], fov: 38 },
  face: { pos: [-0.6, 1.62, 2.2], target: [0.2, 1.55, 0.5], fov: 34 },
};
export const VIEW_LIMITS = { pos: [[ROOM.x0 + 0.2, ROOM.x1 - 0.2], [0.3, ROOM.h - 0.2], [ROOM.z0 + 0.3, ROOM.z1 - 0.2]], target: [[ROOM.x0, ROOM.x1], [0.1, ROOM.h], [ROOM.z0, ROOM.z1]], fov: [12, 70] }; // 動かせる範囲(部屋の外へは出ない)
const clampR = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));
export const cloneView = (v) => ({ pos: [...v.pos], target: [...v.target], fov: v.fov });
/** 保存してある camCustom({px,py,pz,tx,ty,tz,fov})を、画角(pos・target・fov)へ。 */
export function viewFromCustom(c) { return c ? { pos: [c.px, c.py, c.pz], target: [c.tx, c.ty, c.tz], fov: c.fov } : cloneView(WIPE_VIEWS.monitor); }
/** 画角を、保存用の camCustom へ。 */
export function customFromView(v) { return { px: v.pos[0], py: v.pos[1], pz: v.pos[2], tx: v.target[0], ty: v.target[1], tz: v.target[2], fov: v.fov }; }
/** 部屋の外へ出ない範囲に、画角を収める。 */
export function clampView(v) { return { pos: v.pos.map((x, i) => clampR(x, VIEW_LIMITS.pos[i])), target: v.target.map((x, i) => clampR(x, VIEW_LIMITS.target[i])), fov: clampR(v.fov, VIEW_LIMITS.fov) }; }
/** 縦長の画面(16:9より細い)でも、部屋が見えるように、視野を広げる(最大80度)。16:9以上なら、そのまま。 */
export function fitFov(baseFov, aspect) {
  if (aspect >= 16 / 9) return baseFov;
  return Math.min(80, Math.max(baseFov, (2 * Math.atan((Math.tan((baseFov * Math.PI) / 360) * (16 / 9) * 0.85) / aspect) * 180) / Math.PI));
}

// ---- パソコンを操作する時の姿勢の調整値(椅子で、前かがみになる角度・キーボードまでの距離)----
export const OP_TUNE = { lean: 0.14, kbF: 0.76 };

/**
 * 設定画面のプレビュー用: キャンバスを、ドラッグで回す・右ドラッグ(か Shift+ドラッグ)で平行移動・ホイールでズームして、画角を決める。
 * 動かすたびに onChange(視点) を呼ぶ。録画の中では、カメラは動かさない(これは、設定画面の、画角を決める操作だけ)。
 * canEdit() が false の間(自動切り替え中など)は、動かさない。getFlip() が true(プレビューが左右反転)の間は、左右のドラッグの向きを、絵にあわせて逆にする。戻り値: 外す関数。
 */
export function attachViewControls(canvas, view, onChange, canEdit = () => true, getFlip = () => false) {
  let drag = null;
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const down = (e) => { if (!canEdit()) return; drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey, v: view.getView() }; try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* なくても動く */ } e.preventDefault(); };
  const move = (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) * (getFlip() ? -1 : 1), dy = e.clientY - drag.y, v = drag.v, off = [v.pos[0] - v.target[0], v.pos[1] - v.target[1], v.pos[2] - v.target[2]], r = Math.hypot(off[0], off[1], off[2]) || 1;
    let nv;
    if (drag.pan) { // 画面の左右・上下へ、カメラと注目点を、いっしょに動かす
      const fwd = norm([-off[0], -off[1], -off[2]]), right = norm(cross(fwd, [0, 1, 0])), up = cross(right, fwd), k = r * 0.0022 * (v.fov / 38);
      const m = [(-dx * right[0] + dy * up[0]) * k, (-dx * right[1] + dy * up[1]) * k, (-dx * right[2] + dy * up[2]) * k];
      nv = { pos: [v.pos[0] + m[0], v.pos[1] + m[1], v.pos[2] + m[2]], target: [v.target[0] + m[0], v.target[1] + m[1], v.target[2] + m[2]], fov: v.fov };
    } else { // 注目点のまわりを回る
      let yaw = Math.atan2(off[0], off[2]) - dx * 0.008, pitch = Math.asin(Math.max(-1, Math.min(1, off[1] / r))) + dy * 0.006; pitch = Math.max(-0.5, Math.min(1.2, pitch));
      nv = { pos: [v.target[0] + r * Math.cos(pitch) * Math.sin(yaw), v.target[1] + r * Math.sin(pitch), v.target[2] + r * Math.cos(pitch) * Math.cos(yaw)], target: v.target, fov: v.fov };
    }
    view.setView(nv); onChange(view.getView());
  };
  const up = () => { drag = null; };
  const wheel = (e) => { if (!canEdit()) return; e.preventDefault(); const v = view.getView(); v.fov = v.fov * Math.exp(e.deltaY * 0.0012); view.setView(v); onChange(view.getView()); };
  const menu = (e) => e.preventDefault();
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('contextmenu', menu);
  return () => { canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('contextmenu', menu); };
}
