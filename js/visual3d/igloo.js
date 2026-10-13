// igloo.js
// テントが積雪で埋もれた時に代わりに表示する「かまくら」。
// 雪だるまが立って入れる大きさのドーム(半球)+入口の開口部+
// 中を照らす蝋燭(モデル+明かり)で構成する。
// 原点はかまくら底面(地面/雪面と接する場所)の中心。
//
// 2026-09(v1.26): 改訂5の影設定がscene3d.jsの一括処理に上書きされ、実際の
// シーンでは効いていなかった(モアレが残った原因)。メッシュに
// userData.keepShadowFlags を付けて上書きされないようにした。また、
// 階調を4段から256段の滑らかな階調へ変更した。
//
// 2026-09(改訂5): 実機フィードバックへの対応。
// - 「視点の距離や角度でかまくらの表面にシワ/モアレが出る」: 原因は、
//   壁が両面描画(DoubleSide)かつ影を落とす/受ける設定のままだったため、
//   曲面が自分自身の影を細かく受ける「シャドウアクネ」が出ていたこと。
//   外壁(FrontSide・影を落とすが受けない)と内壁(BackSide・影を受ける
//   だけ)にマテリアルと影の設定を分離した。また、以前は柱(入口の断面)の
//   ジオメトリが表裏の両巻きで法線が打ち消し合っていた(法線がゼロ)ので、
//   片巻きにして正しい法線を持たせた。壁の法線は球面の解析解(位置の
//   正規化)を使い、上段のドームと下段の帯の継ぎ目で陰影が途切れない。
// - 「入口の上の方が尖っている。丸くして」: 以前はアーチの幅をsmoothstepで
//   0へ絞っていたため、頂点で針のように細く尖っていた。今回は頂点で
//   水平に接する1/4楕円(半円状)の輪郭にし、頂点付近は細かく分割した。
// - 「もっと白っぽく」: 外壁に、ごくわずかな自己発光(emissive)を加えて
//   暗い時間帯でも灰色に沈まないようにし、階調の下限も引き上げた。
//
// 2026-09(改訂4): 複数の実機フィードバックへの対応。
// - 「壁の厚み15cmを40cmに」: WALL_THICKNESSを0.4へ(内径は変えない)。
// - 「入口の切断面が全て鋭角。角を丸く」: 以前は「入口全体を長方形の
//   ウェッジで欠けさせ、上端を平らな"まぐさ"で塞ぐ」方式だったため、
//   左右の柱とまぐさの継ぎ目が直角の鋭い角になっていた。今回、入口の
//   欠け方自体を「地面付近は全開の長方形、上に行くほど滑らかに幅が
//   狭まっていき、上端では幅0(=1点)に収束するアーチ形」に作り直した。
//   これにより上端は自然に丸く閉じ、左右の柱の断面も上端の1点へ
//   なめらかに集約するので、まぐさ自体が不要になり、鋭い角が生じない。
// - 「全体をふんわり柔らかく、マシュマロみたいに。色が少しグレーなので
//   白っぽく」: 分割数を増やして輪郭をより滑らかにし、専用の明るめの
//   トゥーングラデーションと、より純粋な白に近い色へ変更した。
//
// 2026-09(改訂3): 「壁の厚みが全く無いのが変」との指摘に対応し、内径
// (半径)はそのままに、壁に実際の厚みを持たせた。
//
// 2026-09(改訂2): 「入口が実際には穴になっておらず、暗い板を貼っただけの
// "黒いドア"に見える。雪だるまが中へ歩いて入れない」という指摘に対応し、
// ドームのジオメトリ自体に本物の開口部を作る方式に作り直した。板を貼る
// のではなく実際に壁が存在しない開口部になるため、雪だるまがそのまま
// 歩いて中へ入れる(衝突判定側もこの開口部に合わせてscene3d.js側で
// 対応させる)。
//
// 2026-09(改訂): 実機フィードバックへの対応。
// - 外壁の横縞(リング)は「ラインが見える」と指摘されたため削除し、
//   継ぎ目の無い滑らかなドームにした。
// - 雪だるまが余裕を持って入れるよう、既定スケールでの半径を拡大。
// - 蝋燭を、ただの光る球ではなく「ろうそく本体+炎」のミニチュア模型に
//   差し替え、明かりも明るくした。

