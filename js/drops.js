// drops.js (v1.79)
// 落とし物: 地形のあちこちに、小枝・おもちゃ・拾えるサイズの丸太が、ときどき落ちてくる。
// このモジュールは three.js に依存しない(Nodeで試験できる)。見た目は visual3d/drop-field.js。
//   ・createDropScheduler: 種類ごとの「次に落ちるまでの時間」と、同時に地上にある数の上限。
//   ・pickDropSpot: 落ちる場所。歩ける範囲の全体から、条件に合う候補を集め、他の落とし物・キャンプから遠い(ばらける)場所を選ぶ。
import { DROPS } from './config.js';

export function createDropScheduler({ rng = Math.random, cfg = DROPS } = {}) {
  const kindIds = Object.keys(cfg.kinds);
  const countdown = {};
  const interval = (k, first) => {
    const c = cfg.kinds[k];
    if (first) return c.intervalSec * (c.firstDelayFactor[0] + rng() * (c.firstDelayFactor[1] - c.firstDelayFactor[0]));
    return c.intervalSec * (1 + c.jitter * (rng() * 2 - 1));
  };
  for (const k of kindIds) countdown[k] = interval(k, true);
  return {
    /**
     * 時間を進める。落とす種類のキーの配列を返す(同時に地上にある数 counts[k] が上限なら、少し後で再挑戦)。
     * @param {number} dt 秒  @param {boolean} night  @param {Record<string,number>} counts 種類ごとの、いま地上にある数
     */
    update(dt, night, counts = {}) {
      const out = [];
      for (const k of kindIds) {
        const c = cfg.kinds[k];
        if (c.nightOnly && !night) continue;
        countdown[k] -= dt;
        if (countdown[k] > 0) continue;
        if ((counts[k] || 0) >= c.max) { countdown[k] = 20; continue; }
        out.push(k);
        countdown[k] = interval(k, false);
      }
      return out;
    },
    countdown: (k) => countdown[k],
    setCountdown(k, sec) { countdown[k] = sec; },
  };
}

/**
 * 落ちる場所を選ぶ。{x,z} か、条件に合う場所が無ければ null。
 * @param {object} d
 *   rng, playableRadius, home{x,z}, camp{x,z}, player{x,z}, others[{x,z}],
 *   obstacles[{x,z,radius}], riverInfo(x,z)→{distance,width}, waterEdge(width), heightAt(x,z), climbBump(x,z)
 */
export function pickDropSpot(d) {
  const S = d.spot || DROPS.spot;
  const rng = d.rng || Math.random;
  const R = d.playableRadius - S.edgeMargin;
  const others = d.others || [];
  const cands = [];
  for (let i = 0; i < S.attempts && cands.length < S.candidates; i++) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * R;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (d.home && Math.hypot(x - d.home.x, z - d.home.z) > S.maxFromHome) continue;
    if (d.camp && Math.hypot(x - d.camp.x, z - d.camp.z) < S.campClear) continue;
    if (d.player && Math.hypot(x - d.player.x, z - d.player.z) < S.playerClear) continue;
    if (others.some((o) => Math.hypot(x - o.x, z - o.z) < S.otherClear)) continue;
    if (d.obstacles && d.obstacles.some((o) => Math.hypot(x - o.x, z - o.z) < o.radius + S.obstacleMargin)) continue;
    if (d.riverInfo) { const rv = d.riverInfo(x, z); if (rv.distance < d.waterEdge(rv.width) + S.waterMargin) continue; }
    if (d.heightAt) {
      const h = d.heightAt(x, z);
      if (Math.abs(d.heightAt(x + 1.2, z) - h) > S.maxSlope || Math.abs(d.heightAt(x, z + 1.2) - h) > S.maxSlope) continue;
    }
    if (d.climbBump && d.climbBump(x, z) > 0.12) continue;
    cands.push({ x, z });
  }
  if (!cands.length) return null;
  // ばらける場所: 他の落とし物から遠く、キャンプからも遠い所を選ぶ(少しだけ運も入れる)
  let best = null, bs = -1;
  for (const c of cands) {
    let m = 40;
    for (const o of others) m = Math.min(m, Math.hypot(c.x - o.x, c.z - o.z));
    const fromCamp = d.camp ? Math.min(40, Math.hypot(c.x - d.camp.x, c.z - d.camp.z)) : 0;
    const score = m + fromCamp * 0.25 + rng() * 5;
    if (score > bs) { bs = score; best = c; }
  }
  return { x: best.x, z: best.z };
}
