// v1.90: 設置面の表示(置けるかどうかの判定)の試験。実行: node verify_placeguide.mjs
import assert from 'node:assert';
import { evaluatePlacement, footprintRise } from './js/placement.js';
const flat = () => 0, slope = (x) => x * 0.5; // 傾き 50%
const base = { radius: 1, heightAt: flat };
assert.deepEqual(evaluatePlacement({ x: 0, z: 0, ...base }), { ok: true, reason: null, rise: 0 });
console.log('ok 何もなければ、置ける(緑)');
assert.equal(evaluatePlacement({ x: 0, z: 0, ...base, isBlocked: () => true }).reason, 'blocked');
assert.equal(evaluatePlacement({ x: 0, z: 0, ...base, obstacles: [{ x: 1.2, z: 0, radius: 0.5 }] }).reason, 'obstacle');
assert.equal(evaluatePlacement({ x: 0, z: 0, ...base, placed: [{ x: 0.9, z: 0.4, radius: 0.5 }] }).reason, 'item');
assert.equal(evaluatePlacement({ x: 0, z: 0, ...base, onFlowers: () => true }).reason, 'flowers');
assert.equal(evaluatePlacement({ x: 0, z: 0, ...base, obstacles: [{ x: 4, z: 0, radius: 0.5 }] }).ok, true, '遠い物には、影響されない');
console.log('ok 水・世界の外 / 木や岩 / 置いた物 / お花畑 の上は、置けない(赤)。理由も分かる');
assert.ok(Math.abs(footprintRise(slope, 0, 0, 1) - 1.0) < 1e-9); // 半径1で、x方向に±1 → 高低差 1.0
assert.equal(evaluatePlacement({ x: 0, z: 0, radius: 1, heightAt: slope, maxRise: 0.6 }).reason, 'steep');
assert.equal(evaluatePlacement({ x: 0, z: 0, radius: 1, heightAt: slope, maxRise: 1.2 }).ok, true);
assert.equal(evaluatePlacement({ x: 0, z: 0, radius: 0.3, heightAt: slope, maxRise: 0.6 }).ok, true, '小さい物なら、同じ斜面でも置ける');
console.log('ok 傾き: 円の中の高低差が maxRise を超えると、置けない。小さい物なら置ける');
// 理由の優先順: 重なり > お花畑 > 傾き
assert.equal(evaluatePlacement({ x: 0, z: 0, radius: 1, heightAt: slope, maxRise: 0.6, onFlowers: () => true, obstacles: [{ x: 1, z: 0, radius: 0.5 }] }).reason, 'obstacle');
assert.equal(evaluatePlacement({ x: 0, z: 0, radius: 1, heightAt: slope, maxRise: 0.6, onFlowers: () => true }).reason, 'flowers');
console.log('\nすべて成功');
