// collectibles.js (v1.54 E3)
// 世界にある「拾えるかもしれない物」を、種類ごとの個別のAIではなく、データと汎用の仕組みで扱う。
//   ・種類の定義(COLLECTIBLE_KINDS)はデータ。新しい物(カセット・缶・色鉛筆など)は、ここに1件足し、
//     その物を世界から探す「提供元(provider)」を登録するだけで、見守りの雪だるまが見つけて拾えるようになる。
//   ・size:'small' は拾える。size:'large'(大きなレコードプレーヤーなど)は、見たり通り過ぎたりするだけで拾わない。
//   ・選び方は、最寄りを順番に拾うのではなく、優先度の重みつきのくじ。気づかない物・気づいても拾わない物がある。
//   ・世界の全物体を毎フレーム調べない。探すのは、行き先を選ぶ時(数秒に1回以下)だけ。
// このモジュールは three.js に依存しない(Nodeで決定的に試験できる)。

/**
 * priority   : 選ばれやすさの重み(0〜1)。星 > 見慣れない物 > 人の痕跡 > 小枝
 * noticeRadius: この距離(m)以内なら気づく可能性がある(星は光るので遠くからでも)
 * noticeChance: 気づく可能性があるとき、実際に気づく確率(距離が近いほど上がる)
 * investigateSec: 近づいて眺める時間の範囲(秒)
 * collectChance: 眺めたあと、実際に拾う確率(sizeが'large'なら無視して拾わない)
 * itemId     : 拾った時にポーチへ入る持ち物の種類(items.jsにある id)
 */
export const COLLECTIBLE_KINDS = {
  star: { itemId: 'star', size: 'small', priority: 0.95, noticeRadius: 110, noticeChance: 1.0, investigateSec: [1.4, 2.6], collectChance: 1.0 },
  // v1.55 E5: 人の痕跡。星 > 見慣れない物(カセット・おもちゃ) > 小さながらくた(缶・色鉛筆) > 小枝。
  // 大きな物(record_player)は、眺めるだけで拾わない(size:'large' のデータだけで決まる)。
  cassette_tape:   { itemId: 'cassette_tape',   size: 'small', priority: 0.7,  noticeRadius: 16, noticeChance: 0.6,  investigateSec: [1.6, 3.0], collectChance: 0.8 },
  small_toy:       { itemId: 'small_toy',       size: 'small', priority: 0.7,  noticeRadius: 16, noticeChance: 0.6,  investigateSec: [1.8, 3.2], collectChance: 0.75 },
  colored_pencils: { itemId: 'colored_pencils', size: 'small', priority: 0.5,  noticeRadius: 14, noticeChance: 0.5,  investigateSec: [1.2, 2.2], collectChance: 0.7 },
  empty_can:       { itemId: 'empty_can',       size: 'small', priority: 0.5,  noticeRadius: 14, noticeChance: 0.5,  investigateSec: [1.0, 2.0], collectChance: 0.7 },
  jack_o_lantern:  { itemId: 'jack_o_lantern', size: 'small', priority: 0.8, noticeRadius: 30, noticeChance: 0.85, investigateSec: [1.5, 2.8], collectChance: 0.9 }, // 光っているので、遠くからでも気づく
  record_player:   { itemId: null,              size: 'large', priority: 0.55, noticeRadius: 22, noticeChance: 0.7,  investigateSec: [3.0, 5.0], collectChance: 0 },
  // v1.79: 落とし物(小枝・おもちゃ・丸太)と、月の石。気づく距離は35m(月の石は星と同じく、光るので110m)。拾う確率も高め。
  dropped_twig: { itemId: 'twig',      size: 'small', priority: 0.45, noticeRadius: 35, noticeChance: 0.7,  investigateSec: [0.7, 1.4], collectChance: 0.9 },
  dropped_toy:  { itemId: 'small_toy', size: 'small', priority: 0.75, noticeRadius: 35, noticeChance: 0.75, investigateSec: [1.8, 3.2], collectChance: 0.9 },
  dropped_log:  { itemId: 'log',       size: 'small', priority: 0.5,  noticeRadius: 35, noticeChance: 0.7,  investigateSec: [1.0, 2.0], collectChance: 0.9 },
  moon_stone:   { itemId: 'moon_stone', size: 'small', priority: 0.9,  noticeRadius: 110, noticeChance: 1.0, investigateSec: [1.4, 2.6], collectChance: 1.0 },
  twig: { itemId: 'twig', size: 'small', priority: 0.3, noticeRadius: 14, noticeChance: 0.5, investigateSec: [0.7, 1.4], collectChance: 0.7, woodTypes: ['twig', 'small_branch'] },
};

