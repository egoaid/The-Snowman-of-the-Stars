// rocks.js
// 低ポリの岩(ボルダー)を作る。IcosahedronGeometryの頂点をランダムに
// 動かして「削れた岩」らしい不規則さを出し、非一様スケールで
// 細長い岩・丸い岩などバリエーションを持たせる。
// 河原には数個まとまった「岩のクラスタ」として配置すると自然に見える。

import * as THREE from 'three';
import { getToonGradientMap } from './shading.js';

const ROCK_MATERIAL = new THREE.MeshToonMaterial({ color: 0x7d786c, gradientMap: getToonGradientMap() });
const WET_ROCK_MATERIAL = new THREE.MeshToonMaterial({ color: 0x5f6a64, gradientMap: getToonGradientMap() });

/**
 * 岩を1つ作る。原点は岩の底面中心あたり(接地させやすいよう、
 * 生成後にバウンディングボックスの下端が y=0 に来るよう平行移動する)。
 * @param {number} scale - おおよその大きさ(メートル)
 * @param {number} seed
 * @param {boolean} wet - 水際の岩は少し暗め・青みがかった色にする
 */
export function createRock(scale = 0.5, seed = 0, wet = false) {
  const detail = 0; // 低ポリ(IcosahedronGeometryの分割なし)
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;

  // 頂点ごとにランダムなオフセットを加え、削れた岩らしい不規則な形にする
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);
    const n = Math.sin((i + seed) * 12.9898) * 43758.5453;
    const jitter = 0.22 + 0.18 * (n - Math.floor(n));
    pos.setX(i, vx * (0.85 + jitter));
    pos.setY(i, vy * (0.75 + jitter * 0.8));
    pos.setZ(i, vz * (0.85 + jitter));
  }
  geo.computeVertexNormals();

  // 非一様スケールで、丸い岩・細長い岩などバリエーションを出す
  geo.scale(
    scale * (0.75 + ((seed * 37) % 100) / 200),
    scale * (0.55 + ((seed * 53) % 100) / 260),
    scale * (0.75 + ((seed * 71) % 100) / 200)
  );

  // 底面がy=0に来るよう平行移動する(接地しやすくする)
  geo.computeBoundingBox();
  const minY = geo.boundingBox.min.y;
  geo.translate(0, -minY, 0);

  const material = wet ? WET_ROCK_MATERIAL : ROCK_MATERIAL;
  const mesh = new THREE.Mesh(geo, material);
  mesh.rotation.y = (seed * 0.7) % (Math.PI * 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * 2〜4個の岩をまとめた「岩のクラスタ」を作る。原点は接地点。
 * @param {number} scale - クラスタ全体のおおよその大きさ
 * @param {number} seed
 * @param {boolean} wet
 */
export function createRockCluster(scale = 0.6, seed = 0, wet = false) {
  const group = new THREE.Group();
  const rockCount = 2 + (seed % 3); // 2〜4個

  for (let i = 0; i < rockCount; i++) {
    const s = scale * (0.5 + ((seed + i * 17) % 100) / 140);
    const rock = createRock(s, seed + i * 101, wet);
    const angle = (i / rockCount) * Math.PI * 2 + (seed % 10) * 0.3;
    const dist = scale * 0.35 * (i === 0 ? 0 : 1);
    rock.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
    group.add(rock);
  }

  return group;
}

/**
 * 地形の上に正しく配置する(接地点の高さをサンプリングする)。
 * @param {THREE.Object3D} obj
 * @param {number} x
 * @param {number} z
 * @param {(x:number,z:number)=>number} terrainHeightFn
 */
export function placeRockOnTerrain(obj, x, z, terrainHeightFn) {
  obj.position.set(x, terrainHeightFn(x, z), z);
}
