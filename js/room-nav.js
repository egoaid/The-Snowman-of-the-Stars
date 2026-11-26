// room-nav.js (v1.122) — 部屋の中の、道すじを決める(障害物をよける)。画面にも three.js にも依存しない(Nodeで試験できる)。
//   以前は、部屋の真ん中(hub)と、机の裏の出入口(GATE)を、手で決めていた。家具が動く(ドールハウスで、ユーザーが並べ替える)と
//   その道すじは、成り立たない。ここでは、家具の足あと(room-layout.js の obstacles)を、雪だるまの体の分だけ広げて、
//   その角をつないだ「見通しのグラフ」の、いちばん短い道を選ぶ(障害物の角を回る、ぴんと張った道すじ)。
//   ・出発点・行き先が、広げた足あとの中に入っている障害物は、この道すじでは、無視する(家具のすぐそばに立つ行動のため)。
//   ・低い物(low)は、障害物にしない。
import { ROOM } from './room-layout.js';

export const BODY = 0.35; // 雪だるまの体の半径(経路用。家具との間に、これだけあける)
export const WALL = 0.3; // 壁から、あける距離

const EPS = 1e-6;
const rotU = (ob) => ({ ax: Math.cos(ob.ry), az: -Math.sin(ob.ry), bx: Math.sin(ob.ry), bz: Math.cos(ob.ry) }); // 局所x軸・局所z軸(世界)

/** 広げた障害物 { cx, cz, hw, hd, ax, az, bx, bz }(hw, hd は、体の分、広げてある)。 */
export function inflate(obstacles, body = BODY) {
  return obstacles.map((o) => ({ id: o.id, cx: o.cx, cz: o.cz, hw: o.hw + body, hd: o.hd + body, ...rotU(o) }));
}
const toLocal = (o, x, z) => { const dx = x - o.cx, dz = z - o.cz; return [dx * o.ax + dz * o.az, dx * o.bx + dz * o.bz]; };
/** 点が、広げた障害物の、内側(境界は、外)にあるか。 */
export const insideInflated = (o, x, z, tol = EPS) => { const [u, v] = toLocal(o, x, z); return Math.abs(u) < o.hw - tol && Math.abs(v) < o.hd - tol; };
/** 線分が、広げた障害物の、内側を通るか(境界をなぞるだけなら、通らない)。 */
function segHits(o, x0, z0, x1, z1) {
  const [u0, v0] = toLocal(o, x0, z0), [u1, v1] = toLocal(o, x1, z1);
  let t0 = 0, t1 = 1;
  for (const [a, d, h] of [[u0, u1 - u0, o.hw - EPS], [v0, v1 - v0, o.hd - EPS]]) {
    if (Math.abs(d) < 1e-12) { if (Math.abs(a) >= h) return false; continue; }
    let ta = (-h - a) / d, tb = (h - a) / d; if (ta > tb) { const s = ta; ta = tb; tb = s; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t1 - t0 <= 1e-9) return false;
  }
  return t1 - t0 > 1e-9;
}
const corners = (o) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => ({ x: o.cx + o.ax * sx * o.hw + o.bx * sz * o.hd, z: o.cz + o.az * sx * o.hw + o.bz * sz * o.hd }));
const inBounds = (p) => p.x >= ROOM.x0 + WALL - EPS && p.x <= ROOM.x1 - WALL + EPS && p.z >= ROOM.z0 + WALL - EPS && p.z <= ROOM.z1 - WALL + EPS;

/**
 * from → to の道すじ(途中の経由点つき。出発点は含まない・行き先は含む)。見通せるなら、そのまま [to]。
 * obstacles = layout.obstacles。opt = { body }。道が見つからない時も、止まらないよう、[to] を返す。
 */
export function planRoute(from, to, obstacles, opt = {}) {
  const body = opt.body == null ? BODY : opt.body;
  const all = inflate(obstacles, body);
  const obs = all.filter((o) => !insideInflated(o, from.x, from.z) && !insideInflated(o, to.x, to.z)); // 出発点・行き先を、ふくむ家具は、無視
  const blocked = (a, b) => obs.some((o) => segHits(o, a.x, a.z, b.x, b.z));
  if (!blocked(from, to)) return [{ x: to.x, z: to.z }];
  const nodes = [{ x: from.x, z: from.z }, { x: to.x, z: to.z }];
  for (const o of obs) for (const c of corners(o)) if (inBounds(c) && !obs.some((q) => q !== o && insideInflated(q, c.x, c.z))) nodes.push(c);
  const n = nodes.length, dist = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), done = new Array(n).fill(false);
  dist[0] = 0;
  for (let it = 0; it < n; it++) {
    let u = -1; for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity) break; done[u] = true; if (u === 1) break;
    for (let v = 0; v < n; v++) {
      if (done[v]) continue; const d = Math.hypot(nodes[u].x - nodes[v].x, nodes[u].z - nodes[v].z); if (dist[u] + d >= dist[v]) continue;
      if (!blocked(nodes[u], nodes[v])) { dist[v] = dist[u] + d; prev[v] = u; }
    }
  }
  if (dist[1] === Infinity) return [{ x: to.x, z: to.z }]; // 道が無い(家具で、ふさがれている): 止まらずに、まっすぐ(はまり検知は、ゲーム側の仕事)
  const path = []; for (let v = 1; v >= 0 && v !== -1; v = prev[v]) { if (v !== 0) path.push({ x: nodes[v].x, z: nodes[v].z }); }
  return path.reverse();
}

/** 道すじの途中が、障害物の中(広げない足あとの中)に、入っていないか(試験用)。入っている点の数を返す。 */
export function countInside(from, path, obstacles, step = 0.05) {
  let bad = 0, p = from;
  for (const q of path) {
    const len = Math.hypot(q.x - p.x, q.z - p.z), k = Math.max(1, Math.ceil(len / step));
    for (let i = 0; i <= k; i++) { const m = { x: p.x + ((q.x - p.x) * i) / k, z: p.z + ((q.z - p.z) * i) / k }; for (const o of obstacles) { const [u, v] = toLocal({ ...o, ...rotU(o) }, m.x, m.z); if (Math.abs(u) < o.hw - 0.01 && Math.abs(v) < o.hd - 0.01) { bad++; break; } } }
    p = q;
  }
  return bad;
}
