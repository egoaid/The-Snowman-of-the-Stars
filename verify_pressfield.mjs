import { createPressField } from './js/visual3d/press-field.js';
import assert from 'node:assert';
const f = createPressField({ max: 3, restoreSec: 10 });
const a = f.add(1, 2, 0.6);
assert.equal(f.list(0)[0].amount, 1);
f.update(5); assert.equal(f.list(5)[0].amount, 1, '置いている間は1のまま');
f.release(a, 5);
assert.ok(Math.abs(f.list(10)[0].amount - 0.5) < 1e-9, '5秒後は半分');
assert.ok(f.update(10), '立ち上がり中は再描画が必要');
assert.equal(f.list(15)[0].amount, 0);
f.update(15.01); assert.equal(f.count(), 0, '10秒後に領域が消える');
assert.equal(f.update(16), false, '何も無ければ再描画不要');
// 上限: 立ち上がり中のものを先に消す
const h1 = f.add(0,0,1), h2 = f.add(1,0,1), h3 = f.add(2,0,1);
f.release(h2, 20);
f.add(3,0,1);
assert.deepEqual(f.list(20).map(z=>z.x), [0,2,3], '立ち上がり中(h2)が先に消える');
// 置いてあるものだけで満杯: いちばん古いものを諦める
f.add(4,0,1); assert.deepEqual(f.list(20).map(z=>z.x), [2,3,4]);
// 置き直し: 拾った直後に同じ場所へ置くと、また1(ペシャンコ)
console.log('press-field OK');