/** 拾える大きさか(データから決まる)。 */
export function isCollectible(kind) { return !!kind && kind.size === 'small' && !!kind.itemId; }

/** 距離に応じた「気づく確率」。noticeRadius の中で、近いほど高い(端で半分)。 */
export function noticeProbability(kind, dist) {
  if (!kind || dist > kind.noticeRadius) return 0;
  const near = 1 - 0.5 * (dist / kind.noticeRadius);
  return Math.min(1, kind.noticeChance * near);
}

/** 選ばれやすさ。優先度が主で、距離は穏やかに効く(遠い物が絶対に選ばれない、という形にはしない)。 */
export function selectionWeight(kind, dist) {
  return kind.priority * (1 / (1 + dist / 30));
}

/**
 * 候補から1つ、重みつきのくじで選ぶ。{candidates:[{kind,dist,...}]} → 選ばれた候補かnull。
 * @param {() => number} rng 0以上1未満
 */
export function chooseCollectTarget(candidates, kinds, rng = Math.random) {
  let total = 0;
  const ws = candidates.map((c) => { const w = selectionWeight(kinds[c.kind], c.dist); total += w; return w; });
  if (!(total > 0)) return null;
  let r = rng() * total;
  for (let i = 0; i < candidates.length; i++) { r -= ws[i]; if (r <= 0) return candidates[i]; }
  return candidates[candidates.length - 1];
}

/**
 * 登録簿。提供元は kind ごとに1つ:
 *   list(x, z, radius) → [{ id, x, z, y?, ref? }]  その kind の物のうち、半径内にあるもの(cheapであること)
 *   take(candidate)    → true/false                世界から取り除く(拾えたらtrue)
 */
export function createCollectibleRegistry({ kinds = COLLECTIBLE_KINDS, rng = Math.random } = {}) {
  const providers = new Map();
  const ignored = new Map(); // `${kind}:${id}` -> 期限(秒)。眺めて拾わなかった物は、しばらく気にしない
  return {
    kinds,
    registerProvider(kindId, provider) {
      if (!kinds[kindId]) throw new Error(`unknown collectible kind: ${kindId}`);
      providers.set(kindId, provider);
    },
    /**
     * 周りで「気づいた」物の一覧を返す(気づかない物は含まれない)。
     * @param {{pouchFull?:boolean, only?:string[], now?:number}} [opts] pouchFull なら、拾えない物は最初から対象にしない
     */
    sense(x, z, opts = {}) {
      const now = opts.now ?? 0;
      const out = [];
      for (const [kindId, p] of providers) {
        if (opts.only && !opts.only.includes(kindId)) continue;
        const kind = kinds[kindId];
        if (opts.pouchFull && isCollectible(kind)) continue;
        for (const it of p.list(x, z, kind.noticeRadius)) {
          const key = `${kindId}:${it.id}`;
          const until = ignored.get(key);
          if (until !== undefined) { if (until > now) continue; ignored.delete(key); }
          const dist = Math.hypot(it.x - x, it.z - z);
          if (rng() >= noticeProbability(kind, dist)) continue; // 気づかない
          out.push({ kind: kindId, id: it.id, x: it.x, z: it.z, y: it.y, ref: it.ref, dist });
        }
      }
      return out;
    },
    choose(cands) { return chooseCollectTarget(cands, kinds, rng); },
    /** 眺めたあとに拾うかを決める。大きな物は拾わない。 */
    decideCollect(cand) {
      const kind = kinds[cand.kind];
      return isCollectible(kind) && rng() < kind.collectChance;
    },
    /** 取り除く。成功したらその物の itemId を返す。 */
    take(cand) {
      const p = providers.get(cand.kind);
      if (!p || !p.take(cand)) return null;
      return kinds[cand.kind].itemId;
    },
    /** その物が、まだ世界にあるか(行ってみたら無かった、を確かめる)。 */
    exists(cand) {
      const p = providers.get(cand.kind);
      return !!p && p.list(cand.x, cand.z, 3).some((it) => it.id === cand.id);
    },
    ignore(cand, untilSec) { ignored.set(`${cand.kind}:${cand.id}`, untilSec); },
    isIgnored(cand, now) { const u = ignored.get(`${cand.kind}:${cand.id}`); return u !== undefined && u > now; },
    kindOf(id) { return kinds[id] || null; },
  };
}
