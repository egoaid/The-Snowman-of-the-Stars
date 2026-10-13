// water-ripples.js
// 雨粒が水面に落ちた時の「波紋」を、水面シェーダーの一部として描くための部品。
// 2026-09(v1.27): 新規追加。「雨粒による波紋.md」の指示への対応。
//
// 【以前(〜v1.26)の方式】 weather.jsが、リング画像を貼った平面(Sprite的な板)を
// 28枚プールし、拡大しながら透明にして消していた。水面とは別の2Dオブジェクトを
// 重ねているだけなので、波が水面そのものを揺らして見えず、光の反射も波に
// 追従せず、重なっても単なる透明リングにしか見えなかった。
//
// 【今回の方式】 雨粒の着水位置を「Ripple Source」として固定長のプールへ登録し、
// 水面シェーダー(river.jsのフラグメント)が、各Sourceから外側へ伝わる波の
// 「高さの勾配」を計算して、水面の疑似法線へ加える。反射(フレネル・スペキュラ)は
// 変化した法線から計算されるので、波の山・谷に沿って光が動く。複数の波は
// 高さ・勾配を足し合わせるので、干渉して見える。板は一切使わない。
//
// 【波の数学】(1つのSourceについて。位置pの水面の高さ h(p, t))
//   age = t - startTime,  u = age / lifetime  (0〜1)
//   中心 c = source + drift * age          (川の流れで少し下流へずれる。高品質のみ)
//   d = |p - c|,  r = R0 + SPEED * radiusScale * age,  q = d - r
//   波(1つの波束):
//     h_wave = AMP * strength * (1-u)^2 * att(d) * near(d) * exp(-(q/w)^2) * sin(K*q)
//       att(d)  = (1 + d/L)^(-1/2)      ... 広がるほど弱まる(距離減衰)
//       near(d) = 1 - exp(-d/CORE)       ... 中心付近では強すぎないようにする
//       w       = WIDTH * (1 + 0.6u)      ... 波束は時間とともに少し広がる
//   最初の「くぼみ」(着水直後の小さな水面の凹み):
//     h_dimple = -DIMPLE_AMP * strength * (1 - age/DIMPLE_TIME) * exp(-(d/DIMPLE_R)^2)
//   勾配(dh/dx, dh/dz)は解析的に求める(有限差分より安く、シェーダーで安定):
//     dh/dd を積の微分で求め、方向ベクトル (p-c)/d を掛ける
//   最終的な水面法線 = normalize( 既存のさざ波の法線 + 全Sourceの勾配の和 )
//
// このファイルは、シェーダー(GLSL)と、検証用のJS参照実装の両方が
// 同じ定数(RIPPLE_PARAMS)を使う(単一の情報源)。

export const RIPPLE_PARAMS = {
  R0: 0.03,          // 初期の波面半径(m)。非常に小さい
  SPEED: 0.5,        // 波の伝播速度(m/秒)。一定
  WIDTH: 0.09,       // 波束のガウス幅(m)
  K: 38.0,           // 波数(rad/m)。波長≒0.165m(480×270でも1〜数px幅で見える大きさ)
  AMP: 0.011,        // 波高(m)。小さい(勾配が最大でAMP*K≒0.4)
  ATTEN_L: 0.35,     // 距離減衰の基準距離(m)
  CORE: 0.05,        // 中心付近を弱める距離(m)
  DIMPLE_R: 0.06,    // 着水直後のくぼみの半径(m)
  DIMPLE_AMP: 0.012, // くぼみの深さ(m)
  DIMPLE_TIME: 0.22, // くぼみが消えるまでの時間(秒)
  LIFE_MIN: 1.2,     // Rippleの寿命(秒)。0.7秒だった旧方式より長く残す
  LIFE_MAX: 1.8,
  RADIUS_SCALE_MIN: 0.85,
  RADIUS_SCALE_MAX: 1.25,
  DRIFT_SPEED: 0.3,  // 川の流れによる中心の下流への移動速度(m/秒)。高品質のみ
  STRENGTH_MIN: 0.55,
  STRENGTH_MAX: 1.0,
  YOUNG_KEEP: 0.5,   // 寿命の何割までは、新しい波紋のために上書きしない(伝播が途中で切れて見えないように)
};

/** 水面の品質。offは最軽量(波紋・さざ波なし)、standardは軽め、highは全部入り。 */
export const WATER_QUALITIES = ['off', 'standard', 'high'];
export const WATER_QUALITY_SETTINGS = {
  off: { shaderLevel: 0, maxRipples: 0, drift: false },
  standard: { shaderLevel: 1, maxRipples: 12, drift: false },
  high: { shaderLevel: 2, maxRipples: 28, drift: true },
};
export function normalizeWaterQuality(q) {
  return WATER_QUALITIES.includes(q) ? q : 'high';
}

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------

