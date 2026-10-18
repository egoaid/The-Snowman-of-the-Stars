// river.js
// 川の中心線をCatmull-Romスプラインで定義する。
// - getRiverSamples(): 地形の谷を掘るため(terrain.js)に使う中心線サンプル
// - buildRiverMesh() / buildRiverbedMesh(): 実際に描画する水面・川底メッシュ
// 制御点は「奥(z負方向)→手前(z正方向)」に蛇行させている。
//
// --- 設計メモ(2026-09 構造的リライト) ---
// 以前の実装は「中心線サンプル点との最短距離」と「中心線+法線オフセットの
// リボン」を使っていたが、これには2つの根本的な弱点があった。
//
// 1. 「最短距離」が離散サンプル点までの点間距離でしかなく、線分(ポリライン)
//    までの最短距離になっていなかった。カーブが曲がる場所では、どのサンプル
//    点が最も近いかが切り替わる境目で距離場に段差ができ、それが水面の
//    「シワ」として現れていた。
// 2. 水面・川底メッシュを、中心線の各点から法線方向にオフセットした
//    「リボン」として作っていた。地形にはアンビエントなノイズ起伏(中心線
//    からの距離に依存しない)が乗っており、法線方向に地形の高さが必ず
//    単調に変化するとは限らないため、水際の二分探索結果が実際の地形の
//    凹凸と食い違うことがあり、それが「水面が地形から浮いて見える」
//    原因になっていた。また、カーブがきつく曲がる場所では法線オフセットの
//    リボン自体が自己交差し、シワの原因にもなっていた。
//
// 今回の実装は、この2つを構造的に解消するため、以下の方式に変更する。
//
// A. 中心線までの最短距離を「線分までの最短距離」で計算する(nearestRiverPoint)。
//    これはカーブがどんな形でも(将来ランダム生成される川でも)連続で
//    滑らかな距離場になり、曲がり角でのシワが原理的に発生しない。
//
// B. 水面・川底メッシュを、リボンではなく「地形と同じ(x,z)平面上のグリッド」
//    に対して marching squares(等値線の面充填版)で生成する。
//    各グリッド頂点で「水面下かどうか(scalar = waterLevel - terrainHeight)」
//    を実際の地形の高さ関数から直接判定するため、
//    - 水面の縁は必ず地形と同じ(x,z)位置で、地形の高さそのものに一致する
//      (=構造的に隙間ができない)
//    - 水面(waterLevel)と川底(riverbed)は同じ境界形状を共有する
//    - どんなにカーブがきつくても、リボンのような自己交差が起こらない
//    という性質を持つ。将来「ユーザーが自由に地形を描く」「起動時に
//    川をランダム生成する」となっても、この2つの関数(距離場・水面下判定)
//    さえ地形生成側と一致していれば、水面は自動的に地形へ追従する。

import * as THREE from 'three';
import { fbm2D } from './noise.js';
import { getToonGradientMap } from './shading.js';
import { ambientHeightAt } from './terrain-noise.js';
import { makeRng, randRange } from './rng.js';
import { shapeRiverEnds, endHillHeight } from './river-ends.js';
import { RIPPLE_GLSL, buildRippleDefines, createRipplePool, normalizeWaterQuality, WATER_QUALITY_SETTINGS } from './water-ripples.js';

// Phase 3(2026-09): 70m世界向けの元の制御点を、中心(0,0)を基準にそのまま
// 226/70倍(=約3.229倍)へ拡大配置する(160m版の2.286倍からさらに拡大)。
// x・zを同じ倍率で拡大することで、蛇行の形状(曲がり方の比率)は変えずに
// 世界の大きさへ追従させる。
const RIVER_SCALE_70_TO_CURRENT = 226 / 70;
const DEFAULT_CONTROL_POINTS = [
  { x: 6, z: -28 },
  { x: 1, z: -15 },
  { x: 8, z: -5 },
  { x: 0, z: 5 },
  { x: 5, z: 15 },
  { x: -2, z: 28 },
].map((p) => ({ x: p.x * RIVER_SCALE_70_TO_CURRENT, z: p.z * RIVER_SCALE_70_TO_CURRENT }));

function buildCurveFromControlPoints(points) {
  return new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p.x, 0, p.z)),
    false,
    'catmullrom',
    0.5
  );
}

// 2026-09(地形自動生成フェーズ): 既定では今までどおり固定の蛇行(手作業で
// 調整した形)を使う。setRiverControlPoints()を呼んだ場合のみ、
// 自動生成された制御点に差し替わる(= 何も呼ばなければ従来と完全に同じ挙動)。
let curve = buildCurveFromControlPoints(DEFAULT_CONTROL_POINTS);

/**
 * 川の中心線(制御点)を差し替える。呼んだ後は resetDefaultRiver() と
 * あわせて呼び、getRiver() のキャッシュも作り直させること。
 * @param {{x:number,z:number}[]} points
 */
export function setRiverControlPoints(points, options = {}) {
  curve = buildCurveFromControlPoints(points);
  // v1.63: 川の両端を、歩行境界の外側でS字に曲げて丘の陰へ隠す(river-ends.js)。
  // shapeEnds = { seed, playableRadius, terrainHalf } を渡した時だけ有効(渡さなければ従来どおり)。
  endShapeCfg = options.shapeEnds || null;
}
let endShapeCfg = null;

/**
 * シードから、ワールドの端から端まで(Boundary Zoneの外側まで)貫くような
 * 蛇行した川の制御点を生成する。
 * 「川の終端を見せない」(ambient-soundscape-concept-summary.md 6章)の方針に
 * 沿い、始点・終点はどちらも halfExtent(だいたい地形の端)より外側に置き、
 * 森の向こうへ消えていくように見せる。
 * @param {number} seed
 * @param {number} halfExtent - 地形の半分のサイズ目安(この値の外側まで川を伸ばす)
 * @returns {{x:number,z:number}[]}
 */
export function generateRiverControlPoints(seed, halfExtent) {
  const rng = makeRng(seed);
  // 川の大まかな向き(南北基調か東西基調か)を決めてから、少しだけ傾ける。
  const baseAngle = (rng() < 0.5 ? 0 : Math.PI / 2) + randRange(rng, -0.3, 0.3);
  const dirX = Math.sin(baseAngle), dirZ = Math.cos(baseAngle);
  const perpX = -dirZ, perpZ = dirX;

  // 2026-09(バリエーション強化): 蛇行の強さ自体もシードで変える
  // (ほぼまっすぐな川〜大きくうねる川まで出るようにする)。
  const wiggleStrength = randRange(rng, 0.16, 0.42);

  const legCount = 7;
  const overshoot = halfExtent * 1.25; // 地形の端よりさらに外側まで伸ばす
  const totalLen = overshoot * 2;
  const points = [];
  for (let i = 0; i < legCount; i++) {
    const t = i / (legCount - 1);
    const alongDist = -overshoot + t * totalLen;
    // 端(t=0,1)は蛇行を小さめに、中央あたりでしっかり曲がるようにする
    const wiggleEnvelope = Math.sin(t * Math.PI) * 0.7 + 0.3;
    const lateral = randRange(rng, -halfExtent * wiggleStrength, halfExtent * wiggleStrength) * wiggleEnvelope;
    points.push({
      x: dirX * alongDist + perpX * lateral,
      z: dirZ * alongDist + perpZ * lateral,
    });
  }
  return points;
}

function widthAtT(t) {
  // t=0(奥)で細く、t=1(手前)で広くなる(増水して川幅・水量感を出す)
  return riverWidthBase + t * riverWidthGrowth;
}

// 2026-09(バリエーション強化): 以前は川幅が常に固定式(1.3 + t*5.5)だった
// ため、シードを変えても川の「細さ/太さ」自体は毎回同じだった。
// configureRiverWidthSeed()を呼ぶと、シードに応じて基準幅・増加量を
// 変える(既定値は元の固定式と完全に一致させてある)。
let riverWidthBase = 1.3;
let riverWidthGrowth = 5.5;

/**
 * シードから川幅のバリエーション(細い川〜広い川)を決める。
 * @param {number} seed
 */
export function configureRiverWidthSeed(seed) {
  const rng = makeRng((seed ^ 0x51ed2704) >>> 0 || 1);
  riverWidthBase = randRange(rng, 0.9, 2.2);
  riverWidthGrowth = randRange(rng, 3.5, 9.0);
}

