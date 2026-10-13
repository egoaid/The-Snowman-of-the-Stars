// remnants.js (v1.55 E5)
// 「人の痕跡」: 森に長いあいだ落ちたままの、人の作った物。何なのかは説明しない。
//   ・種類は REMNANT_DEFS のデータ。新しい物は、ここに1件(と見た目の作り方)を足すだけ。
//   ・小さい物は拾える(size:'small')。大きな物は眺めるだけ(size:'large'。拾う拾わないはcollectibles.jsのデータで決まる)。
//   ・置き場所は、世界のシードから決める(同じ世界なら、毎回同じ場所に落ちている)。
// このモジュールは three.js に依存しない(Nodeで決定的に試験できる)。

/**
 * kind     : collectibles.js の COLLECTIBLE_KINDS のキー
 * count    : 世界に置く数
 * habitat  : どこに落ちているか — 'riverbank'(川岸の少し上) / 'trees'(木の根元の近く) / 'open'(開けた所) / 'any'
 * buried   : 土や雪に埋もれる割合の範囲(0=全部見える, 0.6=6割が埋まって、端だけが見える)
 * tilt     : 傾きの最大(rad)。長く放置されて、斜めに刺さっている
 * size     : 見た目のだいたいの大きさ(m)。縮尺の目安
 */
export const REMNANT_DEFS = {
  // v1.56: 小さすぎて見つからないので、約2.4倍の大きさに(縮尺は実物より大きめ。見つけやすさを優先)。埋まる割合も少し下げた。
  cassette_tape:   { kind: 'cassette_tape',   count: 3, habitat: 'any',       buried: [0.25, 0.5],  tilt: 0.7, size: 0.27 },
  empty_can:       { kind: 'empty_can',       count: 5, habitat: 'riverbank', buried: [0.15, 0.4],  tilt: 1.3, size: 0.3 },
  colored_pencils: { kind: 'colored_pencils', count: 2, habitat: 'trees',     buried: [0.2, 0.45],  tilt: 0.5, size: 0.42 },
  small_toy:       { kind: 'small_toy',       count: 2, habitat: 'any',       buried: [0.2, 0.5],   tilt: 0.6, size: 0.45 },
  record_player:   { kind: 'record_player',   count: 1, habitat: 'open',      buried: [0.1, 0.25],  tilt: 0.12, size: 1.5 },
  // v1.56: ハロウィンのジャック・オー・ランタン。10/20〜11/1のあいだだけ地表に現れる(season)。光っている。
  jack_o_lantern:  { kind: 'jack_o_lantern',  count: 5, habitat: 'any',       buried: [0.05, 0.2],  tilt: 0.25, size: 0.675, /* v1.56-H6: 雪だるまの頭と同じ大きさ(半径0.36m)。以前は0.4(半径約0.21m) */ season: { from: [10, 20], to: [11, 1] }, glow: true },
};

/** その定義が、いま(date)地表に現れる時期か。season が無ければいつでも。 */
export function isInSeason(def, date = new Date()) {
  if (!def.season) return true;
  const md = (date.getMonth() + 1) * 100 + date.getDate();
  const a = def.season.from[0] * 100 + def.season.from[1], b = def.season.to[0] * 100 + def.season.to[1];
  return a <= b ? (md >= a && md <= b) : (md >= a || md <= b);
}

/** 決定的な乱数(同じシードなら同じ列)。 */
export function seededRng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * 置き場所を決める。
 * @param {object} o
 * @param {number} o.seed 世界のシード
 * @param {number} o.radius 置いてよい範囲(中心から)
 * @param {(x:number,z:number)=>boolean} o.isFree 水・急斜面・障害物・キャンプの近くなどを除いた、置いてよい場所か
 * @param {(x:number,z:number)=>number} o.riverDistance 川の水際からの距離(m)
 * @param {Array<{x:number,z:number}>} o.trees 木の位置
 * @param {object} [o.defs]
 * @param {number} [o.minSpacing] 痕跡どうしの最小間隔(m)
 * @returns {Array<{id:string, defId:string, kind:string, x:number, z:number, buried:number, tilt:number, yaw:number, seed:number}>}
 */
export function planRemnants({ seed, radius, isFree, riverDistance, trees = [], defs = REMNANT_DEFS, minSpacing = 8, date = new Date(), forceSeason = false }) {
  const rng = seededRng(seed ^ 0x5EED);
  const out = [];
  const ok = (x, z, def) => {
    if (!isFree(x, z)) return false;
    for (const p of out) if (Math.hypot(p.x - x, p.z - z) < minSpacing) return false;
    if (def.habitat === 'riverbank') { const d = riverDistance(x, z); return d >= 1.2 && d <= 9; }
    if (def.habitat === 'trees') return trees.some((t) => { const d = Math.hypot(t.x - x, t.z - z); return d >= 0.9 && d <= 3.4; });
    if (def.habitat === 'open') return !trees.some((t) => Math.hypot(t.x - x, t.z - z) < 5);
    return true;
  };
  for (const [defId, def] of Object.entries(defs)) {
    if (!forceSeason && !isInSeason(def, date)) continue; // 時期外の物(ジャック・オー・ランタンなど)は、地表に現れない
    for (let n = 0; n < def.count; n++) {
      let placed = null;
      for (let tries = 0; tries < 400 && !placed; tries++) {
        let x, z;
        if (def.habitat === 'trees' && trees.length) { // 木の根元の近くから探す
          const t = trees[Math.floor(rng() * trees.length)]; const a = rng() * Math.PI * 2, r = 1.2 + rng() * 1.8;
          x = t.x + Math.cos(a) * r; z = t.z + Math.sin(a) * r;
        } else { const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * radius; x = Math.cos(a) * r; z = Math.sin(a) * r; }
        if (ok(x, z, def)) placed = { x, z };
      }
      if (!placed) continue; // 場所が見つからなければ、その1つは置かない
      const b = def.buried;
      out.push({
        id: `remnant-${defId}-${n}`, defId, kind: def.kind, x: placed.x, z: placed.z,
        buried: b[0] + rng() * (b[1] - b[0]), tilt: (rng() * 2 - 1) * def.tilt, yaw: rng() * Math.PI * 2, seed: Math.floor(rng() * 1e9),
      });
    }
  }
  return out;
}
