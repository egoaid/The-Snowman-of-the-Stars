// wander-watchdog.js (v1.56-H5)
// 見守りモードの雪だるまが、丸太などの前で行ったり来たりして、何時間も抜け出せなくなるのを防ぐ「安全網」。
// three.js・DOMに依存しない純関数/小さな状態機械(Nodeで決定的に試験できる)。
//
// 【なぜ必要か】既存の閉じ込め検知(E2c)は「12秒間、2m以内」の時だけ反応する。行き来が2mを超える動きや、
//   ジャンプ・引き上げを試して戻るループ(見張りが毎回リセットされる)では反応せず、同じ動きが続いてしまった。
//
// 【考え方】歩き方ではなく「進捗」で見る。進捗=目的地に着いた/丸太を渡り終えた/拾い物・チェストの動作を終えた。
//   次のどちらかが続いたら、行き詰まりとみなして、段階的に強い手を打つ:
//     A. 歩いているのに、ごく狭い範囲(spanMax)から出ない状態が、長く続く
//     B. 歩いているのに、目的地へ1度も着かない状態が、長く続く(広い範囲を回り続けるループも捕まえる)
//   段階: 1=脱出(別の向きへ歩く) 2=乗り越え(丸太をよじ登る。無ければ強い脱出) 3=最後の保証(大きなジャンプで安全な地面へ)
//   休んでいる間・動作の最中は数えない(動かなくて当たり前の時間)。進捗があれば全てリセット。

export const WATCHDOG_DEFAULTS = {
  windowSec: 90,        // A: この秒数の間の居た範囲を見る
  spanMax: 10,          // A: その範囲(外接する四角の対角線、m)がこれ未満なら「狭い範囲から出ていない」
  levelAtSpan: [90, 150, 300],   // A: 狭い範囲に居続けた秒数が、これを超えたら 段階1/2/3
  levelAtNoArrival: [240, 360, 480], // B: 歩き続けて1度も着かない秒数が、これを超えたら 段階1/2/3
  sampleSec: 1.0,       // 位置を記録する間隔
};

/**
 * 進捗の見張り役。
 *  tick(dt, {x, z, walking}) → 新しく段階に達したら、その段階(1|2|3)。無ければ 0。
 *  markProgress() → 進捗があった(全てリセット)。
 * 同じ段階は、進捗があるまで(または範囲から出るまで)1回しか返さない。
 */
export function createStagnationWatchdog(opts = {}) {
  const cfg = { ...WATCHDOG_DEFAULTS, ...opts };
  const st = { samples: [], timer: 0, spanSec: 0, noArrivalSec: 0, firedA: 0, firedB: 0, total: [0, 0, 0, 0] };
  function reset() { st.samples.length = 0; st.timer = 0; st.spanSec = 0; st.noArrivalSec = 0; st.firedA = 0; st.firedB = 0; }
  function spanOfSamples() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < st.samples.length; i += 2) {
      const x = st.samples[i], z = st.samples[i + 1];
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    return Math.hypot(maxX - minX, maxZ - minZ);
  }
  function levelFor(sec, table) { let l = 0; for (let i = 0; i < table.length; i++) if (sec >= table[i]) l = i + 1; return l; }
  return {
    cfg,
    markProgress() { reset(); },
    /** 休み・動作の最中など、数えない時間に呼ぶ(記録だけ切る。進捗扱いにはしない=休んでも、行き詰まりの累計は消えない)。 */
    pause() { st.timer = 0; },
    tick(dt, { x, z, walking }) {
      if (!walking) return 0;
      st.noArrivalSec += dt;
      st.timer += dt;
      let fire = 0;
      if (st.timer >= cfg.sampleSec) {
        st.timer = 0;
        st.samples.push(x, z);
        const maxN = Math.round(cfg.windowSec / cfg.sampleSec);
        while (st.samples.length > maxN * 2) st.samples.splice(0, 2);
        if (st.samples.length >= maxN * 2) {
          if (spanOfSamples() < cfg.spanMax) st.spanSec += cfg.sampleSec;
          else { st.spanSec = 0; st.firedA = 0; } // 範囲から出た: Aはやり直し
        }
      }
      const la = levelFor(st.spanSec + (st.spanSec > 0 ? cfg.windowSec : 0), cfg.levelAtSpan); // 範囲に居続けた時間 = 窓の長さ + それ以降
      const lb = levelFor(st.noArrivalSec, cfg.levelAtNoArrival);
      // 段階は逆戻りさせない: すでに通知した最大の段階より上に達した時だけ知らせる(AとBが別々に数えていても、同じ手を2度打たない)
      const done = Math.max(st.firedA, st.firedB);
      if (la > st.firedA) { st.firedA = la; if (la > done) fire = Math.max(fire, la); }
      if (lb > st.firedB) { st.firedB = lb; if (lb > done) fire = Math.max(fire, lb); }
      if (fire) st.total[fire]++;
      return fire;
    },
    /** 状態の確認用。 */
    info() { return { spanSec: st.spanSec, noArrivalSec: st.noArrivalSec, firedA: st.firedA, firedB: st.firedB, total: st.total.slice() }; },
  };
}

