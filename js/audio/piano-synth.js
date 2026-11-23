// piano-synth.js (v1.116) — 標準的なピアノの音を、サンプル音源なしで、サンプル単位に計算する(純粋な計算。Nodeで試験できる)。
// 本物のピアノの特徴を、物理にならって再現:
//   ・弦の硬さによる倍音のずれ(インハーモニシティ): f_n = n·f0·√(1+B·n²)。高い音ほど B が大きい。
//   ・弦は、ふつう、2〜3本が、わずかに(0.5セント)ずれて鳴る → ゆっくりしたうなり(コーラス)。
//   ・倍音ごとの減衰: 高い倍音ほど、早く消える。2段階の減衰(はじめ速く、あとゆっくり)。低い音ほど、長く響く。
//   ・ハンマーが弦を叩く位置(弦の約1/8)で、特定の倍音が弱まる。
//   ・強く弾くほど、高い倍音が増えて、明るい音になる(ベロシティ)。打鍵の、短いノイズ(ハンマーの音)。
//   ・キーを離すと、ダンパーが降りて、すばやく消える。
const TAU = Math.PI * 2;
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** インハーモニシティ係数 B(高い音ほど大きい)。 */
export const inharmonicity = (midi) => clampN(0.00006 * Math.exp((midi - 40) * 0.075), 0.00002, 0.004);
/** n番目の倍音の周波数。 */
export const partialFreq = (midi, n) => n * midiToFreq(midi) * Math.sqrt(1 + inharmonicity(midi) * n * n);
/** 基本の減衰時間(秒)。低い音ほど長い。 */
export const baseDecay = (midi) => clampN(5.2 * Math.pow(2, -(midi - 48) / 17), 0.7, 8);

/** 1つの音を計算して、Float32Array(モノラル)で返す。dur=キーを押している秒数。 */
export function renderPiano({ midi, vel = 0.7, dur = 1.0, sr = 44100, seed = 1 }) {
  const f0 = midiToFreq(midi), B = inharmonicity(midi), tau0 = baseDecay(midi), r = rng(seed * 7919 + midi);
  const maxP = midi < 60 ? 20 : midi < 80 ? 14 : 8, nStr = midi < 36 ? 2 : 3;
  const total = Math.min(7, dur + 0.45), N = Math.max(1, Math.ceil(total * sr)), out = new Float32Array(N);
  const parts = []; // { c, s, x, y, aF, aS, dF, dS }
  for (let n = 1; n <= maxP; n++) {
    const fn = partialFreq(midi, n); if (fn > 0.45 * sr || fn > 14000) break;
    const tilt = 1.5 - 0.7 * vel; // 強く弾くと、高い倍音が増える
    const strike = Math.abs(Math.sin(Math.PI * n * 0.115)) + 0.25; // ハンマーの打つ位置(約1/8)で弱まる倍音
    const amp = (strike * Math.pow(n, -tilt)) / nStr;
    const tau = tau0 / (1 + 0.28 * Math.pow(n - 1, 1.15)); // 高い倍音ほど、早く消える
    const fastFrac = clampN(0.5 + 0.02 * n, 0.5, 0.72);
    for (let s = 0; s < nStr; s++) {
      const det = (s - (nStr - 1) / 2) * 0.00045 + (r() - 0.5) * 0.0002, ang = (TAU * fn * (1 + det)) / sr, ph = r() * TAU;
      parts.push({ c: Math.cos(ang), s: Math.sin(ang), x: Math.cos(ph), y: Math.sin(ph), eF: 1, eS: 1, aF: amp * fastFrac, aS: amp * (1 - fastFrac), dF: Math.exp(-1 / (sr * 0.18 * tau)), dS: Math.exp(-1 / (sr * tau)) });
    }
  }
  const damperK = Math.exp(-12 / sr), dampStart = Math.floor(dur * sr);
  let damper = 1;
  for (let n = 0; n < N; n++) {
    let sum = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i], nx = p.x * p.c - p.y * p.s, ny = p.x * p.s + p.y * p.c; p.x = nx; p.y = ny;
      sum += (p.aF * p.eF + p.aS * p.eS) * ny; p.eF *= p.dF; p.eS *= p.dS;
    }
    if (n >= dampStart) damper *= damperK; // キーを離すと、ダンパーが降りる
    out[n] = sum * damper;
  }
  // ハンマーの音(打鍵の短いノイズ。強いほど大きく、明るい)
  { const nz = rng(seed * 31 + midi * 3), len = Math.min(N, Math.floor(0.03 * sr)), lp = clampN(0.18 + 0.5 * vel, 0.1, 0.8); let z = 0;
    let peak0 = 0; for (let n = 0; n < Math.min(N, Math.floor(0.2 * sr)); n++) peak0 = Math.max(peak0, Math.abs(out[n])); const g = (0.1 + 0.25 * vel) * (peak0 || 1);
    for (let n = 0; n < len; n++) { z += ((nz() * 2 - 1) - z) * lp; out[n] += z * g * Math.exp(-n / (0.004 * sr)); } }
  // 打鍵のなめらかな立ち上がり(1.5ms)と、音量の正規化(強く弾くほど大きい)
  const att = Math.floor(0.0015 * sr); let peak = 1e-9; for (let n = 0; n < N; n++) { if (n < att) out[n] *= n / att; peak = Math.max(peak, Math.abs(out[n])); }
  const g = (0.22 + 0.58 * vel) / peak; for (let n = 0; n < N; n++) out[n] *= g;
  return out;
}