/** 既定の川幅に戻す。自動生成をOFFに戻す時に使う。 */
export function resetRiverWidth() {
  riverWidthBase = 1.3;
  riverWidthGrowth = 5.5;
}

// 中心線サンプル数。以前は呼び出し側ごとに60〜80とバラバラだったが、
// 距離場を線分ベースにした今でも「折れ線が実際のスプライン曲線に
// どれだけ近いか」は連続性に影響するため、全体で1つの十分に細かい値に
// 統一する。
// Phase 3(2026-09): 川の実長がさらに約1.41倍(160m→226m)になったため、
// 中心線1サンプルあたりの間隔を維持するため、サンプル数も220→310へ増やす。
export const RIVER_SAMPLE_COUNT = 310;

/**
 * 川の中心線サンプル(地形の谷掘り・木の配置回避などに使う)。
 * @param {number} count
 * @returns {{x:number, z:number, width:number, t:number}[]}
 */
export function getRiverSamples(count = RIVER_SAMPLE_COUNT) {
  const pts = curve.getPoints(count);
  return pts.map((p, i) => ({ x: p.x, z: p.z, width: widthAtT(i / count), t: i / count }));
}

/**
 * 任意の(x,z)から川の中心線(折れ線)までの最短点そのものを返す。
 *
 * 以前は「離散サンプル点との最短距離」だったため、カーブが曲がる場所で
 * 距離場が不連続になっていた。ここでは中心線を「線分の集合」として扱い、
 * 点と線分の最短距離(線分上への正射影)を全区間について求め、その中の
 * 最小値を採用する。これにより、カーブの形状に関わらず連続で滑らかな
 * 距離場になる(=水面のシワが原理的に発生しない)。
 *
 * 戻り値には、その最短点における接線方向(tangentX/Z、川の流れの向き)も
 * 含める。これは水面メッシュのUV(岸のどちら側か)の計算に使う。
 */
export function nearestRiverPoint(x, z, samples) {
  let best = null;
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const lenSq = abx * abx + abz * abz;
    let t = lenSq > 1e-9 ? ((x - a.x) * abx + (z - a.z) * abz) / lenSq : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const px = a.x + abx * t;
    const pz = a.z + abz * t;
    const dx = x - px;
    const dz = z - pz;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (!best || distance < best.distance) {
      const width = a.width + (b.width - a.width) * t;
      const segLen = Math.sqrt(lenSq) || 1;
      best = {
        x: px,
        z: pz,
        distance,
        width,
        t: (i + t) / (samples.length - 1),
        tangentX: abx / segLen,
        tangentZ: abz / segLen,
      };
    }
  }
  if (!best) {
    return { x, z, distance: 0, width: 0, t: 0, tangentX: 0, tangentZ: 1 };
  }
  return best;
}

/**
 * 任意の(x,z)から川の中心線までの最短距離と、その位置の川幅を返す。
 * 地形の谷掘り・オブジェクト配置の「川を避ける」判定に使う。
 */
