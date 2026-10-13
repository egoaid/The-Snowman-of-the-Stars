// mountains3d.js
// 地平線を360度囲む山脈を作る。実体は「内側から見る大きな円筒」で、
// 上端の頂点をノイズで揺らして稜線のシルエットにしている。
// カメラは常にこの円筒の内側にいるので、ズームやドラッグで回転しても
// どの方向にも山が見える(=何も作っていない空間が見えない)ようにする。
//
// 【立体感を出すための工夫】
// - 遠景(色が薄く霞んだ、より大きい)と近景(色が濃い、やや小さい)の
//   2枚のリングを重ねることで、単色1枚のときの「ペラペラ感」をなくす。
// - 稜線には上下方向のノイズだけでなく、半径方向(奥行き)のノイズも
//   加えることで、真上から見ても輪郭が単純な円にならないようにする。

import * as THREE from 'three';
import { fbm2D } from './noise.js';

/**
 * 山脈のリングメッシュを作る。
 * @param {object} opts
 * @param {number} [opts.radius] - 円筒の半径(シーンの外側を十分覆う大きさ)
 * @param {number} [opts.height] - 円筒の高さ
 * @param {number} [opts.baseY] - 円筒の下端のY座標(地形より十分低くしておく)
 * @param {number} [opts.color] - 山肌の色
 * @param {number} [opts.noiseSeed] - リングごとに違う稜線にするためのオフセット
 * @param {number} [opts.radialJag] - 半径方向(奥行き)の凹凸の強さ(0で無効)
 */
export function buildMountainRing(opts = {}) {
  const {
    radius = 130,
    height = 60,
    baseY = -18,
    color = 0x93a8a2,
    noiseSeed = 0,
    radialJag = 0.06,
  } = opts;

  const radialSegments = 128;
  const heightSegments = 6;
  const geo = new THREE.CylinderGeometry(radius, radius * 1.08, height, radialSegments, heightSegments, true);

  const pos = geo.attributes.position;
  const halfH = height / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const angle = Math.atan2(z, x);

    // 高さに応じて(上に行くほど強く)ノイズで凹凸をつけ、稜線らしくする
    const heightFrac = (y + halfH) / height; // 0(下)〜1(上)
    const ridgeNoise = fbm2D(Math.cos(angle) * 2.5 + noiseSeed, Math.sin(angle) * 2.5 + noiseSeed, 4);
    const displacement = ridgeNoise * height * 0.32 * Math.pow(heightFrac, 1.4);
    pos.setY(i, y + displacement);

    // 半径方向(奥行き)にも凹凸をつけ、真上から見ても単純な円にならないようにする
    if (radialJag > 0) {
      const radialNoise = fbm2D(Math.cos(angle) * 3.7 + noiseSeed + 50, Math.sin(angle) * 3.7 + noiseSeed + 50, 3);
      const scaleFactor = 1 + radialNoise * radialJag;
      pos.setX(i, x * scaleFactor);
      pos.setZ(i, z * scaleFactor);
    }
  }
  geo.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({
    color,
    side: THREE.BackSide,
    fog: true,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = baseY;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.userData.baseColor = new THREE.Color(color);
  return mesh;
}

/**
 * 山脈(buildMountainScenery が返すグループ)の明るさを手動で調整する。
 * 山肌はMeshBasicMaterial(ライトの影響を受けない固定色)を使っているため、
 * 昼夜の明るさ変化に合わせて暗くするにはこのように明示的に色を掛け合わせる
 * 必要がある(そうしないと夜になっても山だけ明るいままになってしまう)。
 * @param {THREE.Group} group - buildMountainScenery() の戻り値
 * @param {number} factor - 0(真っ黒)〜1(元の色)の明るさ係数
 */
export function setMountainBrightness(group, factor) {
  group.traverse((obj) => {
    if (obj.isMesh && obj.userData.baseColor) {
      obj.material.color.copy(obj.userData.baseColor).multiplyScalar(factor);
    }
  });
}

/**
 * 遠景・近景2層の山脈をまとめて作る(奥行きのある山並みに見せる)。
 * @param {object} opts
 * @param {number} [opts.nearRadius]
 * @param {number} [opts.farRadius]
 */
export function buildMountainScenery(opts = {}) {
  const group = new THREE.Group();

  const near = buildMountainRing({
    radius: opts.nearRadius ?? 95,
    height: 46,
    baseY: -14,
    color: 0x5f6f52, // 近い山肌は緑がかった、はっきりした色
    noiseSeed: 11,
    radialJag: 0.09,
  });
  const far = buildMountainRing({
    radius: opts.farRadius ?? 175,
    height: 78,
    baseY: -22,
    color: 0xaab9ba, // 遠い山は霞んで淡い色(空気遠近法)
    noiseSeed: 271,
    radialJag: 0.05,
  });

  group.add(far); // 先に奥、後に手前(描画順というより見た目上の意味づけ)
  group.add(near);
  return group;
}

/**
 * 地形の端と山脈の間にできる「何もない空間」を埋めるための、
 * 低ポリな地面の延長(遠くの森の地面のイメージ)。
 * 地形の縁からなだらかに標高を下げつつ、色は霧(fog)に馴染ませて
 * 遠くほど自然に空の色へ溶け込むようにする。
 * @param {number} innerRadius - ここから外側を覆う(実際の地形の縁より少し内側でよい)
 * @param {number} outerRadius - 山脈の裾に届く程度の大きさ
 * @param {number} groundY - 地形の縁のだいたいの高さ
 */
export function buildHorizonFill(innerRadius = 34, outerRadius = 110, groundY = 0) {
  const radialSegments = 64;
  const ringSegments = 3;
  const geo = new THREE.RingGeometry(innerRadius, outerRadius, radialSegments, ringSegments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const t = Math.min(1, (r - innerRadius) / (outerRadius - innerRadius));
    // 内側(地形の縁)は地形の高さに合わせ、外側はなだらかに下げて山の裾へ続ける
    const y = groundY - t * t * 16;
    pos.setY(i, y);
  }
  geo.computeVertexNormals();

  const material = new THREE.MeshToonMaterial({
    color: 0x2f4a2c, // 遠くの森を思わせる暗い緑
    fog: true,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}
