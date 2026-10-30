// v1.88: 置いた焚き火の着火・消火・雨のきまりの試験。実行: node verify_fire.mjs
import assert from 'node:assert';
import { fireAction, nextWet, pickWetLimit, FIRE_RAIN_MIN, FIRE_WET_LIMIT } from './js/fire-rules.js';
// 着火
assert.equal(fireAction({ lit: false, selected: 'star_torch', rain: 0 }), 'ignite');
assert.equal(fireAction({ lit: false, selected: null, rain: 0 }), 'need-torch');
assert.equal(fireAction({ lit: false, selected: 'wood', rain: 0 }), 'need-torch');
assert.equal(fireAction({ lit: false, selected: 'star_torch', rain: 0.6 }), 'rain');
assert.equal(fireAction({ lit: false, selected: 'star_torch', rain: FIRE_RAIN_MIN - 0.01 }), 'ignite');
console.log('ok 着火: 星の松明を持ってクリック。持っていない・雨の中では、つかない');
// 消火
assert.equal(fireAction({ lit: true, selected: null, rain: 0 }), 'extinguish');
assert.equal(fireAction({ lit: true, selected: 'star_torch', rain: 0 }), 'need-empty-hand');
console.log('ok 消火: 手に何も持たずにクリック');
// 雨
let wet = 0; for (let i = 0; i < 60; i++) wet = nextWet(wet, 1, 0.95); assert.ok(wet > FIRE_WET_LIMIT[1] * 0.9);
let w2 = 0; for (let i = 0; i < 20; i++) w2 = nextWet(w2, 1, 0.6); assert.ok(w2 >= 11.9 && w2 <= 12.1);
let dry = 30; for (let i = 0; i < 100; i++) dry = nextWet(dry, 1, 0); assert.equal(dry, 0);
let cl = 5; for (let i = 0; i < 10; i++) cl = nextWet(cl, 1, 0.3); assert.ok(cl < 5, '弱い雨(0.4未満)では、湿らない');
console.log('ok 雨: 強い雨が続くと湿っていき、止めば乾く。弱い雨では湿らない');
for (let i = 0; i < 500; i++) { const l = pickWetLimit(); assert.ok(l >= 25 && l <= 60); }
const stormTime = FIRE_WET_LIMIT[0] / 0.95, rainTime = FIRE_WET_LIMIT[1] / 0.6;
console.log(`ok 消えるまで: 台風・雷雨(降り方0.95)なら最短${stormTime.toFixed(0)}秒、雨(0.6)でも最長${rainTime.toFixed(0)}秒`);
console.log('\nすべて成功');
