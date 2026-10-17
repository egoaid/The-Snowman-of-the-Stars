// river-ends.js (v1.63)
// 川の両端(上流・下流)を「歩行境界の外側で、S字に曲がり、丘の陰へ消える」形に作り替える。
//
// 背景: v1.61/v1.62 は、川の端を隠すために、端の水の上に木を並べていた(川の中に木が立つ不自然な見た目)。
// 方針転換: 歩行できない境界の外側の帯(境界〜地形の端。約30m)の中で、
//   ① 川の中心線を、境界のすぐ外から「川の向きのまま少し進み、境界に沿う向きへ急に曲がる」形にする。
//      曲がったあとの直線は、世界の中心から歩行半径より遠い直線の上に乗る。つまり、その延長線上に
//      歩ける場所が無いので、歩ける場所から川の先を「まっすぐ見通す」ことができない
//      (数値の視線テストで、まっすぐ見通せる配置を作ると、そこから川の先が見えることを確認した)。
//   ② 川の両脇(水路・土手には載せない)に、丘を置く。丘は歩行境界の外側だけ。
//      境界の内側には一切置かないので、登って見下ろすことはできない。
// 中心線の「境界の内側」の部分は、1点も動かさない。
//
// このファイルは three.js に依存しない(Nodeでの検証用にも読める)。

import { makeRng, randRange } from './rng.js';

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// S字の形(正規化)。[外向きの進み u, 横のずれ v]。uは uScale、vは W 倍して使う。
// 最初の区間(0,0)→(5,0)は、元の川の向きにそのまま続く(つなぎ目に折れを作らない)。
export const TUNE = {
  L1: [14, 17],        // 川の向きのまま境界の外へ進む直線の長さ(m)
  R: 6,                // 曲がりの半径(m)
  LW: [22, 28],        // 曲がったあと、接線方向(境界に沿う向き)へ進む長さ(m)
  H: [8, 11], rampK: 1.6, d0: 12, d1: 62, r1: 14,
};

/** 丘の外形パラメータ(境界からの距離で決まる)。 */
export function makeHillProfile(playableRadius, terrainHalf) {
  return {
    r0: playableRadius + 0.5,   // ここから立ち上がる(境界の内側には立ち上げない)
    r1: playableRadius + TUNE.r1,    // 稜線の高さに達する(境界のすぐ外から立ち上げる。そうしないと境界ぎわの低い視点から丘越しに川の先が見える)
    r2: terrainHalf - 12,       // ここから外側へ下がり始める
    r3: terrainHalf - 1,        // 地形メッシュの端の手前で、元の地形の高さへ戻る(外周に崖を作らない)
  };
}

/**
 * 川の向きに沿って L1 だけ進み、半径 R で「境界に沿う向き(接線方向)」へ曲がり、LW だけ進む折れ線(1m間隔)。
 * 曲がったあとの直線は、世界の中心から PLAYABLE_RADIUS より遠い直線の上に乗る。
 * (その直線の延長線上には、歩行できる場所が無いので、そこから川の先を見通すことはできない)
 */
function buildLPath(P0, a, s, L1, R, LW) {
  const pts = [{ x: P0.x, z: P0.z }];
  const step = 1.0;
  let x = P0.x, z = P0.z;
  const walk = (dx, dz, len) => {
    const n = Math.max(1, Math.round(len / step));
    for (let i = 1; i <= n; i++) pts.push({ x: x + dx * len * i / n, z: z + dz * len * i / n });
    x += dx * len; z += dz * len;
  };
  walk(a.x, a.z, L1);
  // 曲がり角での接線方向(中心から見て横向き)。s の符号は呼び出し側が決める。
  const rr = Math.hypot(x, z) || 1;
  let tx = -z / rr * s, tz = x / rr * s;
  // 曲がる角度(a → t)
  const cross = a.x * tz - a.z * tx, dot = a.x * tx + a.z * tz;
  const theta = Math.atan2(cross, dot); // 符号付き
  const arcLen = Math.abs(theta) * R;
  const arcN = Math.max(2, Math.round(arcLen / step));
  // 円弧の中心(進行方向 a に対して、曲がる側へ R だけ)
  const side = theta >= 0 ? 1 : -1;
  const cx = x + (-a.z) * side * R, cz = z + (a.x) * side * R;
  const ang0 = Math.atan2(z - cz, x - cx);
  for (let i = 1; i <= arcN; i++) {
    const ang = ang0 + side * Math.abs(theta) * i / arcN;
    pts.push({ x: cx + Math.cos(ang) * R, z: cz + Math.sin(ang) * R });
  }
  const last = pts[pts.length - 1];
  x = last.x; z = last.z;
  // 曲がり終わった時点の向き(≒ t)で、LW だけ進む
  const hx = Math.cos(ang0 + side * Math.abs(theta) + side * Math.PI / 2), hz = Math.sin(ang0 + side * Math.abs(theta) + side * Math.PI / 2);
  walk(hx, hz, LW);
  return pts;
}

function polyLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return L;
}

function distToPolyline(x, z, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], b = poly[i + 1];
    const abx = b.x - a.x, abz = b.z - a.z;
    const lenSq = abx * abx + abz * abz;
    let t = lenSq > 1e-9 ? ((x - a.x) * abx + (z - a.z) * abz) / lenSq : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (a.x + abx * t), dz = z - (a.z + abz * t);
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
export { distToPolyline };

/**
 * 1つの端のS字を作る。条件(地形の内側に収まる・境界の内側へ戻らない・川の他の部分に近づかない)を
 * 満たす最初の候補を採用する(向き・大きさを順に試す)。
 */
function buildEnd(rng, sampleList, cutIdx, outward, cfg) {
  const P0 = sampleList[cutIdx];
  // 元の川の向き(外向き): カット点と、少し内側の点から求める
  const inner = sampleList[cutIdx + outward.step * 4];
  let ax = P0.x - inner.x, az = P0.z - inner.z;
  const al = Math.hypot(ax, az) || 1;
  const a = { x: ax / al, z: az / al };
  const l = { x: -a.z, z: a.x };
  const sign0 = rng() < 0.5 ? -1 : 1;
  const L1 = randRange(rng, TUNE.L1[0], TUNE.L1[1]);
  const LW = randRange(rng, TUNE.LW[0], TUNE.LW[1]);
  const hMax = randRange(rng, TUNE.H[0], TUNE.H[1]);
  const offX = randRange(rng, 100, 9000), offZ = randRange(rng, 100, 9000);

  const keptFar = outward.keptFar; // 川の別の部分(S字が近づいてはいけない点)
  const limitSq = cfg.terrainHalf - 5;
  const rMax = cfg.terrainHalf - 2;
  const rMin = cfg.playableRadius + 1.5;

  const tries = [];
  for (const k of [1.0, 0.85, 0.7, 0.55, 0.4]) for (const sg of [sign0, -sign0]) tries.push({ k, s: sg });

  let chosen = null;
  for (const t of tries) {
    const pts = buildLPath(P0, a, t.s, L1 * Math.max(0.8, t.k), TUNE.R, LW * t.k);
    let ok = true;
    for (const p of pts) {
      const r = Math.hypot(p.x, p.z);
      if (Math.max(Math.abs(p.x), Math.abs(p.z)) > limitSq || r > rMax || r < rMin) { ok = false; break; }
    }
    if (ok) {
      for (const p of pts) {
        if (distToPolyline(p.x, p.z, keptFar) < 14) { ok = false; break; }
      }
    }
    if (ok) { chosen = { ...t, W: LW * t.k, pts }; break; }
  }
  let fallback = false;
  if (!chosen) {
    // 収まる候補が無い場合の最後の手段: 最小の候補をそのまま使う(検証で警告する)
    const t = { k: 0.4, s: sign0 };
    chosen = { ...t, W: LW * 0.4, pts: buildLPath(P0, a, t.s, L1 * 0.8, TUNE.R, LW * 0.4) };
    fallback = true;
  }
  const ext = chosen.pts; // ext[0] は P0 と同じ点
  let cx = 0, cz = 0;
  for (const p of ext) { cx += p.x; cz += p.z; }
  cx /= ext.length; cz /= ext.length;
  let boundR = 0;
  for (const p of ext) boundR = Math.max(boundR, Math.hypot(p.x - cx, p.z - cz));
  return {
    ext, a, l, side: chosen.s, scale: chosen.k, W: chosen.W, fallback,
    hill: {
      poly: ext, hMax, offX, offZ,
      d0: TUNE.d0, d1: TUNE.d1,              // 川の中心線からこの範囲に丘が広がる(なだらかに消える)
      center: { x: cx, z: cz }, boundR: boundR + TUNE.d1 + 2,
      ramp: hMax * TUNE.rampK,                // 水路・土手のきわから丘へ立ち上がる距離(崖にしない)
    },
  };
}