import * as THREE from 'three';
import { getSmoothGradientMap } from './shading.js';

// 2026-09(改訂4): 「色が少しグレー、白っぽくしてほしい」「マシュマロ
// みたいにふんわり柔らかく」との指摘に対応し、shading.jsのgetCloudGradientMap()
// と同じ考え方(影側でも暗くなりすぎない「floor」付きの階調マップ)で、
// かまくら専用の明るく柔らかいグラデーションを用意した。シーン共通の
// getToonGradientMap()より影を浅くすることで、白くふんわりした質感にする。
// 他のオブジェクト(地形・木など)の見た目には影響しない。
// 2026-09(v1.26): 4段の階調だと、ドーム全体に帯状の等高線(縞)が見える
// ため、256段+線形補間の滑らかな階調(shading.jsのgetSmoothGradientMap)に
// した。「影側でも暗くしない」floorは0.85(4段版の0.9より少し下げ、
// 滑らかになった分、形の陰影が読み取れるようにした)。
function buildSoftWhiteGradientMap() {
  return getSmoothGradientMap(0.85);
}
const SOFT_WHITE_GRADIENT = buildSoftWhiteGradientMap();

// 2026-09(改訂2): 中に入れるようになったため、内側から見た時にドームの
// 壁が透けて見えないよう両面描画にする(既定では裏面が描画されず、
// 内部から見ると壁が消えて背景が透けてしまうため)。
// 外壁: 前面のみ描画。ごくわずかな自己発光で白さを保つ(改訂5)。
const SNOW_OUTER_MATERIAL = new THREE.MeshToonMaterial({
  color: 0xffffff, gradientMap: SOFT_WHITE_GRADIENT, side: THREE.FrontSide,
  emissive: new THREE.Color(0x15181a),
});
// 「影を落とす側」の描画は両面にする(太陽側の外壁の前面が影として記録され、
// 内壁に太陽光が壁越しに差し込まないようにするため)。受ける設定は
// 外壁ではオフなので、これによるシャドウアクネは出ない。
SNOW_OUTER_MATERIAL.shadowSide = THREE.DoubleSide;
// 内壁: 内側から見た時だけ描画(BackSide)。蝋燭の光と、外壁が落とす影を受ける。
const SNOW_INNER_MATERIAL = new THREE.MeshToonMaterial({
  color: 0xffffff, gradientMap: SOFT_WHITE_GRADIENT, side: THREE.BackSide,
});
// 入口の左右の断面(柱): 開口部の外からも内からも見えるので両面描画。
// 小さな面積なので影は落とさず・受けない(アクネの原因を作らない)。
const SNOW_JAMB_MATERIAL = new THREE.MeshToonMaterial({
  color: 0xffffff, gradientMap: SOFT_WHITE_GRADIENT, side: THREE.DoubleSide,
  emissive: new THREE.Color(0x15181a),
});
// 2026-09(改訂3): 「蝋燭の軸(ろう本体)自体が光っているように見えるのは
// 変。光るのは炎だけで、軸は炎の明かりの反射で明るく見えるだけ」との
// 指摘に対応。MeshBasicMaterial(常に一定の明るさで自ら発光して見える)
// をやめ、実際の光源(candleLight)からの陰影を受けるMeshToonMaterialに
// 変更した。炎だけは自ら光って見えるべきなのでMeshBasicMaterialのまま。
const CANDLE_BODY_MATERIAL = new THREE.MeshToonMaterial({ color: 0xfbf3d8, gradientMap: SOFT_WHITE_GRADIENT });
const CANDLE_FLAME_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xffcf6b });

