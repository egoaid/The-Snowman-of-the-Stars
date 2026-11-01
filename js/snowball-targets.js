// snowball-targets.js (v1.96)
// 雪玉の「当たる物」と、当たった時の反応のきまり。画面や three.js に依存しない(Nodeで試験できる)。
//   ・当たり判定の形: 円柱(木の幹・岩・置いた物・焚き火・松明)、球(木の葉の茂み)、ドーム(かまくら。入口は通り抜けられる)
//   ・蝶・蜂は、雪玉の通り道から必ず避ける(当たらない)
//   ・星の松明は、しなって「ぶるん」と戻り、しばらく光が点滅する
//   ・焚き火は、火が一瞬消えかかって、すぐ元に戻る
//   ・かまくらは、傷つかない(当たって砕けるだけ)

// ---------- 当たり判定 ----------
/**
 * 形の定義:
 *  { shape:'cyl',    kind, x, z, y0, y1, r, ref }           円柱(y0〜y1)
 *  { shape:'sphere', kind, x, z, cy, r, ref }               球(中心の高さ cy)
 *  { shape:'dome',   kind, x, z, baseY, r, innerR, doorYaw, doorHalf, doorH, ref }  かまくら(ドームの殻。入口の隙間は通れる)
 * br は雪玉の半径。
 */
export function hitShape(s, x, y, z, br) {
  if (s.shape === 'cyl') {
    return Math.hypot(x - s.x, z - s.z) < s.r + br && y > s.y0 - br && y < s.y1 + br;
  }
  if (s.shape === 'sphere') {
    return Math.hypot(x - s.x, y - s.cy, z - s.z) < s.r + br;
  }
  if (s.shape === 'dome') {
    if (y < s.baseY - br) return false;
    const d = Math.hypot(x - s.x, y - s.baseY, z - s.z);
    if (d >= s.r + br || d <= s.innerR) return false; // 殻の外・中の空洞は当たらない
    // 入口(隙間): 入口の向きの近くで、入口の高さより下なら、通り抜けられる
    const ang = Math.atan2(x - s.x, z - s.z);
    let diff = Math.abs(ang - s.doorYaw); diff = Math.min(diff, Math.PI * 2 - diff);
    if (diff < s.doorHalf && y < s.baseY + s.doorH) return false;
    return true;
  }
  return false;
}
/** 雪玉の位置で最初に当たる形(なければ null)。 */
export function findHit(shapes, x, y, z, br) {
  for (const s of shapes) if (hitShape(s, x, y, z, br)) return s;
  return null;
}

// ---------- 蝶・蜂がよける ----------
export const DODGE = { radius: 1.6, lookahead: 0.7, accel: 95, spring: 14, damp: 7.5, maxOffset: 2.4 };
/**
 * 雪玉(位置 b、速度 v)の通り道から、虫(位置 p)を遠ざける加速度ベクトルを返す。
 * いちばん近づく地点(いまから lookahead 秒以内)での距離が radius より近ければ、その地点から離れる向きへ。
 * 当たる寸前ほど強く避けるので、雪玉は必ず外れる。
 */
