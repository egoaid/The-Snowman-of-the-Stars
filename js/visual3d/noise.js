// noise.js
// 外部ライブラリを使わない、軽量な2次元ノイズ。
// 格子点にハッシュから疑似乱数を割り当て、スムーズステップで補間する
// (Value Noiseと呼ばれる方式)。地形の起伏に使う。

function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

/**
 * 2次元Value Noise。戻り値はおおよそ -1〜1。
 */
export function valueNoise2D(x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const sx = smoothstep(x - x0);
  const sy = smoothstep(y - y0);

  const n00 = hash(x0, y0);
  const n10 = hash(x1, y0);
  const n01 = hash(x0, y1);
  const n11 = hash(x1, y1);

  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  const n = nx0 + (nx1 - nx0) * sy;
  return n * 2 - 1;
}

/**
 * オクターブを重ねたfBmノイズ(より自然な起伏)。
 */
export function fbm2D(x, y, octaves = 4) {
  let total = 0;
  let amp = 1;
  let freq = 1;
  let maxAmp = 0;
  for (let i = 0; i < octaves; i++) {
    total += valueNoise2D(x * freq, y * freq) * amp;
    maxAmp += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return total / maxAmp;
}