/** シェーダー冒頭に置く #define(定数を全て RIPPLE_PARAMS から生成する)。 */
export function buildRippleDefines() {
  const f = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
  const P = RIPPLE_PARAMS;
  return [
    `#define RIPPLE_R0 ${f(P.R0)}`,
    `#define RIPPLE_SPEED ${f(P.SPEED)}`,
    `#define RIPPLE_WIDTH ${f(P.WIDTH)}`,
    `#define RIPPLE_K ${f(P.K)}`,
    `#define RIPPLE_AMP ${f(P.AMP)}`,
    `#define RIPPLE_ATTEN_L ${f(P.ATTEN_L)}`,
    `#define RIPPLE_CORE ${f(P.CORE)}`,
    `#define DIMPLE_R ${f(P.DIMPLE_R)}`,
    `#define DIMPLE_AMP ${f(P.DIMPLE_AMP)}`,
    `#define DIMPLE_TIME ${f(P.DIMPLE_TIME)}`,
  ].join('\n');
}

/**
 * フラグメントシェーダーに埋め込む、波紋の計算関数。
 * 前提: RIPPLE_COUNT(>=1)がdefineされていること。
 * 戻り値: vec3(dh/dx, dh/dz, h)(全Sourceの合計)
 * WATER_RIPPLE_DRIFTがdefineされていれば、中心が流れで下流へずれる。
 */
export const RIPPLE_GLSL = `
uniform vec4 uRippleA[RIPPLE_COUNT]; // x, z, startTime, strength
uniform vec4 uRippleB[RIPPLE_COUNT]; // radiusScale, lifetime, driftX, driftZ
uniform float uRippleCount;          // 生きているRippleの数(先頭からpackされている)

vec3 rippleField(vec2 p, float now) {
  float h = 0.0;
  vec2 grad = vec2(0.0);
  for (int i = 0; i < RIPPLE_COUNT; i++) {
    if (float(i) >= uRippleCount) break; // 生きている分だけ回す(雨が弱い時はほぼ素通り)
    vec4 A = uRippleA[i];
    vec4 B = uRippleB[i];
    float age = now - A.z;
    if (age < -0.001 || age > B.y) continue;
    float u = age / B.y;
    vec2 c = A.xy;
#ifdef WATER_RIPPLE_DRIFT
    c += B.zw * age;
#endif
    vec2 dv = p - c;
    float d2 = dot(dv, dv);
    float r = RIPPLE_R0 + RIPPLE_SPEED * B.x * age;
    float w = RIPPLE_WIDTH * (1.0 + 0.6 * u);
    // 安価な事前判定(平方根なし): 波の帯(r±3w)にも、くぼみ(中心付近)にも
    // 入っていない画素は、この波紋の計算を丸ごと飛ばす。ほとんどの画素はここで抜ける。
    float outer = r + 3.0 * w;
    float inner = max(r - 3.0 * w, 0.0);
    bool inBand = d2 < outer * outer && d2 > inner * inner;
    bool inDimple = age < DIMPLE_TIME && d2 < 16.0 * DIMPLE_R * DIMPLE_R;
    if (!inBand && !inDimple) continue;

    float d = sqrt(d2);
    vec2 dir = dv / max(d, 1e-4);
    float dh = 0.0;
    if (inBand) {
      float q = d - r;
      float e = exp(-(q * q) / (w * w));
      float s = sin(RIPPLE_K * q);
      float co = cos(RIPPLE_K * q);
      float ex = exp(-d / RIPPLE_CORE);
      float nr = 1.0 - ex;
      float dnr = ex / RIPPLE_CORE;
      float onePlus = 1.0 + d / RIPPLE_ATTEN_L;
      float att = inversesqrt(onePlus);
      float datt = -0.5 / RIPPLE_ATTEN_L * att / onePlus;
      float tf = 1.0 - u;
      float amp = RIPPLE_AMP * A.w * tf * tf;
      float es = e * s;
      float des = e * (RIPPLE_K * co - 2.0 * q / (w * w) * s);
      h += amp * att * nr * es;
      dh += amp * ((datt * nr + att * dnr) * es + att * nr * des);
    }
    if (inDimple) {
      float g = exp(-d2 / (DIMPLE_R * DIMPLE_R));
      float a2 = DIMPLE_AMP * A.w * (1.0 - age / DIMPLE_TIME) * g;
      h -= a2;
      dh += a2 * 2.0 * d / (DIMPLE_R * DIMPLE_R);
    }
    grad += dh * dir;
  }
  return vec3(grad, h);
}
`;

