// v1.85: 木炭の出る場所の試験。実行: node verify_coal.mjs
import assert from 'node:assert';
import { makeRng } from './js/visual3d/rng.js';
import { pickCoalOutcrops, slopeAt } from './js/visual3d/coal-field.js';
// 擬似の地形: なだらかな起伏 + 川(z=0付近)の両岸に急な崖
const heightAt = (x, z) => 2 * Math.sin(x * 0.05) * Math.cos(z * 0.04) + 3.5 * Math.exp(-Math.pow((Math.abs(z) - 6) / 1.2, 2));
const bankDistanceAt = (x, z) => Math.abs(z) - 4;       // 水際は |z|=4
const isBlocked = (x, z) => Math.abs(z) < 4.3 || Math.hypot(x + 10, z - 20) < 8; // 水の中・キャンプ
const run = (seed) => pickCoalOutcrops({ rng: makeRng(seed), range: 100, heightAt, bankDistanceAt, isBlocked });
const a = run(1), b = run(1), c = run(2);
assert.deepEqual(a, b); console.log('ok 同じシードなら、毎回同じ場所');
assert.notDeepEqual(a.map((o) => [o.x, o.z]), c.map((o) => [o.x, o.z])); console.log('ok シードが違えば、場所も違う');
const total = a.reduce((n, o) => n + o.pieces.length, 0);
assert.equal(a.length, 14); assert.ok(total >= 28 && total <= 56, 'total=' + total); console.log('ok 露頭14か所・炭は計' + total + '個');
for (const o of a) { assert.ok(!isBlocked(o.x, o.z)); assert.ok(o.pieces.length >= 2 && o.pieces.length <= 4); }
for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) assert.ok(Math.hypot(a[i].x - a[j].x, a[i].z - a[j].z) >= 6);
console.log('ok 水・キャンプの上に出ず、露頭どうしは6m以上離れる');
const rng = makeRng(99); let sumRand = 0; for (let i = 0; i < 2000; i++) sumRand += slopeAt(heightAt, (rng() * 2 - 1) * 100, (rng() * 2 - 1) * 100);
const mean = a.reduce((s, o) => s + slopeAt(heightAt, o.x, o.z), 0) / a.length;
assert.ok(mean > (sumRand / 2000) * 2.5, `斜面に偏る mean=${mean.toFixed(3)} rand=${(sumRand / 2000).toFixed(3)}`); console.log('ok 急な斜面や川岸に偏って出る(平均の斜度は、ふつうの地面の' + (mean / (sumRand / 2000)).toFixed(1) + '倍)');
console.log('\nすべて成功');
