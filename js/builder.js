// builder.js (v1.103) — 見守りモードの雪だるまの「ものづくり」のきまり。画面に依存しない(Nodeで試験できる)。
//   ・回収した物を、チェストへ収納する。チェストに空きがない(または、チェストがない)時は、雪だるま自らチェストを作る。
//   ・チェストを作る材料がなければ、地形を探して集める。作ったチェストは、雪だるまが地形に設置する。
//   ・作業台や焚き火も、気まぐれに、材料を集めて、作って、設置する。ただし、すでに地形に設置されているものは、作らない。
//   ・作業台や焚き火を作る時は、まず作業台がいる(ほかの物は、作業台で作る)。作業台がなければ、先に作業台を作る。
import { TENTATIVE, LOG_TO_WOOD, STAR_TO_SHARDS } from './recipes.js';

export const BUILD = {
  whimChance: 0.2,          // 選ぶたびの、気まぐれに作り始める確率(作業台・焚き火)
  cooldownSec: [120, 300],  // 作り終えて、次の気まぐれまで(現実の秒)
  retrySec: 60,             // 失敗した(置く場所がなかった)時の、やり直しまで
  abandonSec: 900,          // 材料が集まらないまま、この秒数たったら、いったんあきらめる
};
const range = (rng, [a, b]) => a + rng() * (b - a);

/** 材料の種類 → 雪だるまが地形で集められる、拾えるものの種類(collectibles.js) */
export const GATHER_KINDS = { log: ['dropped_log'], star: ['star'], stone: ['pebble'], coal: ['coal'], twig: ['twig'] };

/**
 * 目標(table / chest / campfire)に足りない材料。counts = 持ち物の数 { log, wood, star, star_shard, stone, coal }。
 *   チェスト: 木材(丸太1本で10) と 星のかけら(星1個で10) が要る。丸太→木材・星→星のかけらは、作業台で作る。
 */
export function missingFor(goal, counts) {
  const c = (id) => counts[id] || 0, m = {};
  const add = (id, n) => { if (n > 0) m[id] = (m[id] || 0) + n; };
  if (goal === 'table') add('log', TENTATIVE.craftingTableLogs - c('log'));
  else if (goal === 'torch') { // v1.104: 炎の松明(松明の木1本が要る。松明の木・丸太があればよい。なければ小枝3本)
    if (c('torch_wood') < 1 && c('log') < 1) add('twig', 3 - c('twig'));
  } else if (goal === 'chest') {
    const logs = Math.ceil(Math.max(0, TENTATIVE.chestWood - c('wood')) / LOG_TO_WOOD), stars = Math.ceil(Math.max(0, TENTATIVE.chestShards - c('star_shard')) / STAR_TO_SHARDS);
    add('log', logs - c('log')); add('star', stars - c('star'));
  } else if (goal === 'campfire') { add('log', TENTATIVE.campfireLogs - c('log')); add('stone', TENTATIVE.campfireStones - c('stone')); add('coal', TENTATIVE.campfireCoals - c('coal')); }
  return m;
}
/** 足りない材料を集めるために、探す「拾えるものの種類」。 */
export function gatherKindsFor(missing) { const out = []; for (const id of Object.keys(missing)) for (const k of (GATHER_KINDS[id] || [])) if (!out.includes(k)) out.push(k); return out; }

export function createBuilder({ rng = Math.random } = {}) {
  let goal = null, since = 0, cooldownUntil = 0;
  return {
    /**
     * 次の目標を決める(いまの目標があれば、それを続ける)。
     * st = { now, needChest, tableCount, campfireCount }
     *   needChest: 回収した物があるのに、空きのあるチェストがない(収納できない)
     *   needTorch: 夜なのに、炎の松明を持っていない(v1.104。ホームの木で、炎の松明を作って、夜の散歩をする)
     */
    goal(st) {
      if (goal && st.now - since > BUILD.abandonSec) { goal = null; cooldownUntil = st.now + range(rng, BUILD.cooldownSec); } // 集まらない: いったん、あきらめる
      // すでにあるものは、作らない(目標のあいだに、置かれた場合も)
      if (goal === 'table' && st.tableCount > 0 && !st.needChest) goal = null;
      if (goal === 'campfire' && st.campfireCount > 0) goal = null;
      if (goal === 'chest' && !st.needChest) goal = null;
      if (goal === 'torch' && !st.needTorch) goal = null;
      if (!goal) {
        if (st.needChest) { goal = 'chest'; since = st.now; }
        else if (st.needTorch) { goal = 'torch'; since = st.now; }
        else if (st.now >= cooldownUntil && rng() < BUILD.whimChance) {
          const options = []; if (st.tableCount === 0) options.push('table'); if (st.campfireCount === 0) options.push('campfire');
          if (options.length) { goal = options[Math.floor(rng() * options.length)]; since = st.now; }
        }
      }
      if (!goal) return null;
      // チェスト・焚き火は、作業台で作る。作業台がなければ、先に作業台
      if ((goal === 'chest' || goal === 'campfire') && st.tableCount === 0) return 'table';
      return goal;
    },
    done(now) { goal = null; cooldownUntil = now + range(rng, BUILD.cooldownSec); },
    failed(now) { cooldownUntil = now + BUILD.retrySec; },
    current: () => goal,
    cooldownUntil: () => cooldownUntil,
  };
}
