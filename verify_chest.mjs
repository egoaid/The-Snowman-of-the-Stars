// v1.83: 置けるチェスト(レシピ・中身の保存/復元)の試験。実行: node verify_chest.mjs
import assert from 'node:assert';
import { getRecipe, recipeInputs, TENTATIVE } from './js/recipes.js';
import { createChestStorage } from './js/visual3d/chest.js';
const r = getRecipe('chest');
assert.equal(r.station, 'table'); assert.deepEqual(recipeInputs(r), [{ id: 'wood', count: TENTATIVE.chestWood }, { id: 'star_shard', count: TENTATIVE.chestShards }]);
assert.equal(r.output.id, 'chest'); assert.equal(TENTATIVE.chestWood, 8); assert.equal(TENTATIVE.chestShards, 2);
console.log('ok チェストは、作業台で 木材8 + 星のかけら2 から作る');
// 置いたチェストごとに、中身は別々で、保存して戻せる
const a = createChestStorage(), b = createChestStorage();
a.store('wood', 70); a.store('star_shard', 3); b.store('twig', 5);
assert.equal(a.count('wood'), 70); assert.equal(b.count('wood'), 0); assert.equal(a.total(), 73);
const saved = JSON.parse(JSON.stringify(a.serialize()));
const c = createChestStorage(); c.restore(saved);
assert.deepEqual(c.contents(), a.contents()); assert.equal(c.total(), 73);
console.log('ok チェストごとに中身が別で、保存して戻せる(中身がある間は拾えない判定は total()>0)');
const empty = createChestStorage(); assert.equal(empty.total(), 0);
console.log('\nすべて成功');
