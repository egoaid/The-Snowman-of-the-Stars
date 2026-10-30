// v1.81: 長押し(作業台: タップ=画面を開く / 長押し=拾う)と、作業台まわりのレシピの試験。実行: node verify_holdinteract.mjs
import * as THREE from 'three';
import assert from 'node:assert';
import { createInteractionSystem } from './js/visual3d/interaction.js';
import { RECIPES, getRecipe, recipeInputs, TENTATIVE } from './js/recipes.js';

let n = 0; const ok = (m) => console.log('ok ' + m);
const eye = { x: 0, y: 1.2, z: 0 }, fwd = { x: 0, y: 0, z: 1 };
function setup() {
  const log = { tap: 0, hold: 0, plain: 0 };
  const sys = createInteractionSystem({ THREE });
  const table = sys.register({ kind: 'placed', getPosition: () => ({ x: 0, y: 1.2, z: 1.5 }), radius: 0.7,
    onInteract: () => { log.tap++; }, onHold: () => { log.hold++; }, holdSec: 0.6 });
  return { sys, log, table };
}
{ const { sys, log } = setup(); sys.update(eye, fwd, 0);
  assert.ok(sys.press(1000)); sys.update(eye, fwd, 1100); assert.equal(log.hold, 0);
  sys.release(); assert.equal(log.tap, 1); assert.equal(log.hold, 0); ok('短く押して離す → タップ(画面を開く)だけ'); }
{ const { sys, log } = setup(); sys.update(eye, fwd, 0);
  sys.press(1000); sys.update(eye, fwd, 1300); assert.ok(Math.abs(sys.holdProgress(1300) - 0.5) < 1e-9, '半分');
  sys.update(eye, fwd, 1650); assert.equal(log.hold, 1); assert.equal(sys.holdProgress(1700), 0);
  sys.update(eye, fwd, 2500); assert.equal(log.hold, 1, '1度だけ');
  sys.release(); assert.equal(log.tap, 0); ok('0.6秒以上の長押し → 拾うだけ(離してもタップにならない)'); }
{ const { sys, log } = setup(); sys.update(eye, fwd, 0);
  sys.press(1000); sys.update(eye, { x: 1, y: 0, z: 0 }, 1200); // 目を離した
  sys.update(eye, fwd, 1800); assert.equal(log.hold, 0); sys.release(); assert.equal(log.tap, 0); ok('長押し中に目を離すと、取り消し'); }
{ const sys = createInteractionSystem({ THREE }); let c = 0;
  sys.register({ kind: 'x', getPosition: () => ({ x: 0, y: 1.2, z: 1.5 }), radius: 0.7, onInteract: () => { c++; } });
  sys.update(eye, fwd, 0); sys.press(0); assert.equal(c, 1); sys.release(); assert.equal(c, 1); ok('長押しのない対象は、押した瞬間に従来どおり反応'); }
// レシピ
const tbl = getRecipe('crafting_table');
assert.equal(tbl.station, 'inventory'); assert.deepEqual(recipeInputs(tbl), [{ id: 'log', count: TENTATIVE.craftingTableLogs }]); ok('作業台は、持ち物の画面で丸太から作る');
for (const id of ['log_to_wood', 'star_to_shards', 'moon_to_shards']) assert.equal(getRecipe(id).station, 'table');
ok('丸太→木材・星→かけら・月の石→かけらは、作業台で作る');
console.log('\nすべて成功');