/**
 * 同じ動きの繰り返しの検出。同じ「場所×向き」で引き返す/失敗することが、一定時間に limit 回起きたら、
 * 「同じことを繰り返している」と答える(その接近を禁止して、別の手を打つ合図)。
 */
export function createRepeatDetector({ limit = 3, windowSec = 300 } = {}) {
  const hist = new Map(); // signature -> [time...]
  return {
    /** 記録して、この一定時間内の回数を返す。 */
    record(sig, now) {
      const arr = (hist.get(sig) || []).filter((t) => now - t <= windowSec);
      arr.push(now); hist.set(sig, arr);
      return arr.length;
    },
    isRepeating(sig, now) { const arr = hist.get(sig); return !!arr && arr.filter((t) => now - t <= windowSec).length >= limit; },
    clear(sig) { if (sig === undefined) hist.clear(); else hist.delete(sig); },
    limit, windowSec,
  };
}

/** 障害物の塊と進む向きから、「場所×向き」の署名を作る。場所は4mのマス目、向きは8方位。 */
export function blockerSignature(x, z, dirX, dirZ, cell = 4) {
  const sector = ((Math.round(Math.atan2(dirZ, dirX) / (Math.PI / 4)) % 8) + 8) % 8;
  return `${Math.round(x / cell)},${Math.round(z / cell)}|${sector}`;
}

/**
 * 最後の保証: 近くの安全な地面を探す(大きなジャンプの着地点)。
 * isValid(x,z) が true の点のうち、いまの位置から minDist 以上離れた、いちばん近い点。
 * 向きは均等に調べ、距離を少しずつ伸ばす(決定的。同じ入力なら同じ結果)。無ければ null。
 */
export function findRescueSpot({ x, z, isValid, minDist = 8, maxDist = 45, step = 2, dirs = 24 }) {
  for (let d = minDist; d <= maxDist + 1e-9; d += step) {
    let best = null;
    for (let i = 0; i < dirs; i++) {
      const a = (i / dirs) * Math.PI * 2;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (!isValid(px, pz)) continue;
      // 同じ距離なら、障害物から遠い(余裕がある)方を好む: isValidが数値(余裕)を返すなら使う
      const room = typeof isValid.room === 'function' ? isValid.room(px, pz) : 0;
      if (!best || room > best.room) best = { x: px, z: pz, room, distance: d };
    }
    if (best) return best;
  }
  return null;
}

/** 放物線のジャンプ。u∈[0,1]。始点・終点の高さと、頂点の高さ(2点を結ぶ線から)を与える。 */
export function hopPoint(from, to, apex, u) {
  const k = Math.max(0, Math.min(1, u));
  return {
    x: from.x + (to.x - from.x) * k,
    z: from.z + (to.z - from.z) * k,
    y: from.y + (to.y - from.y) * k + 4 * apex * k * (1 - k),
  };
}