// ---------------------------------------------------------------------------
// JS参照実装(GLSLのrippleFieldと同じ式。検証用。シェーダーとは同じ定数を使う)
// ---------------------------------------------------------------------------

/**
 * 1つのRippleの、位置(px,pz)・時刻nowでの {gx, gz, h} を返す(GLSLと同じ式)。
 * @param {{x:number,z:number,start:number,strength:number,radiusScale:number,life:number,driftX:number,driftZ:number}} rp
 */
export function rippleContribution(px, pz, now, rp, drift = false) {
  const P = RIPPLE_PARAMS;
  const age = now - rp.start;
  if (age < -0.001 || age > rp.life) return { gx: 0, gz: 0, h: 0 };
  const u = age / rp.life;
  let cx = rp.x, cz = rp.z;
  if (drift) { cx += rp.driftX * age; cz += rp.driftZ * age; }
  const dx = px - cx, dz = pz - cz;
  const d2 = dx * dx + dz * dz;
  const r = P.R0 + P.SPEED * rp.radiusScale * age;
  const w = P.WIDTH * (1 + 0.6 * u);
  const outer = r + 3 * w, inner = Math.max(r - 3 * w, 0);
  const inBand = d2 < outer * outer && d2 > inner * inner;
  const inDimple = age < P.DIMPLE_TIME && d2 < 16 * P.DIMPLE_R * P.DIMPLE_R;
  if (!inBand && !inDimple) return { gx: 0, gz: 0, h: 0 };
  const d = Math.sqrt(d2);
  const dirx = dx / Math.max(d, 1e-4), dirz = dz / Math.max(d, 1e-4);
  let h = 0, dh = 0;
  if (inBand) {
    const q = d - r;
    const e = Math.exp(-(q * q) / (w * w));
    const s = Math.sin(P.K * q), co = Math.cos(P.K * q);
    const ex = Math.exp(-d / P.CORE);
    const nr = 1 - ex, dnr = ex / P.CORE;
    const onePlus = 1 + d / P.ATTEN_L;
    const att = 1 / Math.sqrt(onePlus);
    const datt = -0.5 / P.ATTEN_L * att / onePlus;
    const tf = 1 - u;
    const amp = P.AMP * rp.strength * tf * tf;
    const es = e * s;
    const des = e * (P.K * co - 2 * q / (w * w) * s);
    h += amp * att * nr * es;
    dh += amp * ((datt * nr + att * dnr) * es + att * nr * des);
  }
  if (inDimple) {
    const g = Math.exp(-d2 / (P.DIMPLE_R * P.DIMPLE_R));
    const a2 = P.DIMPLE_AMP * rp.strength * (1 - age / P.DIMPLE_TIME) * g;
    h -= a2;
    dh += a2 * 2 * d / (P.DIMPLE_R * P.DIMPLE_R);
  }
  return { gx: dh * dirx, gz: dh * dirz, h };
}

/** 複数のRippleの合計(干渉)。 */
export function rippleField(px, pz, now, ripples, drift = false) {
  let gx = 0, gz = 0, h = 0;
  for (const rp of ripples) {
    const c = rippleContribution(px, pz, now, rp, drift);
    gx += c.gx; gz += c.gz; h += c.h;
  }
  return { gx, gz, h };
}

// ---------------------------------------------------------------------------
// Ripple Sourceの固定長プール
// ---------------------------------------------------------------------------

/**
 * 固定長のRipple Sourceプール。uniform配列(uRippleA/B。Float32Array、vec4×N)へ
 * 直接書き込む。新規生成時は空きスロットを使い、無ければ「寿命の半分以上
 * 経過した最も古いもの」を再利用し、それも無ければ生成を見送る(伝播中の波が
 * 途中で切れて見えないようにするため)。
 * @param {number} maxRipples 0ならすべて無効(spawnは常にfalse)
 * @param {() => number} [rng] 0〜1の乱数(既定Math.random)
 */
