// placement.js (v1.56-H3)
// 地面に物を置くとき、他の物と重ならない「いちばん近い空き位置」を探す。
// three.js・DOMに依存しない純関数(Nodeで決定的に試験できる)。
//
// 重なりの定義: 置く物の円(半径 radius)が、障害物の円(半径 o.radius)・すでに置かれた物の円・
//   追加の禁止領域(水など)に、margin 以上の隙間なく触れていたら「重なっている」。
// 探し方: 狙った位置が空いていればそのまま。重なっていれば、狙った位置を中心に、
//   半径を少しずつ広げた輪(リング)の上を調べ、最初に見つかった空き位置を返す
//   (リングを内側から外側へ調べるので、見つかる位置は「ほぼ最も近い」位置)。
//   同じ半径の輪の中では、狙った点→元の位置の向きに近い角度を先に調べる(押し出される向きが自然)。
//   上限(maxSearch)内に空きが無ければ null(置けない)。

export const PLACEMENT_DEFAULTS = {
  itemRadius: 0.28,   // 置く物の円の半径(m)。持ち物の大きさに近い
  margin: 0.06,       // 物と物の間に最低限あける隙間(m)
  ringStep: 0.12,     // リングの間隔(m)
  maxSearch: 4.0,     // どこまで離れた空きを探すか(m)
};

/** 位置(x,z)に半径 r の物を置くと重なるか。重なる相手があれば、その種類を返す('obstacle'|'item'|'blocked')。無ければ null。 */
export function overlapAt(x, z, r, { obstacles = [], placed = [], isBlocked = null, margin = PLACEMENT_DEFAULTS.margin } = {}) {
  if (isBlocked && isBlocked(x, z, r)) return 'blocked';
  for (const o of obstacles) {
    const rr = r + (o.radius || 0) + margin;
    const dx = x - o.x, dz = z - o.z;
    if (dx * dx + dz * dz < rr * rr) return 'obstacle';
  }
  for (const p of placed) {
    const rr = r + (p.radius ?? PLACEMENT_DEFAULTS.itemRadius) + margin;
    const dx = x - p.x, dz = z - p.z;
    if (dx * dx + dz * dz < rr * rr) return 'item';
  }
  return null;
}

/**
 * 狙った位置(x,z)の近くで、重ならない位置を探す。
 * @param {object} p
 * @param {number} p.x @param {number} p.z 狙った位置
 * @param {number} [p.radius] 置く物の半径
 * @param {Array<{x:number,z:number,radius:number}>} [p.obstacles] 通り抜けられない物(木・岩・テント・チェスト・焚き火・倒木の円の列…)
 * @param {Array<{x:number,z:number,radius?:number}>} [p.placed] すでに地面にある物(置かれた物・痕跡など)
 * @param {(x:number,z:number,r:number)=>boolean} [p.isBlocked] 置けない所(水の中・世界の外…)
 * @param {number} [p.pushX] @param {number} [p.pushZ] 押し出す向き(雪だるまの方から見て手前→奥など)。省略可
 * @returns {{x:number,z:number,moved:boolean,distance:number}|null}
 */
export function findFreePlacement(p) {
  const cfg = { ...PLACEMENT_DEFAULTS, ...(p.options || {}) };
  const r = p.radius ?? cfg.itemRadius;
  const ctx = { obstacles: p.obstacles || [], placed: p.placed || [], isBlocked: p.isBlocked || null, margin: cfg.margin };
  if (!overlapAt(p.x, p.z, r, ctx)) return { x: p.x, z: p.z, moved: false, distance: 0 };

  // 押し出す向きの既定: いちばん近い重なり相手の中心から、外へ向かう向き(その相手の外へ出るのが最短)
  let pref = null;
  if (Number.isFinite(p.pushX) && Number.isFinite(p.pushZ) && (p.pushX || p.pushZ)) pref = Math.atan2(p.pushZ, p.pushX);
  else {
    let best = Infinity, bx = 0, bz = 0;
    for (const o of ctx.obstacles.concat(ctx.placed)) {
      const d = Math.hypot(p.x - o.x, p.z - o.z) - (o.radius ?? cfg.itemRadius);
      if (d < best) { best = d; bx = p.x - o.x; bz = p.z - o.z; }
    }
    if (best < Infinity && (bx || bz)) pref = Math.atan2(bz, bx);
  }

  for (let ring = cfg.ringStep; ring <= cfg.maxSearch + 1e-9; ring += cfg.ringStep) {
    const n = Math.max(12, Math.ceil((2 * Math.PI * ring) / 0.1)); // 輪の上の標本は約10cm間隔
    let found = null, foundDelta = Infinity;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI;
      const cx = p.x + Math.cos(a) * ring, cz = p.z + Math.sin(a) * ring;
      if (overlapAt(cx, cz, r, ctx)) continue;
      // 押し出す向きに近い角度を優先(無ければ最初に見つかったもの)
      let delta = 0;
      if (pref !== null) { delta = Math.abs(Math.atan2(Math.sin(a - pref), Math.cos(a - pref))); }
      if (delta < foundDelta) { found = { x: cx, z: cz }; foundDelta = delta; }
    }
    if (found) return { x: found.x, z: found.z, moved: true, distance: Math.hypot(found.x - p.x, found.z - p.z) };
  }
  return null;
}