export function distanceToRiver(x, z, samples) {
  const nearest = nearestRiverPoint(x, z, samples);
  return { distance: nearest.distance, width: nearest.width };
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// --- 川の断面(深さ)形状 ---
// 「その地点の川幅」だけから断面形状を決める(将来ユーザーが
// 川の形を変えても、この関係式だけで自動的に破綻なく形が決まる)。
//
// 水面は中心線基準でほぼ水平な1枚の面として描くため(実際の川と同じ)、
// 水路の中(distance <= halfWidth)は川幅に応じた深さで一定に掘り下げ、
// 必ず水面の下に収まるようにする(=浅瀬を装って部分的に浅くすると、
// 水面より底のほうが高くなって干上がって見える不具合になるため避けている)。
// 岸の外側は、深さに比例した距離でなだらかに立ち上がる土手にする
// (深さに関わらず傾斜がほぼ一定になるので、深い区間でも崖にならない)。
const RIVER_DEPTH_BASE = 1.3;
const RIVER_DEPTH_PER_WIDTH = 0.45;
const RIVER_BANK_SLOPE_FACTOR = 0.9; // 土手の距離 = 深さ × この倍率(緩斜面を保つ)
export const RIVER_WATER_CLEARANCE = 1.0; // 最深部の上に張る水の厚み(水面の高さに使う)

/**
 * その地点の川幅から、水路の深さ(一定)を決める。
 * 川幅が広いほど深い=下流ほど水量が増える自然な傾向の近似。
 */
function maxDepthForWidth(width) {
  return RIVER_DEPTH_BASE + width * RIVER_DEPTH_PER_WIDTH;
}

/**
 * (中心線までの距離, その地点の川幅) から谷の深さを返す。
 * terrain.js の谷掘りと、この後の水面・川底メッシュ生成の両方が
 * この1つの関数だけを参照するため、形状の食い違いが起きない。
 */
export function getChannelDepth(distance, width) {
  const halfWidth = width / 2;
  if (halfWidth <= 0) return 0;
  const maxDepth = maxDepthForWidth(width);
  if (distance <= halfWidth) return maxDepth; // 水路の中: 常に水面下

  const bankRise = maxDepth * RIVER_BANK_SLOPE_FACTOR;
  const t = smoothstep(halfWidth, halfWidth + bankRise, distance);
  return maxDepth * (1 - t);
}

/**
 * 川幅だけから「おおよその」水際までの距離を返す(地形のアンビエントな
 * ノイズ起伏は考慮しない近似値)。メッシュの正確な形状には使わず、
 * オブジェクト配置の回避マージンや、水面の色グラデーション用UVの
 * 正規化など、多少のズレが問題にならない場面でのみ使う。
 */
export function getWaterEdgeDistance(width) {
  const halfWidth = width / 2;
  if (halfWidth <= 0) return 0;
  const maxDepth = maxDepthForWidth(width);
  const targetDepth = Math.max(0, maxDepth - RIVER_WATER_CLEARANCE);

  if (targetDepth >= maxDepth) return halfWidth; // 水面の厚みが0以下という異常値への保険

  // getChannelDepth(d, width) は d>=halfWidth で単調減少なので二分探索できる
  let lo = halfWidth;
  let hi = halfWidth + maxDepth * RIVER_BANK_SLOPE_FACTOR * 4 + 1; // 十分広い上限
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (getChannelDepth(mid, width) > targetDepth) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * getWaterEdgeDistance() と同じ考え方だが、幅だけの近似式ではなく
 * 実際の地形の高さ関数(terrainHeightFn。ノイズによる細かな起伏も含む)
 * を直接使って、ある一方向(normal)に沿ってのみ二分探索する版。
 * 川沿いの岩の配置など、単一方向の目安が分かれば十分な場面で使う
 * (水面・川底メッシュ本体の形状はグリッドベースの手法に一本化したため、
 * ここでは使っていない)。
 * @param {number} centerX 中心線上の点のx
 * @param {number} centerZ 中心線上の点のz
 * @param {{x:number,y:number}} normal 中心線に垂直な単位ベクトル
 * @param {number} width その地点の川幅(探索範囲の見積もりに使う)
 * @param {(x:number,z:number)=>number} terrainHeightFn 実際の地形の高さ関数
 */
export function getWaterEdgeDistanceOnTerrain(centerX, centerZ, normal, width, terrainHeightFn) {
  const waterLevel = terrainHeightFn(centerX, centerZ) + RIVER_WATER_CLEARANCE;
  const halfWidth = width / 2;
  const maxDepth = maxDepthForWidth(width);

  let lo = halfWidth;
  let hi = halfWidth + maxDepth * RIVER_BANK_SLOPE_FACTOR * 4 + 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const h = terrainHeightFn(centerX + normal.x * mid, centerZ + normal.y * mid);
    if (h < waterLevel) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// =====================================================================
// Hydrology Solver — 川の縦断方向(上流→下流)の標高プロファイル
// =====================================================================
//
// --- 設計メモ(2026-09 追加) ---
// これまでの実装は「水面の高さ = その断面の地形の高さ + 水の厚み」を
// 断面ごとに独立に計算しており、上流から下流までを通した縦断方向の
// 整合性(=下流は上流より高くならない)を保証する仕組みが無かった。
// アンビエントノイズ次第では、下流側がたまたま高くなってしまうことも
// あり得る、という構造的な欠落があった。
//
// ここで追加する Hydrology Solver は、本格的な流体シミュレーションでは
// なく、以下の2つの制約を順番に機械的に適用するだけの軽量な計算である。
//
//   1. 河床(river bed)の縦断プロファイル:
//      「全体的な降下トレンド(RIVER_BASE_GRADIENT)」+
//      「瀬・淵を表す局所的な変動(高周波=瀬/低周波=淵のノイズ、
//      RIVER_MAX_LOCAL_RISEで急な隆起だけを抑制)」を合成する。
//      河床は局所的に上昇してもよい(単調減少を強制しない)。
//   2. 水面(water surface)の縦断プロファイル:
//      上流から下流へ順番に走査し、「河床+最小水深」と「直前地点の
//      水面標高」の小さい方を採る、という累積処理で求める。
//      これにより水面は必ず下流へ単調減少し、河床が局所的に隆起する
//      区間の手前では自動的に「せき止められて水位が保たれる」=淵が
//      できる、という振る舞いが自然に出る。
//
// この2つの標高プロファイル(bedElevation / waterSurfaceElevation)が、
// 地形の谷掘り(applyRiverChannel、terrain.js から呼ばれる)と、
// 水面メッシュ生成(buildRiverField)の両方が参照する「Physical River
// State」になる。

// --- 縦断プロファイルの各種パラメータ ---
// 既存の断面形状パラメータ(RIVER_DEPTH_BASE 等)とは別に、縦断方向にのみ
// 関わるパラメータを新設する。
const RIVER_BASE_GRADIENT = 0.02; // 河床の全体的な降下トレンド(1mあたりの標高低下)
const RIVER_WATER_SLOPE = 0.004; // 水面が最低限これだけは下流へ傾斜する、という下限勾配(淵が無限に水平にならないようにする)
const RIVER_BED_VARIATION = 0.6; // 河床の局所的な変動(瀬・淵)の振幅
const RIVER_MAX_LOCAL_RISE = 0.35; // 隣接サンプル間で河床が急激に隆起することを抑える上限
const RIVER_RIFFLE_SCALE = 0.6; // 瀬(高周波・小刻みな凹凸)のノイズ周波数
const RIVER_POOL_SCALE = 0.12; // 淵(低周波・大きなうねり)のノイズ周波数
export const RIVER_MIN_DEPTH = 0.4; // どんなに浅い場所でも保証する最小水深
export const RIVER_MAX_DEPTH = 6.0; // どんなに深い淵でもこれ以上は深くしない
const RIVER_MAX_DROP = 0.4; // 隣接サンプル間で水面が一度に落ち込める最大量(唐突な崖状の落差を避ける安全策。本格的な滝の表現は別途今後の課題)

/**
 * 川の中心線サンプルから、Hydrology(河床・水面の縦断標高プロファイル)を計算する。
 *
 * @param {{x:number,z:number,width:number,t:number}[]} centerline
 * @param {(x:number,z:number)=>number} ambientHeightFn 川の影響を含まない地形の高さ関数
 * @param {object} [options] 各種パラメータの上書き(省略時はモジュール既定値を使う)
 * @returns {{t:number,x:number,z:number,width:number,bedElevation:number,waterSurfaceElevation:number,depth:number}[]}
 */
export function solveHydrology(centerline, ambientHeightFn, options = {}) {
  const {
    baseGradient = RIVER_BASE_GRADIENT,
    waterSlope = RIVER_WATER_SLOPE,
    bedVariation = RIVER_BED_VARIATION,
    maxLocalRise = RIVER_MAX_LOCAL_RISE,
    riffleScale = RIVER_RIFFLE_SCALE,
    poolScale = RIVER_POOL_SCALE,
    minDepth = RIVER_MIN_DEPTH,
    maxDepth = RIVER_MAX_DEPTH,
    maxDrop = RIVER_MAX_DROP,
    clearance = RIVER_WATER_CLEARANCE,
    sourceAmbient: sourceAmbientOverride,
    arcShift = 0,
  } = options;

  const n = centerline.length;

  // 中心線に沿った累積距離(実際の弧長)。RIVER_BASE_GRADIENT・RIVER_WATER_SLOPE・
  // RIVER_MAX_DROPは「1mあたり」の量として定義したいので、tではなく実距離を使う。
  const arc = new Array(n);
  arc[0] = 0;
  for (let i = 1; i < n; i++) {
    const a = centerline[i - 1];
    const b = centerline[i];
    arc[i] = arc[i - 1] + Math.hypot(b.x - a.x, b.z - a.z);
  }

  const sourceAmbient = sourceAmbientOverride !== undefined ? sourceAmbientOverride : ambientHeightFn(centerline[0].x, centerline[0].z);

  // 1) 河床の縦断プロファイル(全体トレンド + 瀬/淵の局所変動)
  const rawBed = centerline.map((s, i) => {
    const trend = sourceAmbient - baseGradient * (arc[i] + arcShift);
    // 瀬(riffle): 高周波・小振幅で細かい凹凸を作る
    const riffle = fbm2D(s.x * riffleScale, s.z * riffleScale, 2) * bedVariation * 0.4;
    // 淵(pool): 低周波・大振幅でゆるやかな深みを作る(riffleと周波数を変えるため、
    // サンプリング座標をずらしてある)
    const pool = fbm2D(s.x * poolScale + 500, s.z * poolScale + 500, 2) * bedVariation;
    const channelBase = maxDepthForWidth(s.width); // 川幅が広いほど基本的に深い、という既存の傾向を踏襲
    return trend + riffle + pool - channelBase;
  });

  // 隣接サンプル間の急激な隆起だけを抑える(下降方向は自由=淵はいくら深くてもよい)
  const bed = rawBed.slice();
  for (let i = 1; i < n; i++) {
    const maxAllowed = bed[i - 1] + maxLocalRise;
    if (bed[i] > maxAllowed) bed[i] = maxAllowed;
  }

  // 2) 水面の縦断プロファイル: 下流へ単調減少する「包絡線」
  const water = new Array(n);
  water[0] = bed[0] + Math.max(minDepth, clearance);
  for (let i = 1; i < n; i++) {
    const step = arc[i] - arc[i - 1];
    const candidate = bed[i] + Math.max(minDepth, clearance); // 通常の(せき止められていない)場合の水面
    const forcedDrop = water[i - 1] - waterSlope * step; // 最低限これだけは下流へ傾斜する
    let level = Math.min(candidate, forcedDrop); // 単調減少を保証(=淵の手前で自動的にせき止められる)
    const minLevel = water[i - 1] - maxDrop; // 一度に落ち込みすぎない(崖状の落差を避ける)
    if (level < minLevel) level = minLevel;
    water[i] = level;
  }

  // 3) 水深を確定させ、必要ならその場で河床を掘り下げる/持ち上げる
  //    (最小水深・最大水深の制約を、水面プロファイルを崩さずに河床側で吸収する)
  const hydrology = new Array(n);
  for (let i = 0; i < n; i++) {
    let bedY = bed[i];
    let depth = water[i] - bedY;
    if (depth < minDepth) {
      bedY = water[i] - minDepth;
      depth = minDepth;
    } else if (depth > maxDepth) {
      bedY = water[i] - maxDepth;
      depth = maxDepth;
    }
    hydrology[i] = {
      t: centerline[i].t,
      x: centerline[i].x,
      z: centerline[i].z,
      width: centerline[i].width,
      bedElevation: bedY,
      waterSurfaceElevation: water[i],
      depth,
    };
  }
  return hydrology;
}

/**
 * hydrology配列(中心線サンプルと同じ並び・同じt)を、任意のtで線形補間する。
 */
function interpolateHydrology(hydrology, t) {
  const n = hydrology.length - 1;
  const pos = Math.min(n, Math.max(0, t * n));
  const i0 = Math.floor(pos);
  const i1 = Math.min(n, i0 + 1);
  const frac = pos - i0;
  const a = hydrology[i0];
  const b = hydrology[i1];
  return {
    bedElevation: a.bedElevation + (b.bedElevation - a.bedElevation) * frac,
    waterSurfaceElevation: a.waterSurfaceElevation + (b.waterSurfaceElevation - a.waterSurfaceElevation) * frac,
  };
}

/**
 * 任意の(x,z)における「水面の高さ」を返す。水の無い場所(その地点の
 * 地形の高さが水面より高い場所)では -Infinity を返す。
 * 水面メッシュ生成(grid/marching squares)と同じ判定
 * (scalar = waterLevel - terrainHeight > 0)を1点だけ評価するもので、
 * 自動カメラなどが「水面の下に潜らない」ための下限の計算に使う。
 * (2026-09: 自動カメラの裏面表示バグ対応で追加)
 * @param {number} x
 * @param {number} z
 * @param {(x:number,z:number)=>number} terrainHeightFn
 * @param {object} [river]
 */
export function getWaterSurfaceAt(x, z, terrainHeightFn, river = getRiver()) {
  if (x * x + z * z > RIVER_VISIBLE_RADIUS * RIVER_VISIBLE_RADIUS) return -Infinity; // 見える川の外には、水は無い
  const nearest = nearestRiverPoint(x, z, river.centerline);
  const depthEstimate = Math.max(maxDepthForWidth(nearest.width), RIVER_MIN_DEPTH);
  const candidateMargin = nearest.width / 2 + depthEstimate * RIVER_BANK_SLOPE_FACTOR + RIVER_GRID_SAFETY_MARGIN;
  if (nearest.distance > candidateMargin) return -Infinity;
  const waterLevel = interpolateHydrology(river.hydrology, nearest.t).waterSurfaceElevation;
  return terrainHeightFn(x, z) < waterLevel ? waterLevel : -Infinity;
}

/**
 * 「River」データモデルを作る(ジオメトリのみ。Hydrologyは別途 recalculateRiver() で計算する)。
 * @param {number} [count]
 */
export function createRiver(count = RIVER_SAMPLE_COUNT) {
  let centerline = getRiverSamples(count);
  let shape = null;
  if (endShapeCfg) {
    const shaped = shapeRiverEnds(centerline, endShapeCfg);
    centerline = shaped.centerline;
    shape = shaped.info; // null = 想定外の川で、整形しなかった
  }
  return {
    shape,
    source: { x: centerline[0].x, z: centerline[0].z },
    mouth: { x: centerline[centerline.length - 1].x, z: centerline[centerline.length - 1].z },
    centerline,
    flowDirection: 1, // 将来、川の向きを反転する編集操作に対応する余地として持たせてある
    hydrology: null,
    constraints: {
      baseGradient: RIVER_BASE_GRADIENT,
      waterSlope: RIVER_WATER_SLOPE,
      bedVariation: RIVER_BED_VARIATION,
      maxLocalRise: RIVER_MAX_LOCAL_RISE,
      riffleScale: RIVER_RIFFLE_SCALE,
      poolScale: RIVER_POOL_SCALE,
      minDepth: RIVER_MIN_DEPTH,
      maxDepth: RIVER_MAX_DEPTH,
      maxDrop: RIVER_MAX_DROP,
      clearance: RIVER_WATER_CLEARANCE,
    },
  };
}

/**
 * Riverの Hydrology を(再)計算する。中心線の形が変わった時に、この関数を
 * もう一度呼ぶだけで河床・水面標高が再計算される想定(将来の編集機能向け)。
 * @param {ReturnType<typeof createRiver>} river
 * @param {(x:number,z:number)=>number} [ambientHeightFn]
 */
export function recalculateRiver(river, ambientHeightFn = ambientHeightAt) {
  // v1.63: 端を延長した川は、河床の全体勾配を「元の川の先頭(地形の外)を起点にした式」のまま続ける。
  // これにより、境界の内側(中央)の水位・河床は、v1.62とほぼ同じになる。
  const hydroOptions = river.shape
    ? { ...river.constraints, sourceAmbient: ambientHeightFn(river.shape.origFirst.x, river.shape.origFirst.z), arcShift: river.shape.arcShift }
    : river.constraints;
  river.hydrology = solveHydrology(river.centerline, ambientHeightFn, hydroOptions);
  river.source = { x: river.centerline[0].x, z: river.centerline[0].z };
  river.mouth = { x: river.centerline[river.centerline.length - 1].x, z: river.centerline[river.centerline.length - 1].z };
  return river;
}

let _defaultRiver = null;

/**
 * シーン全体で共有する既定のRiver(ジオメトリ+Hydrology計算済み)を返す。
 * 初回呼び出し時にのみ計算し、以降はキャッシュを返す。
 */
export function getRiver() {
  if (!_defaultRiver) {
    _defaultRiver = createRiver();
    recalculateRiver(_defaultRiver, ambientHeightAt);
  }
  return _defaultRiver;
}

/**
 * 2026-09(地形自動生成フェーズ): setRiverControlPoints()で川の形を
 * 差し替えた後、この関数でキャッシュを破棄する。次にgetRiver()が
 * 呼ばれた時、新しい中心線でHydrologyから作り直される。
 * (何もしなければ_defaultRiverは前の形のままキャッシュされ続けるため、
 * 差し替え後は必ずこれを呼ぶこと。)
 */
export function resetDefaultRiver() {
  _defaultRiver = null;
}

/**
 * 地形の高さ関数(terrain.js)から呼ばれる、Hydrology対応の谷掘り関数。
 * 「その(x,z)のアンビエントな地形の高さ」を受け取り、川の中なら
 * Hydrology Solverが計算した河床標高(bedElevation)へ、岸の外側では
 * なめらかにアンビエントな高さへ戻す。
 *
 * 以前は「アンビエントノイズ - 断面形状(getChannelDepth)」という
 * その場しのぎの計算だったが、ここでは「縦断方向で整合性の取れた
 * 河床標高プロファイル」を基準にする。
 *
 * @param {number} x
 * @param {number} z
 * @param {number} ambientHeight その(x,z)の、川の影響を含まないアンビエントな地形高さ
 * @param {ReturnType<typeof createRiver>} [river]
 * @returns {number}
 */
export function applyRiverChannel(x, z, ambientHeight, river = getRiver()) {
  const nearest = nearestRiverPoint(x, z, river.centerline);
  const halfWidth = nearest.width / 2;
  if (halfWidth <= 0) return ambientHeight;

  const { bedElevation } = interpolateHydrology(river.hydrology, nearest.t);

  if (nearest.distance <= halfWidth) return bedElevation; // 水路の中: 縦断プロファイル通りの河床標高

  const depthHere = Math.max(0, ambientHeight - bedElevation);
  const bankRise = Math.max(depthHere, RIVER_MIN_DEPTH) * RIVER_BANK_SLOPE_FACTOR;
  const t = smoothstep(halfWidth, halfWidth + bankRise, nearest.distance);
  const carved = ambientHeight - depthHere * (1 - t);

  // v1.63: 川の端の丘。歩行境界の外側だけ。水路・土手(bankRise の範囲)には載せず、
  // その外側から、緩やかに立ち上げる(川の中に丘を置いて川を塞ぐことはしない)。
  if (river.shape) {
    const hill = endHillHeight(x, z, river.shape, fbm2D);
    if (hill.h > 0) {
      const bankEnd = halfWidth + bankRise + 0.5;
      const channelMask = smoothstep(bankEnd, bankEnd + hill.ramp, nearest.distance);
      return carved + hill.h * channelMask;
    }
  }
  return carved;
}

// =====================================================================
// グリッドベースの水面/川底メッシュ生成(marching squares)
// =====================================================================
//
// 地形と全く同じ(x,z)座標系のグリッドを川の周辺だけに敷き、各格子点で
// 「水面下かどうか(scalar = waterLevel(x,z) - terrainHeight(x,z))」を
// 実際の地形の高さ関数から直接評価する。水面・川底メッシュはどちらも
// この同じグリッド・同じ判定結果(buildRiverField)を三角形分割する
// (triangulateRiverField)ことで作るため、2つのメッシュの境界形状は
// 常に完全に一致する。

// v1.61b: 川が「見える」範囲の半径(世界の中心から)。これより外には、水も川底も作らない。
// 生成ワールドの川は、設計上、地形の端(113m)のさらに外(約141m)まで伸ばしてあり、その先で唐突に終わる断面が見えていた。
// 川の中心線・水位・谷の掘り込みは変えず(=同じシードなら同じ世界)、水と川底の「見える部分」だけを、固定ワールドの川の端
// (約92m)と同じ位置の円で終わらせる。終わりは、水を少しずつ透明にし、木の茂みで隠す(scene3d.jsの「川の両端」)。
export let RIVER_VISIBLE_RADIUS = 94;
/**
 * v1.63: 川の端を丘の陰へ隠す世界(setRiverControlPoints の shapeEnds)では、水を円で切る必要が無いので、
 * 地形の端のすぐ内側まで広げる(水の端は、丘の陰で、水面シェーダーが少しずつ透明にする)。
 */
export function setRiverVisibleRadius(r) { RIVER_VISIBLE_RADIUS = r; }
const RIVER_GRID_CELL = 0.5; // 格子の一辺(地形のノイズ起伏を捉えられる細かさ。terrain.jsの分割幅と同程度)
const RIVER_GRID_SAFETY_MARGIN = 2.0; // 判定範囲の左右に足す安全マージン(地形ノイズによるはみ出しを吸収する)

/**
 * 川の中心線サンプルから、水面が存在しうる範囲の外接矩形を求める。
 * 「水路の半分幅 + 土手が立ち上がりきるまでの距離」より外側は、
 * 地形のノイズ起伏がどうであれ水面下になり得ないことが getChannelDepth()
 * の設計から保証されているので、安全マージンを足した上でその範囲だけを
 * グリッド化すれば十分。
 */
function computeRiverBounds(river) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let maxHalfExtent = 0;
  for (let i = 0; i < river.centerline.length; i++) {
    const s = river.centerline[i];
    // 実際にHydrology Solverが計算した水深(局所的な瀬・淵を反映)と、
    // 幅だけからの見積もりの両方の大きい方を使い、余裕を持って判定範囲を取る。
    const hydroDepth = river.hydrology[i].depth;
    const depthEstimate = Math.max(maxDepthForWidth(s.width), hydroDepth, RIVER_MIN_DEPTH);
    const halfExtent = s.width / 2 + depthEstimate * RIVER_BANK_SLOPE_FACTOR + RIVER_GRID_SAFETY_MARGIN;
    if (halfExtent > maxHalfExtent) maxHalfExtent = halfExtent;
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.z < minZ) minZ = s.z;
    if (s.z > maxZ) maxZ = s.z;
  }
  return {
    minX: minX - maxHalfExtent,
    maxX: maxX + maxHalfExtent,
    minZ: minZ - maxHalfExtent,
    maxZ: maxZ + maxHalfExtent,
  };
}

/**
 * 川周辺のグリッドを作り、各格子点について
 * scalar = waterLevel(x,z) - terrainHeight(x,z) (正=水面下) を評価する。
 * water/riverbed 両方のメッシュ生成が、この同じグリッド・同じ判定結果を
 * 参照するため、2つのメッシュの境界形状が完全に一致する。
 */
function buildRiverField(terrainHeightFn, river = getRiver()) {
  const samples = river.centerline;
  const bounds = computeRiverBounds(river);
  const cols = Math.max(2, Math.ceil((bounds.maxX - bounds.minX) / RIVER_GRID_CELL));
  const rows = Math.max(2, Math.ceil((bounds.maxZ - bounds.minZ) / RIVER_GRID_CELL));
  const stride = cols + 1;
  const grid = new Array((rows + 1) * stride);

  for (let j = 0; j <= rows; j++) {
    const z = bounds.minZ + ((bounds.maxZ - bounds.minZ) * j) / rows;
    for (let i = 0; i <= cols; i++) {
      const x = bounds.minX + ((bounds.maxX - bounds.minX) * i) / cols;
      const nearest = nearestRiverPoint(x, z, samples);
      const hydro = interpolateHydrology(river.hydrology, nearest.t);
      const depthEstimate = Math.max(maxDepthForWidth(nearest.width), RIVER_MIN_DEPTH);
      const candidateMargin = nearest.width / 2 + depthEstimate * RIVER_BANK_SLOPE_FACTOR + RIVER_GRID_SAFETY_MARGIN;

      let scalar = -1; // 負=判定範囲外(=乾いている)
      let waterLevel = 0;
      let u = 0.5;

      if (nearest.distance <= candidateMargin && x * x + z * z <= RIVER_VISIBLE_RADIUS * RIVER_VISIBLE_RADIUS) {
        // 水面の高さは、その場しのぎの「中心点の地形高さ+水の厚み」ではなく、
        // Hydrology Solverが縦断方向で単調減少するよう計算した
        // waterSurfaceElevation(t) をそのまま使う。
        waterLevel = hydro.waterSurfaceElevation;
        const terrainH = terrainHeightFn(x, z);
        scalar = waterLevel - terrainH;

        // UV.x: 0(左岸)〜1(右岸)。近似式(幅だけから決まる水際)で正規化する
        // だけなので、これは見た目の色グラデーション用であり、メッシュの
        // 形状そのもの(scalarの境界)には影響しない。
        const halfW = Math.max(0.001, getWaterEdgeDistance(nearest.width));
        const uNorm = Math.min(1, nearest.distance / halfW);
        const crossX = x - nearest.x;
        const crossZ = z - nearest.z;
        const side = nearest.tangentX * crossZ - nearest.tangentZ * crossX;
        u = 0.5 + 0.5 * Math.sign(side) * uNorm;
      }

      grid[j * stride + i] = { x, z, scalar, waterLevel, u, v: nearest.t, fx: nearest.tangentX, fz: nearest.tangentZ }; // v1.66: fx,fz = その地点の川の流れの向き(下流向き)
    }
  }

  return { grid, cols, rows, stride };
}

/**
 * 2点の格子属性を、scalarの符号が反転する境界上の位置(alpha)で線形補間する。
 * (座標・UVのみ。高さ(y)はメッシュの種類ごとにyPickerが別途決める)
 */
function lerpFieldAttrs(a, b, alpha) {
  return {
    x: a.x + (b.x - a.x) * alpha,
    z: a.z + (b.z - a.z) * alpha,
    u: a.u + (b.u - a.u) * alpha,
    v: a.v + (b.v - a.v) * alpha,
    waterLevel: a.waterLevel + (b.waterLevel - a.waterLevel) * alpha,
    fx: a.fx + (b.fx - a.fx) * alpha,
    fz: a.fz + (b.fz - a.fz) * alpha,
  };
}

/**
 * buildRiverField() で得たグリッドを、scalar>0 の領域だけ marching squares
 * (面充填版)で三角形分割する。
 *
 * 各セル(4頂点の正方形)について、内側(scalar>0)の頂点と、内側⇔外側が
 * 切り替わる辺の上の補間点を順番に集めるとポリゴンになる
 * (Sutherland-Hodgmanのポリゴンクリッピングと同じ考え方)。
 * これを頂点数-2個の三角形にファン状に分割する。
 *
 * yPicker(attrs, isBoundary) => number で頂点の高さだけを外から決められる
 * ようにしてあり、水面メッシュ(内側=一定の水面高さ、境界=地形にぴったり
 * 接する高さ)と川底メッシュ(常に地形の高さ)の両方をこの1つの関数で
 * 生成する。
 */
function triangulateRiverField(field, yPicker) {
  const { grid, cols, rows, stride } = field;
  const positions = [];
  const uvs = [];
  const vertexXZ = []; // 頂点カラー計算用に、各頂点の実際のx,zとuを保持しておく
  const flows = [];    // v1.66: 各頂点の、川の流れの向き(x,z)。水面のさざ波を流れに沿って動かすために使う
  const indices = [];
  let vertexCount = 0;

  function pushVertex(attrs, isBoundary) {
    const y = yPicker(attrs, isBoundary);
    positions.push(attrs.x, y, attrs.z);
    uvs.push(attrs.u, attrs.v);
    vertexXZ.push(attrs.x, attrs.z, attrs.u);
    flows.push(attrs.fx, attrs.fz);
    vertexCount += 1;
    return vertexCount - 1;
  }

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const c0 = grid[j * stride + i];
      const c1 = grid[j * stride + (i + 1)];
      const c2 = grid[(j + 1) * stride + (i + 1)];
      const c3 = grid[(j + 1) * stride + i];
      const corners = [c0, c1, c2, c3];
      const inside = [c0.scalar > 0, c1.scalar > 0, c2.scalar > 0, c3.scalar > 0];
      if (!inside[0] && !inside[1] && !inside[2] && !inside[3]) continue; // 完全に乾いている

      // 4辺を順番に見て、「内側の頂点そのもの」と「符号が反転する辺の
      // 補間点」を集めるとセル内の水面ポリゴンになる。
      const polyAttrs = [];
      const polyBoundary = [];
      for (let k = 0; k < 4; k++) {
        const cur = corners[k];
        const next = corners[(k + 1) % 4];
        if (inside[k]) {
          polyAttrs.push(cur);
          polyBoundary.push(false);
        }
        if (inside[k] !== inside[(k + 1) % 4]) {
          const alpha = cur.scalar / (cur.scalar - next.scalar);
          polyAttrs.push(lerpFieldAttrs(cur, next, alpha));
          polyBoundary.push(true);
        }
      }
      if (polyAttrs.length < 3) continue;

      const idx = polyAttrs.map((attrs, k) => pushVertex(attrs, polyBoundary[k]));
      // ポリゴンの頂点は c0->c1->c2->c3 の順(上から見て時計回り)で
      // 集めているため、そのままファン分割すると法線が下向きになる。
      // k, k+1 の順序を入れ替えて上向きにする。
      for (let k = 1; k < idx.length - 1; k++) {
        indices.push(idx[0], idx[k + 1], idx[k]);
      }
    }
  }

  return { positions, uvs, vertexXZ, indices, vertexCount, flows };
}