// 入口の開口部の半角(度)。地面付近での全開時の半角(既定70°)。
// scene3d.js側の衝突判定(通り抜けられる隙間)もこの値に合わせる必要が
// あるため、DOORWAY_HALF_ANGLE_RADとして外部にも公開する。
const DOORWAY_HALF_ANGLE_DEG = 35;
export const DOORWAY_HALF_ANGLE_RAD = (DOORWAY_HALF_ANGLE_DEG * Math.PI) / 180;
// 開口部の高さ(アーチの頂点)は、ドーム半径に対する比率(0〜1)で指定する
// (thetaで言えばacos(この値)が入口の一番高い場所)。
const DOORWAY_HEIGHT_RATIO = 0.85;
// アーチが始まる高さ(0〜1、DOORWAY_HEIGHT_RATIOに対する割合)。
// 地面からこの高さまでは全開幅の長方形、そこから上はなめらかに幅0へ
// 収束するアーチにする。
const DOORWAY_ARCH_START_RATIO = 0.62;
// 壁の厚み(m)。「40cmぐらいの厚みが欲しい」との指摘にそのまま対応。
export const WALL_THICKNESS = 0.4;

/**
 * 球面上の点(SphereGeometryの座標式と同じ)。
 * x = -r*cos(phi)*sin(theta), y = r*cos(theta), z = r*sin(phi)*sin(theta)
 */
function sphericalPoint(r, phi, theta) {
  return new THREE.Vector3(
    -r * Math.cos(phi) * Math.sin(theta),
    r * Math.cos(theta),
    r * Math.sin(phi) * Math.sin(theta)
  );
}

/**
 * 入口の輪郭(下から上へ並べた {theta, half} の列)を作る。
 * - 地面(theta=π/2)からthetaFullUntilまでは全開幅(maxHalf)の直線部分
 * - thetaFullUntilからthetaArchTopまでは、1/4楕円のアーチ:
 *     theta = thetaFullUntil - (thetaFullUntil - thetaArchTop) * sin(ψ)
 *     half  = maxHalf * cos(ψ)         (ψ: 0→π/2)
 *   頂点(ψ=π/2)では theta の変化がゼロで half だけが変化するため、
 *   輪郭は頂点で水平に接する「丸い」アーチになる(以前のsmoothstep版は
 *   頂点で針のように尖っていた)。ψを等間隔に刻むので、頂点付近ほど
 *   thetaの刻みが細かくなり、丸みが多角形にならない。
 * 上端(half=0)は上段ドームの下端リング(欠けの無い完全な円)とちょうど
 * 接続する。
 */
export function buildDoorwayProfile(maxHalf, thetaArchTop, thetaFullUntil, archSegments = 16, straightSegments = 3) {
  const profile = [];
  for (let i = 0; i < straightSegments; i++) {
    const theta = Math.PI / 2 - (Math.PI / 2 - thetaFullUntil) * (i / straightSegments);
    profile.push({ theta, half: maxHalf });
  }
  for (let j = 0; j <= archSegments; j++) {
    const psi = (Math.PI / 2) * (j / archSegments);
    const theta = thetaFullUntil - (thetaFullUntil - thetaArchTop) * Math.sin(psi);
    const half = j === archSegments ? 0 : maxHalf * Math.cos(psi);
    profile.push({ theta, half });
  }
  return profile;
}

/**
 * 「上段(欠けの無い完全な球帯)」と組み合わせて使う、入口をアーチ状に
 * 欠けさせた下段の球帯ジオメトリを作る(半径r)。profileは下から上への
 * 並び(buildDoorwayProfile)。SphereGeometryでは高さごとに欠け幅を変え
 * られないため、頂点を手作業で並べるBufferGeometryとして構築する。
 * 法線は球面の解析解(位置の正規化=外向き)。巻き順は外向きが表面。
 */
