// terrain-noise.js
// 地形の「素の」高さ(川の影響を一切受けない、fbmノイズだけの起伏)を
// 提供する葉モジュール。
//
// なぜ terrain.js から切り出したか:
// river.js の Hydrology Solver(川の縦断方向の河床・水面標高を計算する部分)
// は、「川が無かったとしたらこの場所の地形はどれくらいの高さか」という
// アンビエントな地形の値を、河床の局所変動(瀬・淵)の種として必要とする。
// 一方 terrain.js は「アンビエントな地形 - 川の谷」で最終的な地形を作るため、
// river.js の計算結果(河床標高)を必要とする。
// この2つを同じファイルに置くと import が循環してしまうため、
// 「川に関与しない部分」だけをこの独立したファイルに分離した。
//   terrain-noise.js (このファイル。他に依存しない)
//     ↑            ↑
//     │            └── river.js が読む(Hydrology Solverの入力)
//     └──────────────  terrain.js が読む(川以外の地形起伏)
// river.js は terrain.js を読まず、terrain.js は river.js を読むので、
// 依存関係は一方向(循環しない)になる。

import { fbm2D } from './noise.js';
import { makeRng, randRange } from './rng.js';

// 2026-09(地形自動生成フェーズ): noise.js自体は変更せず、サンプリング座標に
// シードから作った大きなオフセットを加えることで「同じノイズ関数を、
// 違う場所から切り出す」形でシード対応にしている。
// configureAmbientSeed()を一度も呼ばなければオフセットは0のままなので、
// 既定の地形は今までとまったく同じ結果になる(リグレッション無し)。
let seedOffsetX = 0;
let seedOffsetZ = 0;

// 2026-09(バリエーション強化): 「地形に違いがあまり感じられない」という
// フィードバックを受けて追加。以前は起伏の周波数・振幅が固定値だったため、
// シードが変わってもノイズの「切り出す場所」が変わるだけで、地形の性格
// (起伏の細かさ・全体的な丘の大きさ)自体はどのシードでもほぼ同じだった。
// ここでは、細かい起伏(fine)・中間の起伏(mid、既存の主要成分)に加えて、
// 新たに「大きな丘」(hill、低周波・大振幅)の層を追加し、これらの周波数・
// 振幅もシードごとに変える。これにより、シードによって
// 「なだらかな平地」「起伏の激しい丘陵」「大きな丘が点在する地形」など、
// はっきり性格の異なる地形が生成されるようにする。
// 既定値(下記)は、以前の固定式 `fbm2D(x*0.05,z*0.05,4)*2.4 +
// fbm2D(x*0.15+100,z*0.15+100,2)*0.5` と完全に一致するよう選んである
// (hillAmpは既定0なので、configureAmbientSeed()を呼ばない限り
// 何も変わらない)。
let midFreq = 0.05, midAmp = 2.4;
let fineFreq = 0.15, fineAmp = 0.5;
let hillFreq = 0.012, hillAmp = 0; // 既定は効果ゼロ(自動生成専用の追加レイヤー)

/**
 * ワールドシードから、地形の起伏ノイズのオフセット・周波数・振幅を決める。
 * @param {number} seed
 */
export function configureAmbientSeed(seed) {
  const rng = makeRng(seed >>> 0 || 1);
  seedOffsetX = randRange(rng, 1000, 90000);
  seedOffsetZ = randRange(rng, 1000, 90000);

  // 中間スケールの起伏(既定0.05/2.4を中心に、多少ばらつかせる)
  midFreq = randRange(rng, 0.035, 0.07);
  midAmp = randRange(rng, 1.8, 3.4);
  // 細かいディテール
  fineFreq = randRange(rng, 0.11, 0.2);
  fineAmp = randRange(rng, 0.3, 0.8);
  // 大きな丘(シードによっては、はっきり丘陵地らしくなる)
  hillFreq = randRange(rng, 0.006, 0.016);
  hillAmp = randRange(rng, 1.5, 6.0);
}

/** 既定(オフセット無し・追加レイヤー無し)の状態に戻す。自動生成をOFFに戻す時に使う。 */
export function resetAmbientSeed() {
  seedOffsetX = 0;
  seedOffsetZ = 0;
  midFreq = 0.05; midAmp = 2.4;
  fineFreq = 0.15; fineAmp = 0.5;
  hillFreq = 0.012; hillAmp = 0;
}

/**
 * 川の影響を一切含まない、地形のアンビエントな起伏だけを返す。
 * @param {number} x
 * @param {number} z
 * @returns {number}
 */
export function ambientHeightAt(x, z) {
  const sx = x + seedOffsetX;
  const sz = z + seedOffsetZ;
  let h = 0;
  h += fbm2D(sx * midFreq, sz * midFreq, 4) * midAmp;
  h += fbm2D(sx * fineFreq + 100, sz * fineFreq + 100, 2) * fineAmp;
  // 大きな丘。既定(hillAmp=0)では何も足さないため、自動生成OFF時の結果には影響しない。
  if (hillAmp !== 0) {
    h += fbm2D(sx * hillFreq + 5000, sz * hillFreq + 5000, 3) * hillAmp;
  }
  return h;
}
