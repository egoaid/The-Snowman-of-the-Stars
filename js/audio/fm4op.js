// fm4op.js (v1.116) — 4オペレーターのFM音源(位相変調方式)。画面にも Web Audio にも依存しない純粋な計算(Nodeで試験できる)。
//
// 本物の4オペレーターFMとして作ってある:
//   ・オペレーターは4つ。それぞれが、サイン波の発振器 + 周波数の比(ratio)+ 微調整(detune)+ 専用のエンベロープ(EG: 立ち上がり・減衰・持続・消え)。
//   ・アルゴリズム: どのオペレーターが、どのオペレーターの「位相」を変調するか(mods)と、音として出るオペレーター(carriers)の組み合わせ。
//   ・変調は位相変調: out_i = sin( 2π·phase_i + (変調するオペレーターの出力の和)·index + フィードバック ) × 振幅
//   ・フィードバック: オペレーターが、自分の直前2サンプルの平均で、自分の位相を変調する(FM音源の定番のノコギリ波ふうの豊かさ)。
//   ・ベロシティ: 強く弾くほど、変調の深さ(index)が増えて、明るい音になる。音域が高いほど、indexを控えめにする(キーボードスケーリング)。
// サンプル音源は使わない。ノートごとに、サンプル単位で計算して、AudioBuffer にして鳴らす。
const TAU = Math.PI * 2;
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** アルゴリズム。mods[i] = オペレーター i の位相を変調するオペレーターの番号。carriers = 音として出すオペレーター。order = 計算の順(変調する側が先)。 */
export const FM4_ALGORITHMS = {
  serial: { name: '直列 4→3→2→1', mods: [[1], [2], [3], []], carriers: [0], order: [3, 2, 1, 0] },
  twoStacks: { name: '2段×2(変調→搬送を2組、足す)', mods: [[1], [], [3], []], carriers: [0, 2], order: [3, 2, 1, 0] },
  parallelMods: { name: '2つの変調 → 1つの搬送 + 単独の搬送', mods: [[1, 2], [], [], []], carriers: [0, 3], order: [1, 2, 3, 0] },
};

/** シンセブラス(4オペレーター): アルゴリズム「2段×2」。オペレーター0・2 が搬送(音)、1・3 が変調。 */
export const BRASS_PATCH = {
  name: 'Synth Brass (4-op)',
  algorithm: 'twoStacks',
  ops: [
    // 0: 搬送A  ratio 1。音の立ち上がりは速く、持続が高い(金管の「ブワッ」)
    { ratio: 1.0, detune: 0, level: 0.5, index: 0, fb: 0, velSens: 0.35, eg: { a: 0.045, d: 0.22, s: 0.82, r: 0.18 } },
    // 1: 変調A(→0)  ratio 1。index が、立ち上がりでふくらみ(明るくなり)、少し落ち着く(金管の、吹き始めの輝き)
    { ratio: 1.0, detune: 0, level: 1, index: 5.2, fb: 0, velSens: 0.85, eg: { a: 0.085, d: 0.38, s: 0.48, r: 0.16 } },
    // 2: 搬送B  ratio 1、すこし高めにずらして、2つの搬送のうなり(コーラス)を作る
    { ratio: 1.0, detune: 7, level: 0.45, index: 0, fb: 0, velSens: 0.3, eg: { a: 0.06, d: 0.25, s: 0.8, r: 0.2 } },
    // 3: 変調B(→2)  ratio 1、フィードバックつき(ノコギリ波ふうの倍音)。立ち上がりは、すこしゆっくり
    { ratio: 1.0, detune: 0, level: 1, index: 3.4, fb: 0.75, velSens: 0.8, eg: { a: 0.12, d: 0.4, s: 0.62, r: 0.18 } },
  ],
  vibrato: { rate: 5.2, depthCents: 6, delay: 0.35, fade: 0.5 }, // 遅れて、ゆっくり効くビブラート
  tail: 0.4,
};

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** EGの、時刻 t での値(0〜1)。noteDur でキーを離す。立ち上がり: 1-exp 型 / 減衰: 持続レベルへ指数 / 消え: 離した時の値から指数。 */
export function egLevel(t, noteDur, eg) {
  const held = (tt) => { const att = tt < eg.a ? 1 - Math.exp((-5 * tt) / Math.max(1e-4, eg.a)) : 1; const dec = tt <= eg.a ? 0 : tt - eg.a; return att * (eg.s + (1 - eg.s) * Math.exp((-3 * dec) / Math.max(1e-4, eg.d))); };
  if (t <= noteDur) return held(t);
  return held(noteDur) * Math.exp((-5 * (t - noteDur)) / Math.max(1e-3, eg.r));
}