const riverVertexShader = `
  attribute vec2 aFlow;
  varying vec2 vFlow;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vRestPos; // v1.67: 上下のうねりを足す前の、水面の位置(星の映り込みを、動く水面から完全に切り離すために使う)
  uniform float uTime;

  void main() {
    vUv = uv;
    vFlow = aFlow;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vRestPos = worldPos.xyz;
    // ごく小さな上下のうねり(実際の波シミュレーションではなく、
    // 「生きた水面」に見せるための安価な近似)
    float bob = sin(worldPos.x * 0.8 + worldPos.z * 0.6 + uTime * 1.4) * 0.025;
    worldPos.y += bob;
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

// 水面フラグメントシェーダー本体。品質(WATER_LEVEL)によってコードそのものを
// 切り替える(値だけ変えるのではなく、不要な計算をコンパイル時に外す):
//   0 = off      : 単色+フレネル+岸の泡(ノイズ・波紋なし。最軽量)
//   1 = standard : さざ波1層+疑似法線+スペキュラ+岸の泡+波紋(最大12個)
//   2 = high     : さざ波2層+きらめき+波紋(最大28個、流れで下流へずれる)
// 波紋(RIPPLE_COUNT>0の時)は、各Ripple Sourceから外側へ伝わる波の高さの
// 勾配を疑似法線へ足し合わせる(water-ripples.jsのRIPPLE_GLSL)。
const riverFragmentBody = `
  varying vec2 vFlow;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vRestPos;
  uniform float uTime;
  uniform vec3 uCameraPos;
  uniform vec3 uSunDir;
  uniform vec3 uSkyColor;
  uniform float uLight; // v1.56-H6: 空の明るさ(0=夜〜1=昼)。水の色・きらめきの強さを昼夜で変える
