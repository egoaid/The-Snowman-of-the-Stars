// shading.js
// MeshToonMaterial用の階調マップ(gradientMap)を作る。
// 段階数を絞ることで、なめらかなグラデーションではなく
// ドット絵的な「くっきりした陰影の境界」を再現する。

import * as THREE from 'three';

let cachedMap = null;
let cachedCloudMap = null;

/**
 * 4段階の階調マップを返す(キャッシュして使い回す)。
 */
export function getToonGradientMap() {
  if (cachedMap) return cachedMap;

  const steps = 4;
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) {
    data[i] = Math.round((i / (steps - 1)) * 255);
  }
  const texture = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  cachedMap = texture;
  return texture;
}

/**
 * 雲専用の階調マップ。通常の階調マップ(0〜255、最も暗い段は黒)をそのまま
 * 雲に使うと、影側が黒くつぶれてしまい「白い雲」に見えなくなる。
 * 実際の雲は影側でも周囲の空からの光で薄く白いままなので、最も暗い段でも
 * 中間より明るいグレーまでしか落ちないようにした専用マップを用意する。
 */
export function getCloudGradientMap() {
  if (cachedCloudMap) return cachedCloudMap;

  const steps = 4;
  const floor = 0.7; // 影側でもここより暗くはしない
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    data[i] = Math.round((floor + t * (1 - floor)) * 255);
  }
  const texture = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  cachedCloudMap = texture;
  return texture;
}

// 2026-09(v1.26): 滑らかな階調マップ。4段のトゥーン階調(上のgetToonGradientMap)
// だと、雪だるまの胴体など丸い面に4本ほどの帯が見えて荒い印象になる、との
// 指摘への対応。256段+線形補間にして、陰影の変化を連続的にする。
// 明暗の範囲は 0(または floor)〜1 で、4段版と同じ範囲(平均の明るさも
// ほぼ同じ)。地形・木・岩などは従来の4段のままにして、ピクセルアート的な
// 質感を保つ(このマップを使うのは雪だるまとかまくらだけ)。
const cachedSmooth = new Map();
export const SMOOTH_GRADIENT_STEPS = 256;
export function getSmoothGradientMap(floor = 0) {
  const key = String(floor);
  if (cachedSmooth.has(key)) return cachedSmooth.get(key);
  const data = new Uint8Array(SMOOTH_GRADIENT_STEPS);
  for (let i = 0; i < SMOOTH_GRADIENT_STEPS; i++) {
    const t = i / (SMOOTH_GRADIENT_STEPS - 1);
    data[i] = Math.round((floor + t * (1 - floor)) * 255);
  }
  const texture = new THREE.DataTexture(data, SMOOTH_GRADIENT_STEPS, 1, THREE.RedFormat);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  cachedSmooth.set(key, texture);
  return texture;
}