export function createRipplePool(maxRipples, rng = Math.random) {
  const n = maxRipples;
  const A = new Float32Array(Math.max(1, n) * 4);
  const B = new Float32Array(Math.max(1, n) * 4);
  // シェーダーへ渡す、生きている波紋だけを先頭へ詰めた配列(pack()で毎フレーム作る)
  const PA = new Float32Array(Math.max(1, n) * 4);
  const PB = new Float32Array(Math.max(1, n) * 4);
  let packedCount = 0;
  const FAR_PAST = -1e6;
  for (let i = 0; i < Math.max(1, n); i++) { A[i * 4 + 2] = FAR_PAST; B[i * 4 + 1] = 1; }
  let cursor = 0;

  function clear() {
    for (let i = 0; i < Math.max(1, n); i++) { A[i * 4 + 2] = FAR_PAST; }
    cursor = 0;
  }

  /**
   * @returns {boolean} 登録できたか
   */
  function spawn(x, z, now, tangentX = 0, tangentZ = 0) {
    if (n <= 0) return false;
    const P = RIPPLE_PARAMS;
    // 空きスロット(寿命が切れているもの)を探す。cursorから順に見る
    let slot = -1;
    for (let k = 0; k < n; k++) {
      const i = (cursor + k) % n;
      const age = now - A[i * 4 + 2];
      // 寿命切れ、または時計が大きく巻き戻った(<-1秒)スロットは空き。
      // 注意: 開始時刻はFloat32へ丸めて保存するため、同じフレーム内で直後に
      // 調べるとageが-1e-6程度の微小な負になる。これを「空き」と誤判定すると、
      // 同じフレームに複数の雨粒が着水した時に、直前の波紋を上書きしてしまう。
      if (age > B[i * 4 + 1] || age < -1.0) { slot = i; break; }
    }
    if (slot < 0) {
      // 全て伝播中。寿命の半分以上経過した最も古いものだけ再利用する
      let oldest = -1, oldestAge = -1;
      for (let i = 0; i < n; i++) {
        const age = now - A[i * 4 + 2];
        const frac = age / B[i * 4 + 1];
        if (frac >= P.YOUNG_KEEP && age > oldestAge) { oldest = i; oldestAge = age; }
      }
      if (oldest < 0) return false;
      slot = oldest;
    }
    cursor = (slot + 1) % n;
    const life = P.LIFE_MIN + rng() * (P.LIFE_MAX - P.LIFE_MIN);
    A[slot * 4] = x; A[slot * 4 + 1] = z; A[slot * 4 + 2] = now;
    A[slot * 4 + 3] = P.STRENGTH_MIN + rng() * (P.STRENGTH_MAX - P.STRENGTH_MIN);
    B[slot * 4] = P.RADIUS_SCALE_MIN + rng() * (P.RADIUS_SCALE_MAX - P.RADIUS_SCALE_MIN);
    B[slot * 4 + 1] = life;
    B[slot * 4 + 2] = tangentX * P.DRIFT_SPEED;
    B[slot * 4 + 3] = tangentZ * P.DRIFT_SPEED;
    return true;
  }

  /**
   * 生きている波紋だけを先頭へ詰めて PA/PB に書き、その数を返す(毎フレーム、
   * シェーダーへ渡す直前に呼ぶ)。シェーダーは詰められた数だけループするので、
   * 雨が弱くて波紋が少ない時ほど、水面の1画素あたりのコストが下がる。
   */
  function pack(now) {
    let k = 0;
    for (let i = 0; i < n; i++) {
      const age = now - A[i * 4 + 2];
      if (age >= -1e-3 && age <= B[i * 4 + 1]) {
        PA[k * 4] = A[i * 4]; PA[k * 4 + 1] = A[i * 4 + 1]; PA[k * 4 + 2] = A[i * 4 + 2]; PA[k * 4 + 3] = A[i * 4 + 3];
        PB[k * 4] = B[i * 4]; PB[k * 4 + 1] = B[i * 4 + 1]; PB[k * 4 + 2] = B[i * 4 + 2]; PB[k * 4 + 3] = B[i * 4 + 3];
        k++;
      }
    }
    packedCount = k;
    return k;
  }

  /** 検証・デバッグ用: 現在生きているRippleをJS参照実装の形式で返す。 */
  function activeRipples(now) {
    const list = [];
    for (let i = 0; i < n; i++) {
      const age = now - A[i * 4 + 2];
      if (age >= -1e-3 && age <= B[i * 4 + 1]) {
        list.push({ x: A[i * 4], z: A[i * 4 + 1], start: A[i * 4 + 2], strength: A[i * 4 + 3], radiusScale: B[i * 4], life: B[i * 4 + 1], driftX: B[i * 4 + 2], driftZ: B[i * 4 + 3] });
      }
    }
    return list;
  }

  return { size: n, A, B, PA, PB, pack, getPackedCount: () => packedCount, spawn, clear, activeRipples };
}