function buildArchedBand(r, profile, gapCenterPhi, phiSegments) {
  const rowsTopDown = profile.slice().reverse(); // アーチの頂点(小さいtheta)から地面へ
  const positions = [];
  const normals = [];
  for (const { theta, half } of rowsTopDown) {
    const phiStart = gapCenterPhi + half;
    const phiLength = Math.PI * 2 - half * 2;
    for (let pi = 0; pi <= phiSegments; pi++) {
      const phi = phiStart + phiLength * (pi / phiSegments);
      const p = sphericalPoint(r, phi, theta);
      positions.push(p.x, p.y, p.z);
      const n = p.clone().normalize();
      normals.push(n.x, n.y, n.z);
    }
  }
  const indices = [];
  const rowLen = phiSegments + 1;
  for (let ti = 0; ti < rowsTopDown.length - 1; ti++) {
    for (let pi = 0; pi < phiSegments; pi++) {
      const a = ti * rowLen + pi, b = ti * rowLen + pi + 1, c = (ti + 1) * rowLen + pi, d = (ti + 1) * rowLen + pi + 1;
      indices.push(a, c, b, b, c, d); // 外向きが表(verify_igloo_surface.mjsで検証)
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

/**
 * 内側の球面(rInner)と外側の球面(rOuter)を、入口の左右の縁
 * (phi = gapCenterPhi ± half(theta))に沿ってつなぐ、柱状のジオメトリ
 * (壁の厚みの断面を塞ぐ)。頂点(half=0)では左右の柱が1点に収束し、
 * 輪郭は上のbuildDoorwayProfile()と同じなので、丸いアーチの縁になる。
 * 片巻きにして法線を正しく計算する(両面描画はマテリアル側で行う)。
 */
function buildCurvedJamb(rInner, rOuter, sign, profile, gapCenterPhi) {
  const positions = [];
  for (const { theta, half } of profile) {
    const phi = gapCenterPhi + sign * half;
    const pIn = sphericalPoint(rInner, phi, theta);
    const pOut = sphericalPoint(rOuter, phi, theta);
    positions.push(pIn.x, pIn.y, pIn.z, pOut.x, pOut.y, pOut.z);
  }
  const indices = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    indices.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * ミニチュアの蝋燭(台+ろう本体+炎)を作る。
 * @param {number} size - 蝋燭全体のおおよその高さ(m)
 */
function buildCandle(size) {
  const group = new THREE.Group();
  const bodyH = size * 0.7;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(size * 0.18, size * 0.2, bodyH, 8),
    CANDLE_BODY_MATERIAL
  );
  body.position.y = bodyH / 2;
  group.add(body);
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(size * 0.12, size * 0.32, 6),
    CANDLE_FLAME_MATERIAL
  );
  flame.position.y = bodyH + size * 0.16;
  group.add(flame);
  group.userData.flame = flame;
  group.userData.flameBaseY = flame.position.y;
  group.userData.flameBaseScale = flame.scale.clone();
  return group;
}

/**
 * かまくらのGroupを作る。
 * @param {number} scale - 雪だるまが立って入れる大きさを基準(scale=1で内径約2.1m)
 */
export function createIgloo(scale = 1) {
  const group = new THREE.Group();
  const radius = 2.1 * scale; // 内径。2026-09(改訂2): 「小さい」との指摘でscale自体もscene3d.js側で拡大
  const outerRadius = radius + WALL_THICKNESS; // 2026-09(改訂3/4): 壁の厚みぶん外側に拡張(内径は変えない)

  // ドームの頂点(theta=0)を基準に、開口部の一番高い場所(アーチの頂点)に
  // 対応するtheta境界を求める(y = radius * cos(theta) なので
  // theta = acos(y/radius))。内径(radius)を基準に高さを決める。
  const doorHeight = radius * DOORWAY_HEIGHT_RATIO;
  const thetaArchTop = Math.acos(Math.min(1, doorHeight / radius));
  const thetaFullUntil = thetaArchTop + (Math.PI / 2 - thetaArchTop) * DOORWAY_ARCH_START_RATIO;
  // +Z方向(入口の向き)はSphereGeometryの座標式でphi=π/2にあたる。
  const gapCenterPhi = Math.PI / 2;
  const half = DOORWAY_HALF_ANGLE_RAD;
  const profile = buildDoorwayProfile(half, thetaArchTop, thetaFullUntil);

  const dome = new THREE.Group();
  // 外壁=影を落とす(受けない: シャドウアクネ対策)/内壁=影を受ける(落とさない)。
  const addShell = (geo, material, { cast, receive }) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.userData.keepShadowFlags = true; // scene3d.jsの一括の影設定で上書きさせない(v1.26)
    dome.add(mesh);
  };
  const OUTER_FLAGS = { cast: true, receive: false };
  const INNER_FLAGS = { cast: false, receive: true };
  // 2026-09(改訂4): 分割数を増やして輪郭を滑らかにした(24→32)。
  // 改訂5: 上段ドームの縦分割も 6→10 に増やし、陰影の段差を減らした。
  const PHI_SEGMENTS = 32;
  const CAP_THETA_SEGMENTS = 10;
  // 上段(頂点〜アーチの頂点、欠け無し)を内外2枚
  addShell(new THREE.SphereGeometry(radius, PHI_SEGMENTS, CAP_THETA_SEGMENTS, 0, Math.PI * 2, 0, thetaArchTop), SNOW_INNER_MATERIAL, INNER_FLAGS);
  addShell(new THREE.SphereGeometry(outerRadius, PHI_SEGMENTS, CAP_THETA_SEGMENTS, 0, Math.PI * 2, 0, thetaArchTop), SNOW_OUTER_MATERIAL, OUTER_FLAGS);
  // 下段(アーチの頂点〜地面、入口をアーチ状に欠けさせる)を内外2枚
  addShell(buildArchedBand(radius, profile, gapCenterPhi, PHI_SEGMENTS), SNOW_INNER_MATERIAL, INNER_FLAGS);
  addShell(buildArchedBand(outerRadius, profile, gapCenterPhi, PHI_SEGMENTS), SNOW_OUTER_MATERIAL, OUTER_FLAGS);

  // 入口の左右の縁(壁の厚みの断面)を塞ぐ、曲がった柱。頂点で幅0の1点に
  // 収束し、輪郭は丸いアーチ。
  const jambLeft = new THREE.Mesh(buildCurvedJamb(radius, outerRadius, -1, profile, gapCenterPhi), SNOW_JAMB_MATERIAL);
  const jambRight = new THREE.Mesh(buildCurvedJamb(radius, outerRadius, 1, profile, gapCenterPhi), SNOW_JAMB_MATERIAL);
  jambLeft.castShadow = jambRight.castShadow = false;
  jambLeft.receiveShadow = jambRight.receiveShadow = false;
  jambLeft.userData.keepShadowFlags = jambRight.userData.keepShadowFlags = true;
  dome.add(jambLeft, jambRight);
  group.add(dome);

  // 中を照らす蝋燭(モデル+明かり)。開口部のすぐ内側に置き、開口部から
  // 光が漏れて外の雪をほんのり照らすようにする。
  const candle = buildCandle(radius * 0.22);
  candle.position.set(0, 0.02, radius * 0.35);
  group.add(candle);

  const candleLight = new THREE.PointLight(0xffb066, 1.8, radius * 4, 2);
  candleLight.position.set(0, radius * 0.32, radius * 0.35);
  group.add(candleLight);

  return {
    group,
    radius,
    outerRadius,
    doorwayLocalOffset: new THREE.Vector3(0, 0, outerRadius),
    doorwayHalfAngle: half,
    /**
     * 炎のゆらめき+明かりの明滅を進める(scene3d.jsの毎フレーム更新から
     * 呼ぶ)。2026-09(改訂3): 「蝋燭の炎を少し揺らして」との指摘に対応。
     */
    updateFlame(t) {
      const flame = candle.userData.flame;
      if (!flame) return;
      const flicker = Math.sin(t * 11.3) * 0.5 + Math.sin(t * 23.7 + 1.4) * 0.3 + Math.sin(t * 5.1 + 0.6) * 0.2;
      const s = 1 + flicker * 0.16;
      flame.scale.set(
        candle.userData.flameBaseScale.x * (1 + flicker * 0.1),
        candle.userData.flameBaseScale.y * s,
        candle.userData.flameBaseScale.z * (1 + flicker * 0.1)
      );
      flame.position.y = candle.userData.flameBaseY + flicker * candle.userData.flameBaseScale.y * 0.02;
      flame.rotation.z = flicker * 0.12;
      candleLight.intensity = 1.8 + flicker * 0.35;
    },
  };
}
