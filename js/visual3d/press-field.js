// press-field.js (v1.81)
// 作業台・チェストの下で草が踏み潰される「つぶれ領域」の管理。three.js に依存しない(Nodeで試験できる)。
//   ・置いている間は、潰れ具合(amount)=1 のまま。
//   ・拾う(release)と、その場の潰れ具合が restoreSec 秒(既定10秒)かけて 1→0 へ下がる(草がゆっくり立ち上がる)。
//   ・領域の数には上限(max)がある。一杯の時は、立ち上がり中のいちばん古いものを先に消す。
//     それでも足りなければ、置いてあるもののうち、いちばん古いものを諦める(その下の草だけ立つ)。
export function createPressField({ max = 24, restoreSec = 10 } = {}) {
  let seq = 0;
  const zones = []; // { id, x, z, radius, held, t0 }
  let dirty = true;

  function evictOne() {
    let idx = -1;
    for (let i = 0; i < zones.length; i++) if (!zones[i].held) { idx = i; break; }
    if (idx < 0) idx = 0;
    zones.splice(idx, 1);
  }
  return {
    max, restoreSec,
    /** 領域を足す。戻り値のidは release/remove に使う。 */
    add(x, z, radius) {
      if (zones.length >= max) evictOne();
      const id = ++seq;
      zones.push({ id, x, z, radius, held: true, t0: 0 });
      dirty = true;
      return id;
    },
    /** 作業台などを拾った: now(秒)から restoreSec 秒かけて草が立ち上がる。 */
    release(id, now) {
      const z = zones.find((q) => q.id === id);
      if (!z || !z.held) return;
      z.held = false; z.t0 = now; dirty = true;
    },
    /** すぐに消す(立ち上がりなし)。 */
    remove(id) {
      const i = zones.findIndex((q) => q.id === id);
      if (i >= 0) { zones.splice(i, 1); dirty = true; }
    },
    /** 時間を進める。見た目が変わった(再描画が要る)なら true。 */
    update(now) {
      let changed = dirty; dirty = false;
      for (let i = zones.length - 1; i >= 0; i--) {
        const z = zones[i];
        if (z.held) continue;
        changed = true; // 立ち上がり中は毎フレーム変わる
        if (now - z.t0 >= restoreSec) zones.splice(i, 1);
      }
      return changed;
    },
    /** シェーダーへ渡す一覧: [{x,z,radius,amount}] (amount は 0〜1。置いている間は1) */
    list(now) {
      return zones.map((z) => ({ x: z.x, z: z.z, radius: z.radius, amount: z.held ? 1 : Math.max(0, 1 - (now - z.t0) / restoreSec) }));
    },
    count: () => zones.length,
  };
}