uniform samplerCube uSkyCube; // v1.65: 星空(星・天の川)を描いたキューブマップ(空の回転しない基準の向き)
uniform mat3 uSkyRot;         // v1.65: 世界の向き → キューブマップの向き(星空の回転の逆回転)
uniform float uStarRefl;      // v1.65: 星の映り込みの強さ(0=なし)。夜・晴れ・月明かりで変わる
uniform vec3 uMoonDir;        // v1.66: 月の向き(世界座標、単位ベクトル)
uniform float uMoonRefl;      // v1.66: 月の映り込みの強さ(0=なし)

#if WATER_LEVEL >= 1
  // 安価なvalue noise(テクスチャ不要。数回のsin/fractで済ませる)
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }
  // v1.66: さざ波の模様を、川の流れの向きに沿って動かすためのノイズ。
  //   向きが場所で変わっても模様がねじれ続けないよう、2つの層を半周期ずらして交互に混ぜる(フローマップと同じ方式)。
  float flowBlend(vec2 q, vec2 o0, vec2 o1, float w0) {
    return mix(vnoise(q - o1 + vec2(7.3, 2.9)), vnoise(q - o0), w0);
  }
#endif

#ifdef HAS_RIPPLES
  RIPPLE_FUNCTIONS
#endif

  void main() {
#if WATER_LEVEL >= 1
    // 1) 流れるさざ波(ワールド座標基準なので、川幅が変わっても模様が伸び縮みしない)
    //    v1.66: 模様は、その場所の川の流れの向き(vFlow)に沿って下流へ動く。
    //    (以前は、世界の座標軸の決まった向きに動いていて、川の向きと関係なかった)
    vec2 fl = vFlow;
    float fll = length(fl);
    fl = fll > 0.01 ? fl / fll : vec2(0.0, 1.0);
    const float FLOW_PERIOD = 3.0;
    float ph0 = fract(uTime / FLOW_PERIOD);
    float ph1 = fract(uTime / FLOW_PERIOD + 0.5);
    float fw = 1.0 - abs(2.0 * ph0 - 1.0);
    vec2 qA = vWorldPos.xz * 0.55;
    vec2 oA0 = fl * (ph0 * FLOW_PERIOD * 0.4);
    vec2 oA1 = fl * (ph1 * FLOW_PERIOD * 0.4);
    float nA = flowBlend(qA, oA0, oA1, fw);
  #if WATER_LEVEL >= 2
    vec2 qB = vWorldPos.xz * 1.6;
    vec2 oB0 = fl * (ph0 * FLOW_PERIOD * 0.26);
    vec2 oB1 = fl * (ph1 * FLOW_PERIOD * 0.26);
    float nB = flowBlend(qB, oB0, oB1, fw);
    float ripple = nA * 0.6 + nB * 0.4;
  #else
    float ripple = nA;
  #endif

    // 2) 疑似法線: ノイズの勾配から求める(本物のバンプマップの代わり)
    float eps = 0.15;
    float ndx = flowBlend(qA + vec2(eps, 0.0), oA0, oA1, fw) - flowBlend(qA - vec2(eps, 0.0), oA0, oA1, fw);
    float ndz = flowBlend(qA + vec2(0.0, eps), oA0, oA1, fw) - flowBlend(qA - vec2(0.0, eps), oA0, oA1, fw);
    // 雨粒の波紋: 各Ripple Sourceの波の勾配(dh/dx, dh/dz)と高さhの合計
  #ifdef HAS_RIPPLES
    vec3 rp = rippleField(vWorldPos.xz, uTime);
  #else
    vec3 rp = vec3(0.0);
  #endif
    // 既存のさざ波の法線に、波紋由来の勾配を加えて正規化する
    vec3 fakeNormal = normalize(vec3(-ndx * 1.3 - rp.x, 1.0, -ndz * 1.3 - rp.y));
#else
    float ripple = 0.5;
    vec3 rp = vec3(0.0);
    vec3 fakeNormal = vec3(0.0, 1.0, 0.0);
#endif

    // 3) フレネル: 視線が水面に対して浅い角度になるほど、空の色に近づける
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    float fresnel = pow(1.0 - clamp(dot(viewDir, fakeNormal), 0.0, 1.0), 3.0);

    // 4) 水深の近似: 川岸(UV端)のごく近くだけ浅く透明にし、
    //    そこから内側はすぐ「深い水」の色になるようにする
    float edgeDist = min(vUv.x, 1.0 - vUv.x); // 0(岸)〜0.5(中央)
    float depthFactor = smoothstep(0.015, 0.12, edgeDist); // 0=浅い, 1=深い

    // 5) ベースの水colour
    vec3 deepColor = vec3(0.08, 0.22, 0.27);
    vec3 shallowColor = vec3(0.30, 0.50, 0.50); // v1.56-H6: 岸ぎわの浅い所も白っぽくしない(以前は0.42,0.62,0.60)
    vec3 water = mix(shallowColor, deepColor, depthFactor);
    water *= 0.92 + ripple * 0.16; // さざ波による明暗の揺らぎ
    // v1.56-H6: 昼夜で水の明るさを変える。以前は水の色が一日中同じで、夜の川だけが明るかった(草・山脈と同じ考え方)。
    //   夜は昼の約25%まで暗く、きらめき(太陽/月の映り込み)は夜は約12%まで弱くする。
    float dayK = smoothstep(0.22, 0.85, uLight);
    water *= mix(0.25, 1.0, dayK);
    water = mix(water, uSkyColor, fresnel * 0.2);
#ifdef HAS_RIPPLES
    // 波紋の山・谷: 勾配が大きい所ほど空を映し込み、高さで明暗が少し変わる
    water = mix(water, uSkyColor, clamp(length(rp.xy) * 0.9, 0.0, 0.45));
    water *= 1.0 + rp.z * 8.0;
#endif

#if WATER_LEVEL >= 1
    // 6) 太陽のきらめき(疑似スペキュラ。波紋の法線にも追従する)
    vec3 halfDir = normalize(uSunDir + viewDir);
    float spec = pow(max(dot(fakeNormal, halfDir), 0.0), 70.0);
    water += vec3(1.0, 0.97, 0.88) * spec * 1.4 * mix(0.12, 1.0, dayK);
    // v1.65: 星空の映り込み。星空のキューブマップを、反射方向で引く。
    //   浅い角度ほど強く映す(フレネル)。
    // v1.67: 星の映り込みは、動く水面から完全に切り離す。法線は、さざ波・波紋の法線(fakeNormal)を一切使わず、
    //   常に真上(平らな鏡)。視線も、上下のうねりを足す前の位置(vRestPos)から求める。
    //   星の位置は、カメラの位置と星空の回転だけで決まり、波では動かない(星空は、波の上でも静かに回る)。
    if (uStarRefl > 0.002) {
      vec3 starView = normalize(uCameraPos - vRestPos);
      vec3 rv = reflect(-starView, vec3(0.0, 1.0, 0.0));
      float upK = smoothstep(0.03, 0.28, rv.y);                       // 地平線ぎわは映さない
      float fr = 0.30 + 0.70 * pow(1.0 - clamp(starView.y, 0.0, 1.0), 3.0);
      vec3 sk = textureCube(uSkyCube, uSkyRot * rv).rgb;
      water += sk * upK * fr * uStarRefl * 2.2;
    }
    // v1.66: 月の映り込み。月の円盤(空の月の見かけの大きさ)が、さざ波・波紋の法線で崩れた光の粒になって映る。
    //   法線の揺れは強めに使う(静かな円ではなく、きらきらした筋になる)。昼は出ない。
    if (uMoonRefl > 0.002) {
      vec3 rnM = normalize(mix(vec3(0.0, 1.0, 0.0), fakeNormal, 0.9));
      vec3 rvM = reflect(-viewDir, rnM);
      float cdM = dot(rvM, uMoonDir);
      float disc = smoothstep(cos(0.085), cos(0.032), cdM);           // 月の円盤(半径0.03rad)と、そのまわりのにじみ
      float halo = pow(max(cdM, 0.0), 160.0) * 0.5;
      float nightK = 1.0 - smoothstep(0.15, 0.6, uLight);
      water += vec3(0.93, 0.96, 1.0) * (disc * 0.95 + halo) * uMoonRefl * nightK * step(0.02, rvM.y);
    }
  #if WATER_LEVEL >= 2
    float glitterNoise = flowBlend(qB * 3.3, oB0 * 3.3, oB1 * 3.3, fw);
    float glitter = smoothstep(0.965, 1.0, glitterNoise);
    water += vec3(1.0, 1.0, 0.95) * glitter * 0.6 * mix(0.12, 1.0, dayK);
  #endif

    // 7) 岸辺の白い泡は無し(v1.56-H6)。以前は川の端に沿って明るい白を75%混ぜていて、夜も白く光り不自然だった。
    //    岸に近いほど浅く透ける水の色(上の shallowColor と、下の透明度)だけで表す。
#endif

    // 8) 透明度: 岸のごく近くだけ少し透明にし、それ以外はしっかり
    //    「水」に見える不透明度にする
    float baseAlpha = mix(0.4, 0.8, depthFactor);
    baseAlpha = clamp(baseAlpha + fresnel * 0.15, 0.0, 1.0);
    float alpha = baseAlpha;
    // v1.61b: 川の端(世界の中心から RIVER_VISIBLE_RADIUS の円)に近づくほど、水を徐々に透明にして、
    // 水がぷつりと途切れた「断面」が見えないようにする(端は、さらに木の茂みで隠している)。
    alpha *= 1.0 - smoothstep(RIVER_FADE_A, RIVER_FADE_B, length(vWorldPos.xz));
    gl_FragColor = vec4(water, alpha);
  }
