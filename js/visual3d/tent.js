// tent.js
// 単純な三角プリズム(A型テント)ではなく、「低い垂直の壁 + 傾斜した屋根」の
// キャビン型の断面(五角形)で押し出したテントを作る。実在のドームテント/
// ツールームテントに近いシルエットになる。
// さらに、雨よけ(フライシート)とインナー(壁)を色分けし、
// 入口の庇(前室)・グラウンドシート・ガイロープ+ペグを追加してリアルさを出す。
// 原点はテント底面の中心。

import * as THREE from 'three';
import { getToonGradientMap } from './shading.js';

const WALL_MATERIAL = new THREE.MeshToonMaterial({ color: 0x3f5c62, gradientMap: getToonGradientMap() }); // インナー(壁)
const FLY_MATERIAL = new THREE.MeshToonMaterial({ color: 0xa8562f, gradientMap: getToonGradientMap() }); // フライシート(屋根・庇)
const FLOOR_MATERIAL = new THREE.MeshToonMaterial({ color: 0x6b6558, gradientMap: getToonGradientMap() }); // グラウンドシート
const DOOR_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x0c0f10 });
const ROPE_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x222222 });
const PEG_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x3a3a3a });
const POLE_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x555550 });

/**
 * 断面(五角形: 左裾-左壁上-頂点-右壁上-右裾)をZ方向(0〜L)へ押し出した
 * 側面バンドのジオメトリを作る。フラットシェーディング用に面ごとに
 * 独立した頂点を持たせる。
 * @param {[number,number]} upper - 上側の点(x,y)
 * @param {[number,number]} lower - 下側の点(x,y)
 * @param {number} L
 * @param {'left'|'right'} side - どちら側の面か(法線の向きを合わせるため)
 */
function buildBand(upper, lower, L, side) {
  const Af = [upper[0], upper[1], 0];
  const Bf = [lower[0], lower[1], 0];
  const Ab = [upper[0], upper[1], L];
  const Bb = [lower[0], lower[1], L];

  const tris = side === 'left'
    ? [[Af, Bf, Bb], [Af, Bb, Ab]]
    : [[Af, Bb, Bf], [Af, Ab, Bb]];

  const positions = [];
  for (const tri of tris) for (const v of tri) positions.push(...v);
  return positions;
}

/**
 * 妻面(小口の五角形のふた)。sweepは "rightToLeft"(前面用)か
 * "leftToRight"(背面用)かを指定する(法線を外向きにするため)。
 */
function buildCap(points, z, sweep) {
  const apex = points.apex;
  const ordered = sweep === 'rightToLeft'
    ? [points.rightWall, points.rightBase, points.leftBase, points.leftWall]
    : [points.leftWall, points.leftBase, points.rightBase, points.rightWall];

  const tris = [
    [apex, ordered[0], ordered[1]],
    [apex, ordered[1], ordered[2]],
    [apex, ordered[2], ordered[3]],
  ];

  const positions = [];
  for (const tri of tris) {
    for (const p of tri) positions.push(p[0], p[1], z);
  }
  return positions;
}

