// terrain.js
// 地形メッシュを、ノイズによる起伏+川の経路に沿った谷掘りで作る。
// 木・テント・焚き火は、この地形の高さを実際にサンプリングして
// 「地面の上」に正しく配置する(2D版で起きた「川に木が立つ」問題を
// 構造的に避けられる)。

import * as THREE from 'three';
import { ambientHeightAt } from './terrain-noise.js';
import { getRiver, distanceToRiver, applyRiverChannel } from './river.js';
import { getToonGradientMap } from './shading.js';
import { grassZoneValue, GRASS_ZONE_SPARSE_THRESHOLD, GRASS_ZONE_ULTRA_THRESHOLD } from './ground-detail.js';

// Phase 3(2026-09): 160m×160m → 226m×226m(Playable Areaを面積で約2倍に)。
// 頂点間隔(0.5m/segment)は維持するため、セグメント数も比例して増やす
// (226 / 0.5 = 452)。
export const TERRAIN_SIZE = 226;
export const TERRAIN_SEGMENTS = 452;

// 2026-09(地形自動生成フェーズ): 以前はここで `const river = getRiver();`
// と1回だけ取得してモジュールスコープに固定していたが、これだと
// setRiverControlPoints()で川の形を差し替えても、この古い参照は
// 更新されずに残ってしまう(=川だけ新しい形なのに地形の谷掘りは
// 古い川のままになる不具合の原因になる)。
// そのため、使う場所(naturalHeightAt/riverClearance)でその都度
// getRiver()を呼び直す形にする(getRiver()自体は計算済みならキャッシュを
// 返すだけなので、頂点ごとに呼んでもコストはごくわずか)。

// --- 構造物による「平地」処理(汎用) ---
// テント・焚き火などの構造物は、それぞれの足元(footprint)だけを
// なだらかに平らへ均す。以前は「キャンプ全体」を覆う1つの巨大な
// 固定半径・固定座標でまとめて平坦化しており、その範囲がたまたま
// 川の谷とも重なっていたため、キャンプ付近で川の谷が消えて
// 川が干上がって見える不具合の原因になっていた。
//
// 汎用化のポイント(将来ユーザーが川の形や構造物の位置を自由に
// 変更できるようにする際も、このロジックはそのまま使える):
//   - 平坦化は「固定座標」ではなく、configureFlattening() で渡される
//     構造物リスト([{x, z, radius, feather}, ...])だけから決まる。
//   - どんなに構造物を川の近くに置いても、川の水路の中(川岸+余白)は
//     平坦化の対象から除外され、谷が消えることはない。
let flattenStructures = [];

/**
 * 地形を平らに均す構造物(テント・焚き火など)を設定する。
 * 必ず buildTerrainMesh() より前、かつ river.js の中心線が
 * 確定した後に呼ぶ。
 * @param {{x:number, z:number, radius:number, feather?:number}[]} structures
 *   radius: この半径内は完全に平ら。feather: そこからなだらかに自然な地形へ戻すまでの距離(省略時は radius と同程度)。
 */
