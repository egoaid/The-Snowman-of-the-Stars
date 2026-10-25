// verify_startorch.mjs (v1.74): 星の松明のレシピ・持ち物の動きを、画面なしで検証する
import { createInventory } from './js/inventory.js';
import { getRecipe, canCraft, craft, recipeInputs } from './js/recipes.js';
import { isKnownItem, getItemDef, maxStackOf } from './js/items.js';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('NG', m); } else console.log('ok', m); };

ok(isKnownItem('star_torch') && maxStackOf('star_torch') === 16, 'star_torch が定義されている(最大16個)');
ok(getItemDef('star_torch').category !== 'placeable', 'Qキーで置ける種類(placeableではない)');
const r = getRecipe('star_torch');
ok(r && recipeInputs(r).length === 2 && r.output.id === 'star_torch', 'レシピは、材料2種類→星の松明');
{
  const inv = createInventory();
  ok(!canCraft(inv, 'star_torch'), '材料が無い時は作れない');
  inv.add('twig', 1);
  ok(!canCraft(inv, 'star_torch') && !craft(inv, 'star_torch') && inv.count('twig') === 1, '枝だけでは作れず、何も減らない');
  inv.add('star_shard', 1);
  ok(canCraft(inv, 'star_torch'), '枝1+星のかけら1で作れる');
  ok(craft(inv, 'star_torch') && inv.count('star_torch') === 1 && inv.count('twig') === 0 && inv.count('star_shard') === 0, '作ると、材料が1つずつ減って、松明が1本できる');
}
{
  const inv = createInventory({ mainSlots: 1, hotbarSlots: 1 });
  inv.add('stone', 64); inv.add('coal', 64); // 全スロットを埋める…と、材料のスロットが空かない
  const inv2 = createInventory({ mainSlots: 1, hotbarSlots: 1 });
  inv2.add('twig', 1); inv2.add('star_shard', 1); // 2スロットとも材料で埋まる(出力は、材料を減らした後に入る)
  ok(craft(inv2, 'star_torch') && inv2.count('star_torch') === 1, 'スロットが材料だけで埋まっていても、作れる(材料を先に減らすので入る)');
  const inv3 = createInventory({ mainSlots: 1, hotbarSlots: 1 });
  inv3.add('twig', 2); inv3.add('star_shard', 1); // 枝は1個残り、スロットが空かない=出力が入らない
  ok(!craft(inv3, 'star_torch') ? true : inv3.count('star_torch') === 1, '満杯なら、全か無か(失敗なら、材料は元のまま)');
  if (inv3.count('star_torch') === 0) ok(inv3.count('twig') === 2 && inv3.count('star_shard') === 1, '失敗時、材料は元のまま');
}
{
  const inv = createInventory();
  inv.add('log', 1); inv.add('star_shard', 1);
  ok(canCraft(inv, 'log_to_star_torch'), '丸太1+星のかけら1で作れる');
  ok(craft(inv, 'log_to_star_torch') && inv.count('star_torch') === 4 && inv.count('log') === 0 && inv.count('star_shard') === 0, '丸太から作ると、星の松明が4本できる');
}
console.log(fails ? `\n失敗 ${fails}` : '\nすべて成功'); process.exit(fails ? 1 : 0);