`;

/**
 * 品質に応じた完全なフラグメントシェーダーのソースを組み立てる(検証からも使う)。
 * @param {'off'|'standard'|'high'} quality
 */
export function buildWaterFragmentSource(quality) {
  const cfg = WATER_QUALITY_SETTINGS[normalizeWaterQuality(quality)];
  const lines = [`#define WATER_LEVEL ${cfg.shaderLevel}`];
  const hasRipples = cfg.shaderLevel >= 1 && cfg.maxRipples > 0;
  if (hasRipples) {
    lines.push('#define HAS_RIPPLES');
    lines.push(`#define RIPPLE_COUNT ${cfg.maxRipples}`);
    lines.push(buildRippleDefines());
    if (cfg.drift) lines.push('#define WATER_RIPPLE_DRIFT');
  }
  let body = hasRipples ? riverFragmentBody.replace('RIPPLE_FUNCTIONS', RIPPLE_GLSL) : riverFragmentBody;
  body = body.replace('RIVER_FADE_A', (RIVER_VISIBLE_RADIUS - 10).toFixed(1)).replace('RIVER_FADE_B', RIVER_VISIBLE_RADIUS.toFixed(1));
  return lines.join('\n') + '\n' + body;
}

/**
 * 川の水面材質を作る。
 * テクスチャは使わず、ワールド座標を直接ノイズ関数に渡すことで
 * 「流れるさざ波」「フレネルによる空の映り込み」「太陽のきらめき」
 * 「岸辺の泡」「雨粒の波紋」を安価に近似している(追加のレンダーパスや
 * 反射カメラは不要)。
 * @param {'off'|'standard'|'high'} quality
 * @param {object} sharedUniforms uTime/uCameraPos/uSunDir/uSkyColor(品質を切り替えても共有する)
 * @param {{A:Float32Array,B:Float32Array}|null} ripplePool 波紋のuniform配列(品質ごとに別)
 */