export function configureFlattening(structures) {
  flattenStructures = (structures || []).map((s) => ({
    x: s.x,
    z: s.z,
    radius: s.radius,
    feather: s.feather ?? s.radius,
    // 構造物ごとに、その場所自体の「自然な高さ」を平坦化の目標にする
    // (キャンプ全体で1つの高さに揃えるのではなく、構造物ごとに個別)
    height: naturalHeightAt(s.x, s.z),
  }));
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 平地処理をかける前の、純粋な起伏+谷掘りだけの高さ。
 *
 * 川の谷掘りは、以前は「アンビエントノイズ - 断面形状(getChannelDepth)」
 * というその場しのぎの計算だったが、現在は river.js の Hydrology Solver が
 * 縦断方向(上流→下流)で整合性の取れた河床標高プロファイルを計算しており
 * (getRiver().hydrology)、applyRiverChannel() がそれを使って谷を掘る。
 * これにより、地形・水面・川底のすべてが同じ「Physical River State」を
 * 参照するようになっている。
 */
function naturalHeightAt(x, z) {
  const ambient = ambientHeightAt(x, z);
  return applyRiverChannel(x, z, ambient, getRiver());
}

// 川岸からこれだけ余白を持たせた範囲までは、平坦化を一切かけない
// (構造物のfeatherがどれだけ広くても、川の水路には絶対に触れさせない)
const RIVER_NO_FLATTEN_MARGIN = 1.2;

/**
 * (x,z)が川の水路にどれだけ近いかを0〜1で返す。
 * 0 = 完全に水路の中(平坦化は絶対にかけない)、1 = 水路から十分離れている(通常通り平坦化可)。
 */
function riverClearance(x, z) {
  const { distance, width } = distanceToRiver(x, z, getRiver().centerline);
  const inner = width / 2;
  const outer = inner + RIVER_NO_FLATTEN_MARGIN;
  return smoothstep(inner, outer, distance);
}

/**
 * (x,z)における地形の高さ(y)を返す。川に近いほど谷になり、
 * configureFlattening() で登録された構造物の足元だけが平らになる。
 * ただし川の水路そのものは、構造物がどれだけ近くにあっても
 * 絶対に平坦化されない(riverClearanceで保護)。
 */
export function terrainHeightAt(x, z) {
  const natural = naturalHeightAt(x, z);
  if (flattenStructures.length === 0) return natural;

  const clearance = riverClearance(x, z);
  if (clearance <= 0) return natural; // 川の水路の中: 平坦化なし

  // 複数の構造物が近くにある場合は、最も強く効くもの(距離が近いもの)を採用する
  let flattenAmount = 0;
  let targetHeight = natural;
  for (const s of flattenStructures) {
    const d = Math.hypot(x - s.x, z - s.z);
    const local = 1 - smoothstep(s.radius, s.radius + s.feather, d);
    if (local > flattenAmount) {
      flattenAmount = local;
      targetHeight = s.height;
    }
  }
  flattenAmount *= clearance;

  return natural * (1 - flattenAmount) + targetHeight * flattenAmount;
}

/**
 * 地形メッシュを作る。
 *
 * 2026-09(v1.36): 「草を地面が見えないほど密集させてほしい。処理が重く
 * なるなら錯覚でも良い」という要望への対応。草のインスタンス数だけで
 * 完全に地面を隠すのは負荷が高いため、超密集ゾーン(ground-detail.jsの
 * GRASS_ZONE_ULTRA_THRESHOLD以上)では地形メッシュ自体の頂点カラーを
 * 濃い草地寄りへ暗くしておく。草の間から地面が覗いても、そこがまだ
 * 濃い緑色なので「隙間なく茂っている」ように見える、という単純な錯覚を
 * 草の実際の増量(ground-detail.js側)と併用している。
 *
 * 重要: 季節の色変化(scene3d.jsのapplySeasonAndSnow)は、この頂点カラーを
 * 上書きするのではなく、terrain.material.color(季節ごとの色)と乗算する
 * 形で効く(MeshToonMaterialのvertexColors有効時の挙動)。そのため、
 * ここでの頂点カラーは「絶対的な色」ではなく「季節色に対する乗算係数」に
 * する必要がある(通常域=白(1,1,1)=無変化、超密集ゾーン=暗く・より緑に
 * 寄せる係数)。ここを絶対色にしてしまうと、季節色と二重に掛かって
 * 地形全体が不自然に暗くなってしまうので注意。
 */
export function buildTerrainMesh() {
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  geo.rotateX(-Math.PI / 2);

  const normalMult = new THREE.Color(1, 1, 1);
  const denseMult = new THREE.Color(0.55, 0.74, 0.42); // 季節色に掛ける係数: 暗く、かつ緑を残す方向

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const tmpColor = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, terrainHeightAt(x, z));

    // 超密集ゾーンのしきい値に近づくにつれて、なめらかに暗い草地係数へ
    // 寄せる(硬い境界線ができないようsmoothstepで補間)。
    const zoneValue = grassZoneValue(x, z);
    const t = smoothstep(GRASS_ZONE_SPARSE_THRESHOLD, GRASS_ZONE_ULTRA_THRESHOLD + 0.05, zoneValue);
    tmpColor.copy(normalMult).lerp(denseMult, t);
    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const material = new THREE.MeshToonMaterial({
    color: 0x4d6b3c, // 季節の色変化(scene3d.js)が毎フレーム上書きする初期値
    vertexColors: true,
    gradientMap: getToonGradientMap(),
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return mesh;
}
