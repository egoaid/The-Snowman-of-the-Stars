// v1.87: 焚き火(レシピ・火のついていない焚き火)の試験。実行: node verify_campfire.mjs
import * as THREE from 'three';
import assert from 'node:assert';
import { getRecipe, recipeInputs } from './js/recipes.js';
import { ITEM_DEFS } from './js/items.js';
import { createCampfire } from './js/visual3d/campfire.js';
const r = getRecipe('campfire');
assert.equal(r.station, 'table');
assert.deepEqual(recipeInputs(r), [{ id: 'log', count: 1 }, { id: 'stone', count: 6 }, { id: 'coal', count: 2 }]);
assert.equal(r.output.id, 'campfire');
assert.equal(ITEM_DEFS.campfire.category, 'placeable');
console.log('ok 焚き火は、作業台で 丸太1 + 小石6 + 木炭2 から作る');
// 元からある焚き火(キャンプ)は、これまでどおり、火がついていて光もある
const camp = createCampfire(1.0);
assert.ok(camp.isLit() && camp.light); let lights = 0; camp.group.traverse((o) => { if (o.isPointLight) lights++; }); assert.equal(lights, 1);
console.log('ok キャンプの焚き火は、従来どおり(火あり・光1つ)');
// 置く焚き火: 消えた状態で、光を持たない(光はランタンなどと枠を分け合う)
const f = createCampfire(1.0, { lit: false, withLight: false });
assert.ok(!f.isLit() && f.light === null); lights = 0; f.group.traverse((o) => { if (o.isPointLight) lights++; }); assert.equal(lights, 0);
const flame = f.group.children.filter((c) => c.isGroup), embers = f.group.children.filter((c) => c.isPoints);
assert.ok(flame.every((g) => !g.visible) && embers.every((e) => !e.visible)); f.update(1.0); // 消えている間は動かない(落ちない)
f.setLit(true); assert.ok(f.isLit() && flame.every((g) => g.visible) && embers.every((e) => e.visible)); f.update(2.0);
f.setLit(false); assert.ok(!f.isLit() && flame.every((g) => !g.visible));
console.log('ok 置く焚き火は、消えた状態で光を持たず、点け消しで炎・燠が出入りする');
console.log('\nすべて成功');
