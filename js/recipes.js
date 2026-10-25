// recipes.js
// クラフトのレシピ(データ + 実行)。あまり作業ゲームにはしたくないので、レシピは少なく、
// 入力は1種類・出力は1種類という素直な形に絞っている。クラフトの画面(インベントリ内のクラフト)は
// まだ無い。ここではレシピと、全か無かで実行する関数だけを用意する。
//
// 流れ:  倒木(丸太) →[インベントリのクラフト]→ 木材×10 →[クラフト]→ 作業台 / チェスト
//        流れ星の「星」 →[クラフト]→ 星のかけら×10
//        (おもちゃ作りなどは、今後 作業台で。星のかけらが必要)
// 倒木は、丸太に変えずにそのまま置いて使うこともできる(橋・立てかけ。物理フェーズ)。
//
// 注意: 作業台・チェストに必要な木材の数は、ユーザー指定がまだ無いため暫定値(TENTATIVE)。

import { isKnownItem } from './items.js';
import { t } from './i18n.js';

export const LOG_TO_WOOD = 10;        // 倒木(丸太)1個 → 木材10個(ユーザー指定)
export const STAR_TO_SHARDS = 10;     // 星1個 → 星のかけら10個(ユーザー指定)
export const MOON_TO_SHARDS = 10;     // 月の石1個 → 月のかけら10個(v1.69。個数のユーザー指定はまだ無いので、星と同じ暫定値)
export const TENTATIVE = { craftingTableWood: 4, chestWood: 8 }; // 暫定値

export const RECIPES = [
  { id: 'moon_to_shards',  station: 'inventory', input: { id: 'moon_stone', count: 1 }, output: { id: 'moon_shard', count: MOON_TO_SHARDS }, tentative: true },
  { id: 'log_to_wood',      station: 'inventory', input: { id: 'log', count: 1 },   output: { id: 'wood', count: LOG_TO_WOOD } },
  { id: 'star_to_shards',   station: 'inventory', input: { id: 'star', count: 1 },  output: { id: 'star_shard', count: STAR_TO_SHARDS } },
  { id: 'crafting_table',   station: 'inventory', input: { id: 'wood', count: TENTATIVE.craftingTableWood }, output: { id: 'crafting_table', count: 1 }, tentative: true },
  { id: 'chest',            station: 'inventory', input: { id: 'wood', count: TENTATIVE.chestWood },         output: { id: 'chest', count: 1 }, tentative: true },
  // v1.74: 星の松明(材料が2種類のレシピ。inputs)。端材(カット機能は保留中)ができたら、枝の代わりに使えるようにする。
  { id: 'star_torch',       station: 'inventory', inputs: [{ id: 'twig', count: 1 }, { id: 'star_shard', count: 1 }], output: { id: 'star_torch', count: 1 } },
];
/** レシピの材料の一覧(1種類のレシピは input、複数は inputs)。 */
export function recipeInputs(r) { return r.inputs || [r.input]; }
// v1.72: レシピ名は、言語に合わせて辞書(recipe.<id>)から引く
for (const r of RECIPES) Object.defineProperty(r, 'name', { get: () => t(`recipe.${r.id}`), enumerable: true, configurable: true });

export function getRecipe(id) { return RECIPES.find((r) => r.id === id) || null; }

/** そのレシピを、いまのインベントリで作れるか(材料があり、出力が入る)。実際には作らない。 */
export function canCraft(inventory, recipeId) {
  const r = getRecipe(recipeId);
  if (!r) return false;
  return recipeInputs(r).every((i) => inventory.count(i.id) >= i.count);
}

/** レシピを実行する。全か無か(材料が足りない/出力が入らなければ何も変えずfalse)。 */
export function craft(inventory, recipeId) {
  const r = getRecipe(recipeId);
  if (!r || !isKnownItem(r.output.id) || !recipeInputs(r).every((i) => isKnownItem(i.id))) return false;
  if (r.inputs) return inventory.convertMany(r.inputs, r.output.id, r.output.count);
  return inventory.convert(r.input.id, r.input.count, r.output.id, r.output.count);
}