function makeGeometry(positionsArrays) {
  const positions = [].concat(...positionsArrays);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * テントのGroupを作る。原点は底面中心。
 * @param {number} scale
 */
/**
 * テントの最高点(頂点)の高さ(m)。積雪でテントが完全に埋もれて見えなく
 * なる深さの目安として、scene3d.js側から参照する
 * (createTent()内のH計算と必ず同じ式にすること)。
 */
export function getTentHeight(scale = 1) {
  return 1.35 * scale;
}

export function createTent(scale = 1) {
  const W = 1.1 * scale;
  const H = 1.35 * scale;
  const L = 2.3 * scale;  const wallH = H * 0.34; // 垂直の壁の高さ(ここがあるだけで「三角形」感がなくなる)

  const leftBase = [-W, 0];
  const leftWall = [-W, wallH];
  const apex = [0, H];
  const rightWall = [W, wallH];
  const rightBase = [W, 0];
  const points = { leftBase, leftWall, apex, rightWall, rightBase };

  const group = new THREE.Group();

  // --- 壁(垂直部分。インナーカラー) ---
  const wallGeo = makeGeometry([
    buildBand(leftWall, leftBase, L, 'left'),
    buildBand(rightWall, rightBase, L, 'right'),
  ]);
  const wallMesh = new THREE.Mesh(wallGeo, WALL_MATERIAL);
  wallMesh.position.z = -L / 2;
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  group.add(wallMesh);

  // --- 屋根(傾斜部分+妻面のふた。フライシートカラー) ---
  const flyGeo = makeGeometry([
    buildBand(apex, leftWall, L, 'left'),
    buildBand(apex, rightWall, L, 'right'),
    buildCap(points, 0, 'rightToLeft'),
    buildCap(points, L, 'leftToRight'),
  ]);
  const flyMesh = new THREE.Mesh(flyGeo, FLY_MATERIAL);
  flyMesh.position.z = -L / 2;
  flyMesh.castShadow = true;
  flyMesh.receiveShadow = true;
  group.add(flyMesh);

  // --- グラウンドシート(テントの裾から少しはみ出す薄い床) ---
  const floorGeo = new THREE.BoxGeometry(W * 2.2, 0.04, L * 1.12);
  const floor = new THREE.Mesh(floorGeo, FLOOR_MATERIAL);
  floor.position.y = 0.02;
  floor.receiveShadow = true;
  group.add(floor);

  // --- 入口(正面にわずかに浮かせた暗い五角形) ---
  const doorH = wallH + (H - wallH) * 0.85;
  const doorW = W * 0.38;
  const doorGeo = new THREE.BufferGeometry();
  const doorVerts = [
    -doorW, 0, 0,
    doorW, 0, 0,
    doorW, wallH, 0,
    0, doorH, 0,
    -doorW, wallH, 0,
  ];
  doorGeo.setAttribute('position', new THREE.Float32BufferAttribute(doorVerts, 3));
  doorGeo.setIndex([0, 1, 2, 0, 2, 4, 4, 2, 3]);
  doorGeo.computeVertexNormals();
  const door = new THREE.Mesh(doorGeo, DOOR_MATERIAL);
  door.position.z = -L / 2 + 0.02;
  group.add(door);

  // --- 前室(入口の庇。ポール2本で支えた小さな屋根) ---
  const vestW = doorW * 2.0;
  const vestLen = 0.85 * scale;
  const poleH = wallH * 1.5;
  const frontZ = -L / 2;
  const eaveH = wallH * 0.95; // 庇の付け根の高さ(壁の少し上)
  const awningGeo = new THREE.BufferGeometry();
  const awningVerts = [
    -doorW * 1.4, eaveH, frontZ,
    doorW * 1.4, eaveH, frontZ,
    vestW, poleH, frontZ - vestLen,
    -vestW, poleH, frontZ - vestLen,
  ];
  awningGeo.setAttribute('position', new THREE.Float32BufferAttribute(awningVerts, 3));
  awningGeo.setIndex([0, 1, 2, 0, 2, 3]);
  awningGeo.computeVertexNormals();
  const awning = new THREE.Mesh(
    awningGeo,
    new THREE.MeshToonMaterial({ color: 0xa8562f, gradientMap: getToonGradientMap(), side: THREE.DoubleSide })
  );
  awning.castShadow = true;
  group.add(awning);

  // 前室のポール2本
  for (const side of [-1, 1]) {
    const poleGeo = new THREE.CylinderGeometry(0.025 * scale, 0.025 * scale, poleH, 6);
    const pole = new THREE.Mesh(poleGeo, POLE_MATERIAL);
    pole.position.set(side * vestW * 0.85, poleH / 2, frontZ - vestLen + 0.08);
    pole.castShadow = true;
    group.add(pole);
  }

  // --- ガイロープ+ペグ(テント本体の左右、屋根の傾斜部から) ---
  for (const side of [-1, 1]) {
    const ropeStart = new THREE.Vector3(side * (W - 0.05), wallH + (H - wallH) * 0.5, 0);
    const pegPos = new THREE.Vector3(side * (W + 0.85), 0, 0.25);
    const dir = new THREE.Vector3().subVectors(pegPos, ropeStart);
    const len = dir.length();
    const ropeGeo = new THREE.CylinderGeometry(0.013, 0.013, len, 4);
    const rope = new THREE.Mesh(ropeGeo, ROPE_MATERIAL);
    rope.position.copy(ropeStart).addScaledVector(dir, 0.5);
    rope.position.z += -L / 2;
    rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    group.add(rope);

    const pegGeo = new THREE.ConeGeometry(0.055, 0.16, 5);
    const peg = new THREE.Mesh(pegGeo, PEG_MATERIAL);
    peg.position.set(pegPos.x, 0.04, pegPos.z - L / 2);
    peg.castShadow = true;
    group.add(peg);
  }

  // --- 前室のガイロープ+ペグ ---
  for (const side of [-1, 1]) {
    const ropeStart = new THREE.Vector3(side * vestW * 0.85, poleH, frontZ - vestLen + 0.08);
    const pegPos = new THREE.Vector3(side * (vestW + 0.55), 0, frontZ - vestLen - 0.35);
    const dir = new THREE.Vector3().subVectors(pegPos, ropeStart);
    const len = dir.length();
    const ropeGeo = new THREE.CylinderGeometry(0.012, 0.012, len, 4);
    const rope = new THREE.Mesh(ropeGeo, ROPE_MATERIAL);
    rope.position.copy(ropeStart).addScaledVector(dir, 0.5);
    rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    group.add(rope);

    const pegGeo = new THREE.ConeGeometry(0.05, 0.15, 5);
    const peg = new THREE.Mesh(pegGeo, PEG_MATERIAL);
    peg.position.set(pegPos.x, 0.04, pegPos.z);
    peg.castShadow = true;
    group.add(peg);
  }

  return group;
}
