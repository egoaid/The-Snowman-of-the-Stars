// verify_activitylog.mjs (v1.80)
import { createActivityLog, SAMPLE_COLUMNS } from './js/visual3d/activity-log.js';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('NG', m); } else console.log('ok', m); };
const L = createActivityLog({ maxSamples: 50, maxEvents: 5, version: 't' });
let calls = 0;
for (let i = 0; i < 1000; i++) L.tick(0.1, () => { calls++; return { x: i, z: -i, act: 'walk', edge: 3.14159, night: i % 2, weather: 'clear' }; });
ok(calls >= 99 && calls <= 101, '1秒ごとに記録する(100秒で約100回): ' + calls);
ok(L.sizes().samples === 50, '軌跡は、上限(50行)で、古いものを捨てる');
L.event('collect', { x: 1.2345, z: 6.789, item: 'twig' });
for (let i = 0; i < 10; i++) L.event('e' + i);
ok(L.sizes().events === 5, '出来事は、上限(5件)で、古いものを捨てる');
const o = L.toObject();
ok(o.columns.join() === SAMPLE_COLUMNS.join() && o.samples[0].length === 7, '列の定義と一致');
const c = L.toCSV(); ok(c.track.split('\n').length === 51 && c.events.split('\n')[0].startsWith('n,t,kind,x,z'), 'CSVの行数・ヘッダ');
const L2 = createActivityLog(); L2.setEnabled(false); L2.tick(5, () => ({})); L2.event('x'); ok(L2.sizes().samples === 0 && L2.sizes().events === 0, '無効の時は、何も記録しない');
const L3 = createActivityLog(); L3.tick(2, () => { throw new Error('x'); }); ok(true, '状態の取得に失敗しても、落ちない');
console.log(fails ? `\n失敗 ${fails}` : '\nすべて成功'); process.exit(fails ? 1 : 0);