/**
 * 1つの音を、サンプルごとに計算して、Float32Array で返す(モノラル)。
 * midi=音の高さ / vel=0〜1 / dur=キーを押している秒数 / sr=サンプルレート / patch=音色 / mute=鳴らさない(0にする)オペレーターの番号の配列(試験用)
 */
export function renderFm4({ midi, vel = 0.8, dur = 0.5, sr = 44100, patch = BRASS_PATCH, mute = [] }) {
  const algo = FM4_ALGORITHMS[patch.algorithm]; if (!algo) throw new Error('unknown algorithm ' + patch.algorithm);
  const f0 = midiToFreq(midi), total = dur + (patch.tail || 0.3), N = Math.max(1, Math.ceil(total * sr));
  const out = new Float32Array(N), isCarrier = [false, false, false, false]; for (const c of algo.carriers) isCarrier[c] = true;
  const phase = [0, 0, 0, 0], y = [0, 0, 0, 0], y1 = [0, 0, 0, 0], y2 = [0, 0, 0, 0]; // 現在・1つ前・2つ前の出力(フィードバック用)
  const idxScale = clampN(1.25 - (midi - 60) / 72, 0.5, 1.3); // 高い音ほど、変調を控えめに
  const ops = patch.ops.map((o, i) => ({ ...o, mute: mute.includes(i), velK: 1 - o.velSens + o.velSens * vel, mul: o.ratio * Math.pow(2, o.detune / 1200) }));
  const vib = patch.vibrato || { rate: 0, depthCents: 0, delay: 0, fade: 1 };
  for (let n = 0; n < N; n++) {
    const t = n / sr;
    const vibK = vib.depthCents ? Math.sin(TAU * vib.rate * t) * vib.depthCents * clampN((t - vib.delay) / Math.max(1e-3, vib.fade), 0, 1) : 0;
    const pitch = f0 * Math.pow(2, vibK / 1200);
    for (let k = 0; k < 4; k++) {
      const i = algo.order[k], o = ops[i];
      phase[i] += (TAU * pitch * o.mul) / sr; if (phase[i] > 1e6) phase[i] -= Math.floor(phase[i] / TAU) * TAU;
      let mod = 0; for (const j of algo.mods[i]) mod += y[j];
      const fbTerm = o.fb ? o.fb * 0.5 * (y1[i] + y2[i]) : 0; // 自分の直前2サンプルの平均で、自分を変調
      const env = egLevel(t, dur, o.eg);
      // 搬送: 振幅=level。変調: 振幅=変調の深さ(index、ラジアン)
      const amp = o.mute ? 0 : isCarrier[i] ? o.level * (0.55 + 0.45 * o.velK) * env : o.index * idxScale * o.velK * env;
      const modScale = 1; // 変調する側の出力は、すでに index(ラジアン)を含んでいる
      y2[i] = y1[i]; y1[i] = y[i];
      y[i] = Math.sin(phase[i] + mod * modScale + fbTerm) * amp;
    }
    let s = 0; for (const c of algo.carriers) s += y[c];
    out[n] = s;
  }
  // 音の頭と終わりの、プチッを防ぐ(1ms・5ms)。やわらかく飽和
  const a = Math.min(N, Math.floor(0.001 * sr)), b = Math.min(N, Math.floor(0.005 * sr));
  for (let n = 0; n < N; n++) { let g = 1; if (n < a) g = n / a; if (N - 1 - n < b) g = Math.min(g, (N - 1 - n) / b); out[n] = Math.tanh(out[n] * 1.15) / 1.15 * g; }
  return out;
}

/** 試験・表示用: 音色の構造(オペレーター数・アルゴリズム・搬送と変調・フィードバックの有無)。 */
export function describePatch(patch = BRASS_PATCH) {
  const algo = FM4_ALGORITHMS[patch.algorithm];
  return { operators: patch.ops.length, algorithm: patch.algorithm, algorithmName: algo.name, carriers: [...algo.carriers], modulators: patch.ops.map((_, i) => i).filter((i) => !algo.carriers.includes(i)), mods: algo.mods.map((m) => [...m]), feedback: patch.ops.map((o) => o.fb), ratios: patch.ops.map((o) => o.ratio) };
}
