// verify_drops.mjs (v1.79): 落とし物の間隔・上限・場所選びを、画面なしで検証する
import { createDropScheduler, pickDropSpot } from './js/drops.js';
import { DROPS } from './js/config.js';
import { COLLECTIBLE_KINDS, isCollectible } from './js/collectibles.js';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('NG', m); } else console.log('ok', m); };
let seed = 2024; const rng = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

// 1) 間隔: 1時間に、種類ごとに、設定どおりの回数(上限が無い時)
{
  const sch = createDropScheduler({ rng });
  const n = { twig: 0, toy: 0, log: 0 };
  for (let i = 0; i < 3600 * 10; i++) for (const k of sch.update(0.1, false, {})) n[k]++;
  console.log('1時間の回数', JSON.stringify(n));
  ok(n.twig >= 36 && n.twig <= 44, '小枝は約90秒に1回(1時間に約40回)');
  ok(n.log >= 17 && n.log <= 23, '丸太は約3分に1回(1時間に約20回)');
  ok(n.toy >= 12 && n.toy <= 18, 'おもちゃは約4分に1回(1時間に約15回)');
}
// 2) 上限: 地上にある数が上限なら、落とさない
{
  const sch = createDropScheduler({ rng, cfg: { ...DROPS, kinds: { twig: { ...DROPS.kinds.twig, intervalSec: 1, firstDelayFactor: [0, 0] } } } });
  let spawned = 0; const counts = { twig: DROPS.kinds.twig.max };
  for (let i = 0; i < 600; i++) spawned += sch.update(0.1, false, counts).length;
  ok(spawned === 0, '上限(6個)に達している間は、落とさない');
  counts.twig = DROPS.kinds.twig.max - 1; let after = 0;
  for (let i = 0; i < 600; i++) after += sch.update(0.1, false, counts).length;
  ok(after > 0, '1個減ったら、また落とす');
}
// 3) 場所: 条件を守る
const world = {
  rng, playableRadius: 57.6, home: { x: -5, z: 5 }, camp: { x: 0, z: 0 }, player: { x: 20, z: 20 },
  obstacles: [{ x: 10, z: 10, radius: 2 }, { x: -20, z: 15, radius: 3 }],
  riverInfo: (x, z) => ({ distance: Math.abs(x - 30), width: 4 }), waterEdge: (w) => w / 2,
  heightAt: (x, z) => 0.05 * x + (x > 40 ? 3 : 0), climbBump: () => 0,
};
{
  const S = DROPS.spot; let bad = 0, nulls = 0; const others = [];
  for (let i = 0; i < 200; i++) {
    const p = pickDropSpot({ ...world, others });
    if (!p) { nulls++; continue; }
    if (Math.hypot(p.x, p.z) > 57.6 - S.edgeMargin + 1e-6) bad++;
    if (Math.hypot(p.x - world.home.x, p.z - world.home.z) > S.maxFromHome + 1e-6) bad++;
    if (Math.hypot(p.x - world.camp.x, p.z - world.camp.z) < S.campClear) bad++;
    if (Math.hypot(p.x - world.player.x, p.z - world.player.z) < S.playerClear) bad++;
    if (world.obstacles.some((o) => Math.hypot(p.x - o.x, p.z - o.z) < o.radius + S.obstacleMargin)) bad++;
    if (Math.abs(p.x - 30) < 2 + S.waterMargin) bad++;
    if (others.some((o) => Math.hypot(p.x - o.x, p.z - o.z) < S.otherClear)) bad++;
    others.push(p); if (others.length > 8) others.shift();
  }
  ok(bad === 0, '落ちる場所が、全部の条件(縁・ホーム・キャンプ・自分・岩・水際・他の落とし物)を守る(違反 ' + bad + ')');
  ok(nulls < 20, '場所が見つからないことは、まれ(' + nulls + '/200)');
}
// 4) ばらける: 20個落とした時、全体に広がる(近い所に偏らない)
{
  const placed = []; for (let i = 0; i < 20; i++) { const p = pickDropSpot({ ...world, others: placed.slice(-8) }); if (p) placed.push(p); }
  const quad = [0, 0, 0, 0]; for (const p of placed) quad[(p.x >= 0 ? 1 : 0) + (p.z >= 0 ? 2 : 0)]++;
  const dist = placed.map((p) => Math.hypot(p.x - world.camp.x, p.z - world.camp.z));
  console.log('象限の数', quad.join(','), ' キャンプからの距離 最小', Math.min(...dist).toFixed(0), '最大', Math.max(...dist).toFixed(0));
  ok(quad.filter((q) => q > 0).length >= 3, '4つの方角のうち、3つ以上に落ちる(偏らない)');
  ok(Math.max(...dist) > 30, 'キャンプから30m以上離れた場所にも落ちる');
}
// 5) 拾い物の種類
for (const k of ['dropped_twig', 'dropped_toy', 'dropped_log', 'moon_stone']) ok(isCollectible(COLLECTIBLE_KINDS[k]), k + ' は、拾える(雪だるまが拾う)');
ok(COLLECTIBLE_KINDS.dropped_twig.noticeRadius === 35 && COLLECTIBLE_KINDS.moon_stone.noticeRadius === 110, '気づく距離: 落とし物35m・月の石110m');
console.log(fails ? `\n失敗 ${fails}` : '\nすべて成功'); process.exit(fails ? 1 : 0);