function makeWaterMaterial(quality, sharedUniforms, ripplePool) {
  const uniforms = { ...sharedUniforms };
  if (ripplePool && ripplePool.size > 0) {
    // vec4配列: three.jsはFloat32Array(平坦な配列)を直接受け取れる
    // 生きている波紋だけを先頭へ詰めた配列(PA/PB。pack()で毎フレーム更新)と、その数
    uniforms.uRippleA = { value: ripplePool.PA };
    uniforms.uRippleB = { value: ripplePool.PB };
    uniforms.uRippleCount = { value: 0 };
  }
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: riverVertexShader,
    fragmentShader: buildWaterFragmentSource(quality),
    transparent: true,
    side: THREE.DoubleSide, // 巻き順の見落としがあっても必ず見えるようにする保険
  });
}

/**
 * 川の水面メッシュを作る。
 *
 * 内側(scalar>0)の頂点は、その地点で計算済みの水面高さ(waterLevel =
 * 中心線上の地形高さ + 水の厚み)をそのまま使う(=断面はほぼ水平)。
 * 境界(水際)の頂点だけは、実際の地形の高さ関数を境界の(x,z)ちょうどで
 * 評価し直した値を使う。これにより境界では水面高さ=地形の高さに
 * 正確に一致し、地形との間に隙間ができない。
 *
 * @param {(x:number, z:number) => number} terrainHeightFn
 * @returns {{ mesh: THREE.Mesh, update: (time:number) => void }}
 */