export function dodgePush(b, v, p, opts = DODGE) {
  const rx = p.x - b.x, ry = p.y - b.y, rz = p.z - b.z;
  const v2 = v.x * v.x + v.y * v.y + v.z * v.z;
  if (v2 < 1e-6) return { x: 0, y: 0, z: 0, strength: 0 };
  let t = (rx * v.x + ry * v.y + rz * v.z) / v2;      // いちばん近づく時刻
  if (t < -0.05 || t > opts.lookahead) return { x: 0, y: 0, z: 0, strength: 0 }; // 通り過ぎた・まだ遠い
  t = Math.max(0, t);
  let cx = rx - v.x * t, cy = ry - v.y * t, cz = rz - v.z * t; // 最接近時の、玉→虫のずれ
  const dmin = Math.hypot(cx, cy, cz);
  if (dmin >= opts.radius) return { x: 0, y: 0, z: 0, strength: 0 };
  if (dmin < 1e-3) { cx = -v.z; cy = 0.6; cz = v.x; } // ど真ん中なら、横上へ
  const L = Math.hypot(cx, cy, cz) || 1;
  const urgency = 1 - dmin / opts.radius;                // 近いほど強く
  const k = opts.accel * (0.45 + 0.55 * urgency) * (1.15 - Math.min(1, t / opts.lookahead) * 0.5);
  return { x: (cx / L) * k, y: (cy / L) * k, z: (cz / L) * k, strength: urgency };
}
/** 虫のよけ分(offset と velocity)を dt 進める。push は加速度。元の位置へは、バネで戻る。 */
export function stepDodge(o, push, dt, opts = DODGE) {
  o.vx += (push.x - opts.spring * o.x - opts.damp * o.vx) * dt;
  o.vy += (push.y - opts.spring * o.y - opts.damp * o.vy) * dt;
  o.vz += (push.z - opts.spring * o.z - opts.damp * o.vz) * dt;
  o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
  const m = Math.hypot(o.x, o.y, o.z);
  if (m > opts.maxOffset) { const s = opts.maxOffset / m; o.x *= s; o.y *= s; o.z *= s; }
  return o;
}
export const newDodge = () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });

// ---------- 星の松明: しなって、ぶるんと戻る ----------
export const TORCH_SWAY = { bend: 0.55, bendSec: 0.16, spring: 75, damp: 3.8, flickerSec: 1.6 };
export const newSway = () => ({ ax: 0, az: 0, vx: 0, vz: 0, pushT: 0, tx: 0, tz: 0, age: 99 });
/** 当たった: 向き(dirX,dirZ 単位ベクトル。松明のローカル座標)へ、しなる。 */
export function hitSway(s, dirX, dirZ) {
  const L = Math.hypot(dirX, dirZ) || 1;
  s.tx = (dirX / L) * TORCH_SWAY.bend; s.tz = (dirZ / L) * TORCH_SWAY.bend;
  s.pushT = TORCH_SWAY.bendSec; s.vx = 0; s.vz = 0; s.age = 0;
}
/** dt 進める。倒れそうになるまで曲がり(pushT)、そのあとバネで反動して元に戻る。 */
export function stepSway(s, dt) {
  s.age += dt;
  if (s.pushT > 0) {
    const k = Math.min(1, dt / 0.05);
    s.ax += (s.tx - s.ax) * k; s.az += (s.tz - s.az) * k;
    s.pushT -= dt;
    return s;
  }
  const C = TORCH_SWAY;
  s.vx += (-C.spring * s.ax - C.damp * s.vx) * dt; s.vz += (-C.spring * s.az - C.damp * s.vz) * dt;
  s.ax += s.vx * dt; s.az += s.vz * dt;
  if (Math.hypot(s.ax, s.az) < 0.005 && Math.hypot(s.vx, s.vz) < 0.05) { s.ax = s.az = s.vx = s.vz = 0; }
  return s;
}
/** 当たってからの時間(秒)での、光の強さの倍率(0.3〜1)。少し点滅して、元に戻る。 */
export function torchFlickerMul(age) {
  const T = TORCH_SWAY.flickerSec;
  if (age >= T) return 1;
  const fade = 1 - age / T; // 1→0
  const flick = 0.5 + 0.5 * Math.sin(age * 38 + Math.sin(age * 11) * 2);
  return 1 - fade * (0.25 + 0.5 * flick);
}

// ---------- 焚き火: 一瞬消えかかって、すぐ戻る ----------
export const FIRE_DIP = { downSec: 0.18, upSec: 1.4, minK: 0.15 };
/** 当たってからの時間(秒)での、火の勢いの倍率。 */
export function fireDipMul(age) {
  const { downSec, upSec, minK } = FIRE_DIP;
  if (age < 0) return 1;
  if (age < downSec) { const u = age / downSec; return 1 - (1 - minK) * u * u * (3 - 2 * u); }
  const u = Math.min(1, (age - downSec) / upSec);
  return minK + (1 - minK) * u * u * (3 - 2 * u);
}