/**
 * 中心線サンプル(元の川。両端は地形の外まで伸びている)を受け取り、
 * 歩行境界の少し外側で切り、そこから先をS字の延長に置き換える。
 * @param {{x:number,z:number,width:number,t:number}[]} samples
 * @param {{seed:number, playableRadius:number, terrainHalf:number}} cfg
 * @returns {{centerline:object[], info:object}}
 */
export function shapeRiverEnds(samples, cfg) {
  const n = samples.length;
  const rng = makeRng(((cfg.seed ^ 0x6a09e667) >>> 0) || 1);
  const cutRadius = cfg.playableRadius + 3;

  let iu = 0;
  while (iu < n - 1 && Math.hypot(samples[iu].x, samples[iu].z) > cutRadius) iu++;
  let id = n - 1;
  while (id > 0 && Math.hypot(samples[id].x, samples[id].z) > cutRadius) id--;
  if (id - iu < 40) return { centerline: samples, info: null }; // 想定外(川が境界の内側にほとんど無い)。そのままにする

  // 元の弧長(水位・河床の計算で、中央の川を変えないために使う)
  const arcOld = new Array(n);
  arcOld[0] = 0;
  for (let i = 1; i < n; i++) arcOld[i] = arcOld[i - 1] + Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z);

  const kept = samples.slice(iu, id + 1);
  const keptPoly = kept.map((s) => ({ x: s.x, z: s.z }));
  // 各端が避けるべき「川の他の部分」: 自分の端から30サンプル以内の区間は除く
  const upFar = keptPoly.slice(40);
  const downFar = keptPoly.slice(0, keptPoly.length - 40);

  const up = buildEnd(rng, samples, iu, { step: 1, keptFar: upFar }, cfg);
  const down = buildEnd(rng, samples, id, { step: -1, keptFar: downFar }, cfg);

  const widthUp = samples[iu].width, widthDown = samples[id].width;
  const extUp = up.ext.slice(1).reverse().map((p) => ({ x: p.x, z: p.z, width: widthUp }));
  const extDown = down.ext.slice(1).map((p) => ({ x: p.x, z: p.z, width: widthDown }));

  const centerline = [...extUp, ...kept.map((s) => ({ x: s.x, z: s.z, width: s.width })), ...extDown];
  const m = centerline.length;
  for (let i = 0; i < m; i++) centerline[i].t = i / (m - 1);

  const lenUp = polyLength(up.ext);
  return {
    centerline,
    info: {
      cutRadius,
      origFirst: { x: samples[0].x, z: samples[0].z },
      // 新しい先頭サンプルの、元の弧長座標(河床の全体勾配を、元の川と同じ式で続けるため)
      arcShift: arcOld[iu] - lenUp,
      upstream: up, downstream: down,
      hills: [up.hill, down.hill],
      profile: makeHillProfile(cfg.playableRadius, cfg.terrainHalf),
      keptRange: { from: extUp.length, to: extUp.length + kept.length - 1 },
    },
  };
}

/**
 * 丘の高さ(川の水路・土手を除く前の値)。terrain側の谷掘りの後で足す。
 * @returns {number} 0以上。水路・土手のきわからの距離マスクは呼び出し側(river.js)でかける。
 */
export function endHillHeight(x, z, info, fbm) {
  const prof = info.profile;
  const r = Math.hypot(x, z);
  if (r <= prof.r0 || r >= prof.r3) return { h: 0, ramp: 1 };
  let best = 0, bestRamp = 1;
  for (const e of info.hills) {
    const dx = x - e.center.x, dz = z - e.center.z;
    if (dx * dx + dz * dz > e.boundR * e.boundR) continue;
    const d = distToPolyline(x, z, e.poly);
    const lateral = 1 - smoothstep(e.d0, e.d1, d);
    if (lateral <= 0) continue;
    let h = e.hMax * lateral;
    if (fbm) h *= 1 + 0.2 * fbm(x * 0.035 + e.offX, z * 0.035 + e.offZ, 2); // 稜線に自然なうねりを付ける
    if (h > best) { best = h; bestRamp = e.ramp; }
  }
  if (best <= 0) return { h: 0, ramp: 1 };
  const radial = smoothstep(prof.r0, prof.r1, r) * (1 - smoothstep(prof.r2, prof.r3, r));
  return { h: best * radial, ramp: bestRamp };
}
