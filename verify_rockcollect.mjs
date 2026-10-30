// v1.86: 岩の回収(小石の数・回収できる岩の大きさ)の試験。実行: node verify_rockcollect.mjs
import assert from 'node:assert';
import { pebblesFromRock, ROCK_COLLECT_MAX_SCALE } from './js/recipes.js';
assert.equal(ROCK_COLLECT_MAX_SCALE, 0.5);
// 世界の岩の大きさは 0.25〜0.7(野原)、0.3〜0.7(川辺)。0.5未満=登れる小さな岩だけが、回収できる。
let min = 9, max = 0; for (let s = 0.25; s < ROCK_COLLECT_MAX_SCALE; s += 0.005) { const n = pebblesFromRock(s); min = Math.min(min, n); max = Math.max(max, n); assert.ok(n >= 1 && n <= 3); }
assert.equal(min, 1); assert.equal(max, 3);
assert.ok(pebblesFromRock(0.3) <= pebblesFromRock(0.4) && pebblesFromRock(0.4) <= pebblesFromRock(0.49));
console.log('ok 小さい岩ほど小石が少ない(1〜3個)。大きさが増えても、減らない');
console.log('\nすべて成功');