export function buildRiverMesh(terrainHeightFn, options = {}) {
  const field = buildRiverField(terrainHeightFn);
  const yPicker = (attrs, isBoundary) =>
    isBoundary ? terrainHeightFn(attrs.x, attrs.z) : attrs.waterLevel;
  const { positions, uvs, indices, flows } = triangulateRiverField(field, yPicker);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flows, 2)); // v1.66
  geo.setIndex(indices);
  geo.computeVertexNormals();

  // 品質を切り替えても共有するuniform(同じオブジェクトを全材質が参照する)
  const sharedUniforms = {
    uTime: { value: 0 },
    uCameraPos: { value: new THREE.Vector3() },
    uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3) },
    uSkyColor: { value: new THREE.Color(0xdfe8dc) },
    uLight: { value: 1 }, // v1.56-H6: 0=夜〜1=昼
    uSkyCube: { value: null },                 // v1.65: 星空のキューブマップ(未設定なら何も映らない)
    uSkyRot: { value: new THREE.Matrix3() },
    uStarRefl: { value: 0 },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) },   // v1.66
    uMoonRefl: { value: 0 },
  };

  // 2026-09(v1.27): 品質(off/standard/high)ごとに、シェーダーのコードそのものと
  // 波紋のプール(固定長)を持つ。切り替えは材質を差し替えるだけ(初めて使う
  // 品質は、その時に1回だけシェーダーをコンパイルする)。
  const variants = new Map(); // quality -> { material, pool }
  function getVariant(quality) {
    let v = variants.get(quality);
    if (!v) {
      const pool = createRipplePool(WATER_QUALITY_SETTINGS[quality].maxRipples);
      v = { pool, material: makeWaterMaterial(quality, sharedUniforms, pool) };
      variants.set(quality, v);
    }
    return v;
  }
  let quality = normalizeWaterQuality(options.quality);
  let active = getVariant(quality);

  const mesh = new THREE.Mesh(geo, active.material);
  mesh.receiveShadow = true;

  /**
   * @param {number} time
   * @param {THREE.Vector3} [cameraPos] - フレネル計算に使う。省略時は前回値を維持する
   */
  function update(time, cameraPos) {
    sharedUniforms.uTime.value = time;
    if (cameraPos) sharedUniforms.uCameraPos.value.copy(cameraPos);
    // 波紋: 生きているものだけを先頭へ詰めて、その数をシェーダーへ渡す
    if (active.pool.size > 0) active.material.uniforms.uRippleCount.value = active.pool.pack(time);
  }

  /**
   * 時刻帯が変わった時に、空の色・太陽の向きを水面の映り込みへ反映する。
   * (毎フレームではなく、時刻帯が変わった時だけ呼べば十分)
   * @param {THREE.Color} skyColor
   * @param {THREE.Vector3} [sunDirection]
   * @param {number} [light] v1.56-H6: 空の明るさ(0=夜〜1=昼)。水の明るさときらめきに反映する
   */
  /**
   * v1.65: 星空の映り込みを設定する(毎フレーム呼んでよい)。
   * @param {THREE.Texture|null} cube 星空のキューブマップ
   * @param {THREE.Matrix3} rot       世界の向き → キューブマップの向き
   * @param {number} strength         0=映さない
   */
  function setStarReflection(cube, rot, strength, moonDir, moonStrength) {
    sharedUniforms.uSkyCube.value = cube;
    if (rot) sharedUniforms.uSkyRot.value.copy(rot);
    sharedUniforms.uStarRefl.value = cube ? Math.max(0, strength) : 0;
    // v1.66: 月の映り込み(月の向きと強さ。キューブマップが無くても、月だけは映せる)
    if (moonDir) sharedUniforms.uMoonDir.value.copy(moonDir);
    sharedUniforms.uMoonRefl.value = Math.max(0, moonStrength || 0);
  }

  function setEnvironment(skyColor, sunDirection, light) {
    sharedUniforms.uSkyColor.value.copy(skyColor);
    if (sunDirection) sharedUniforms.uSunDir.value.copy(sunDirection);
    if (Number.isFinite(light)) sharedUniforms.uLight.value = Math.max(0, Math.min(1, light));
  }

  /**
   * 雨粒が水面に落ちた位置を、波紋のRipple Sourceとして登録する。
   * @param {number} worldX
   * @param {number} worldZ
   * @param {number} [tangentX] その地点の川の流れの向き(単位ベクトル)
   * @param {number} [tangentZ]
   * @returns {boolean} 登録できたか(offの品質・プールが満杯の時はfalse)
   */
  function spawnRipple(worldX, worldZ, tangentX = 0, tangentZ = 0) {
    return active.pool.spawn(worldX, worldZ, sharedUniforms.uTime.value, tangentX, tangentZ);
  }

  /** 水面の品質を切り替える('off' | 'standard' | 'high')。 */
  function setQuality(q) {
    const next = normalizeWaterQuality(q);
    if (next === quality) return;
    quality = next;
    active = getVariant(quality);
    active.pool.clear();
    mesh.material = active.material;
  }

  function getQuality() { return quality; }

  return { mesh, update, setEnvironment, setStarReflection, spawnRipple, setQuality, getQuality, getRipplePool: () => active.pool };
}

// ---- 川底の色(頂点カラー) ----
// v1.61: 川底に規則的な格子模様(幾何学模様)が見えるバグの修正。
// 原因: 色は川メッシュの格子点(間隔 RIVER_GRID_CELL=0.5m)でしか決められないのに、色を作るノイズの周波数が
//       最大で 1.4×4(=5.6)周期/m と、格子で表せる上限(0.5mごとのサンプルなら 1周期/m)を大きく超えていた。
//       すると「折り返し(エイリアシング)」が起き、ノイズの格子目が規則的な模様として浮かび上がる。
// 対策: ①どの周波数成分も、格子で表せる範囲(0.6周期/m以下)に収める
//       ②ノイズの座標を回転させ、ノイズ自身の縦横の格子目が、川のメッシュの格子と揃って見えないようにする
const BED_SAND_LIGHT = new THREE.Color(0x8c7f5e); // 濡れた砂利(明るい部分)。乾いた砂浜のような明るさは避ける
const BED_SAND_DARK = new THREE.Color(0x4a4030); // 濡れた砂利(暗い部分)
const BED_PEBBLE = new THREE.Color(0x6b6b64); // 大粒の丸石(灰色寄り)
const BED_ALGAE = new THREE.Color(0x33481c);
const BED_ROT_COS = Math.cos(0.61); // 約35度
const BED_ROT_SIN = Math.sin(0.61);

/**
 * (x,z)の川底の色を out に書く。u は 0(左岸)〜1(右岸)。
 * 使う周波数は、どれも 0.6周期/m 以下(格子0.5mで折り返さない範囲)。
 */
export function riverbedColorAt(x, z, u, out) {
  const rx = x * BED_ROT_COS - z * BED_ROT_SIN;
  const rz = x * BED_ROT_SIN + z * BED_ROT_COS;
  // fbm2Dは-1〜1を返すので、色の混合に使う前に0〜1へ変換する
  const grain = fbm2D(rx * 0.30, rz * 0.30, 2) * 0.5 + 0.5; // 砂利の濃淡(0.3と0.6周期/m)
  const bigPebble = fbm2D(rx * 0.22 + 20, rz * 0.22 + 20, 2) * 0.5 + 0.5; // 大粒の丸石パッチ(0.22と0.44周期/m)
  const patch = fbm2D(rx * 0.14 + 50, rz * 0.14 + 50, 2) * 0.5 + 0.5; // 藻の生えるパッチ(0.14と0.28周期/m)
  const centerDarken = 1 - Math.abs(u - 0.5) * 2; // 中央(深そうな部分)は少し暗く
  out.copy(BED_SAND_LIGHT).lerp(BED_SAND_DARK, grain * 0.55);
  if (bigPebble > 0.6) out.lerp(BED_PEBBLE, Math.min(1, (bigPebble - 0.6) * 2.2));
  out.multiplyScalar(1 - centerDarken * 0.16);
  if (patch > 0.48) out.lerp(BED_ALGAE, Math.min(1, (patch - 0.48) * 2.0));
  return out;
}

/**
 * 川底(砂利・藻)のメッシュを作る。水面のすぐ下に敷くことで、
 * 半透明の水面越しに「底が見える」透明感を安く演出する。
 * テクスチャは使わず、頂点カラー(ビルド時に1回だけノイズで計算)だけで
 * まだら模様を出すので、実行時コストはゼロに近い。
 *
 * 水面メッシュ(buildRiverMesh)と全く同じグリッド・境界形状
 * (buildRiverField / triangulateRiverField)を使って作るため、
 * 水面と川底の輪郭は常に一致する。高さは常に「その(x,z)の実際の地形の
 * 高さ+ごくわずかなオフセット」なので、境界も内側も地形にぴったり沿う。
 *
 * @param {(x:number, z:number) => number} terrainHeightFn
 * @returns {THREE.Mesh}
 */
export function buildRiverbedMesh(terrainHeightFn) {
  const field = buildRiverField(terrainHeightFn);
  const yPicker = (attrs) => terrainHeightFn(attrs.x, attrs.z) + 0.03;
  const { positions, uvs, vertexXZ, indices, vertexCount } = triangulateRiverField(field, yPicker);

  const colors = new Array(vertexCount * 3);
  const tmpColor = new THREE.Color();
  for (let v = 0; v < vertexCount; v++) {
    riverbedColorAt(vertexXZ[v * 3], vertexXZ[v * 3 + 1], vertexXZ[v * 3 + 2], tmpColor);
    colors[v * 3] = tmpColor.r;
    colors[v * 3 + 1] = tmpColor.g;
    colors[v * 3 + 2] = tmpColor.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const material = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradientMap() });
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}
