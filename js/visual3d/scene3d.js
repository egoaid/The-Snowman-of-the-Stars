// scene3d.js
// Three.jsによる3Dシーンを統合する。
//
// 構成:
// - 地形(terrain.js): 高さ場を持ち、木・テント・焚き火はその高さを
//   実際にサンプリングして配置する(「木が川に立つ」等の矛盾が起きない)
// - 山脈(mountains3d.js): 360度を囲む円筒状の背景。ズーム・回転しても
//   「何も作っていない空間」が見えないようにする
// - 草・落ち葉(ground-detail.js): InstancedMeshで大量描画
// - 歩行モード(walk-controls.js): クリックでポインタロックし、WASDで移動

import * as THREE from 'three';
import { OrbitControls } from '../../vendor/OrbitControls.js'; // v1.57: CDNをやめて同梱(three.js r160のもの)
import { buildTerrainMesh, terrainHeightAt, TERRAIN_SIZE, configureFlattening } from './terrain.js';
import { ambientHeightAt, configureAmbientSeed } from './terrain-noise.js';
import { getWaterSurfaceAt } from './river.js';
import { createCameraGroundGuard, createDomeOcclusionGuard } from './camera-ground.js';
import { applyDefaultShadowFlags } from './shadow-flags.js';
import { snapShadowCenter } from './shadow-snap.js';
import { stepHeading, WANDER_MAX_TURN_RATE, resolveCircleCollisions, computeAvoidSteer as computeAvoidSteerFor, pushOutOfObstacles, buildIglooPostObstacles, isMakingProgress, planWallDetour } from './wander-nav.js';
import { buildRiverMesh, buildRiverbedMesh, getRiver, distanceToRiver, nearestRiverPoint, getWaterEdgeDistance, getWaterEdgeDistanceOnTerrain, RIVER_VISIBLE_RADIUS, setRiverVisibleRadius, setRiverControlPoints, generateRiverControlPoints, resetDefaultRiver, configureRiverWidthSeed } from './river.js';
import { createFish } from './fish.js';
import { computeSkyState, createCelestialBodies } from './daynight.js';
import { createStarfield } from './starfield.js';
import { createWeatherSystem, SNOW_DEPTH_MAX } from './weather.js';
import { createSeasonSystem, getSeasonLabel } from './season.js';
import { createPineTree, createFallenTree, placeOnTerrain, setLeafTint, setLeafSnowBulk, createBroadleafTree, setBroadleafTint, applyBroadleafDefoliation, setBroadleafShapeParams } from './tree.js';
import { createLeafFallSystem, getSheddingIntensity } from './leaf-fall.js';
import { createRockCluster, placeRockOnTerrain } from './rocks.js';
import { createTent, getTentHeight } from './tent.js';
import { createIgloo, WALL_THICKNESS as IGLOO_WALL_THICKNESS } from './igloo.js';
import { createCampfire } from './campfire.js';
import { buildMountainScenery, buildHorizonFill, setMountainBrightness } from './mountains3d.js';
import { createGrassField, createFallenLeaves } from './ground-detail.js';
import { createPoppyField } from './flowers.js';
import { createPollinatorField, createBeehive, shouldPollinatorsBeActive } from './pollinators.js';
import { getToonGradientMap } from './shading.js';
import { createCameraDirector } from './camera-director.js';
import { createWalkControls, EYE_HEIGHT } from './walk-controls.js';
import { createSnowmanCharacter, createFirstPersonHands, createTorch } from './snowman.js';
import { createEmoteBrain } from './emote-brain.js'; // v1.73: 座る・寝るエモートの状態機械
import { makeRng, randRange, deriveSeed } from './rng.js';
import { createFallenWood, placeFallenWood, WOOD_PLAN_EXTRA, woodPhysicalProperties, woodMaterial, collisionDims } from './fallen-wood.js';
import { createLogObstacleManager, isWalkOver } from './log-obstacles.js';
import { createTraversal, createVerticalState, createClimbController, createTraversalFailureMemory, ACTION, climbDurationFor } from './traversal.js';
import { createStagnationWatchdog, createRepeatDetector, blockerSignature, findRescueSpot, hopPoint } from './wander-watchdog.js';
import { createFallingStarSystem, pickStarLandingSpot } from './falling-star.js';
import { getRecipe, recipeInputs } from '../recipes.js'; // v1.69 / v1.74(recipeInputs)
import { createStarTorchMesh, tickStarTorch, STAR_TORCH } from './star-torch.js'; // v1.74: 星の松明
import { createDebugLog } from './debug-log.js'; // v1.69: 動作確認用のログ(JSONで書き出せる)
import { createGlueTool } from './glue-tool.js'; // v1.71: 接着モード(位置と角度を決めて接着・再編集)
import { createShardSystem } from './shard-system.js'; // v1.69: 星のかけら・月のかけら(倒木を接着する・浮かせる)
import { createCrescentGeometry } from './moon-stone.js'; // v1.69: 月の石の形(三日月)
import { createTreeDecorations, computeTreeTop } from './tree-decor.js';
import { createInteractionSystem } from './interaction.js';
import { buildHeldItem } from './held-items.js';
import { createInventory } from '../inventory.js';
import { LOG_TO_WOOD, getItemDef, isKnownItem } from '../items.js';
import { createPhysics } from '../physics.js';
import { createFallenLogSystem, levelQuaternion, logBuryHeight, logMinClearance } from './fallen-log-system.js';
import { createCollectibleRegistry, COLLECTIBLE_KINDS } from '../collectibles.js';
import { createPouch } from '../pouch.js';
import { createBaseChest } from './chest.js';
import { findFreePlacement } from '../placement.js';
import { createEquipment, EQUIP_SLOTS } from '../equipment.js';
import { createJackOLanternMesh, createLanternLightPool } from './lantern.js';
import { REMNANT_DEFS, planRemnants } from '../remnants.js';
import { createRemnantField } from './remnants-visual.js';
import { createEditMode } from './edit-mode.js';
import { applySessionMode, currentSessionMode } from '../session-mode.js';
import { APP, FALLING_STAR, MOON_STONE, SNOWMAN_STAR, SNOWMAN_COLLECT, INTERACTION, HOTBAR, INVENTORY, readStarTestMode } from '../config.js';

export const BUFFER_WIDTH = 480;
export const BUFFER_HEIGHT = 270;

// --- Phase 2(2026-09): Playable Area / Boundary Zoneの正式な階層 ---
// Terrain Edge  : 地形メッシュそのものの外周(半径)。これは絶対に変えない基準。
// Boundary Zone : Playable AreaからTerrain Edgeまでの「森の壁」の帯。
//                 ここに木を密集させ、視界と歩みを自然に阻むことで、
//                 「見えない壁」ではなく「自然に奥へ行けなくなっている」
//                 感覚を作る。
// Playable Area : プレイヤーが自由に歩き回れる範囲。
// (以前は forestHalfSize という1つの値がこの3つの役割を兼ねていたが、
//  今回それぞれの役割ごとに明確な定数へ分離する)
export const TERRAIN_EDGE = TERRAIN_SIZE / 2;        // 80
export const PLAYABLE_RADIUS = TERRAIN_SIZE * 0.36;  // 57.6
export const BOUNDARY_OUTER = TERRAIN_EDGE - 3;      // 77(地形の際の少し内側まで木を生やす)

/**
 * 2026-09(地形自動生成フェーズ): 自動生成された川に対して、キャンプ
 * (大木・テント・焚き火・雪だるまのホーム)一式を安全に置ける場所を探す。
 * 「ユーザーは自然を直接モデリングするのではなく、自然に対する意図を
 * 入力する」という方針にならい、キャンプ同士の相対レイアウト(大木からの
 * オフセット)は既定のものをそのまま使い、「どこに置くか」だけを
 * 川からの距離・地形の傾斜をもとに自動選定する。
 * @param {number} seed
 * @param {{x:number,z:number,width:number}[]} riverSamples
 * @param {number} playableRadius
 * @returns {{x:number,z:number}}
 */
function pickCampAnchor(seed, riverSamples, playableRadius) {
  const rng = makeRng((seed ^ 0x9e3779b9) >>> 0 || 1);
  // 大木を原点とした時の、テント・焚き火・雪だるまホームの相対オフセット
  // (下のinitScene内の既定レイアウトと同じ値。ここでは安全確認用)
  const relativeOffsets = [
    { x: 0, z: 0 }, // 大木自身
    { x: 3.2, z: -1.6 }, // テント(camp)
    { x: 4.7, z: -7.1 }, // 焚き火(fire)
    { x: 7.2, z: 1.4 }, // 雪だるまホーム
  ];
  const MIN_RIVER_CLEARANCE = 6.5; // 各構造物の位置で、川岸からこれだけは離す
  const MAX_SLOPE = 0.9; // 2m進んだ時の高さ変化がこれを超えたら急すぎると判断

  let best = null;
  let bestScore = -Infinity;
  for (let attempt = 0; attempt < 60; attempt++) {
    const angle = rng() * Math.PI * 2;
    const dist = randRange(rng, playableRadius * 0.15, playableRadius * 0.55);
    const ax = Math.cos(angle) * dist;
    const az = Math.sin(angle) * dist;

    let minClearance = Infinity;
    let ok = true;
    for (const off of relativeOffsets) {
      const px = ax + off.x, pz = az + off.z;
      const { distance, width } = distanceToRiver(px, pz, riverSamples);
      const clearance = distance - width / 2;
      minClearance = Math.min(minClearance, clearance);
      if (clearance < MIN_RIVER_CLEARANCE) { ok = false; break; }
    }
    if (!ok) continue;

    const h0 = ambientHeightAt(ax, az);
    const hx = ambientHeightAt(ax + 2, az);
    const hz = ambientHeightAt(ax, az + 2);
    const slope = Math.max(Math.abs(hx - h0), Math.abs(hz - h0));
    if (slope > MAX_SLOPE) continue;

    const score = minClearance - slope * 6;
    if (score > bestScore) { bestScore = score; best = { x: ax, z: az }; }
  }
  // 60回試しても条件を満たす場所が見つからなければ、一番マシだった場所
  // (もしくは見つからなければ原点付近)を使う。完全に理想的でなくても
  // 「毎回同じ座標に固定で失敗する」よりはまし、という考え方。
  return best || { x: 0, z: 0 };
}


// 虫・鳥のアンビエンス配分を決めるための大まかな時間帯区分
// (見た目の空の色・明るさは daynight.js の連続的な補間を使う)
export function getTimeOfDay(hour) {
  if (hour >= 5 && hour < 8) return 'morning';
  if (hour >= 8 && hour < 17) return 'day';
  if (hour >= 17 && hour < 19) return 'evening';
  return 'night';
}

export function initScene(mountEl, options = {}) {
  const scene = new THREE.Scene();
  // 2026-09: near=0.1のままだと遠景の深度精度がやや不足しがちなので0.15へ。
  // farは、太陽・月の見た目上の距離(RADIUS=280、実際の最大距離は約280.3m)
  // より余裕を持たせて320に設定している。
  const camera = new THREE.PerspectiveCamera(45, BUFFER_WIDTH / BUFFER_HEIGHT, 0.15, 320);

  // 2026-09: 太陽・月が山脈の手前に浮いて見える不具合の原因調査で、
  // 一時的に対数深度バッファ(logarithmicDepthBuffer)を試したが、この
  // プロジェクトは川の水面・草・ヒナゲシ・虹などカスタムShaderMaterialを
  // 複数使っており、対数深度バッファ対応のシェーダーチャンクを individually
  // 書き足さない限りそれらの深度計算が壊れて「見えなくなる」重大な副作用が
  // 出ることが判明したため(実際に花・川の水面が非表示になる不具合が発生)、
  // 対数深度バッファは使わない。実際の原因は深度精度ではなく幾何学的な
  // ものだったため、daynight.js側でRADIUSを見直して解決した。
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(BUFFER_WIDTH, BUFFER_HEIGHT, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.imageRendering = 'pixelated';
  renderer.domElement.style.display = 'block';
  mountEl.appendChild(renderer.domElement);

  // --- 地形自動生成モード(2026-09、オプション) ---
  // options.worldGen = { enabled: true, seed: <number> } が渡された場合のみ、
  // 地形の起伏・川の形をシードから生成し直す。渡されなければ、今までと
  // 完全に同じ固定の地形・川になる(デフォルトは一切変更なし)。
  // 2026-09(v1.33、オプション): 広葉樹の段数・枝分かれの本数・葉の塊の
  // 大きさを設定パネルから調整できるようにするための入り口。木を作る前
  // (この後のbigTreeBuilt/spawnForestTreeより前)に反映しておく必要がある。
  // 渡されなければtree.js側の既定値のまま(今までと同じ)。
  if (options.broadleafShape) {
    if (options.broadleafShape.full) setBroadleafShapeParams('full', options.broadleafShape.full);
    if (options.broadleafShape.simple) setBroadleafShapeParams('simple', options.broadleafShape.simple);
  }

  const worldGen = options.worldGen && options.worldGen.enabled ? options.worldGen : null;
  if (worldGen) {
    const seed = worldGen.seed >>> 0;
    configureAmbientSeed(seed);
    configureRiverWidthSeed(seed);
    // v1.63: 川の両端は、歩行境界の外側でS字に曲げて丘の陰に隠す(river-ends.js)。水を円で切る処理は不要になる。
    setRiverControlPoints(generateRiverControlPoints(seed, TERRAIN_EDGE), { shapeEnds: { seed, playableRadius: PLAYABLE_RADIUS, terrainHalf: TERRAIN_EDGE } });
    setRiverVisibleRadius(TERRAIN_EDGE - 1);
    resetDefaultRiver(); // 上の変更を反映させるため、川のHydrologyキャッシュを作り直させる
  }

  // --- 大木・キャンプ(テント・焚き火)の座標を先に決める ---
  // (地形の平坦化は、この座標を「構造物のfootprint」として使う。
  //  座標自体は地形の高さに依存しないので、地形を作る前に確定できる)
  // 2026-09: 以前の座標(-9, 9)は、160m化で川の制御点を相似拡大した結果、
  // テントが川岸からわずか数mの位置になってしまっていた(危険・不自然)。
  // 川から十分離れた安全な位置(テントが川の中心線から約12.7m=水際から
  // 約10m以上)へ、大木ごとキャンプ全体を移動する。
  // 2026-09(地形自動生成フェーズ): 自動生成モードの時だけ、この既定座標の
  // 代わりに pickCampAnchor() で選んだ場所を使う。大木からテント・焚き火・
  // 雪だるまホームへの相対オフセットは、自動生成でもそのまま維持する
  // (「相対レイアウトは保ち、置く場所だけ自動選定する」という方針)。
  let bigTreeX = -14.6, bigTreeZ = 6.8;
  if (worldGen) {
    const anchor = pickCampAnchor(worldGen.seed, getRiver().centerline, PLAYABLE_RADIUS);
    bigTreeX = anchor.x;
    bigTreeZ = anchor.z;
  }
  // 2026-09(改訂4): 「かまくらが木々と重なる」との指摘に対応し、テント・
  // 焚き火を置くこの段階で、冬に設置する(壁厚込みで大きい)かまくらの
  // 大きさを最初から考慮する。かまくらの内径・壁厚はigloo.js側の値と
  // 必ず一致させる(値がずれるとまた重なりが再発するため、ここで一度
  // だけ計算して以降すべての配置判断で使い回す)。
  const IGLOO_SCALE = 1.6; // createIgloo()呼び出し側ともここで揃える
  const iglooOuterRadiusPlanned = 2.1 * IGLOO_SCALE + IGLOO_WALL_THICKNESS;
  // 大木とキャンプの距離が、これまで(約3.6m)は「壁の厚みを増したかまくら」
  // の外側の面(約3.76m)より近く、かまくらが大木に食い込んでしまって
  // いた。方向はそのまま(大木から見て同じ向き)に、距離だけを、かまくら
  // 外周+余裕(1.5m)を確実に上回る値へ広げる。
  const campFromTreeDir = { x: 4.9, z: -2.5 }; // 元の(3.2,-1.6)と同じ向きを維持しつつ拡大
  const campX = bigTreeX + campFromTreeDir.x, campZ = bigTreeZ + campFromTreeDir.z;
  // 焚き火は以前 campX+2.6, campZ-2.0 に置いていたが、その座標がちょうど
  // 川のカーブのすぐそば(川岸からわずか1m弱)に来てしまっており、
  // 川の谷の斜面の上に乗って低く見える不具合があった。
  // 川から十分離れた、大木・テントに近い側へ位置を変更する。
  // 2026-09: 以前は焚き火がテントから3.0m、大木からわずか1.6mしか離れて
  // おらず(テントと大木の間に挟まる位置)、延焼の危険があった。
  // テント・大木のどちらからも十分な距離(焚き火→テント約5.7m、
  // 焚き火→大木約8.5m)を取れる位置へ移動する。
  // 2026-09(改訂4): 「かまくら設置時に焚き火の位置が変わるのは変。冬に
  // かまくらを設置することを考慮して、最初から焚き火の位置を決めて」
  // との指摘に対応。以前は夏(テント)と冬(かまくら)で焚き火が別の
  // 場所へ移動していたが(冬はかまくらの壁から離すため)、そもそも
  // 最初からかまくら(壁厚込みの外側の面)を基準に、年間を通して
  // 動かない1つの位置に決めることで、この不自然な移動自体を無くす。
  // 方向は上と同じ(川から離れた安全な向き)を保ったまま、距離だけを
  // かまくらの外周+2.6mぶん確保できるよう伸ばす。
  const fireDirFromCampUnnormalized = { x: 1.5, z: -5.5 }; // 元の向き(川安全確認済み)をそのまま使う
  const fireDirMag = Math.hypot(fireDirFromCampUnnormalized.x, fireDirFromCampUnnormalized.z);
  const fireDist = iglooOuterRadiusPlanned + 2.6;
  const fireX = campX + (fireDirFromCampUnnormalized.x / fireDirMag) * fireDist;
  const fireZ = campZ + (fireDirFromCampUnnormalized.z / fireDirMag) * fireDist;
  // かまくらの入口(ドア)は、年間を通して動かないこの焚き火の方へ
  // 向けておく(焚き火が「入口の前」にある自然な配置になる)。
  const campDoorAngle = Math.atan2(fireX - campX, fireZ - campZ);

  // 各構造物の足元だけを平らにする(以前のような「キャンプ全体を覆う
  // 巨大な固定半径」ではないので、川の谷まで平坦化が及ばない。
  // 万一近くにあっても terrain.js 側で川の水路は保護される)。
  // 2026-09(改訂4): 「かまくらの底面が雪の地形から少し浮いている」との
  // 指摘に対応し、テント側の平坦化半径を、かまくら(壁厚込みの外側の面
  // 約3.76m)を確実に覆う大きさへ広げた(以前は2.8mしか無く、かまくらの
  // 縁が平坦化のfeather区間=まだ自然な起伏が残る範囲に掛かっていた)。
  configureFlattening([
    { x: campX, z: campZ, radius: iglooOuterRadiusPlanned + 0.3, feather: 2.0 }, // テント/かまくらの足元
    { x: fireX, z: fireZ, radius: 1.2, feather: 1.4 },  // 焚き火の周り
  ]);


  // --- 地形・川 ---
  const terrain = buildTerrainMesh();
  scene.add(terrain);

  // --- 積雪の本格実装(2026-09): 「色を変えるだけではダメ。積雪を表現
  //     すべき」との指摘への対応。terrain.jsのジオメトリをそのまま複製し、
  //     真っ白なトゥーンマテリアルを与えた「雪面メッシュ」を用意する。
  //     積雪の深さ(weather.getSnowDepth()、メートル単位)ぶんだけ、この
  //     メッシュ全体を垂直に持ち上げるだけの簡易な実装だが(=雪が場所に
  //     よって偏って積もる表現はしない、常に一律の深さという簡略化)、
  //     地形の起伏そのものは保ったまま持ち上がるため「地形に沿って
  //     積もった雪」に見える。木・岩・小川は、この不透明な雪面の下に
  //     沈めることで、Z-bufferによる自然な「埋没して見えなくなる」効果を
  //     安価に実現する(詳細はupdateSnowAccumulation()を参照)。
  const snowCapGeo = terrain.geometry.clone();
  const snowCapMaterial = new THREE.MeshToonMaterial({
    color: 0xfbfdff, // 「灰色ではなく綺麗な白で」との指摘に対応した明るい白
    gradientMap: getToonGradientMap(),
  });
  // 2026-09(春の融雪): 「春になっても雪が溶けにくいのは変。春の初めの
  // 方は完全に溶けてなくて雪が残っている箇所もある」との指摘に対応。
  // 積雪の深さ自体は場所によらない一律の値(簡略化)だが、雪面が薄く
  // なってきた時だけワールド座標ベースの簡易ノイズでまだらに欠けさせる
  // ことで、「一様に消える」のではなく「まだらに溶け残る」ように見せる。
  const snowMeltPatchinessUniform = { value: 0 };
  snowCapMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uMeltPatchiness = snowMeltPatchinessUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vMeltWorldXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMeltWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uMeltPatchiness;\nvarying vec2 vMeltWorldXZ;')
      .replace('#include <dithering_fragment>', [
        'if (uMeltPatchiness > 0.001) {',
        '  float n = fract(sin(dot(floor(vMeltWorldXZ * 2.2), vec2(12.9898, 78.233))) * 43758.5453123);',
        '  if (n < uMeltPatchiness * 0.92) discard;',
        '}',
        '#include <dithering_fragment>',
      ].join('\n'));
  };
  const snowCapMesh = new THREE.Mesh(snowCapGeo, snowCapMaterial);
  snowCapMesh.receiveShadow = true;
  snowCapMesh.visible = false;
  scene.add(snowCapMesh);

  // 焚き火の熱で周りの雪だけが少し溶けてくぼむ表現(2026-09修正: 「くぼみの
  // 底に焚き火を置く設計自体は正しいが、その15cm分の雪が実際には溶けて
  // 無くなっていないため、焚き火が雪に埋もれて見える」との指摘に対応)。
  // 雪面メッシュ(snowCapGeo)自体の、焚き火の位置を中心にした半径内の
  // 頂点を実際にへこませることで、見た目上も本当に雪が溶けてくぼんだ
  // 「すり鉢状の穴」を作る。焚き火の設置位置(fireGroup.position.y)が
  // このくぼみの底の高さと一致するようにしてあるので、雪に埋もれず
  // くぼみの中に自然に収まって見える。
  function smoothstep01(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }
  function carveSnowMeltCrater(geo, cx, cz, depth, innerRadius, outerRadius) {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vz = pos.getZ(i);
      const d = Math.hypot(vx - cx, vz - cz);
      if (d >= outerRadius) continue;
      const dip = d <= innerRadius ? depth : depth * (1 - smoothstep01(innerRadius, outerRadius, d));
      pos.setY(i, pos.getY(i) - dip);
    }
  }
  const FIRE_MELT_DIP = 0.15; // 下の焚き火位置更新処理と必ず同じ値にする
  const FIRE_MELT_INNER_RADIUS = 1.15; // meltedPatchMeshの半径と揃える(円盤の下がちょうどくぼみの底になる)
  const FIRE_MELT_OUTER_RADIUS = 1.9; // ここまでで滑らかに通常の雪面へ戻る
  carveSnowMeltCrater(snowCapGeo, fireX, fireZ, FIRE_MELT_DIP, FIRE_MELT_INNER_RADIUS, FIRE_MELT_OUTER_RADIUS);
  // 2026-09(改訂4): 焚き火の位置が年間を通して1箇所固定になったため、
  // 彫り込みも1回だけでよい(以前はテント用/かまくら用の2箇所に彫って
  // いた)。彫り終わったら法線を再計算する。
  snowCapGeo.attributes.position.needsUpdate = true;
  snowCapGeo.computeVertexNormals();

  // 2026-09(v1.27): 水面の品質(off/standard/high)。初期値はoptions.waterQuality。
  const { mesh: river, update: updateRiver, setEnvironment: setRiverEnvironment, setStarReflection: setRiverStarReflection, spawnRipple: spawnWaterRipple, setQuality: setRiverQuality, getQuality: getRiverQuality } = buildRiverMesh(terrainHeightAt, { quality: options.waterQuality });
  const riverbed = buildRiverbedMesh(terrainHeightAt);
  scene.add(riverbed);
  const { group: fishGroup, update: updateFish } = createFish(terrainHeightAt, {
    count: 9,
    maxRadius: PLAYABLE_RADIUS, // 歩ける範囲(Playable Area)に合わせる
  });
  scene.add(fishGroup);
  scene.add(river);
  const riverSamplesForAvoid = getRiver().centerline;

  // --- 山脈(360度を囲む背景。遠景・近景2層+奥行きのノイズで厚みを出す) ---
  // Phase 3(2026-09): 160m→226m化で地形の端が80m→113mへ広がった(+33m)ため、
  // 「地形の端から山までの緩衝距離」が変わらないよう、山の半径も同じ+33m
  // だけ遠くへずらす(140→173, 220→253)。
  const mountains = buildMountainScenery({ nearRadius: 173, farRadius: 253 });
  scene.add(mountains);

  // --- 地形の端と山脈の間の「何もない空間」を埋める、なだらかな地面の延長 ---
  // Phase 2: Boundary Zone(森の壁)がBOUNDARY_OUTER(77m)まで木で覆うため、
  // horizonFillはそこからバトンタッチする形で始める。
  let edgeHeightSum = 0;
  const edgeSampleCount = 16;
  for (let i = 0; i < edgeSampleCount; i++) {
    const a = (i / edgeSampleCount) * Math.PI * 2;
    const ex = Math.cos(a) * BOUNDARY_OUTER;
    const ez = Math.sin(a) * BOUNDARY_OUTER;
    edgeHeightSum += terrainHeightAt(ex, ez);
  }
  const edgeGroundY = edgeHeightSum / edgeSampleCount - 0.4; // わずかに下げて地形の下に潜り込ませ、段差を隠す
  // Phase 3: 外径も山の近景半径(173)にほぼ届くまで延長。
  const horizonFill = buildHorizonFill(BOUNDARY_OUTER - 2, 171, edgeGroundY);
  scene.add(horizonFill);

  // --- 霧(地平線を馴染ませ、遠景の切れ目を目立たなくする) ---
  // Phase 3: 山を+33m遠くへずらしたのに合わせ、霧が山の近景付近で
  // ちょうど馴染むよう far も+33mずらす(215→248)。
  scene.fog = new THREE.Fog(0xdfe8dc, 40, 248);

  // --- 衝突判定用の障害物リスト(木・岩・テント・焚き火を通り抜けない
  //     ようにする)。配置の間引き用のavoidZonesとは別に持たせる
  //     (avoidZonesの半径は樹冠同士がぶつからないための間隔なので、
  //     衝突判定にそのまま使うと広すぎて不自然に手前で止まってしまう)。
  const collisionObstacles = []; // { x, z, radius } — 通り抜けられない
  // v1.53 E2: 見守りの回避ステアリング専用の円(歩いて上がれない丸太の目印)。物理的な押し出しには使わない(上に乗れるため)。
  const avoidLogCircles = [];
  const aiObstacles = () => (avoidLogCircles.length ? collisionObstacles.concat(avoidLogCircles) : collisionObstacles);
  // v1.49 Phase B: 物理(丸太の落下・積み重ね)用の静的コライダーの一覧。歩行用のcollisionObstacles
  // (x-z平面の円)とは別の、見た目より単純な立体(円柱・角柱)。物理が作られた時に一括登録する。
  const worldColliders = [];
  const climbableBumps = []; // { x, z, radius, height } — 小さな岩: 登れる
  const burialCandidates = []; // { mesh, baseY, heightM, log? } — 積雪で埋もれる木・岩・倒木
  const snowFollowers = []; // v1.56-H4: 雪の深さが変わるたびに呼ぶ関数(雪面に乗る物の高さ更新)。初期化の順序に依存しないよう、後から登録する
  const ROCK_CLIMB_SCALE_THRESHOLD = 0.5; // これ未満のscaleの岩は「小さな岩」として登れるようにする

  function resolveCollisions(x, z, playerRadius) {
    return resolveCircleCollisions(x, z, playerRadius, collisionObstacles);
  }

  /** 小さな岩の上に乗った時、足元の高さをなだらかに底上げする(「登れる」演出)。 */
  function getClimbBump(x, z) {
    let maxBump = 0;
    for (const rock of climbableBumps) {
      const dx = x - rock.x, dz = z - rock.z;
      const dist = Math.hypot(dx, dz);
      if (dist < rock.radius) {
        const tt = 1 - dist / rock.radius;
        const bump = rock.height * (tt * tt * (3 - 2 * tt)); // smoothstep
        if (bump > maxBump) maxBump = bump;
      }
    }
    return maxBump;
  }

  /**
   * フェーズD: 三人称カメラの障害物めり込み回避。
   * アンカー(anchorX, anchorZ)から水平方向(dirX, dirZ。正規化済み)へ
   * desiredDistanceだけ離れた位置にカメラを置きたい時、途中に木・岩・
   * テント・焚き火(collisionObstacles、x-z平面上の円として近似)が
   * あれば、その手前までdesiredDistanceを短縮する。
   * 高さ(y)は考慮しない簡易な2D判定だが、「カメラが幹の中にめり込んで
   * 画面が真っ暗になる」という最も気になる不具合には十分対応できる。
   */
  function clampCameraDistanceForObstacles(anchorX, anchorZ, dirX, dirZ, desiredDistance) {
    const CAMERA_CLEARANCE = 0.4; // 障害物の表面からさらに手前に置く余白
    let maxDist = desiredDistance;
    for (const obs of collisionObstacles) {
      if (obs.low) continue; // v1.51: 倒木などの低い障害物は、カメラの高さでは視界を遮らない
      const ax = obs.x - anchorX, az = obs.z - anchorZ;
      const anchorDist = Math.hypot(ax, az);
      if (anchorDist < obs.radius) continue; // アンカー自体が障害物の内側(大木の根元にいる時など)
      const t = ax * dirX + az * dirZ; // アンカーから見た障害物中心の視線方向への射影距離
      if (t <= 0 || t >= maxDist) continue; // 背後か、現在の制限距離より遠ければ無関係
      const closestX = anchorX + dirX * t, closestZ = anchorZ + dirZ * t;
      const perpDist = Math.hypot(obs.x - closestX, obs.z - closestZ);
      const effectiveRadius = obs.radius + CAMERA_CLEARANCE;
      if (perpDist < effectiveRadius) {
        const back = Math.sqrt(Math.max(0, effectiveRadius * effectiveRadius - perpDist * perpDist));
        const hitDist = t - back;
        if (hitDist > 0.5 && hitDist < maxDist) maxDist = hitDist;
      }
    }
    return maxDist;
  }

  // --- 大木の配置 ---
  // 2026-09(v1.30): 「紅葉を表現したい」との要望で、キャンプの目印である
  // この大木を広葉樹(createBroadleafTree)に変更した。プレイヤーが最も
  // 近くで長く見る木なので、紅葉の効果が最大化される。背景の針葉樹林は
  // そのまま(実際の針葉樹は秋でも大きくは色づかないため、この使い分けは
  // 現実の混交林の見え方とも合っている)。
  const bigTreeY = terrainHeightAt(bigTreeX, bigTreeZ);

  const bigTreeBuilt = createBroadleafTree(2.2, 1, null, 'full'); // 大木は最も近くで見るので、二段の枝分かれ('full')を使う
  const bigTree = bigTreeBuilt.group;
  placeOnTerrain(bigTree, bigTreeX, bigTreeZ, terrainHeightAt);
  scene.add(bigTree);
  collisionObstacles.push({ x: bigTreeX, z: bigTreeZ, radius: 2.2 * 0.28 });
  worldColliders.push({ id: 'tree-big', kind: 'cylinder', x: bigTreeX, z: bigTreeZ, y: terrainHeightAt(bigTreeX, bigTreeZ) + 1.6 * 2.2 / 2, radius: 2.2 * 0.2, height: 1.6 * 2.2 });
  burialCandidates.push({ mesh: bigTree, baseY: bigTree.position.y, heightM: 2.2 * 3.7 });
  const broadleafCanopyBlobs = [...bigTreeBuilt.canopyBlobs];
  const broadleafLeafSources = [{
    x: bigTreeX, z: bigTreeZ,
    top: bigTree.position.y + bigTreeBuilt.canopyTop,
    radius: bigTreeBuilt.canopyRadius,
  }];

  // --- キャンプ(テント・焚き火。大木の根元、川からは離れた場所) ---
  const campY = terrainHeightAt(campX, campZ);

  const tent = createTent(1.5); // 視点の目線の高さ(1.7m)から見て小さく見えすぎていたため拡大
  const TENT_HEIGHT = getTentHeight(1.5); // 2026-09: かまくら切り替えのタイミング判定に使う(テントが埋もれる高さ)
  placeOnTerrain(tent, campX, campZ, terrainHeightAt);
  tent.rotation.y = 0.35;
  scene.add(tent);
  // v1.49: テントの物理用コライダー = 断面五角形(壁+屋根)の角柱。屋根の傾斜に丸太が載る/滑り落ちる。
  worldColliders.push({ id: 'tent', kind: 'prism', x: campX, z: campZ, y: tent.position.y, halfWidth: 1.1 * 1.5, wallH: 1.35 * 1.5 * 0.34, apexH: 1.35 * 1.5, halfLength: 2.3 * 1.5 / 2, yaw: tent.rotation.y });
  // 2026-09(改訂2): 「かまくらの中に雪だるまが歩いて入れない」バグの
  // 根本原因への対応。以前はここで衝突判定の円(半径2.0)を一度だけ
  // 登録し、テント・かまくらの両方でそのまま使い回していた。テントは
  // 中に入れない構造物なので全周を塞ぐ円で正しいが、かまくらは入口から
  // 中に入れる構造物なので、同じ円のままでは(見た目のドームに実際の
  // 開口部を作っても)衝突判定だけが全周を塞ぎ続けて入れないままだった。
  // → テント時は従来通りの全周の円、かまくら時は入口の方向だけ隙間を
  // 空けた「柱の輪」に、状態が切り替わるたびに動的に差し替える。
  let campCollisionEntries = [];
  function setCampCollisionMode(isIgloo) {
    for (const e of campCollisionEntries) {
      const idx = collisionObstacles.indexOf(e);
      if (idx !== -1) collisionObstacles.splice(idx, 1);
    }
    campCollisionEntries = [];
    if (!isIgloo) {
      const e = { x: campX, z: campZ, radius: 2.0 };
      campCollisionEntries.push(e);
    } else {
      // ドームの入口方向(igloo.jsのDOORWAY_HALF_ANGLE_RADと同じ隙間)を
      // 避けて、外壁に沿って柱状の衝突判定を並べる。隣同士が重なる
      // 半径にすることで、柱の間からすり抜けられないようにする。
      // (計算はwander-nav.jsのbuildIglooPostObstacles。ヘッドレス検証と共通)
      for (const e of buildIglooPostObstacles(campX, campZ, iglooOuterRadius, doorwayWorldDir, doorwayHalfAngle)) {
        campCollisionEntries.push(e);
      }
    }
    for (const e of campCollisionEntries) collisionObstacles.push(e);
    if (onCampPhysicsModeChange) onCampPhysicsModeChange(isIgloo); // v1.49: 物理のコライダーもテント↔かまくらで差し替える
  }
  let onCampPhysicsModeChange = null;
  let campCollisionIsIgloo = false;
  setCampCollisionMode(campCollisionIsIgloo);

  const { group: fireGroup, update: updateFire } = createCampfire(1.0);
  placeOnTerrain(fireGroup, fireX, fireZ, terrainHeightAt);
  scene.add(fireGroup);
  const fireCollision = { x: fireX, z: fireZ, radius: 0.9 };
  collisionObstacles.push(fireCollision);
  worldColliders.push({ id: 'campfire', kind: 'cylinder', x: fireX, z: fireZ, y: terrainHeightAt(fireX, fireZ) + 0.2, radius: 0.45, height: 0.4 });

  // --- v1.54 E4: チェスト(テントの出入口の横。見守りの雪だるまが、集めた物をしまう場所) ---
  // 星のかけらの飾りがついた、世界のチェスト。キャンプの中心から、入口の向きに対して横へずらし、
  // かまくらの外側にも収まる距離に置く。正面はキャンプの外側を向く(雪だるまは外側からしまう)。
  const chest = createBaseChest({ scale: 1.0 });
  const chestAngle = campDoorAngle + SNOWMAN_COLLECT.chestAngleFromDoor;
  const chestDist = Math.max(SNOWMAN_COLLECT.chestDistance, iglooOuterRadiusPlanned + 0.9);
  const chestX = campX + Math.sin(chestAngle) * chestDist, chestZ = campZ + Math.cos(chestAngle) * chestDist;
  placeOnTerrain(chest.group, chestX, chestZ, terrainHeightAt);
  chest.group.rotation.y = chestAngle;
  scene.add(chest.group);
  collisionObstacles.push({ x: chestX, z: chestZ, radius: chest.radius * 0.85 });
  const chestCollider = { id: 'chest-camp', kind: 'cylinder', x: chestX, z: chestZ, y: terrainHeightAt(chestX, chestZ) + chest.height / 2, radius: chest.radius * 0.85, height: chest.height };
  worldColliders.push(chestCollider);
  const chestGroundOffset = chest.group.position.y - terrainHeightAt(chestX, chestZ); // 地面からの置き高さ(雪が無い時の見た目を保つ)
  const chestStand = { x: chestX + Math.sin(chestAngle) * 1.15, z: chestZ + Math.cos(chestAngle) * 1.15 }; // しまう時に立つ場所(正面)
  // v1.56-H3: チェストの開閉音。見守りの雪だるまの開閉も、歩行モードのプレイヤーの開閉も、chest.open()/close()を通るのでここで鳴る。
  chest.setSoundHooks({
    onOpen: () => { const s = sfx(); if (s) s.chestOpen(sfxRelative(chestX, terrainHeightAt(chestX, chestZ) + 0.4, chestZ)); },
    onClose: () => { const s = sfx(); if (s) s.chestClose(sfxRelative(chestX, terrainHeightAt(chestX, chestZ) + 0.4, chestZ)); },
  });

  // --- かまくら(積雪5m到達時、テントの代わりに表示) ---
  // 2026-09: 新規追加。「積雪が5mに達するとテントの代わりに雪の
  // "かまくら"を作り、焚き火は入口の前に置く(中には置かない)」との
  // 指定に対応。かまくらはテントと全く同じ場所・向きに配置しておき、
  // 見た目だけを切り替える(衝突判定は上のsetCampCollisionMode()で切替)。
  // 2026-09(改訂2): 「サイズが小さい」との指摘に対応し、1.15→1.6へ拡大
  // (半径約2.4m→約3.4m。雪だるまが余裕を持って歩いて入れる大きさ)。
  // 2026-09(改訂4): scaleは上で定義したIGLOO_SCALE(木の避け方・焚き火
  // 距離の計画にも使った値)と必ず一致させる。
  const { group: iglooGroup, radius: iglooRadius, outerRadius: iglooOuterRadius, doorwayLocalOffset, doorwayHalfAngle, updateFlame: updateIglooFlame } = createIgloo(IGLOO_SCALE);
  placeOnTerrain(iglooGroup, campX, campZ, terrainHeightAt);
  // 2026-09(改訂4): 「焚き火の位置が変わるのは変」との指摘に対応し、
  // かまくらの入口は年間を通して動かない焚き火の方(campDoorAngle)へ
  // 向ける(テント自体の見た目の向きtent.rotation.yとは切り離した)。
  iglooGroup.rotation.y = campDoorAngle;
  iglooGroup.visible = false;
  scene.add(iglooGroup);
  // 衝突判定側(setCampCollisionMode)で、柱の輪の入口方向を求めるのに使う。
  const doorwayWorldDir = doorwayLocalOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), iglooGroup.rotation.y).normalize();


  // 焚き火の周りの、熱で少し溶けて窪んだ雪。2026-09(修正): 「土が見える
  // のは変。焚き火の周りは雪が熱で溶けてくぼんでいる(=設置面が雪面より
  // 少し下がっている)」との指摘に対応し、土色ではなく圧雪のような
  // 少し青みがかった白に変更。円盤自体も、雪面よりやや低い位置(くぼみの
  // 底)に置く(下の更新処理を参照)。
  const meltedPatchMesh = new THREE.Mesh(
    new THREE.CircleGeometry(1.15, 20),
    new THREE.MeshToonMaterial({ color: 0xd8e4ec, gradientMap: getToonGradientMap() })
  );
  meltedPatchMesh.rotation.x = -Math.PI / 2;
  meltedPatchMesh.visible = false;
  scene.add(meltedPatchMesh);

  // --- 雪だるまキャラクター(Snowman 3D Character) ---
  // この世界の雪だるまは常に1体だけ、という設定にしている。
  // プレイヤーが操作していない間は「見守りモード」で自律的に
  // 歩き回らせることができる(setWander()で切り替え)。
  // 実際のCollision判定(木・岩との衝突)はまだ実装していない
  // (Snowman 3D Character.md 21〜22節の通り、将来のフェーズで対応)。
  const playerSnowman = createSnowmanCharacter(1);
  const emoteBrain = createEmoteBrain(); // v1.73: 座る・寝る(見守りでは、ときどき勝手に。歩行ではBキーのホイールから)
  const snowmanHomeX = campX + 4.0, snowmanHomeZ = campZ + 3.0; // 川・大木・テント・焚き火から十分離れた安全な位置(検証済み)
  placeOnTerrain(playerSnowman.group, snowmanHomeX, snowmanHomeZ, terrainHeightAt);
  scene.add(playerSnowman.group);

  // --- 見守りモード(自律的なランダムウォーク) ---
  // 2026-09: 「行動範囲を広げてほしい」「焚き火の前でくつろいだり、
  // 川を渡って冒険したりしてほしい」との要望を受け、ホーム周辺を
  // ぶらつくだけでなく、焚き火のそばで長めに休んだり、川を渡った
  // 対岸まで足を延ばしたりする3種類の行動を確率で選ぶようにした。
  // 2026-09(続き1): 「もっと自由に動くように」との要望を受けてさらに拡張。
  // - 行動範囲(WANDER_RADIUS)をPlayable Area(約81m)に対してかなり広げた
  // - 遠出する時は一直線ではなく、途中に横ズレした経由点を挟んで
  //   ゆるく曲がりながら歩くようにした(buildWanderPath)
  // - 立ち止まっている間もその場で完全に静止させず、ゆっくり
  //   首(向き)を振って周囲を見回すようにした
  // 2026-09(続き2): 「テントや木に挟まって前へ進めないような動きをする」
  // という不具合報告を受けて、以下を修正・追加。
  // - 焚き火・テントの「くつろぐ場所」は固定の1点ではなく、その時いる
  //   位置から見て対象の手前側(近い側)を毎回計算するようにし、
  //   目的地への直線移動が障害物の footprint を横切らないようにした
  // - それでも何かに阻まれて足止めされた場合(進んでいるのに位置が
  //   ほとんど変わらない状態が続いた場合)は、その場でその場で向きを
  //   変えて別の目的地を選び直す「スタック検知」を追加した
  // - 花畑に立ち寄って花を手に取って遊ぶ、という行動を追加した
  const WANDER_RADIUS = 60.0; // ホームからどのくらいの範囲を冒険するか(38→60にさらに拡大)
  const WANDER_SPEED = 2.0; // プレイヤーの歩行速度(7.0m/s)よりゆっくり
  const AI_JUMP_FORWARD_BOOST = 1.9; // 見守りが丸太へ跳び乗る時の、空中での前進の倍率
  const STUCK_CHECK_INTERVAL = 1.2; // 何秒おきに「進めているか」を確認するか
  const STUCK_MIN_PROGRESS = 0.35; // その間に最低限これだけ移動していないと「詰まっている」と判定
  // 2026-09(v1.25): 「動いてはいるが目的地に近づけていない」(障害物の縁を
  // 円を描いてすべっている)状態の検知。1回の確認間隔で目的地までの距離が
  // これだけ縮まなければ「近づけていない」とみなし、連続して
  // STUCK_MAX_NO_APPROACH_CHECKS回続いたらスタック扱いにする(障害物を
  // 大回りする正常な迂回で一時的に距離が縮まらないことがあるため、
  // 1回では判定しない)。
  const STUCK_MIN_APPROACH = 0.25;
  const STUCK_MAX_NO_APPROACH_CHECKS = 3;
  // 目的地・経由点を障害物の衝突円の外へ押し出す時の余白。雪だるまの
  // 衝突半径 + 到着判定(目的地から0.3m以内)より大きい値にする。
  const WANDER_ARRIVE_CLEARANCE = playerSnowman.collision.collisionRadius + 0.35;
  function sanitizeWaypoint(x, z) {
    return pushOutOfObstacles(x, z, aiObstacles(), WANDER_ARRIVE_CLEARANCE);
  }
  const wander = {
    pos: new THREE.Vector2(snowmanHomeX, snowmanHomeZ),
    target: new THREE.Vector2(snowmanHomeX, snowmanHomeZ),
    legs: [], // 現在の目的地までの残り経由点(曲がりながら歩くための経路)
    heading: 0,
    baseHeading: 0, // 待機中に見回す動きの基準となる向き
    waiting: true,
    waitTimer: 1.5,
    waitElapsed: 0,
    walking: false,
    nextRestMin: 2,
    nextRestMax: 6,
    activity: 'idle', // 'idle' | 'walk' | 'flower' (花を手に取って遊ぶ演出用)
    routePlan: null, // v1.53 E2: 丸太を伝って川を渡っている最中の経路
    jumpAssist: false, // 丸太へ跳び乗っている最中(空中の前進を速くする)
    collectTask: null, // v1.54: 拾い物の動作 {cand, phase:'goto'|'investigate'|'around'}
    baseTask: null, // v1.54: チェストへしまう動作 {phase:'goto'|'face'|'open'|'store'|'close'|'pause'}
    // --- スタック検知用 ---
    stuckCheckTimer: STUCK_CHECK_INTERVAL,
    stuckCheckPos: new THREE.Vector2(snowmanHomeX, snowmanHomeZ),
    stuckCheckDist: 0, // 前回の確認時点での、目的地までの距離
    noApproachStrikes: 0, // 「目的地に近づけていない」確認が連続した回数
    detouring: 0, // v1.51: >0の間は、倒木の端を回り込む経由点へ向かっている(残りの数)
    turningAway: 0, // >0の間は目的地を無視してその場で回転しながら少し進む(方向転換)
    turnHeadingTarget: 0,
  };

  /**
   * 「対象の近くでくつろぐ/佇む」場所を、固定座標ではなくその都度、
   * 現在地から見た対象の手前側(近い側)に計算する。
   * こうすることで、直線移動の経路が対象の footprint(衝突判定の円)を
   * 横切らずに済み、テントや焚き火にめり込んで詰まる動きを防げる。
   */
  function pickRelaxSpotNear(targetX, targetZ, backOff) {
    const dx = wander.pos.x - targetX, dz = wander.pos.y - targetZ;
    const d = Math.hypot(dx, dz) || 1;
    return { x: targetX + (dx / d) * backOff, z: targetZ + (dz / d) * backOff };
  }

  /**
   * フェーズC: 見守りモードの簡易障害物回避ステアリング。
   * 目的地方向(seekDirX, seekDirZ。正規化済み)へ進もうとした時、進行方向
   * のすぐ先(AVOID_LOOKAHEAD以内)に木・岩・テント・焚き火があれば、
   * それを避けるよう進行方向を少しだけ左右に振る「回避ベクトル」を返す。
   * 経路探索(A*等)ではなく、その場のごく短い先読みだけで判断する簡易な
   * ステアリングだが、これまでの「ぶつかってから初めて気づき、その場で
   * 反転する」(スタック検知)よりも自然に見えることを狙う。
   * スタック検知自体は、行き詰まった時の最終手段として引き続き残す。
   */
  const AVOID_LOOKAHEAD = 3.5; // この距離以内に障害物の中心があれば回避を検討する
  const AVOID_MARGIN = 0.6; // 雪だるまの半径相当として見込む余白
  function computeAvoidSteer(px, pz, seekDirX, seekDirZ) {
    return computeAvoidSteerFor(px, pz, seekDirX, seekDirZ, aiObstacles(), AVOID_LOOKAHEAD, AVOID_MARGIN);
  }

  function pickWanderTarget() {
    // ホームから半径WANDER_RADIUS以内で、川からもPlayable Areaの外周
    // (境界ゾーン)からも十分離れた点を選ぶ(見つからない場合は最大8回まで
    // 探し、それでも駄目ならホームへ戻す)。
    // sqrt分布にすることで、中心付近に偏らずWANDER_RADIUS全体へ
    // まんべんなく(むしろ遠出寄りに)出かけるようにする。
    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.sqrt(Math.random()) * WANDER_RADIUS;
      const tx = snowmanHomeX + Math.cos(angle) * dist;
      const tz = snowmanHomeZ + Math.sin(angle) * dist;
      if (Math.hypot(tx, tz) > PLAYABLE_RADIUS - 6) continue; // 森の境界ゾーンには踏み込ませない
      const { distance, width } = distanceToRiver(tx, tz, riverSamplesForAvoid);
      if (distance > getWaterEdgeDistance(width) + 2.0) return { x: tx, z: tz };
    }
    return { x: snowmanHomeX, z: snowmanHomeZ };
  }

  /**
   * v1.53 E1: 川は入れない境界になったので、「川を渡る」のではなく「今いる側の川岸まで行って水辺で佇む」地点を選ぶ。
   * (対岸へ渡る行動は、E2で橋になる倒木を探して使う形で戻す。橋が無ければ渡らない。)
   */
  function pickRiverCrossingTarget() {
    const near = nearestRiverPoint(wander.pos.x, wander.pos.y, riverSamplesForAvoid);
    const dx = wander.pos.x - near.x, dz = wander.pos.y - near.z;
    const d = Math.hypot(dx, dz) || 1;
    const bank = getWaterEdgeDistance(near.width) + 1.6 + Math.random() * 1.2; // 水際より手前(今いる側)
    return { x: near.x + (dx / d) * bank, z: near.z + (dz / d) * bank };
  }

  /** 花畑のどれか1つの近くを選ぶ(「花を手に取って遊ぶ」用)。花畑が無ければnull。 */
  function pickFlowerPatchTarget() {
    if (!poppyField || !poppyField.patchCenters || poppyField.patchCenters.length === 0) return null;
    const patch = poppyField.patchCenters[Math.floor(Math.random() * poppyField.patchCenters.length)];
    // 花畑の中心そのものではなく、少し縁寄り(半径の6割くらい)へ向かわせる
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * 5;
    return { x: patch.x + Math.cos(angle) * dist, z: patch.z + Math.sin(angle) * dist };
  }

  /** 次の行動(ぶらつく/焚き火でくつろぐ/川を渡る/テントで佇む/花畑で遊ぶ/
   *  かまくらの中でくつろぐ)を確率で選ぶ。
   *  2026-09(改訂3): 「見守りモードの時、かまくらの中に雪だるまが入って
   *  くつろぐイベントも入れてほしい」との指摘に対応し、かまくらが実際に
   *  設置されている(iglooActiveState)時だけ選ばれる新しい行動を追加した。
   */
  // 川に丸太がかかった時の「渡ってみたい」気持ち(初めての丸太は強く、渡ったことのある丸太は習性として時々)
  const CROSS_CURIOSITY_NOVEL = 0.9;
  const CROSS_HABIT = 0.4;
  const CROSS_COOLDOWN_SEC = 25; // 渡ったあと、しばらくは別の行動をする
  const crossedLogs = new Set();
  let lastCrossSec = -1e9;
  const logIdOfRouteKey = (key) => key.replace(/:[01]$/, '');
  let debugForceCrossing = false; // 開発・検証用: 次の行動を「川を渡る」に固定する
  function pickNextWanderActivity() {
    // v1.38: 落ちてきた星が気になっている時は、そちらへ向かう(星が先に消えていたら忘れる)
    // v1.54: ポーチが満杯なら、探索をやめてテントのチェストへ帰る(チェストが満杯なら、そのまま持ち歩く)
    if (pouch.isFull() && !pouch.isEmpty() && !chest.storage.isFull()) {
      return { target: { x: chestStand.x, z: chestStand.z }, restMin: 2, restMax: 4, activity: 'idle', toChest: true };
    }
    // 落ちてきた星が気になっている時(気づいた上で向かうと決めた時)は、そちらへ向かう
    if (starInterest.active) {
      starInterest.active = false;
      const cands = collectRegistry.sense(wander.pos.x, wander.pos.y, { only: ['star'], now: clock.elapsedTime, pouchFull: pouch.isFull() });
      const c = cands.length ? collectRegistry.choose(cands) : null;
      if (c) return collectActivity(c);
    }
    // v1.54: 周りの拾えそうな物(星・小枝)に気づいたら、優先度の重みつきのくじで1つ選んで向かう(最寄りを順番に、ではない)
    if (!pouch.isFull()) {
      const cands = collectRegistry.sense(wander.pos.x, wander.pos.y, { now: clock.elapsedTime });
      if (cands.length) {
        const p = cands.some((c) => c.kind === 'star') ? SNOWMAN_COLLECT.attemptProbabilityStar : SNOWMAN_COLLECT.attemptProbability;
        if (Math.random() < p) { const c = collectRegistry.choose(cands); if (c) return collectActivity(c); }
      }
    }
    if (debugForceCrossing) { debugForceCrossing = false; return { target: pickRiverCrossingTarget(), restMin: 2, restMax: 3, activity: 'idle', crossing: true }; }
    // v1.53 E2: 川に渡れる丸太がかかっていたら、渡ってみたくなる(好奇心)。いちど渡った丸太でも、向こう岸へ行く習性で時々また渡る。
    // 渡れるかどうかは、丸太に「橋」の印があるかではなく、面の高さ・位置から物理的に届くかで決まる(ジャンプが必要でも、届くなら跳んで渡る)。
    const nowSec = clock.elapsedTime;
    if (nowSec - lastCrossSec > CROSS_COOLDOWN_SEC) {
      const plan = traversal.planLogCrossing(wander.pos.x, wander.pos.y, { isFailed: (k) => traversalFailures.isFailed(k), maxEntryDistance: 70 });
      if (plan) {
        const novel = !crossedLogs.has(logIdOfRouteKey(plan.key));
        if (Math.random() < (novel ? CROSS_CURIOSITY_NOVEL : CROSS_HABIT)) {
          return { target: pickRiverCrossingTarget(), restMin: 3, restMax: 8, activity: 'idle', crossing: true };
        }
      }
    }
    const r = Math.random();
    if (iglooActiveState && r < 0.14) {
      return { target: pickIglooRelaxTarget(), restMin: 12, restMax: 22, activity: 'igloo' };
    }
    const rOffset = iglooActiveState ? 0.14 : 0; // 上のかまくら行動が選ばれなかった分、他の確率帯はそのまま維持する
    if (r < 0.16 + rOffset) return { target: pickRelaxSpotNear(fireX, fireZ, 1.7), restMin: 8, restMax: 16, activity: 'idle' };
    if (r < 0.32 + rOffset) return { target: pickRiverCrossingTarget(), restMin: 4, restMax: 10, activity: 'idle', crossing: true };
    if (r < 0.44 + rOffset) return { target: pickRelaxSpotNear(campX, campZ, 3.2), restMin: 5, restMax: 11, activity: 'idle' };
    const flowerTarget = r < 0.60 + rOffset ? pickFlowerPatchTarget() : null;
    if (flowerTarget) return { target: flowerTarget, restMin: 6, restMax: 12, activity: 'flower' };
    return { target: pickWanderTarget(), restMin: 2, restMax: 7, activity: 'idle' };
  }

  /**
   * かまくらの中の、蝋燭のそばのくつろぎ場所を選ぶ(入口からまっすぐ
   * 奥へ入った、中心よりやや入口寄りの位置)。かまくらが設置されて
   * いない時はnullを返す。
   */
  function pickIglooRelaxTarget() {
    if (!iglooActiveState) return null;
    const dist = iglooRadius * (0.25 + Math.random() * 0.15);
    return { x: campX + doorwayWorldDir.x * dist, z: campZ + doorwayWorldDir.z * dist };
  }

  /**
   * かまくらの入口の少し外側にある、経路の中継点(ここを経由させることで
   * ドームの壁にぶつからず必ず入口を通って出入りするようにする)。
   */
  function pickIglooApproachPoint() {
    const dist = iglooOuterRadius + 2;
    // 2026-09(v1.25): 入口の正面には焚き火(外周+2.6m)があり、素の位置
    // (外周+2.0m)は焚き火の衝突円の内側だった。この経由点に着けず、雪だるまが
    // 焚き火の縁で押し戻され続けて高速回転して見える不具合の原因になっていた。
    // 障害物の衝突円の外へ押し出した位置を返す(焚き火が動いても追従する)。
    return sanitizeWaypoint(campX + doorwayWorldDir.x * dist, campZ + doorwayWorldDir.z * dist);
  }

  /**
   * 目的地までの経路(legs)を組み立てる。通常はbuildWanderPath()で直線的な
   * 経路を作るだけでよいが、かまくらへ入る/かまくらの中から出る場合だけは
   * 必ず入口を経由させる(そうしないとドームの壁に沿って詰まってしまう)。
   */
  function computeWanderLegs(next) {
    wander.routePlan = null;
    wander.collectTask = next.collect ? { cand: next.collect, phase: 'goto' } : null; // v1.54
    wander.baseTask = next.toChest ? { phase: 'goto' } : null;
    // v1.53 E2: 川を渡りたい時は、丸太の表面を伝って向こう岸へ届く経路があるかを、物理的な到達可能性から調べる
    // (丸太に「橋」の印は無い。入口で乗れるか・上を歩けるか・向こうに地面があるかを面の高さと位置から確かめる)。
    // 無ければ、川岸まで行って佇む。失敗した足がかりは一定時間覚えて、同じ不可能な試みを繰り返さない。
    if (next.crossing) {
      const plan = traversal.planLogCrossing(wander.pos.x, wander.pos.y, { isFailed: (k) => traversalFailures.isFailed(k), maxEntryDistance: 70 });
      if (plan) {
        wander.routePlan = plan;
        const topAt = (x, z) => { let m = NaN; for (const h of traversal.surfaceHits(x, z, 0)) if (!(m >= h.topAbs)) m = h.topAbs; return m; }; // 重なった丸太なら、いちばん高い面
        const legs = [{ x: plan.approach.x, z: plan.approach.z, raw: true, act: 'approach' },
          { x: plan.mount.x, z: plan.mount.z, raw: true, act: 'mount', action: plan.mount.action, rise: plan.mount.rise, topY: topAt(plan.mount.x, plan.mount.z), tries: 0 }];
        for (const a of plan.along) legs.push({ x: a.x, z: a.z, raw: true, act: 'along' });
        legs.push({ x: plan.exit.x, z: plan.exit.z, raw: true, act: 'exit' });
        return legs;
      }
    }
    // どの行き先でも、目的地・経由点が障害物の衝突円の内側にならないよう
    // 押し出してから使う(木・岩・焚き火の縁に着けず回り続けるのを防ぐ)。
    return computeWanderLegsRaw(next).map((leg) => sanitizeWaypoint(leg.x, leg.z));
  }
  // 渡る試みに失敗した丸太は、失敗のたびに覚える時間を倍にする(150秒→300→600→…最大1時間)。同じ丸太に1時間以上挑み続けない。
  const routeFails = new Map(); // 丸太のid -> 失敗した回数
  function markRouteFailed(plan) {
    if (!plan) return;
    const id = logIdOfRouteKey(plan.key);
    const n = (routeFails.get(id) || 0) + 1;
    routeFails.set(id, n);
    const sec = Math.min(3600, 150 * Math.pow(2, n - 1));
    traversalFailures.mark(`${id}:0`, sec); traversalFailures.mark(`${id}:1`, sec); // 入口の両端とも
  }
  /** 渡る試みに失敗した: 足がかり(丸太)を覚え、引き返す。 */
  function failRoute() {
    markRouteFailed(wander.routePlan);
    wander.routePlan = null;
    aiClimb.cancel(); nonWalkVertical.climbing = false;
    startTurnAround();
  }
  function computeWanderLegsRaw(next) {
    const insideIgloo = iglooActiveState
      && Math.hypot(wander.pos.x - campX, wander.pos.y - campZ) < iglooRadius * 0.95;
    const enteringIgloo = next.activity === 'igloo';
    if (insideIgloo || enteringIgloo) {
      const approach = pickIglooApproachPoint();
      if (insideIgloo && enteringIgloo) return [approach, next.target]; // 通常は起こらないが念のため
      if (insideIgloo) return [approach, ...buildWanderPath(approach.x, approach.z, next.target.x, next.target.z)];
      return [approach, next.target]; // 外から中へ
    }
    return buildWanderPath(wander.pos.x, wander.pos.y, next.target.x, next.target.z);
  }

  /**
   * from→toへ、一直線ではなく途中に横ズレした経由点を挟んだ経路を作る
   * (距離が長いほど、より大きく・複数回曲がりながら歩くようにする)。
   */
  function buildWanderPath(fromX, fromZ, toX, toZ) {
    const dx = toX - fromX, dz = toZ - fromZ;
    const dist = Math.hypot(dx, dz);
    const path = [];
    if (dist > 9) {
      const legs = dist > 26 ? 2 : 1;
      const dirX = dx / dist, dirZ = dz / dist;
      const perpX = -dirZ, perpZ = dirX; // 進行方向に対して垂直な向き
      for (let i = 1; i <= legs; i++) {
        const t = i / (legs + 1);
        const baseX = fromX + dx * t;
        const baseZ = fromZ + dz * t;
        const lateral = (Math.random() - 0.5) * dist * 0.32;
        path.push({ x: baseX + perpX * lateral, z: baseZ + perpZ * lateral });
      }
    }
    path.push({ x: toX, z: toZ });
    return path;
  }

  // ================================================================
  // v1.53 E2c: 閉じ込められた時の脱出(行ったり来たりを繰り返して、抜け出せなくなる状態の安全網)
  // ================================================================
  // 既存のスタック検知(1.2秒ごとの進み具合)は、壁際でごく小さく左右に揺れ続ける状態を「動いている/近づいている」と
  // 見誤る。そこで、もっと長い時間(ESCAPE_WINDOW_SEC)の「居た範囲」で見る: 歩いているつもりなのにその範囲が
  // ESCAPE_MAX_SPAN未満なら、閉じ込められているとみなして、物理的に通れる向きを探して抜け出す。
  //   1回目: 通れる向きへ、少し遠くまで歩く(回避の円は無視して、物理的な障害だけを避ける)
  //   続けて起きたら: 距離を伸ばし、その行き先は一定時間えらばない(同じ場所へ向かい直さない)
  //   どの向きにも通れない(完全に囲まれている): 無理に動かず休み、あとでまた調べる
  const ESCAPE_WINDOW_SEC = 12;       // この秒数の間、同じ狭い範囲にいたら閉じ込められていると判定
  const ESCAPE_MAX_SPAN = 2.0;        // その間に居た範囲(外接する四角の対角線)がこれ未満なら
  const ESCAPE_DISTANCES = [9, 13, 17]; // 脱出で歩く距離(連続して起きるたびに長くなる)
  const ESCAPE_ESCALATE_WITHIN_SEC = 90; // 前回の脱出からこの時間内にまた起きたら、段階を上げる
  const BLOCKED_GOAL_SEC = 180;       // 行き詰まった行き先を、この時間は選ばない
  const BLOCKED_GOAL_RADIUS = 7;      // 行き詰まった行き先の、この範囲内も選ばない
  const escapeState = { samples: [], timer: 0, level: 0, lastEscapeSec: -1e9, blockedGoals: [], total: 0 };
  function resetEscapeWatch() { escapeState.samples.length = 0; escapeState.timer = 0; }
  /** 行き詰まった行き先の近くを選んでしまったら、数回まで選び直す。 */
  function pickActivityAvoidingBlocked() {
    const now = clock.elapsedTime;
    escapeState.blockedGoals = escapeState.blockedGoals.filter((g) => g.until > now);
    let next = pickNextWanderActivity();
    for (let i = 0; i < 6 && escapeState.blockedGoals.length && next.target; i++) {
      const t = next.target;
      if (!escapeState.blockedGoals.some((g) => Math.hypot(g.x - t.x, g.z - t.z) < BLOCKED_GOAL_RADIUS)) break;
      next = pickNextWanderActivity();
    }
    return next;
  }
  /** (x,z)へ歩いて行けるか(物理的に通れない所・水・回避の円の中へ入り込む所は不可)。出発点が円の中でも、外へ出る向きは通す。 */
  function escapeBlockedAt(x, z, sx, sz, obs) {
    if (Math.hypot(x - snowmanHomeX, z - snowmanHomeZ) > WANDER_RADIUS) return true;
    if (traversal.isWaterBlocked(x, z, null)) return true;
    const rr = playerSnowman.collision.collisionRadius;
    for (const o of obs) {
      const lim = o.radius + rr * 0.6;
      const d = Math.hypot(x - o.x, z - o.z);
      if (d < lim && d < Math.hypot(sx - o.x, sz - o.z) - 0.05) return true; // 円の中へ、さらに深く入る向きは不可
    }
    return false;
  }
  /** いまの位置から、通れる向きを探す。{x,z,clear}(clear=その向きに歩ける距離)か、無ければnull。 */
  function findEscapeDirection(maxDist) {
    const sx = wander.pos.x, sz = wander.pos.y;
    const obs = aiObstacles();
    // 近くの障害物の中心から離れる向きを、少し優先する(壁から離れる)
    let awayX = 0, awayZ = 0;
    for (const o of obs) {
      const d = Math.hypot(sx - o.x, sz - o.z);
      if (d < o.radius + 4) { const w = 1 / Math.max(0.5, d); awayX += (sx - o.x) * w; awayZ += (sz - o.z) * w; }
    }
    const aLen = Math.hypot(awayX, awayZ) || 1; awayX /= aLen; awayZ /= aLen;
    const N = 24, cands = [];
    const phase = Math.random() * Math.PI * 2;
    for (let i = 0; i < N; i++) {
      const a = phase + (i / N) * Math.PI * 2;
      const dx = Math.cos(a), dz = Math.sin(a);
      let clear = 0;
      for (let d = 0.5; d <= maxDist + 1e-6; d += 0.5) {
        if (escapeBlockedAt(sx + dx * d, sz + dz * d, sx, sz, obs)) break;
        clear = d;
      }
      if (clear >= 4) cands.push({ dx, dz, clear, score: Math.min(clear, maxDist) + (dx * awayX + dz * awayZ) * 3 + Math.random() * 2 });
    }
    if (!cands.length) return null;
    cands.sort((p, q) => q.score - p.score);
    const c = cands[0];
    const len = Math.min(c.clear, maxDist);
    return { x: sx + c.dx * len, z: sz + c.dz * len, clear: c.clear };
  }
  /** 閉じ込められた: 通れる向きへ抜け出す。 */
  function triggerEscape() {
    const now = clock.elapsedTime;
    escapeState.level = (now - escapeState.lastEscapeSec < ESCAPE_ESCALATE_WITHIN_SEC) ? Math.min(ESCAPE_DISTANCES.length, escapeState.level + 1) : 1;
    escapeState.lastEscapeSec = now;
    escapeState.total++;
    resetEscapeWatch();
    // 向かっていた行き先は、しばらく選ばない
    const goal = wander.legs.length ? wander.legs[wander.legs.length - 1] : { x: wander.target.x, z: wander.target.y };
    escapeState.blockedGoals.push({ x: goal.x, z: goal.z, until: now + BLOCKED_GOAL_SEC });
    if (wander.routePlan) { markRouteFailed(wander.routePlan); wander.routePlan = null; }
    aiClimb.cancel(); nonWalkVertical.climbing = false;
    wander.detouring = 0; wander.turningAway = 0; wander.jumpAssist = false;
    const dir = findEscapeDirection(ESCAPE_DISTANCES[escapeState.level - 1]);
    if (!dir) {
      // どの向きにも通れない(完全に囲まれている): 無理に動かず、しばらく休んでからまた調べる
      wander.legs = []; wander.waiting = true; wander.waitTimer = 15 + Math.random() * 10; wander.waitElapsed = 0;
      wander.baseHeading = wander.heading; wander.walking = false; wander.nextRestMin = 8; wander.nextRestMax = 14; wander.activity = 'idle';
      return;
    }
    wander.legs = [{ x: dir.x, z: dir.z, raw: true, act: 'escape' }];
    wander.target.set(dir.x, dir.z);
    wander.activity = 'walk'; wander.nextRestMin = 2; wander.nextRestMax = 5;
    resetStuckCheck();
  }
  /** 歩いている間、居た範囲を見張る。閉じ込められていれば脱出を始めてtrueを返す。 */
  function updateEscapeWatch(delta) {
    const leg0 = wander.legs[0];
    // 丸太を渡る・跳ぶ・引き上げる最中や、脱出の最中は見張らない(それぞれの失敗処理がある/脱出自体が抜け出す動き)
    if (aiClimb.active || !nonWalkVertical.grounded || (leg0 && leg0.raw && leg0.act !== 'approach')) { resetEscapeWatch(); return false; }
    escapeState.timer += delta;
    if (escapeState.timer < 1.0) return false;
    escapeState.timer = 0;
    escapeState.samples.push(wander.pos.x, wander.pos.y);
    const maxN = ESCAPE_WINDOW_SEC;
    while (escapeState.samples.length > maxN * 2) escapeState.samples.splice(0, 2);
    if (escapeState.samples.length < maxN * 2) return false;
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < escapeState.samples.length; i += 2) {
      const x = escapeState.samples[i], z = escapeState.samples[i + 1];
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    if (Math.hypot(maxX - minX, maxZ - minZ) >= ESCAPE_MAX_SPAN) return false;
    triggerEscape();
    return true;
  }

  // ================================================================
  // v1.56-H5: 行き来のループの根本対策(長時間の進捗監視・同じ動きの繰り返し検出・乗り越え・最後の保証)
  // ================================================================
  // 既存の閉じ込め検知(上のE2c)は「12秒・2m以内」だけが条件で、行き来の幅が広い場合や、ジャンプ・引き上げを試して戻る
  // ループ(見張りが毎回リセット)では反応せず、同じ動きが何時間も続くことがあった。ここでは歩き方ではなく「進捗」で見る
  // (wander-watchdog.js)。段階: 1=脱出 → 2=丸太を乗り越える(無ければ強い脱出) → 3=大きなジャンプで安全な地面へ(必ず終わる)。
  const stagnation = createStagnationWatchdog();
  const repeats = createRepeatDetector({ limit: 3, windowSec: 300 });
  wander.hurdle = null; // { phase:'approach'|'up'|'down', plan, timer, goal }
  wander.hop = null;    // { t, dur, from, to, apex }
  const watchdogStats = { stagnations: 0, hurdles: 0, hops: 0, repeats: 0, lastLevel: 0, lastReason: '' };
  const isNonLogObstacleAt = (x, z, pad) => { for (const o of collisionObstacles) if (!o.low && Math.hypot(x - o.x, z - o.z) < o.radius + pad) return true; return false; };
  function currentGoal() { return wander.legs.length ? wander.legs[wander.legs.length - 1] : { x: wander.target.x, z: wander.target.y }; }

  /** 進路をふさぐ丸太を、よじ登って乗り越える。計画できたらtrue(丸太の手前まで歩いて、よじ登り、向こう側へよじ降りる)。 */
  function startHurdleToward(gx, gz) {
    const plan = traversal.planHurdle(wander.pos.x, wander.pos.y, gx, gz, {
      isFailed: (k) => traversalFailures.isFailed(k), isBlocked: (x, z) => isNonLogObstacleAt(x, z, 0.7),
    });
    if (!plan) return false;
    wander.hurdle = { phase: 'approach', plan, timer: 0, goal: { x: gx, z: gz } };
    wander.legs = []; wander.detouring = 0; wander.turningAway = 0; wander.waiting = false; wander.routePlan = null;
    wander.collectTask = null; wander.baseTask = null; wander.activity = 'walk';
    watchdogStats.hurdles++;
    return true;
  }
  function failHurdle() {
    const h = wander.hurdle; wander.hurdle = null;
    aiClimb.cancel(); nonWalkVertical.climbing = false;
    if (h) traversalFailures.mark(h.plan.key, 600); // この丸太の乗り越えは、しばらく試さない
    startTurnAround();
  }
  function updateHurdle(delta) {
    const h = wander.hurdle; if (!h) return false;
    if (h.phase !== 'approach') return false; // よじ登り・よじ降りの最中は、aiClimbが動かす
    h.timer += delta;
    const a = h.plan.approach, dx = a.x - wander.pos.x, dz = a.z - wander.pos.y, d = Math.hypot(dx, dz);
    if (h.timer > 14) { failHurdle(); return true; }
    if (d < 0.3) {
      const c = h.plan.crest;
      aiClimb.start(wander.pos.x, wander.pos.y, nonWalkVertical.y, c.x, c.z, c.y, climbDurationFor(h.plan.rise));
      nonWalkVertical.climbing = true; wander.walking = false; h.phase = 'up';
      return true;
    }
    const step = Math.min(d, WANDER_SPEED * delta);
    wander.pos.x += (dx / d) * step; wander.pos.y += (dz / d) * step; // 手前までは、障害物の回避を無視してまっすぐ(他の障害物は計画の時点で避けてある)
    wander.heading = stepHeading(wander.heading, Math.atan2(dx, dz), WANDER_MAX_TURN_RATE, delta);
    wander.walking = true;
    return true;
  }
  function onHurdleClimbDone() {
    const h = wander.hurdle; if (!h) return;
    if (h.phase === 'up') { // てっぺんに乗った: 向こう側へよじ降りる
      const c = h.plan.crest, e = h.plan.exit;
      aiClimb.start(c.x, c.z, c.y, e.x, e.z, e.y, climbDurationFor(h.plan.drop));
      nonWalkVertical.climbing = true; h.phase = 'down';
      return;
    }
    // 向こう側に降りた: 元の行き先へ歩き出す。進捗とする
    wander.hurdle = null;
    wander.legs = [{ x: h.goal.x, z: h.goal.z }];
    wander.target.set(h.goal.x, h.goal.z);
    wander.activity = 'walk'; wander.nextRestMin = 3; wander.nextRestMax = 7;
    stagnation.markProgress(); resetEscapeWatch(); resetStuckCheck();
  }

  /** 最後の保証: 大きなジャンプ(放物線)で、近くの安全な地面へ。丸太・木・岩・水から離れた所を選ぶ。 */
  function startRescueHop() {
    const rr = playerSnowman.collision.collisionRadius;
    const valid = (x, z) => {
      if (Math.hypot(x - snowmanHomeX, z - snowmanHomeZ) > WANDER_RADIUS * 0.95) return false;
      if (traversal.isWaterBlocked(x, z, null)) return false;
      for (const o of collisionObstacles) if (Math.hypot(x - o.x, z - o.z) < o.radius + rr + 1.2) return false;
      return true;
    };
    valid.room = (x, z) => { let m = 1e9; for (const o of collisionObstacles) m = Math.min(m, Math.hypot(x - o.x, z - o.z) - o.radius); return Math.min(m, 6); };
    let spot = findRescueSpot({ x: wander.pos.x, z: wander.pos.y, isValid: valid, minDist: 9, maxDist: 50 });
    if (!spot) { const t = pickRelaxSpotNear(fireX, fireZ, 1.7); spot = { x: t.x, z: t.z }; } // 見つからなければ焚き火のそば
    aiClimb.cancel();
    wander.hurdle = null; wander.legs = []; wander.detouring = 0; wander.turningAway = 0; wander.waiting = false; wander.routePlan = null;
    wander.collectTask = null; wander.baseTask = null; wander.jumpAssist = false;
    wander.hop = { t: 0, dur: 1.7, from: { x: wander.pos.x, z: wander.pos.y, y: nonWalkVertical.y }, to: { x: spot.x, z: spot.z, y: snowGroundAt(spot.x, spot.z) }, apex: 3.2 };
    nonWalkVertical.climbing = true; wander.walking = false;
    watchdogStats.hops++;
  }
  function updateHop(delta) {
    const h = wander.hop; if (!h) return false;
    h.t += delta / h.dur;
    const p = hopPoint(h.from, h.to, h.apex, h.t);
    wander.pos.set(p.x, p.z); nonWalkVertical.forceY(p.y);
    wander.heading = stepHeading(wander.heading, Math.atan2(h.to.x - h.from.x, h.to.z - h.from.z), 6, delta);
    wander.walking = false;
    if (h.t >= 1) {
      wander.hop = null; nonWalkVertical.climbing = false;
      wander.waiting = true; wander.waitTimer = 3 + Math.random() * 3; wander.waitElapsed = 0; wander.baseHeading = wander.heading;
      wander.activity = 'idle'; wander.nextRestMin = 5; wander.nextRestMax = 10;
      stagnation.markProgress(); resetEscapeWatch(); resetStuckCheck();
    }
    return true;
  }

  /** 行き詰まりの段階に応じた手を打つ。1=脱出 2=乗り越え(無ければ強い脱出) 3=大きなジャンプ。 */
  function handleStagnation(level) {
    watchdogStats.stagnations++; watchdogStats.lastLevel = level;
    const g = currentGoal();
    if (level >= 3) { watchdogStats.lastReason = 'hop'; startRescueHop(); return; }
    if (level === 2) {
      watchdogStats.lastReason = 'hurdle';
      if (startHurdleToward(g.x, g.z) || startHurdleToward(snowmanHomeX, snowmanHomeZ)) return;
    } else watchdogStats.lastReason = 'escape';
    triggerEscape();
  }

  /** いま進んでいる向きの先にある、いちばん近い障害物の「場所×向き」の署名。無ければnull。 */
  function blockerAhead() {
    const hx = Math.sin(wander.heading), hz = Math.cos(wander.heading);
    let best = null, bd = 1e9;
    for (const o of collisionObstacles) {
      const dx = o.x - wander.pos.x, dz = o.z - wander.pos.y, len = Math.hypot(dx, dz) || 1e-6, d = len - o.radius;
      if (d < 3 && (dx * hx + dz * hz) / len > 0.2 && d < bd) { bd = d; best = o; }
    }
    return best ? { o: best, hx, hz } : null;
  }
  /** 同じ場所・同じ向きの行き詰まりが、5分に3回起きたら、別の手に切り替える。切り替えたらtrue。 */
  function onRepeatedBlock() {
    watchdogStats.repeats++; watchdogStats.lastReason = 'repeat';
    const g = currentGoal();
    escapeState.blockedGoals.push({ x: g.x, z: g.z, until: clock.elapsedTime + BLOCKED_GOAL_SEC * 2 }); // この行き先は、しばらく選ばない
    if (startHurdleToward(g.x, g.z)) return true;
    triggerEscape();
    return true;
  }
  function noteBlockedHere() {
    const b = blockerAhead(); if (!b) return false;
    const sig = blockerSignature(b.o.x, b.o.z, b.hx, b.hz);
    if (repeats.record(sig, clock.elapsedTime) < repeats.limit) return false;
    repeats.clear(sig);
    return onRepeatedBlock();
  }
  function noteWallDetour(wall) {
    const mx = (wall.x1 + wall.x2) / 2, mz = (wall.z1 + wall.z2) / 2;
    const sig = 'wall|' + blockerSignature(mx, mz, Math.sin(wander.heading), Math.cos(wander.heading), 6);
    if (repeats.record(sig, clock.elapsedTime) < repeats.limit) return false;
    repeats.clear(sig);
    return onRepeatedBlock();
  }

  /** 現在の目的地をあきらめ、その場で向きを変えてから別の場所へ歩き出す。 */
  function startTurnAround() {
    if (noteBlockedHere()) return; // v1.56-H5: 同じ場所・同じ向きで3回行き詰まったら、別の手(乗り越え/強い脱出)に切り替える
    wander.collectTask = null; wander.baseTask = null; // v1.54: 着く前に行き詰まったら、拾い物・チェストの動作もあきらめる
    if (wander.routePlan) { markRouteFailed(wander.routePlan); wander.routePlan = null; } // 途中で行き詰まった足がかりは覚えておく
    wander.legs = [];
    wander.detouring = 0;
    wander.turningAway = 0.7 + Math.random() * 0.4; // この秒数はその場で回転を優先する
    wander.turnHeadingTarget = wander.heading + (Math.random() < 0.5 ? 1 : -1) * (Math.PI * 0.5 + Math.random() * Math.PI * 0.4);
    wander.walking = true; // 回転中も「歩いている」扱いにして足踏みアニメを出す
  }

  /** スタック検知の基準(位置・目的地までの距離・連続回数)を現在の状態へ取り直す。目的地を設定した直後に呼ぶ。 */
  function resetStuckCheck() {
    wander.stuckCheckTimer = STUCK_CHECK_INTERVAL;
    wander.stuckCheckPos.copy(wander.pos);
    wander.stuckCheckDist = Math.hypot(wander.target.x - wander.pos.x, wander.target.y - wander.pos.y);
    wander.noApproachStrikes = 0;
  }

  // ================================================================
  // v1.54 E3/E4: 拾い物の動作(眺める→拾う/拾わない→見回す)と、チェストへ帰ってしまう動作
  // ================================================================
  // どちらも、歩いて行く部分は既存の行き先(legs)の仕組みをそのまま使い、着いたあとの「その場の動作」だけを
  // 状態機械として持つ。着く前に行き詰まったら(startTurnAround)、動作ごとあきらめる。
  function collectActivity(cand) {
    return { target: { x: cand.x, z: cand.z }, restMin: 3, restMax: 7, activity: 'idle', collect: cand };
  }
  const TASK_FACE_RATE = WANDER_MAX_TURN_RATE * 1.3;
  /** (x,z)の方を向く。向きの差(rad)を返す。 */
  function faceToward(x, z, delta) {
    const want = Math.atan2(x - wander.pos.x, z - wander.pos.y);
    wander.heading = stepHeading(wander.heading, want, TASK_FACE_RATE, delta);
    let d = want - wander.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
    return Math.abs(d);
  }
  const rand2 = (r) => r[0] + Math.random() * (r[1] - r[0]);
  function endTasks() {
    wander.collectTask = null; wander.baseTask = null;
    wander.waiting = true; wander.waitTimer = 0.4 + Math.random() * 0.8; wander.waitElapsed = 0;
    wander.baseHeading = wander.heading; wander.walking = false; wander.activity = 'idle';
    wander.nextRestMin = 3; wander.nextRestMax = 8;
  }
  /** 着いた: 眺め始める。物がもう無い/遠すぎる時はfalse(通常の休みへ)。 */
  function beginCollectTask() {
    const ct = wander.collectTask;
    if (!ct) return false;
    const c = ct.cand;
    if (!collectRegistry.exists(c) || Math.hypot(c.x - wander.pos.x, c.z - wander.pos.y) > 3.6) { wander.collectTask = null; return false; }
    const kind = collectRegistry.kindOf(c.kind);
    ct.phase = 'investigate'; ct.timer = rand2(kind.investigateSec);
    return true;
  }
  function runCollectTask(ct, delta) {
    wander.walking = false; resetEscapeWatch(); resetStuckCheck();
    const c = ct.cand;
    if (ct.phase === 'investigate') {
      faceToward(c.x, c.z, delta);
      ct.timer -= delta;
      if (ct.timer > 0) return true;
      const kind = collectRegistry.kindOf(c.kind);
      let took = false;
      // 拾うと決めた時だけ。大きな物は、拾わずに眺めるだけ(データのsizeで決まる)。ポーチに入らなければ拾わない。
      if (collectRegistry.exists(c) && collectRegistry.decideCollect(c) && pouch.canTake(kind.itemId)) {
        const itemId = collectRegistry.take(c);
        if (itemId) took = pouch.take(itemId);
      }
      if (!took && collectRegistry.exists(c)) collectRegistry.ignore(c, clock.elapsedTime + SNOWMAN_COLLECT.ignoreAfterDeclineSec); // 拾わなかった物は、しばらく気にしない
      ct.phase = 'around'; ct.timer = rand2(SNOWMAN_COLLECT.lookAroundSec); ct.t0 = ct.timer; ct.took = took;
      return true;
    }
    if (ct.phase === 'around') {
      ct.timer -= delta;
      wander.heading += Math.sin((ct.t0 - ct.timer) * 2.4) * 0.6 * delta; // きょろきょろ見回す
      if (ct.timer <= 0) endTasks();
      return true;
    }
    return false;
  }
  /** 気まぐれ: チェストにジャック・オー・ランタンがあれば、頭にかぶってみる。かぶっていれば、また脱いでしまうこともある。 */
  function aiLanternWhim() {
    const head = equipment.get('head');
    if (!head && chest.storage.count('jack_o_lantern') > 0 && Math.random() < 0.4) {
      if (chest.storage.take('jack_o_lantern', 1) > 0) equipment.set('head', 'jack_o_lantern');
    } else if (head === 'jack_o_lantern' && Math.random() < 0.3) {
      if (chest.storage.store('jack_o_lantern', 1) > 0) equipment.set('head', null);
    }
  }
  function beginChestTask() {
    wander.baseTask = { phase: 'face', timer: 1.6, stored: 0 };
    wander.legs = [];
  }
  function runBaseTask(bt, delta) {
    wander.walking = false; resetEscapeWatch(); resetStuckCheck();
    const COL = SNOWMAN_COLLECT;
    if (bt.phase === 'face') { // チェストの方を向く(向き終えるか、1.6秒たつまで)
      const err = faceToward(chestX, chestZ, delta);
      bt.timer -= delta;
      if (err < 0.15 || bt.timer <= 0) { bt.phase = 'open'; bt.timer = COL.chestOpenSec; chest.open(); }
      return true;
    }
    faceToward(chestX, chestZ, delta);
    if (bt.phase === 'open') {
      bt.timer -= delta;
      if (bt.timer <= 0 && chest.settled()) { bt.phase = 'store'; bt.timer = 0.2; }
      return true;
    }
    if (bt.phase === 'store') { // 1個ずつしまう
      bt.timer -= delta;
      if (bt.timer > 0) return true;
      bt.timer = COL.chestStoreEachSec;
      if (pouch.isEmpty()) { bt.phase = 'close'; bt.timer = COL.chestCloseSec; chest.close(); return true; }
      const id = pouch.giveOne();
      if (id) {
        if (chest.storage.store(id, 1) > 0) bt.stored++;
        else { inventory.add(id, 1); bt.phase = 'close'; bt.timer = COL.chestCloseSec; chest.close(); } // チェストが満杯: 持ち帰って閉じる
      } else { bt.phase = 'close'; bt.timer = COL.chestCloseSec; chest.close(); } // 手元から先に無くなっていた分は、数えから外した
      return true;
    }
    if (bt.phase === 'close') {
      bt.timer -= delta;
      if (bt.timer <= 0 && chest.settled()) { bt.phase = 'pause'; bt.timer = rand2(COL.chestPauseSec); aiLanternWhim(); }
      return true;
    }
    if (bt.phase === 'pause') {
      bt.timer -= delta;
      if (bt.timer <= 0) endTasks();
      return true;
    }
    return false;
  }
  /** 着いたあとの動作が進行中なら進める(trueを返したら、その間は歩かない)。 */
  function updateWanderTasks(delta) {
    const ct = wander.collectTask, bt = wander.baseTask;
    if (ct && ct.phase !== 'goto') return runCollectTask(ct, delta);
    if (bt && bt.phase !== 'goto') return runBaseTask(bt, delta);
    return false;
  }

  function updateWanderAI(delta) {
    if (wander.hop && updateHop(delta)) return; // v1.56-H5: 最後の保証の大きなジャンプの最中
    // v1.53 E2: 手で縁をつかんで引き上げている最中は、その動きだけを進める(歩行モードと同じ引き上げ)
    if (aiClimb.active) {
      const c = aiClimb.update(delta);
      if (c) {
        wander.pos.set(c.x, c.z); nonWalkVertical.forceY(c.y); wander.walking = false;
        if (c.done) { nonWalkVertical.climbing = false; resetStuckCheck(); if (wander.hurdle) onHurdleClimbDone(); }
      }
      return;
    }
    if (wander.hurdle && updateHurdle(delta)) return; // v1.56-H5: 丸太を乗り越えている最中(手前まで歩く)
    if (updateWanderTasks(delta)) return; // v1.54: 拾い物・チェストの動作の最中
    if (wander.waiting) {
      resetEscapeWatch(); // 休んでいる間は、動かなくて当たり前
      wander.waitTimer -= delta;
      wander.waitElapsed += delta;
      wander.walking = false;
      // 完全に静止させず、ゆっくり首を振って周囲を見回しているように見せる
      wander.heading = wander.baseHeading + Math.sin(wander.waitElapsed * 0.45) * 0.5;
      if (wander.waitTimer <= 0) {
        wander.waiting = false;
        const next = pickActivityAvoidingBlocked();
        wander.legs = computeWanderLegs(next);
        wander.detouring = 0;
        const firstLeg = wander.legs[0];
        wander.target.set(firstLeg.x, firstLeg.z);
        wander.nextRestMin = next.restMin;
        wander.nextRestMax = next.restMax;
        wander.activity = next.activity;
        resetStuckCheck();
      }
      return;
    }

    // --- その場で方向転換している最中 ---
    if (wander.turningAway > 0) {
      wander.turningAway -= delta;
      const turnRate = 2.2; // rad/sec
      let diff = wander.turnHeadingTarget - wander.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // -PI〜PIに正規化
      const step = Math.max(-turnRate * delta, Math.min(turnRate * delta, diff));
      wander.heading += step;
      if (wander.turningAway <= 0 || Math.abs(diff) < 0.05) {
        wander.turningAway = 0;
        // 向きを変え終わったら、新しい行き先を選び直して歩き出す
        const next = pickActivityAvoidingBlocked();
        wander.legs = computeWanderLegs(next);
        wander.detouring = 0;
        const firstLeg = wander.legs[0];
        wander.target.set(firstLeg.x, firstLeg.z);
        wander.nextRestMin = next.restMin;
        wander.nextRestMax = next.restMax;
        wander.activity = next.activity;
        resetStuckCheck();
      }
      return;
    }

    // v1.56-H5: 進捗の見張り(狭い範囲から出ない/歩き続けて1度も着かない状態が長く続いたら、段階的に強い手を打つ)
    const stagLevel = stagnation.tick(delta, { x: wander.pos.x, z: wander.pos.y, walking: true });
    if (stagLevel) { handleStagnation(stagLevel); return; }
    // v1.53 E2c: 長い時間、同じ狭い範囲から出られていなければ、閉じ込められているとみなして抜け出す
    if (updateEscapeWatch(delta)) return;

    // --- スタック検知: 歩いているつもりで一定時間ほとんど進めていない、または
    //     (2026-09 v1.25) 動いてはいるが目的地に近づけていない状態が続けば、
    //     何か(テント・木・岩など)に阻まれているとみなして方向転換する ---
    wander.stuckCheckTimer -= delta;
    if (wander.stuckCheckTimer <= 0) {
      const moved = wander.pos.distanceTo(wander.stuckCheckPos);
      const distNow = Math.hypot(wander.target.x - wander.pos.x, wander.target.y - wander.pos.y);
      const prog = isMakingProgress(moved, wander.stuckCheckDist, distNow, STUCK_MIN_PROGRESS, STUCK_MIN_APPROACH);
      if (!prog.moved) {
        startTurnAround();
        return;
      }
      wander.noApproachStrikes = prog.approaching ? 0 : wander.noApproachStrikes + 1;
      if (wander.noApproachStrikes >= STUCK_MAX_NO_APPROACH_CHECKS) {
        startTurnAround();
        return;
      }
      wander.stuckCheckTimer = STUCK_CHECK_INTERVAL;
      wander.stuckCheckPos.copy(wander.pos);
      wander.stuckCheckDist = distNow;
    }

    const dx = wander.target.x - wander.pos.x;
    const dz = wander.target.y - wander.pos.y;
    const dist = Math.hypot(dx, dz);
    const leg0 = wander.legs[0];
    const onRoute = !!(leg0 && leg0.raw);
    // v1.53 E2: 丸太の入口で、必要な動作(ジャンプ/引き上げ)をする。歩いて乗れる高さなら何もしない。
    if (onRoute && leg0.act === 'mount' && nonWalkVertical.grounded && !aiClimb.active && dist > 0.3) {
      // 丸太の端の手前で、物理的に止められる位置(足元の円が幹に触れる所≒端から0.6〜0.8m)に着くより前に動作を始める。
      // 1回目はプランどおり(歩けない高さで届くならジャンプ、高ければ引き上げ)。ジャンプで乗れなかったら、
      // 2回目からは確実な引き上げに切り替える(手が届く高さなら、必ず乗れる)。3回失敗したらあきらめる。
      const wantClimb = leg0.action === ACTION.CLIMB || (leg0.action === ACTION.JUMP && leg0.tries >= 1);
      const trig = leg0.action === ACTION.WALK ? 0 : wantClimb ? 1.9 : 1.75;
      if (trig > 0 && dist < trig) {
        if (++leg0.tries > 3) { failRoute(); return; } // 何度やっても乗れない: あきらめる
        if (!wantClimb) { if (nonWalkVertical.jump()) wander.jumpAssist = true; }
        else if (Number.isFinite(leg0.topY)) {
          aiClimb.start(wander.pos.x, wander.pos.y, nonWalkVertical.y, leg0.x, leg0.z, leg0.topY, climbDurationFor(leg0.rise || 0)); // v1.56-H5: 高い丸太ほどゆっくり、よいしょと
          nonWalkVertical.climbing = true; wander.walking = false; return;
        }
      }
    }
    if (dist < 0.3) {
      // 丸太の上へ乗れたか/歩いている途中で落ちていないかを確かめる(乗れていなければ、その足がかりはあきらめる)
      if (onRoute && (leg0.act === 'mount' || leg0.act === 'along')
        && !traversal.isSupportedBySurface(wander.pos.x, wander.pos.y, nonWalkVertical.y)) { failRoute(); return; }
      const arrivedLeg = wander.legs[0];
      wander.legs.shift();
      if (wander.legs.length === 0 && !(arrivedLeg && arrivedLeg.act === 'escape')) stagnation.markProgress(); // v1.56-H5: 最終の目的地に着いた=進捗(脱出の行き先に着いただけでは進捗にしない)
      if (wander.detouring) wander.detouring--; // 回り込みの経由点に着いた
      if (wander.legs.length > 0) {
        // まだ経由点が残っている: 休まず次の区間へ歩き続ける(曲がりながら進む)
        const nextLeg = wander.legs[0];
        wander.target.set(nextLeg.x, nextLeg.z);
        resetStuckCheck();
        return;
      }
      if (wander.routePlan) { routeFails.delete(logIdOfRouteKey(wander.routePlan.key)); crossedLogs.add(logIdOfRouteKey(wander.routePlan.key)); lastCrossSec = clock.elapsedTime; } // 渡り終えた: その丸太は「渡ったことがある」
      wander.routePlan = null; // 渡り終えた/目的地に着いた
      // v1.54: 拾い物・チェストの目的地に着いたら、その場の動作を始める(休みに入る代わりに)
      if (wander.collectTask && beginCollectTask()) { wander.walking = false; return; }
      if (wander.baseTask) { beginChestTask(); wander.walking = false; return; }
      wander.waiting = true;
      wander.waitTimer = wander.nextRestMin + Math.random() * (wander.nextRestMax - wander.nextRestMin);
      wander.waitElapsed = 0;
      wander.baseHeading = wander.heading;
      wander.walking = false;
      return;
    }
    // 丸太へ跳び乗る時は、空中で勢いよく前へ出る(歩く速さのままだと、跳び上がっても幹の手前に降りてしまう)
    if (nonWalkVertical.grounded) wander.jumpAssist = false;
    const step = Math.min(dist, WANDER_SPEED * (wander.jumpAssist ? AI_JUMP_FORWARD_BOOST : 1) * delta);
    let seekX = dx / dist, seekZ = dz / dist;
    // フェーズC: 進行方向のすぐ先に障害物があれば、目的地方向とブレンド
    // して少し避ける。避けきれない(左右どちらも塞がっている等)場合は
    // 従来通りスタック検知が最終手段としてその場での方向転換を行う。
    // 丸太の上を渡っている間は、丸太を避けない(その丸太こそ足場なので)
    // (入口へ向かう間は、木などは避けるが、渡る丸太そのものは避けない)
    const avoid = onRoute && leg0.act !== 'approach' && leg0.act !== 'escape' ? { blocked: false, x: 0, z: 0 }
      : onRoute ? computeAvoidSteerFor(wander.pos.x, wander.pos.y, seekX, seekZ, collisionObstacles, AVOID_LOOKAHEAD, AVOID_MARGIN)
      : computeAvoidSteer(wander.pos.x, wander.pos.y, seekX, seekZ);
    // v1.51: 長い倒木(壁)に塞がれたら、近い方の端を回り込む経由点を2つ、目的地の前に挟む
    // (円ごとの回避だけでは、壁に真正面から向かった時に立ち往生するため)。回り込み中は重ねて作らない。
    if (avoid.blocked && avoid.wall && !wander.detouring) {
      if (noteWallDetour(avoid.wall)) return; // v1.56-H5: 同じ壁の前で同じ回り込みを繰り返していたら、別の手に切り替える
      const wps = planWallDetour(wander.pos.x, wander.pos.y, avoid.wall, playerSnowman.collision.collisionRadius);
      const safe = wps.map((w) => sanitizeWaypoint(w.x, w.z));
      wander.legs.unshift(...safe);
      wander.detouring = 2; // 残りの回り込み経由点の数
      wander.target.set(safe[0].x, safe[0].z);
      resetStuckCheck();
      return;
    }
    if (avoid.blocked) {
      let steerX = seekX + avoid.x, steerZ = seekZ + avoid.z;
      const steerLen = Math.hypot(steerX, steerZ);
      if (steerLen > 1e-6) { seekX = steerX / steerLen; seekZ = steerZ / steerLen; }
    }
    wander.pos.x += seekX * step;
    wander.pos.y += seekZ * step;
    // 2026-09(v1.25): 向きは進行方向へ即座に切り替えず、回転速度に上限を
    // 設けて追従させる。押し戻し・回避で進行方向が細かく変わっても、
    // 「その場で高速回転している」ようには見えない。
    wander.heading = stepHeading(wander.heading, Math.atan2(seekX, seekZ), WANDER_MAX_TURN_RATE, delta);
    wander.walking = true;
  }

  // --- 背景・中景の木々をランダムに散らす(川・大木・キャンプは避ける) ---
  // 2026-09(v1.29): 「シードで地形を自動生成しても、木・岩の並びだけは
  // 毎回同じ」との指摘に対応。ワールドのシード(worldGen.seed)から派生
  // させ、シードごとに木・岩の並びも変わるようにした。自動生成が無効な
  // 通常時は、従来通りの固定シード(2024)のまま(=既定の景観は変えない)。
  const treeRng = makeRng(worldGen ? deriveSeed(worldGen.seed, 'trees') : 2024);

  // 木の高さの目安(実際の自然の分布を参考にした3段階):
  //   低木〜若木     : 5m未満   → scale 0.75〜1.3(基本の見た目)
  //   中高木・小高木 : 5〜20m   → scale 1.4〜4.0
  //   高木           : 20m以上 → scale 5.5〜7.5
  // (createPineTreeは概ね「高さ ≈ scale × 3.7m」になる形状のため)
  // Phase 3(2026-09): 「小さな木が多すぎる」との指摘を受け、低木の比率を
  // 82%→70%→40%へ段階的に下げ、中高木・小高木の比率を14%→25%→55%へ
  // 増やした(高木の比率5%は据え置き。本数自体も別途削減している。
  // 詳しくは各配置ループを参照)。
  function pickTreeScale(rng, baseMin, baseMax) {
    const r = rng();
    if (r < 0.05) return randRange(rng, 5.5, 7.5); // 高木(20m以上)
    if (r < 0.60) return randRange(rng, 1.4, 4.0); // 中高木・小高木(5〜20m)
    return randRange(rng, baseMin, baseMax); // 低木サイズ
  }
  const livingTreePositions = [{ x: bigTreeX, z: bigTreeZ, scale: 2.2 }];
  const coniferTrees = []; // v1.38: 針葉樹だけの一覧({x,z,scale,mesh,decorations})
  const fallenLogs = []; // v1.39: 倒木の一覧({x,z,scale,mesh})
  const rockClusters = []; // v1.39: 岩の一覧({x,z,scale,mesh})
  const avoidZones = [
    // 2026-09(改訂4): 「かまくらが木々と重なる」との指摘に対応し、壁厚
    // 込みのかまくら外周(iglooOuterRadiusPlanned)を確実に上回る半径に。
    { x: campX, z: campZ, radius: iglooOuterRadiusPlanned + 1.3 },
    { x: bigTreeX, z: bigTreeZ, radius: 3 },
  ];

  /**
   * 2026-09: 「川の斜面に木が生えるのは珍しい」という指摘を受けて追加。
   * 水際からある程度の範囲(riverBankZone)を「川岸の斜面」とみなし、
   * その中では木が生える確率を大きく下げる(riverBankTreeChance)。
   * 運よく(?)生えることになった場合は、根元付近の傾斜を調べ、
   * ある程度の傾斜があれば「根元は斜面に垂直に生え始め、途中から
   * 上向きに曲がる」leanOptionsを作って渡す。
   * @returns {{ reject: boolean, leanOptions: object|null }}
   */
  const RIVER_BANK_ZONE_WIDTH = 6; // 水際からこの距離までを「斜面」とみなす
  const RIVER_BANK_TREE_CHANCE = 0; // 2026-09: 「川岸に木が生える確率を0%に」との要望で0に変更
  function checkRiverBankPlacement(x, z, riverDistance, riverWidth) {
    const edgeDist = getWaterEdgeDistance(riverWidth);
    if (riverDistance < edgeDist + 1.2) return { reject: true, leanOptions: null }; // 水面そのものには生やさない
    if (riverDistance >= edgeDist + 1.2 + RIVER_BANK_ZONE_WIDTH) {
      return { reject: false, leanOptions: null }; // 斜面ゾーンの外: 通常通り
    }
    // 斜面ゾーン内: 低確率でのみ生やす
    if (treeRng() > RIVER_BANK_TREE_CHANCE) return { reject: true, leanOptions: null };
    // 生える場合、根元付近の傾斜を調べて曲がった生え方にする
    const h0 = terrainHeightAt(x, z);
    const dHdx = terrainHeightAt(x + 1, z) - h0;
    const dHdz = terrainHeightAt(x, z + 1) - h0;
    const gradMag = Math.hypot(dHdx, dHdz);
    const slopeAngle = Math.atan(gradMag);
    if (slopeAngle < 0.1) return { reject: false, leanOptions: null }; // ほぼ平坦ならまっすぐでよい
    const dirX = gradMag > 1e-6 ? dHdx / gradMag : 0;
    const dirZ = gradMag > 1e-6 ? dHdz / gradMag : 1;
    return { reject: false, leanOptions: { angle: Math.min(slopeAngle, 0.6), dirX, dirZ } };
  }

  // Phase 1(2026-09): 面積は70m版の約5.2倍になったが、木の本数はそのまま
  // 比例させず(90×5.2≈470本は密林になりすぎる)、線形(半径比≈2.3倍)より
  // やや多い程度に抑えている。密度感は実装後にスクリーンショットで確認する。
  // 2026-09(v1.30): 混交林(広葉樹の比率)。地形自動生成が有効な時は、
  // ワールドシードから世界ごとに異なる比率を作る(針葉樹と広葉樹の
  // 気候境界=移行帯が、世界によって違う場所にある、という見立て)。
  // 無効時(既定)は固定の比率にする。北海道の針広混交林のように、
  // 針葉樹の方が多いが広葉樹も点在する、という配分を基準にしている。
  // 2026-09(v1.34): 大木('full')の分岐を大幅に複雑化した(段数・本数・
  // 分岐点の球を増やし、幹の断面バグも修正)ことに伴い、背景の森の広葉樹
  // ('simple')側も少し豊かにした(1段5本→1段6本+葉2枚/枝先)ため、
  // 1本あたりのメッシュ数がv1.33よりやや増えている。全体の負荷を相殺する
  // ため、既定比率をさらに下げた(0.08→0.05、MIN/MAXも同じ比率で縮小)。
  // ユーザーが設定パネルの本数スライダーで直接調整できるようにもしてある
  // (options.broadleafRatioOverride、下記)。
  const BROADLEAF_RATIO_DEFAULT = 0.05;
  const BROADLEAF_RATIO_MIN = 0.02;
  const BROADLEAF_RATIO_MAX = 0.15;
  const broadleafRatio = Number.isFinite(options.broadleafRatioOverride)
    ? options.broadleafRatioOverride
    : worldGen
    ? BROADLEAF_RATIO_MIN + (deriveSeed(worldGen.seed, 'forestMix') / 0xffffffff) * (BROADLEAF_RATIO_MAX - BROADLEAF_RATIO_MIN)
    : BROADLEAF_RATIO_DEFAULT;
  /** 針葉樹/広葉樹のどちらかを作り、シーンへ追加し、関連リストへ登録する共通処理。 */
  function spawnForestTree(x, z, scale, seed, leanOptions, avoidRadius) {
    let tree;
    if (treeRng() < broadleafRatio) {
      const built = createBroadleafTree(scale, seed, leanOptions, 'simple'); // 背景の森は本数が多いので、軽量な一段構成にする
      tree = built.group;
      broadleafCanopyBlobs.push(...built.canopyBlobs);
      broadleafLeafSources.push({ x, z, top: terrainHeightAt(x, z) + built.canopyTop, radius: built.canopyRadius });
    } else {
      tree = createPineTree(scale, seed, leanOptions);
      // v1.38: 星を飾れる針葉樹の一覧(tree-decor.jsが使う)
      coniferTrees.push({ x, z, scale, mesh: tree, decorations: [] });
    }
    placeOnTerrain(tree, x, z, terrainHeightAt, 0.35 * scale);
    scene.add(tree);
    livingTreePositions.push({ x, z, scale });
    avoidZones.push({ x, z, radius: avoidRadius });
    collisionObstacles.push({ x, z, radius: scale * 0.28 });
    worldColliders.push({ id: 'tree-' + worldColliders.length, kind: 'cylinder', x, z, y: terrainHeightAt(x, z) + 1.6 * scale / 2, radius: Math.max(0.12, scale * 0.2), height: 1.6 * scale });
    burialCandidates.push({ mesh: tree, baseY: tree.position.y, heightM: scale * 3.7 });
  }

  let placedTrees = 0;
  let attempts = 0;
  // Phase 3(2026-09): 「小さな木が多すぎる」との指摘を受け、本数自体を
  // 大きく減らす(200→130)。Playable Areaが面積で約2倍になった分と合わせ、
  // 密度は実質的に以前の半分以下になる。
  while (placedTrees < 130 && attempts < 3000) {
    attempts++;
    const x = randRange(treeRng, -PLAYABLE_RADIUS, PLAYABLE_RADIUS);
    const z = randRange(treeRng, -PLAYABLE_RADIUS, PLAYABLE_RADIUS);
    // Phase 2: Playable Areaの円の外(正方形のコーナー部分)は除外する。
    // これにより地形の実際の端(Terrain Edge)をはみ出す配置も併せて防げる。
    if (Math.hypot(x, z) > PLAYABLE_RADIUS) continue;

    const { distance, width } = distanceToRiver(x, z, riverSamplesForAvoid);
    const bankCheck = checkRiverBankPlacement(x, z, distance, width);
    if (bankCheck.reject) continue;

    let blocked = false;
    for (const zone of avoidZones) {
      if (Math.hypot(x - zone.x, z - zone.z) < zone.radius) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    const scale = pickTreeScale(treeRng, 0.75, 1.3);
    const seed = Math.floor(treeRng() * 10000);
    spawnForestTree(x, z, scale, seed, bankCheck.leanOptions, scale * 0.8);
    placedTrees++;
  }

  // --- 境界の「森の壁」(Boundary Zone): Playable Areaの外側〜Terrain Edge
  //     手前まで木を密集させ、その先(地形の延長・山脈への継ぎ目)を
  //     視界から自然に隠す ---
  const wallRingInner = PLAYABLE_RADIUS;
  const wallRingOuter = BOUNDARY_OUTER;
  // Phase 3: 森の壁の輪の半径が広がった分(円周は半径にほぼ比例)を反映しつつ、
  // 全体の「木が多すぎる」印象を抑えるため、線形フル増量はせず控えめにする。
  let placedWallTrees = 0;
  attempts = 0;
  while (placedWallTrees < 150 && attempts < 3800) {
    attempts++;
    const angle = treeRng() * Math.PI * 2;
    // 面積が均等になるよう、半径は二乗のルートで分布させる
    const r = Math.sqrt(randRange(treeRng, wallRingInner * wallRingInner, wallRingOuter * wallRingOuter));
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;

    const { distance, width } = distanceToRiver(x, z, riverSamplesForAvoid);
    const bankCheck = checkRiverBankPlacement(x, z, distance, width);
    if (bankCheck.reject) continue;

    let blocked = false;
    for (const zone of avoidZones) {
      if (Math.hypot(x - zone.x, z - zone.z) < zone.radius) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    const scale = pickTreeScale(treeRng, 0.8, 1.4);
    const seed = Math.floor(treeRng() * 10000);
    spawnForestTree(x, z, scale, seed, bankCheck.leanOptions, scale * 0.7);
    placedWallTrees++;
  }

  // --- v1.61: 川の両端(上流端・下流端)を、木の茂みで隠す ---
  // 川は世界の端のすぐ手前(±約90m)で終わるため、川の先が途切れて見えていた(設計書の「川の終端を見せない」に反する)。
  // 対策: ①端の水が消えかけるところに、太い木を並べて「栓」をする(川沿いからの視線をさえぎる)
  //       ②端の手前16m〜先18mの帯にも、背の高い針葉樹を、枝が重なる間隔(約5m)で敷き詰め、端の先を隠す。
  //       水の端は、水面シェーダー側でも少しずつ透明にしてあるので、断面が見えない。
  //       木は、水と土手の斜面(水際+3.2m)には生やさない。乱数は専用(riverEndScreens)で、他の木の配置は変わらない。
  const riverEndScreenTrees = [];
  // v1.63: 川の端をS字+丘で隠す世界(getRiver().shape がある)では、水の上に木を並べる栓は使わない。
  if (!getRiver().shape) {
    const screenRng = makeRng(worldGen ? deriveSeed(worldGen.seed, 'riverEndScreens') : 6161);
    const cl = riverSamplesForAvoid;
    const n = cl.length;
    // v1.61b: 見える川(半径 RIVER_VISIBLE_RADIUS の円の内側)の、上流側・下流側の切れ目を、端として扱う。
    //         生成ワールドの川は、地形の端よりさらに外へ伸びているので、中心線の最初と最後ではなく、円と交わる所を使う。
    let i0 = 0;
    while (i0 < n - 1 && Math.hypot(cl[i0].x, cl[i0].z) > RIVER_VISIBLE_RADIUS) i0++;
    let i1 = n - 1;
    while (i1 > 0 && Math.hypot(cl[i1].x, cl[i1].z) > RIVER_VISIBLE_RADIUS) i1--;
    const visibleCl = cl.slice(i0, i1 + 1); // 水が見える区間(これ以外は、乾いた谷が続くだけ)
    const ends = [
      { p: cl[i0], q: cl[Math.min(n - 1, i0 + 4)] },    // 上流端(流れの始まり)
      { p: cl[i1], q: cl[Math.max(0, i1 - 4)] },        // 下流端(流れの終わり)
    ];
    const SPACING = 5.2, A_MIN = -16, A_MAX = 18, L_HALF = 13;
    const spawnScreenTree = (x, z, scale) => {
      const tree = createPineTree(scale, Math.floor(screenRng() * 10000), null);
      placeOnTerrain(tree, x, z, terrainHeightAt, 0.35 * scale);
      scene.add(tree);
      coniferTrees.push({ x, z, scale, mesh: tree, decorations: [] });
      livingTreePositions.push({ x, z, scale });
      avoidZones.push({ x, z, radius: scale * 0.7 });
      collisionObstacles.push({ x, z, radius: scale * 0.28 });
      worldColliders.push({ id: 'tree-' + worldColliders.length, kind: 'cylinder', x, z, y: terrainHeightAt(x, z) + 1.6 * scale / 2, radius: Math.max(0.12, scale * 0.2), height: 1.6 * scale });
      burialCandidates.push({ mesh: tree, baseY: tree.position.y, heightM: scale * 3.7 });
      riverEndScreenTrees.push({ x, z, scale });
    };
    for (const { p, q } of ends) {
      let ax = p.x - q.x, az = p.z - q.z;
      const al = Math.hypot(ax, az) || 1;
      ax /= al; az /= al;                // 川の外(端の先)へ向かう向き
      const lx = -az, lz = ax;           // 川に垂直な向き
      // 栓: 水が透明になっていく最後の数m(水面シェーダーが端の約4%=8mで消す)に、太い木を2列×3本並べる。
      //     川沿いから端を見た視線は、この木にさえぎられ、水の終わりが見えない(木は水に立つのではなく、消えかけの水の端に立つ)。
      {
        const spread = Math.max(2.2, (p.width || 2) * 0.45 + 1.6);
        for (const a of [-2.6, 1.4]) {
          for (const l of [-spread, 0, spread]) {
            const x = p.x + ax * (a + randRange(screenRng, -0.5, 0.5)) + lx * (l + randRange(screenRng, -0.5, 0.5));
            const z = p.z + az * (a + randRange(screenRng, -0.5, 0.5)) + lz * (l + randRange(screenRng, -0.5, 0.5));
            if (Math.hypot(x, z) > BOUNDARY_OUTER - 1) continue;
            spawnScreenTree(x, z, randRange(screenRng, 3.0, 4.0));
          }
        }
      }
      for (let a = A_MIN; a <= A_MAX; a += SPACING) {
        for (let l = -L_HALF; l <= L_HALF; l += SPACING) {
          const x = p.x + ax * (a + randRange(screenRng, -1.4, 1.4)) + lx * (l + randRange(screenRng, -1.4, 1.4));
          const z = p.z + az * (a + randRange(screenRng, -1.4, 1.4)) + lz * (l + randRange(screenRng, -1.4, 1.4));
          if (Math.hypot(x, z) > BOUNDARY_OUTER - 1) continue; // 地形の端の内側だけ
          const { distance, width } = distanceToRiver(x, z, visibleCl);
          if (distance < getWaterEdgeDistance(width) + 3.2) continue; // 水と土手の斜面には生やさない(見える川の区間だけを避ける)
          if (a < -4 && screenRng() > 0.8) continue;           // 川沿いの部分は、わずかに間引いて自然に
          let blocked = false;
          for (const zone of avoidZones) {
            if (Math.hypot(x - zone.x, z - zone.z) < zone.radius) { blocked = true; break; }
          }
          if (blocked) continue;
          spawnScreenTree(x, z, randRange(screenRng, 2.4, 3.8));
        }
      }
    }
  }

  // --- 倒木(台風などで倒れた木) ---
  // --- 岩(河原に集中的に、それ以外の地面にもまばらに) ---
  const rockRng = makeRng(worldGen ? deriveSeed(worldGen.seed, 'rocks') : 7777);
  // v1.49: 岩のコライダー = 岩クラスタの外接ボックスから作る円柱(丸太は縁で止まり、上に載り、滑り落ちる)。
  function registerRockCollider(cluster, index) {
    cluster.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(cluster);
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(0.15, 0.45 * (size.x + size.z) * 0.5 * 0.9);
    const height = Math.max(0.2, size.y * 0.9);
    worldColliders.push({ id: 'rock-' + index, kind: 'cylinder', x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2, y: box.min.y + height / 2, radius, height });
  }
  const riverRockClusters = []; // { x, z, radius } — 魚が岩陰を認識するために使う

  // 河原の岩: 川に沿って、水中に半分浸かる岩(魚の隠れ場所)と、
  // 岸のすぐ外側に乗る岩の両方をまばらに点在させる。
  // (以前は間引きが強すぎて、川沿いの区間によっては1つも
  // 生成されないことがあった。density を上げて、どの区間を見ても
  // 岩が目に入るようにする)
  for (let i = 2; i < riverSamplesForAvoid.length - 2; i += 2) {
    if (rockRng() > 0.6) continue;
    const s = riverSamplesForAvoid[i];
    const prev = riverSamplesForAvoid[i - 1];
    const next = riverSamplesForAvoid[i + 1];
    const tx = next.x - prev.x, tz = next.z - prev.z;
    const tLen = Math.hypot(tx, tz) || 1;
    const nx = -tz / tLen, nz = tx / tLen; // 川の流れに垂直な向き
    const side = rockRng() < 0.5 ? 1 : -1;
    const halfW = getWaterEdgeDistanceOnTerrain(s.x, s.z, { x: nx, y: nz }, s.width, terrainHeightAt); // 本当の水際

    // 3割程度は「水中に半分浸かる岩」(魚が岩陰に隠れられる場所)、
    // それ以外は「岸のすぐ外側に乗る岩」にする
    const inStream = rockRng() < 0.3;
    const offset = inStream
      ? halfW * randRange(rockRng, 0.25, 0.75) // 水路の内側(浅瀬)
      : halfW + randRange(rockRng, 0.15, 0.9); // 岸のすぐ外側(水際のすぐ先)

    const x = s.x + nx * offset * side;
    const z = s.z + nz * offset * side;

    let blocked = false;
    for (const zone of avoidZones) {
      if (Math.hypot(x - zone.x, z - zone.z) < zone.radius) { blocked = true; break; }
    }
    if (blocked) continue;

    const scale = randRange(rockRng, 0.3, 0.7);
    const seed = Math.floor(rockRng() * 10000);
    const cluster = createRockCluster(scale, seed, true);
    placeRockOnTerrain(cluster, x, z, terrainHeightAt);
    scene.add(cluster);
    avoidZones.push({ x, z, radius: scale * 1.1 });
    riverRockClusters.push({ x, z, radius: scale * 1.1 });
    rockClusters.push({ x, z, scale, mesh: cluster }); // v1.39
    registerRockCollider(cluster, rockClusters.length - 1);
    burialCandidates.push({ mesh: cluster, baseY: cluster.position.y, heightM: scale * 1.4 });
    if (scale >= ROCK_CLIMB_SCALE_THRESHOLD) {
      collisionObstacles.push({ x, z, radius: scale * 1.1 });
    } else {
      climbableBumps.push({ x, z, radius: scale * 1.1, height: scale * 0.65 });
    }
  }

  // 野原の岩: 森の中や開けた場所にまばらに配置
  let placedRocks = 0;
  attempts = 0;
  while (placedRocks < 45 && attempts < 1100) {
    attempts++;
    const x = randRange(rockRng, -PLAYABLE_RADIUS, PLAYABLE_RADIUS);
    const z = randRange(rockRng, -PLAYABLE_RADIUS, PLAYABLE_RADIUS);
    if (Math.hypot(x, z) > PLAYABLE_RADIUS) continue;
    const { distance, width } = distanceToRiver(x, z, riverSamplesForAvoid);
    if (distance < getWaterEdgeDistance(width) + 1) continue;
    let blocked = false;
    for (const zone of avoidZones) {
      if (Math.hypot(x - zone.x, z - zone.z) < zone.radius) { blocked = true; break; }
    }
    if (blocked) continue;
    const scale = randRange(rockRng, 0.25, 0.65);
    const seed = Math.floor(rockRng() * 10000);
    const cluster = createRockCluster(scale, seed, false);
    placeRockOnTerrain(cluster, x, z, terrainHeightAt);
    scene.add(cluster);
    avoidZones.push({ x, z, radius: scale * 1.1 });
    rockClusters.push({ x, z, scale, mesh: cluster }); // v1.39
    registerRockCollider(cluster, rockClusters.length - 1);
    burialCandidates.push({ mesh: cluster, baseY: cluster.position.y, heightM: scale * 1.4 });
    if (scale >= ROCK_CLIMB_SCALE_THRESHOLD) {
      collisionObstacles.push({ x, z, radius: scale * 1.1 });
    } else {
      climbableBumps.push({ x, z, radius: scale * 1.1, height: scale * 0.65 });
    }
    placedRocks++;
  }

  // v1.48 Phase A: 倒木・大枝・小枝・小枝先を種類ごとに作り分けて、計28個を森の地面に置く。
  // 乱数は専用の列(木・岩とは独立)なので、この変更で木・岩の配置は変わらない。
  // v1.49: 岩・木の幹・テントとも重ならないように、岩を置いた『あと』で置く(岩は木の乱数と無関係なので配置は不変)。
  const fallenRng = makeRng(worldGen ? deriveSeed(worldGen.seed, 'fallenwood') : 3131);
  const woodPlaceOpts = {
    groundHeightAt: terrainHeightAt,
    range: PLAYABLE_RADIUS,
    treeAnchors: livingTreePositions.slice(1).map((t) => ({ x: t.x, z: t.z, radius: Math.max(1.2, t.scale * 0.9) })), // 先頭は大木。それ以外=森の木の近く
    isBlocked: (x, z, r) => {
      if (Math.hypot(x, z) > PLAYABLE_RADIUS) return true;
      const { distance, width } = distanceToRiver(x, z, riverSamplesForAvoid);
      if (distance < getWaterEdgeDistance(width) + 1.0 + r) return true;
      // キャンプ(かまくらの外周)と大木は広く避ける
      for (let i = 0; i < 2; i++) {
        const zone = avoidZones[i];
        if (Math.hypot(x - zone.x, z - zone.z) < zone.radius + 1.5 + r) return true;
      }
      // 森の木: 幹とその周り(樹冠の下には入れる。倒木は木の近くにあるのが自然)
      for (const t of livingTreePositions) {
        if (Math.hypot(x - t.x, z - t.z) < t.scale * 0.35 + 0.35 + r) return true;
      }
      // 岩: 外周+余白(岩クラスタの大きさ scale*1.1 に余裕を足す)
      for (const rk of rockClusters) {
        if (Math.hypot(x - rk.x, z - rk.z) < rk.scale * 1.3 + 0.3 + r) return true;
      }
      return false;
    },
  };
  const placedWoodBase = placeFallenWood({ ...woodPlaceOpts, rng: fallenRng });
  // v1.70: 追加の倒木(30本)。最初の30本のあとに、別の乱数で置く(最初の30本の位置・番号は変わらない)。
  const fallenRng2 = makeRng(worldGen ? deriveSeed(worldGen.seed, 'fallenwood2') : 3132);
  const placedWoodExtra = placeFallenWood({ ...woodPlaceOpts, rng: fallenRng2, plan: WOOD_PLAN_EXTRA, existing: placedWoodBase });
  const placedWood = placedWoodBase.concat(placedWoodExtra);
  for (const w of placedWood) {
    const wood = createFallenWood(w.spec);
    wood.position.copy(w.pose.base);
    wood.quaternion.copy(w.pose.quaternion);
    scene.add(wood);
    burialCandidates.push({ mesh: wood, baseY: wood.position.y, heightM: w.spec.radius * 3.3 + 0.12 });
    fallenLogs.push({
      x: w.pose.center.x, z: w.pose.center.z, scale: w.spec.length / 1.6, mesh: wood,
      type: w.spec.type, spec: w.spec, dims: w.dims, pickable: w.spec.pickable,
      physicalProperties: woodPhysicalProperties(w.spec), // v1.52: 体積×密度の質量など(将来の月・星の力はこれを変える)
      material: woodMaterial(w.spec), // v1.52: 将来の火が読む材質(燃えやすさ・湿り気・燃料の量…)。まだ挙動には使わない
    });
  }

  // --- 落ち葉(木の根元に散らす) ---
  const leaves = createFallenLeaves(livingTreePositions, terrainHeightAt);

  // 2026-09(v1.30): 枯れ葉が舞い落ちて積もる表現。既存の静的な落ち葉(leaves、
  // 上記)は「秋の間、木の根元に元々ある落ち葉」の役割のまま残し、その上に
  // 今回のleafFallが「実際に舞い落ちて積もっていく葉」を重ねる。表示/非表示は
  // 既存のleavesと同じタイミング(season.isAutumnLike())で揃えるため、
  // 積雪(冬)と同時に見えることはない。
  const leafFall = createLeafFallSystem(terrainHeightAt, { seed: worldGen ? deriveSeed(worldGen.seed, 'leafFall') : 1 });
  scene.add(leafFall.group);
  if (leaves) scene.add(leaves);

  // --- 草(風で揺れる。川・キャンプ・木の幹は避ける) ---
  const grassAvoid = avoidZones.map((z) => ({ x: z.x, z: z.z, radius: z.radius + 0.5 }));
  // Phase 3(2026-09): 面積比(約2倍)ほどは増やさず、控えめに増量する
  // (InstancedMeshなのでGPU負荷は小さいが、配置時の川・avoidゾーンとの
  // 距離判定コストがあるため青天井には増やさない。全体の密度としては
  // 以前よりやや下がる=「木が多すぎる」印象の緩和にもつながる)。
  const { mesh: grassMesh, update: updateGrass, setLightMul: setGrassLightMul, setSeasonColors: setGrassSeasonColors, setSnowMix: setGrassSnowMix } = createGrassField(terrainHeightAt, {
    count: 12000,
    halfSize: PLAYABLE_RADIUS, // Phase 2: Playable Areaの円内に収める(円形範囲として扱われる)
    avoid: grassAvoid,
    seed: 555,
  });
  scene.add(grassMesh);

  // --- Coquelicot(ヒナゲシ)の花畑パッチ ---
  // マルセイユなど南フランスの野原をイメージした、鮮やかな赤い野生の
  // ポピー。地形全体ではなく、数か所に「花畑」として部分的に咲かせる。
  const poppyField = createPoppyField(terrainHeightAt, {
    patchCount: 3,
    perPatch: 220,
    patchRadius: 9,
    halfSize: PLAYABLE_RADIUS,
    avoid: grassAvoid,
    seed: 4242,
  });
  if (poppyField) scene.add(poppyField.group);

  // --- 蝶・蜂・蜂の巣 ---
  // 2026-09: 新規追加。晴れた日の午前中だけ、花畑の周りに蝶と蜂を飛ばす。
  // 蜂の巣は花畑の1つ目のパッチに最も近い木の幹に取り付ける。
  let pollinators = null;
  let beehiveWorldPos = null;
  let isPollinatorActiveNow = false; // updateGameAudio()側で羽音の近接判定に使う
  let pollinatorsBuriedUnderSnow = false; // 積雪で埋まっているか(applySeasonAndSnow()が更新。表示自体はpollinators側が管理する)
  if (poppyField && poppyField.patchCenters.length > 0) {
    const homePatch = poppyField.patchCenters[0];
    let nearestTree = null, nearestDist = Infinity;
    for (const t of livingTreePositions) {
      const d = Math.hypot(t.x - homePatch.x, t.z - homePatch.z);
      if (d < nearestDist) { nearestDist = d; nearestTree = t; }
    }
    if (nearestTree) {
      const hive = createBeehive(nearestTree.scale * 0.9);
      const trunkY = terrainHeightAt(nearestTree.x, nearestTree.z);
      // 2026-09: 以前は幹の高さの75%(=1.6*scale*0.75)に取り付けていたが、
      // 針葉樹の葉(canopy)は幹の高さの55%あたりから始まるため、そこは
      // 葉の茂みの中に完全に埋もれてしまい、外から見えなくなっていた
      // (「蜂の巣がない」不具合の原因)。葉が無い、幹がむき出しの区間
      // (0〜55%)の中ほど(40%)に付け直し、必ず外から見えるようにする。
      const attachHeight = 1.6 * nearestTree.scale * 0.4;
      const trunkRadius = 0.18 * nearestTree.scale;
      // 花畑の方を向く向きへ、幹から少し外側にオフセットして取り付ける
      const dx = homePatch.x - nearestTree.x, dz = homePatch.z - nearestTree.z;
      const dAngle = Math.atan2(dx, dz);
      hive.position.set(
        nearestTree.x + Math.sin(dAngle) * (trunkRadius + 0.05),
        trunkY + attachHeight,
        nearestTree.z + Math.cos(dAngle) * (trunkRadius + 0.05)
      );
      hive.rotation.y = dAngle;
      hive.rotation.x = Math.PI * 0.06; // ほんの少し下向きに傾けて、垂れ下がる巣らしくする
      scene.add(hive);
      beehiveWorldPos = hive.position.clone();
    }
    pollinators = createPollinatorField(terrainHeightAt, {
      flowerPatches: poppyField.patchCenters,
      patchRadius: 9,
      hivePos: beehiveWorldPos,
      butterflyCount: 6,
      beeCount: beehiveWorldPos ? 5 : 0,
    });
    if (pollinators) scene.add(pollinators.group);
  }

  // --- ライト ---
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(campX - 10, campY + 14, campZ + 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  // 影を落とす範囲(shadow.cameraのフラスタム)は、以前は「テントの周り
  // ±25m」に固定されていた(=celestialCenterがテントの座標に固定されて
  // いたため)。160m世界でプレイヤーがテントから離れると、木や地形の影が
  // 全く出ない範囲がほとんどになってしまう不具合があった。
  // 対策として、フラスタム自体は同じ大きさ(±25m=軽量)のまま、
  // 「常にプレイヤー(カメラ)の足元を中心にする」ように毎フレーム
  // 位置を追従させる(下のrenderFrame内、celestialCenterの更新を参照)。
  // これにより「視界に入っている周辺だけ影を計算する」形になり、
  // 160mの世界全体を一度に影計算するより大幅に軽い。
  sun.shadow.camera.left = -25;
  sun.shadow.camera.right = 25;
  sun.shadow.camera.top = 25;
  sun.shadow.camera.bottom = -25;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  // 2026-09(v1.25): 「かまくらの表面に、視点の距離や角度でシワ/モアレが出る」
  // 不具合(シャドウアクネ=曲面が自分自身の影を細かく受ける現象)への対応。
  // それまでbias/normalBiasが未設定だった。影マップ1枚のテクセルは
  // 約5cm(50m/1024)なので、normalBiasをそれと同程度にする。ごく小さい
  // 値なので、木・テントなど他の影が浮いて見える(peter-panning)ことは無い。
  sun.shadow.normalBias = 0.04;
  sun.shadow.bias = -0.0003;
  sun.target.position.set(campX, campY, campZ);
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xdfe8dc, 0x4d6b3c, 0.65);
  scene.add(hemi);

  // --- 太陽・月(見た目のスプライト)。影を落とす平行光源(sun)の向きは
  //     これらのうち地平線より高いほうに毎フレーム追従させる ---
  const celestial = createCelestialBodies();
  scene.add(celestial.group);
  // v1.64: 晴れた夜の星空(星・天の川・流れ星)。ワールドのシードごとに星の並びが変わる。
  const starfield = createStarfield({ seed: worldGen ? worldGen.seed : 20261017 });
  scene.add(starfield.group);
  let waterReflectionEnabled = options.waterReflection !== false; // v1.66: 星と月の映り込み(設定でオン/オフ。初期値はオン)
  // celestialCenterは「太陽/月の見た目の中心」であり同時に「影を計算する
  // フラスタムの中心」でもある。以前はテントの座標に固定していたため、
  // 160m世界でプレイヤーがテントから離れると影が出ない不具合があった。
  // 今はrenderFrame()の中で毎フレーム、プレイヤー(カメラ)の足元へ
  // 追従させている(下記参照)。初期値はテント付近にしておく。
  const celestialCenter = new THREE.Vector3(campX, campY, campZ);
  const shadowCenterScratch = new THREE.Vector3();
  const LIGHT_DISTANCE = 24; // 影用のDirectionalLightは近くに置く(shadow.cameraのfar=60に収める)

  // --- 天候(雨・雷雨のビジュアル)。音との連動はSoundEngine初期化後に配線する ---
  // 雨粒が川に落ちたら、その位置を水面シェーダーの波紋(Ripple Source)として登録する
  // (2026-09 v1.27: 以前のリング画像の板(Sprite的な2D)方式を廃止)。
  const weather = createWeatherSystem(scene, { seed: 9001, onWaterImpact: spawnWaterRipple });
  // ================================================================
  // v1.56-H4: 雪面の高さ。積雪の深さはこの世界では場所によらず一律(snowCapMeshは地形を深さぶん持ち上げた面)。
  // ================================================================
  const SNOW_MIN = 0.03; // これ未満は「積もっていない」(snowCapMeshの表示と同じ閾値)
  function snowNow() { const d = weather.getSnowDepth(); return d > SNOW_MIN ? d : 0; }
  /** 雪面を含む地面の高さ(雪が無ければ地形の高さ)。物理・編集モード・置く物の地面。 */
  function snowGroundAt(x, z) { return terrainHeightAt(x, z) + snowNow(); }
  /**
   * 歩く・置く・物理の「水面」。雪が水面の高さまで積もった所は、雪が川を覆っているので、水ではなく地面として扱う
   * (雪だるまは川の上を歩けて、物も置ける)。それ以外は川の水面(river.jsの既存関数)。水が無ければ -Infinity。
   */
  function dryWaterSurfaceAt(x, z) {
    const s = getWaterSurfaceAt(x, z, terrainHeightAt);
    if (!Number.isFinite(s)) return s;
    return snowGroundAt(x, z) >= s - 0.02 ? -Infinity : s;
  }
  weather.setWaterRipplesEnabled(getRiverQuality() !== 'off');
  const season = createSeasonSystem();

  // 季節・積雪による色の変化は瞬時に切り替えると不自然なので、
  // 目標色へ毎フレームなめらかに補間する(他の明暗処理と同じ作法)。
  const terrainColorTarget = new THREE.Color();
  const leafColorTarget = new THREE.Color();
  const leafColorCurrent = new THREE.Color(0x3d6a34);
  const grassLowTarget = new THREE.Color();
  const grassHighTarget = new THREE.Color();
  const grassLowCurrent = new THREE.Color(0.20, 0.33, 0.15);
  const grassHighCurrent = new THREE.Color(0.42, 0.58, 0.28);
  let currentAutumnLeavesVisible = null; // 前回設定した表示状態(変化した時だけ再設定する)
  weather.setWeatherWeights(season.getWeatherWeights());


  // --- 影を落とす/受け取る設定(まず全体に適用し、あとで例外を上書きする) ---
  // 2026-09(v1.26): 個別に影の設定を決めているメッシュ(かまくらの壁など。
  // userData.keepShadowFlags)は上書きしない。以前はここで全メッシュを
  // 一律に上書きしていたため、かまくらのシャドウアクネ対策が無効になっていた。
  applyDefaultShadowFlags(scene);
  // 例外: 地形自身は影を落とす必要がない/山脈・草・落ち葉・水面は
  // 影を落とさなくてよい(見た目への影響が小さい割に負荷が上がるため)
  terrain.castShadow = false;
  mountains.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = false;
      obj.receiveShadow = false;
    }
  });
  horizonFill.castShadow = false;
  horizonFill.receiveShadow = false;
  grassMesh.receiveShadow = false;
  river.castShadow = false;
  riverbed.castShadow = false;
  fishGroup.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = false;
      obj.receiveShadow = false;
    }
  });
  if (leaves) {
    leaves.traverse((obj) => {
      if (obj.isMesh) obj.castShadow = false;
    });
  }

  // --- カメラは「実際の地形の高さ」を基準に向きを決める ---
  camera.position.set(campX - 9.8, campY + 6.2, campZ + 11.5);
  const lookTarget = new THREE.Vector3(campX, campY + 0.8, campZ);
  camera.lookAt(lookTarget);

  // --- マウスドラッグでの回転・ズーム(OrbitControls) ---
  const orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControls.target.copy(lookTarget);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.08;
  orbitControls.minDistance = 3;
  orbitControls.maxDistance = TERRAIN_SIZE * 0.34;
  orbitControls.maxPolarAngle = Math.PI / 2 - 0.03;
  orbitControls.minPolarAngle = 0.15;
  orbitControls.update();

  // --- 歩行モード(クリックでロック、WASDで移動、Escで戻る) ---
  // Phase 2(2026-09): Playable Area(PLAYABLE_RADIUS=57.6m)を超えると、
  // walk-controls.js側で徐々に移動速度を落とす「ソフトな境界」にした。
  // ちょうどこの半径から森の壁(Boundary Zone)が始まるため、
  // 「見えない壁」ではなく「茂みに阻まれて自然に進みづらくなる」
  // 体感になる。
  // --- 歩行モード(クリックでロック、WASDで移動、Escで戻る) ---
  // Phase 2(2026-09): Playable Area(PLAYABLE_RADIUS)を超えると、
  // 境界線上で位置を止める(ハードリミット)。ちょうどこの半径から
  // 森の壁(Boundary Zone)が始まるため、「見えない壁」ではなく
  // 「茂みに阻まれて自然に進みづらくなる」体感になる。
  //
  // 2026-09: 三人称視点(前方/後方)・「見守りモード」(自律的に歩き回る)
  // を追加。この世界の雪だるまは常に1体だけという設定にするため、
  // 以前あったデモ用NPCとは別枠にせず、この1体(playerSnowman)を
  // 「プレイヤーが操作する」か「自律的に歩き回らせる(見守りモード)」
  // かのどちらかで動かす、という構成にしている。
  let mode = 'orbit'; // 'orbit'(自由カメラ・未操作) | 'walk'(プレイヤー操作)
  // 歩行モードの初期視点は「三人称(後ろ姿)」(2026-09 v1.28: 指定により。以前は一人称)。
  // 'first' | 'third-back' | 'third-front' (mode==='walk'の時のみ意味を持つ)
  const DEFAULT_WALK_VIEW = 'third-back';
  let cameraView = DEFAULT_WALK_VIEW;
  let wanderActive = false; // 見守りモード(自律移動)。mode==='walk'とは排他
  let cinemaMode = false; // 見守りモード中だけ有効な自動シネマティックカメラ
  // 2026-09: 自動カメラの候補位置が木の葉(canopy)の中に入り込み、
  // 「画面いっぱいに木の葉だけになるカット」になってしまう不具合への対応。
  // 木の位置ごとに、だいたいの葉の高さ範囲(地面からtrunkHeight*0.55
  // 〜 +canopyTotalHeight)と水平距離(scale*1.2以内)を大まかにチェックし、
  // その範囲に入っていたら「ブロックされている」とみなす(近似判定でよい。
  // 完全に正確な当たり判定は不要で、明らかな埋没だけ避けられれば十分)。
  function isCameraPositionInFoliage(pos) {
    for (const t of livingTreePositions) {
      const dx = pos.x - t.x, dz = pos.z - t.z;
      if (Math.hypot(dx, dz) > t.scale * 1.2) continue;
      const groundY = terrainHeightAt(t.x, t.z);
      const canopyBottom = groundY + 1.6 * t.scale * 0.5;
      const canopyTop = groundY + 1.6 * t.scale * 0.55 + 3.2 * t.scale;
      if (pos.y > canopyBottom && pos.y < canopyTop) return true;
    }
    return false;
  }

  // --- カメラの地面/水面めり込み防止(2026-09 v1.25) ---
  // 「自動カメラで地形の裏側(雪で埋まっているはずの川の中や地面の中)が
  // 見える」不具合への対応。計算はcamera-ground.js(ヘッドレス検証と共通)。
  const cameraGround = createCameraGroundGuard({
    terrainHeightFn: terrainHeightAt,
    waterSurfaceFn: (x, z) => getWaterSurfaceAt(x, z, terrainHeightAt),
    snowOffsetFn: () => (snowCapMesh.visible ? weather.getSnowDepth() : 0),
  });
  const constrainCameraPosition = cameraGround.constrainCameraPosition;
  /** 自動カメラの候補位置を採用してよいか(trueなら却下して選び直す)。 */
  // かまくら(冬の積雪5m時のみ存在)のドームが視線を遮る/カメラがドームの中に入る位置も却下する。
  const domeGuard = createDomeOcclusionGuard({
    getDome: () => (iglooActiveState ? { x: campX, y: terrainHeightAt(campX, campZ), z: campZ } : null),
    radius: iglooOuterRadiusPlanned,
  });
  function isCameraShotBlocked(pos, target) {
    return isCameraPositionInFoliage(pos) || cameraGround.isShotBlockedByGround(pos, target) || domeGuard.isShotBlockedByDome(pos, target);
  }
  const cameraDirector = createCameraDirector({
    isBlocked: isCameraShotBlocked,
    constrainPosition: constrainCameraPosition,
  });

  // 2026-09: 「三人称視点の時に全身が見えるようにしてほしい」との要望を
  // 受け、距離・高さを広げ、常にキャラクターの胴体中央あたりを
  // lookAt()で見るように変更した(以前はカメラの向きをマウス視点と
  // 完全に一致させていたため、見上げる/見下ろす角度によっては
  // 頭や足が画面外に出てしまうことがあった)。
  // 2026-09b: 「上下に視点を動かせない」「歩きながらマウスを上下に動かすと
  // 視点が横からになる」バグ修正。以前はヨー(水平)成分だけを取り出して
  // 使っており、真上/真下付近を見た時に水平成分がほぼゼロになって
  // 一時的な決め打ちの向き(0,0,1)へ切り替わっていたのが原因。
  // マウスの向き(ヨー・ピッチ)をそのままカメラの軌道方向として使い、
  // 常にアンカー点(胴体よりやや上)をlookAt()で見るようにすることで、
  // ピッチ操作がそのまま「見上げる/見下ろす」になり、かつ不連続な
  // 切り替わりも起きないようにした。
  const THIRD_PERSON_ANCHOR_HEIGHT = 1.2; // 地面からアンカー点(胴体やや上)までの高さ
  const THIRD_PERSON_BACK_DISTANCE = 4.6;
  const THIRD_PERSON_FRONT_DISTANCE = 4.6;

  const cameraForwardScratch = new THREE.Vector3();
  const walkLookDirScratch = new THREE.Vector3();
  const bodyCenterScratch = new THREE.Vector3();
  const interactForwardScratch = new THREE.Vector3(); // v1.39: 視線中心の狙い判定用
  const torchUprightQuatScratch = new THREE.Quaternion();

  /**
   * 松明を、持っている腕/手の傾きに関わらず常に世界座標で直立させる。
   * (枝と同じ角度で傾いていると「枝の一部が伸びているだけ」に見えて
   * しまうため、松明本体だけ独立して縦向きに補正する)
   */
  function keepTorchUpright(torch, socket) {
    socket.updateWorldMatrix(true, false);
    socket.getWorldQuaternion(torchUprightQuatScratch);
    torch.group.quaternion.copy(torchUprightQuatScratch.invert());
  }
  // Escで歩行モードを抜けた時・画面の✕ボタン(スマホ)で抜けた時の共通処理。
  // 今いる位置・向きからOrbitControlsを再開する。
  function leaveWalkMode() {
    if (mode !== 'walk') return; // 二重に呼ばれても一度だけ処理する
    mode = 'orbit';
    inventoryOpen = false; // 歩行を抜けたらインベントリも閉じる
    emoteState.wheelOpen = false; // v1.73: エモートのホイールも閉じる
    walk.setFrozen(false);
    walk.endUiRelease(false);
    interaction.hide(); // v1.39: 歩行を抜けたら、狙いのハイライトも消す
    orbitControls.target.copy(camera.position).addScaledVector(cameraForwardScratch.set(0, 0, -1).applyQuaternion(camera.quaternion), 5);
    orbitControls.enabled = true;
    orbitControls.update();
    firstPersonHands.group.visible = false;
    if (options.onModeChange) options.onModeChange(mode);
  }
  const walk = createWalkControls(renderer.domElement, () => leaveWalkMode(), PLAYABLE_RADIUS);

  // --- 一人称視点用の手(Snowman 3D Character.md 15〜16節) ---
  // カメラの子として画面下部にだけ見える簡易な手を用意する。
  // 一人称視点(cameraView==='first')の時だけ表示する。
  const firstPersonHands = createFirstPersonHands(1);
  firstPersonHands.group.visible = false;
  camera.add(firstPersonHands.group);
  scene.add(camera); // camera.add()の子を描画するにはcamera自体もシーングラフに入れる必要がある

  // --- 松明(夜間に雪だるまへ持たせる) ---
  // 本体側(三人称で見える右腕の先)と、一人称視点の手側の両方に
  // 用意しておき、視点モードに関わらず夜は光源として機能するようにする。
  const torchOnBody = createTorch(0.85);
  playerSnowman.torchSocket.add(torchOnBody.group);
  const torchOnHands = createTorch(0.55);
  firstPersonHands.torchSocket.add(torchOnHands.group);

  function enterWalkMode(viewMode = DEFAULT_WALK_VIEW) {
    editMode.disable(); // 編集モードと歩行モードは両立しない
    mode = 'walk';
    cameraView = viewMode;
    wanderActive = false;
    cinemaMode = false;
    orbitControls.enabled = false;
    // 現在のカメラの位置・向きから引き継ぐ(急に視点が飛ばないように)
    walk.playerPos.set(playerSnowman.group.position.x, 0, playerSnowman.group.position.z);
    walk.lookRig.quaternion.copy(camera.quaternion);
    walk.syncBodyYaw(); // v1.58: 歩行モードに入るたび、体の向きを今のカメラの向きにそろえる
    walk.lock();
    if (options.onModeChange) options.onModeChange(mode);
  }

  /**
   * 歩行モードを終了する(スマホの✕ボタン、見守りモードへの切替などから)。
   * ポインターロック中なら解除も行う。Escでの解除('unlock'イベント)と同じ
   * leaveWalkMode()を通るので、結果は同じになる。
   */
  function exitWalkMode() {
    if (mode !== 'walk') return;
    leaveWalkMode();
    if (walk.isLocked) walk.controls.unlock();
  }

  /** 歩行モード中に一人称/三人称-後方/三人称-前方を順番に切り替える。 */
  function cycleCameraView() {
    if (mode !== 'walk') return;
    const order = ['first', 'third-back', 'third-front'];
    cameraView = order[(order.indexOf(cameraView) + 1) % order.length];
  }

  /**
   * 見守りモード(自律的に歩き回る)の切り替え。
   * この世界の雪だるまは1体だけなので、プレイヤー操作(mode==='walk')
   * とは同時に成立しない。有効化する時、歩行モード中であれば
   * 一旦ポインターロックを解除してプレイヤー操作を終了させる。
   */
  function setWander(active) {
    if (active && mode === 'walk') {
      exitWalkMode(); // v1.38: タッチ操作(ポインターロック無し)でも確実にorbitへ戻す
    }
    wanderActive = !!active;
    if (wanderActive) emoteBrain.adoptAuto(); // v1.73
    wander.collectTask = null; wander.baseTask = null; // v1.54: モードの切り替えで、途中の動作は終える
    if (!wanderActive) { cinemaMode = false; chest.close(); } // 見守りモードを切ったら自動カメラも切る
    if (wanderActive && fallingStars.isLanded()) rollSnowmanStarReaction(); // すでに落ちている星にも気づくことがある
  }

  /** 見守りモード中の自動シネマティックカメラのON/OFF。 */
  function setCinemaMode(active) {
    cinemaMode = !!active && wanderActive;
    if (cinemaMode) cameraDirector.reset(); // ONにした瞬間に新しいショットから始める
  }

  function applyTimeOfDay(hour) {
    const tod = getTimeOfDay(hour);
    const { sunIntensity, hemiIntensity } = computeSkyState(
      hour, skyBaseScratch, sunColorScratch, hemiSkyScratch, hemiGroundScratch
    );

    // --- 天候(曇り/雷雨)による減光・グレー化をここで重ねる ---
    const skyMod = weather.getSkyModifier();
    skyBaseScratch.lerp(GRAY_TINT, skyMod.colorTint).multiplyScalar(skyMod.brightnessMul);
    sunColorScratch.lerp(GRAY_TINT, skyMod.colorTint * 0.6).multiplyScalar(skyMod.brightnessMul);
    hemiSkyScratch.lerp(GRAY_TINT, skyMod.colorTint).multiplyScalar(skyMod.brightnessMul);
    hemiGroundScratch.multiplyScalar(Math.max(0.45, skyMod.brightnessMul));

    let sunIntensityFinal = sunIntensity * skyMod.brightnessMul;
    let hemiIntensityFinal = hemiIntensity * Math.max(0.4, skyMod.brightnessMul);

    // --- 稲妻フラッシュ(一瞬だけ全体を明るくブーストする) ---
    if (skyMod.flashBoost > 0.001) {
      skyBaseScratch.lerp(FLASH_COLOR, skyMod.flashBoost * 0.85);
      sunIntensityFinal += skyMod.flashBoost * 3.2;
      hemiIntensityFinal += skyMod.flashBoost * 2.4;
    }

    scene.background.copy(skyBaseScratch);
    scene.fog.color.copy(scene.background);
    scene.fog.near = THREE.MathUtils.lerp(40, 22, skyMod.fogAmount);
    scene.fog.far = THREE.MathUtils.lerp(248, 75, skyMod.fogAmount);

    sun.color.copy(sunColorScratch);
    sun.intensity = sunIntensityFinal;
    hemi.color.copy(hemiSkyScratch);
    hemi.groundColor.copy(hemiGroundScratch);
    hemi.intensity = hemiIntensityFinal;

    const { lightDir, sunPos: celSunPos, moonPos: celMoonPos } = celestial.update(hour, celestialCenter);
    // v1.64: 星空。夜の度合い(空の明るさ・太陽の高さ)と晴れ具合(雲・雨・雪・霧)で見え方を決める。
    // 空の明るさは、天候で暗くした後の背景色の輝度(リニア→見た目の明るさ)。
    const skyLumLinear = 0.2126 * skyBaseScratch.r + 0.7152 * skyBaseScratch.g + 0.0722 * skyBaseScratch.b;
    starfield.update({
      hour, center: celestialCenter, sunPos: celSunPos, moonPos: celMoonPos,
      skyLum: Math.pow(Math.max(0, skyLumLinear), 1 / 2.2), clarity: 1 - skyMod.fogAmount,
    });
    // 影の範囲の中心は、影マップの1マス単位に揃える(2026-09 v1.28。カメラが動くたびに
    // 影マップの格子が世界に対してずれて、雪だるまなどの表面に影のちらつき・ムラが
    // 出ていた。詳細はshadow-snap.js)。太陽・月の見た目の中心(celestialCenter)は
    // そのまま滑らかに追従させる。
    snapShadowCenter(celestialCenter, lightDir, sun.shadow.camera.right - sun.shadow.camera.left, sun.shadow.mapSize.x, shadowCenterScratch);
    sun.position.copy(shadowCenterScratch).addScaledVector(lightDir, LIGHT_DISTANCE);
    weather.setSunDirection(lightDir); // 虹を反太陽点へ向けるための基準
    sun.target.position.copy(shadowCenterScratch);
    // 月のシャープさ(晴れ=クレーターまで見える、曇り/雨=ボヤける)を天候に連動させる
    celestial.setMoonClarity(1 - skyMod.fogAmount);

    // 草・山脈はどちらもライトの影響を受けない(unlitな)描画方式のため、
    // 昼夜・天候による明暗変化を手動で反映させる必要がある。
    // 基準値は daynight.js の最小/最大の目安値(sun 0.16〜1.7、hemi 0.3〜0.65)。
    const brightnessRaw = THREE.MathUtils.clamp(
      (sunIntensityFinal * 0.6 + hemiIntensityFinal * 0.8) / 1.54, 0, 1
    );
    if (typeof setRiverEnvironment === 'function') {
      setRiverEnvironment(scene.background, lightDir, brightnessRaw); // v1.56-H6: 川も昼夜・天候の明るさに合わせる(夜は暗く)
      if (typeof setRiverStarReflection === 'function') { // v1.65: 星空の映り込み / v1.66: 月の映り込み。設定でオフにできる
        const sr = starfield.getReflection();
        const on = waterReflectionEnabled ? 1 : 0;
        setRiverStarReflection(sr.texture, sr.size, sr.strength * on, sr.moonDir, sr.moonStrength * on);
      }
    }
    // 山は「夜景のシルエット」として見えてほしいので、草より下限を低く(暗く)している
    const mountainFactor = THREE.MathUtils.lerp(0.08, 1, Math.pow(brightnessRaw, 1.2));
    setMountainBrightness(mountains, mountainFactor);

    if (typeof setGrassLightMul === 'function') {
      const lightMul = THREE.MathUtils.lerp(0.14, 1, brightnessRaw);
      setGrassLightMul(lightMul);
      if (poppyField) poppyField.setLightMul(lightMul);
    }
    return tod;
  }

  let lastSeasonKey = null;

  /**
   * 季節(season.js)と積雪量(weather.jsのgetSnowCoverage())を反映して、
   * 地形・草・木の葉の色をなめらかに更新する。
   * また、季節が変わった瞬間だけ、天候自動サイクルの重みと落ち葉の
   * 表示状態を更新する(毎フレーム再計算する必要はないため)。
   */
  function applySeasonAndSnow(delta) {
    const seasonKey = season.update();
    if (seasonKey !== lastSeasonKey) {
      lastSeasonKey = seasonKey;
      weather.setWeatherWeights(season.getWeatherWeights());
      const wantLeavesVisible = season.isAutumnLike();
      if (wantLeavesVisible !== currentAutumnLeavesVisible) {
        currentAutumnLeavesVisible = wantLeavesVisible;
        if (leaves) leaves.setVisible(wantLeavesVisible);
        // 積もった枯れ葉(動的な方)も、既存の静的な落ち葉と同じタイミングで
        // 表示/非表示を切り替える(=積雪の季節には一緒に隠れるため、
        // 積雪と枯れ葉の山が同時に見えることはない)。
        leafFall.setPileVisible(wantLeavesVisible);
      }
    }

    terrainColorTarget.set(season.getTerrainColor());
    leafColorTarget.set(season.getLeafColor());
    // 2026-09(v1.30): 広葉樹(紅葉)。針葉樹(leafColorTarget、上記)とは別に、
    // getBroadleafLeafColor()の連続的な色(緑→黄→橙→赤茶)を毎フレーム
    // そのまま反映する(針葉樹のような遅いブレンドは行わない。紅葉の色は
    // すでにgetAutumnProgress()で日単位のゆっくりした変化になっているため)。
    setBroadleafTint(season.getBroadleafLeafColor());
    applyBroadleafDefoliation(broadleafCanopyBlobs, season.getBroadleafDefoliation());
    const grassColors = season.getGrassColors();
    grassLowTarget.setRGB(grassColors.low[0], grassColors.low[1], grassColors.low[2]);
    grassHighTarget.setRGB(grassColors.high[0], grassColors.high[1], grassColors.high[2]);

    const blend = Math.min(1, delta * 0.15); // 季節切り替え時、数秒かけてなめらかに移行する
    terrainColorCurrent.lerp(terrainColorTarget, blend);
    leafColorCurrent.lerp(leafColorTarget, blend);
    grassLowCurrent.lerp(grassLowTarget, blend);
    grassHighCurrent.lerp(grassHighTarget, blend);

    // --- 積雪(色の変化。降っている間ゆっくり白さが増す) ---
    const snowCoverage = weather.getSnowCoverage();
    const snowDepth = weather.getSnowDepth();
    const rime = weather.getRimeIntensity();
    terrain.material.color.copy(terrainColorCurrent).lerp(SNOW_WHITE, snowCoverage * 0.8);
    // 樹氷(2〜3m付近)の時は、通常の積雪による色混ざりより強く白くする
    const leafSnowAmount = Math.max(snowCoverage * 0.35, rime * 0.9);
    const leafWithSnow = leafColorScratch.copy(leafColorCurrent).lerp(SNOW_WHITE, leafSnowAmount);
    setLeafTint(leafWithSnow);
    // 2026-09: 「木の葉の上にも雪が積もり、単純な色変化ではなく厚みが
    // 増して丸くなるように」との指摘に対応。積雪量(すぐ飽和する
    // snowCoverage)と積雪の深さ(3mまで)の両方から、葉のふくらみ量を
    // 決める(深さ3m以上は、どのみち埋没が進むのでこれ以上は増やさない)。
    setLeafSnowBulk(snowCoverage * 0.15 + Math.min(snowDepth, 3) * 0.06);
    // 春の融雪でまだらに欠けていく表現(上のsnowCapMaterial.onBeforeCompile参照)。
    // 2026-09(改訂3修正): 「雪が降り始めた時に地形がチェッカーボード状に
    // なる」バグの本当の原因はここだった。以前は単純に「積雪が薄い=まだら」
    // という式だったため、積雪がまさに"積もり始めた"瞬間(まだ薄い)にも
    // このまだら演出が誤って発動し、格子状のノイズで大量に欠けて見えて
    // いた(前回の地形非表示化の修正は、この欠けた隙間から地形が透けて
    // 見えていたのを隠しただけで、欠け自体は直っておらず、隙間の先が
    // 何も無くなった分むしろ目立って悪化していた)。まだら演出は「雪が
    // 降り止んだ後、時間をかけて溶けて薄くなっていく」場面だけのための
    // ものなので、実際に降雪中(weather.getWeather()==='snow')は常に
    // まだら化させない(積もり始めはどんな深さでも不透明な雪面のまま)よう
    // 修正した。
    const isActivelySnowing = weather.getWeather() === 'snow';
    const meltPatchT = isActivelySnowing ? 1 : Math.max(0, Math.min(1, snowDepth / 1.2));
    const meltPatchSmooth = meltPatchT * meltPatchT * (3 - 2 * meltPatchT);
    snowMeltPatchinessUniform.value = 1 - meltPatchSmooth;
    if (typeof setGrassSeasonColors === 'function') {
      setGrassSeasonColors(
        [grassLowCurrent.r, grassLowCurrent.g, grassLowCurrent.b],
        [grassHighCurrent.r, grassHighCurrent.g, grassHighCurrent.b]
      );
    }
    if (typeof setGrassSnowMix === 'function') setGrassSnowMix(snowCoverage);

    // --- 実際に積もる雪(色だけでなく、実体のある積雪) ---
    // 2026-09: 新規実装。「色を変えるだけではダメ。積雪を表現すべき」との
    // 指摘への対応。雪面メッシュ(地形と同じ形をした白いメッシュ)を積雪の
    // 深さぶんだけ垂直に持ち上げ、木・岩はその深さぶんだけ沈める。
    // (このプロジェクトでは積雪の深さを場所によらず一律の値として扱う
    // 簡略化をしている。吹き溜まり等の偏りは表現しない)
    const SNOW_VISIBLE_THRESHOLD = 0.03; // これ未満は「積もっていない」扱い
    snowCapMesh.visible = snowDepth > SNOW_VISIBLE_THRESHOLD;
    if (snowCapMesh.visible) snowCapMesh.position.y = snowDepth;
    // 2026-09(修正): 「雪が降り始めた時に地形がチェッカーボード状にちらつく」
    // バグへの対応。snowCapMeshは地形メッシュを複製して少し持ち上げた
    // だけのものなので、積もり始め(snowDepthがごく小さい)は両者がほぼ
    // 同じ高さで重なり、Zファイティング(奥行きの奪い合い)でちらつく
    // 市松模様が出ていた。雪面メッシュが見えている間は元の地形メッシュを
    // 完全に隠す(雪面メッシュが地形と同じ形なので見た目上の変化は無い)
    // ことで、そもそも2枚の面が重ならないようにする。
    terrain.visible = !snowCapMesh.visible;

    // 2026-09(訂正): 積雪で沈める(position.yを下げる)と、雪面自体も
    // 同じ深さだけ持ち上がっているため、見える高さが「実際の2倍」の
    // 速さで減ってしまう不具合があった(木を沈めた上に、雪面もかぶさる
    // ため)。正しくは、木や岩は元の位置に固定したまま、雪面という
    // 不透明な面が下から迫り上がることで自然にZバッファ遮蔽され、
    // 「埋もれて見えなくなる」はず。よってここでは位置を動かさず、
    // 完全に埋没しきった(=雪面より低い)ものだけdraw callの節約として
    // 非表示にする(見た目上はどのみち隠れているので変化はない)。
    for (const c of burialCandidates) {
      // v1.56-H4: 動いている/つかんでいる丸太は、雪の中でも見える(掘り出した直後に消えない)。
      // 丸太は「雪の深さ > 丸太の上面の高さ(河床からの高さ)」の時だけ隠れる。川にかけた丸太は高い位置にあるので、すぐには消えない。
      const moving = c.log && c.log.physics && c.log.physics.physicsState !== 'static';
      c.mesh.visible = moving || snowDepth < c.heightM;
    }
    for (const f of snowFollowers) f(snowDepth > SNOW_MIN ? snowDepth : 0);

    // 草・花畑・蝶蜂: 積もり始めたら地面ごと埋もれるので非表示にする
    // (「花も蝶も蜂も非表示です」との指定通り)
    const buriedUnderSnow = snowDepth > SNOW_VISIBLE_THRESHOLD;
    grassMesh.visible = !buriedUnderSnow;
    if (poppyField) poppyField.group.visible = !buriedUnderSnow;
    // 蝶・蜂の表示/非表示は、pollinators側(setActive+フェード)だけが管理する。
    // ここでgroup.visibleを直接いじると、非アクティブ(雨・夜・霧)でも表示に戻して
    // しまい、見えたまま空中で固まる不具合になる(v1.28で修正)。
    pollinatorsBuriedUnderSnow = buriedUnderSnow;

    // --- 深い積雪(5m): 小川が完全に埋もれる ---
    // ヒステリシス(4.5m未満で復活、4.9m以上で埋没)を設けて、閾値付近での
    // ちらつきを防ぐ。
    if (!riverBuriedState && snowDepth >= 4.9) riverBuriedState = true;
    else if (riverBuriedState && snowDepth < 4.5) riverBuriedState = false;
    river.visible = !riverBuriedState;
    riverbed.visible = !riverBuriedState;
    if (riverSound) riverSound.setSize(riverBuriedState ? 0 : RIVER_SIZE);

    // --- 深い積雪(5m): テントの代わりに「かまくら」、焚き火は入口の外へ ---
    // 2026-09(修正): 複数の不具合を修正。
    // (1) かまくらが雪に埋まって見えなくなっていたバグ: かまくらの位置を
    //     配置時の一度きりの高さに固定していたため、雪面が積もって
    //     持ち上がると、かまくら自体は元の(低い)高さのままになり、
    //     雪面の下に埋もれて見えなくなっていた。→ 毎フレーム、雪面の
    //     高さ(terrainHeightAt+snowDepth)に合わせて位置を更新し、常に
    //     雪の上に乗っているようにした。
    // (2) 焚き火が雪に埋まって見えなくなっていたバグ: 以前は
    //     iglooActiveState(5m到達)の時だけ雪面の高さに合わせていたため、
    //     それ以前(0〜5m)の間は焚き火が雪の中に埋もれてしまっていた。
    //     → 常に(段階に関係なく)雪面の高さに合わせるようにし、焚き火が
    //     埋もれることが無いようにした。
    // 2026-09(改訂): 「かまくらの設置タイミングが遅すぎる。テントが
    // 積雪で埋もれて見えなくなった時点で設置して」との指摘に対応。
    // 以前は5m(埋没の最終段階)まで待っていたが、正しくはテントの高さ
    // (TENT_HEIGHT)で判定する。
    if (!iglooActiveState && snowDepth >= TENT_HEIGHT + 0.05) iglooActiveState = true;
    else if (iglooActiveState && snowDepth < TENT_HEIGHT - 0.3) iglooActiveState = false;
    if (iglooActiveState !== campCollisionIsIgloo) {
      campCollisionIsIgloo = iglooActiveState;
      setCampCollisionMode(campCollisionIsIgloo);
    }
    tent.visible = !iglooActiveState;
    iglooGroup.visible = iglooActiveState;
    if (iglooActiveState) {
      // かまくら自体は常に雪面の上に位置させる(積雪が続いても埋まらない)
      iglooGroup.position.y = terrainHeightAt(campX, campZ) + snowDepth;
      // 2026-09(改訂3): 「蝋燭の炎を少し揺らして」との指摘に対応。
      iglooFlameClock += delta;
      updateIglooFlame(iglooFlameClock);
    }

    // v1.56-H4: かまくらが建った段階で、チェストはかまくらの隣の雪面の上に現れる(それまでは雪に埋もれて見えない)。
    // かまくらが消えて雪が引いたら、元の地面の位置に戻る。位置(x,z)はかまくらの隣のまま変わらない。
    {
      const chestY = terrainHeightAt(chestX, chestZ) + chestGroundOffset + (iglooActiveState ? snowDepth : 0);
      if (Math.abs(chest.group.position.y - chestY) > 1e-4) {
        chest.group.position.y = chestY;
        chestCollider.y = chestY - chestGroundOffset + chest.height / 2;
      }
    }

    // 2026-09(改訂4): 焚き火の位置は年間を通して固定(fireX/fireZ)。
    // 以前はかまくら設置時に別の場所へ動かしていたが、「位置が変わるのは
    // 変」との指摘に対応し、そもそも最初からかまくらの分の余白を
    // 確保した1箇所だけを使うようにした。
    fireGroup.position.x = fireX;
    fireGroup.position.z = fireZ;
    // 2026-09(修正): 「焚き火の設置面が雪面より少し下がっている(熱で
    // 溶けてくぼんでいる)」との指摘に対応。雪が積もっている間は、焚き火
    // 自体の設置面を雪面よりFIRE_MELT_DIPだけ低い「くぼみの底」に置く
    // (雪が全く無い時は通常通り地形の高さのまま)。
    const FIRE_MELT_DIP = 0.15;
    const fireSnowSurfaceY = terrainHeightAt(fireX, fireZ) + snowDepth;
    fireGroup.position.y = snowDepth > 0.05 ? fireSnowSurfaceY - FIRE_MELT_DIP : fireSnowSurfaceY;

    // 焚き火の熱で周りの雪が少し溶けてくぼんでいる表現(圧雪のような
    // 明るい色の円盤を、くぼみの底の高さに重ねる簡易表現)。
    meltedPatchMesh.visible = snowDepth > 0.05;
    if (meltedPatchMesh.visible) {
      meltedPatchMesh.position.set(fireX, fireSnowSurfaceY - FIRE_MELT_DIP + 0.008, fireZ);
    }

    updateFootprints(delta);

    // --- 雪だるまの「喜び」(雪が降っている間だけ) ---
    playerSnowman.setJoyful(weather.getWeather() === 'snow');
  }

  let riverBuriedState = false;
  let iglooActiveState = false;
  let iglooFlameClock = 0; // 2026-09(改訂3): 蝋燭の炎のゆらめき用の経過時間
  const leafColorScratch = new THREE.Color();
  const SNOW_WHITE = new THREE.Color(0xfbfdff); // 2026-09: 「灰色ではなく綺麗な白で」との指摘を受け、より明るい白に変更
  const terrainColorCurrent = terrain.material.color.clone();

  scene.background = new THREE.Color(0x000000);
  const skyBaseScratch = new THREE.Color();
  const sunColorScratch = new THREE.Color();
  const hemiSkyScratch = new THREE.Color();
  const hemiGroundScratch = new THREE.Color();
  const GRAY_TINT = new THREE.Color(0x8d97a0);
  const FLASH_COLOR = new THREE.Color(0xf3f6ff);

  // ゲーム内時計: マインクラフトと同じ体感速度(ゲーム内1時間 ≈ 現実50秒、
  // つまりゲーム内1日 ≈ 現実20分)で進む。起動時は現実の現在時刻に同期する。
  let gameHour = options.hourOverride ?? (new Date().getHours() + new Date().getMinutes() / 60);
  const GAME_HOURS_PER_REAL_SECOND = 1 / 50;
  let lastCreatureBucket = null;

  applyTimeOfDay(gameHour);

  // ================================================================
  // 環境音(バイノーラル立体音響)の統合
  // ================================================================
  // 焚き火の実座標(炎の中心あたり)
  const fireSoundPos = fireGroup.position.clone().add(new THREE.Vector3(0, 0.2, 0));

  let audioOn = false;

  // --- 足音(草/川の中。雪は季節システム実装後に使用予定) ---
  // 2026-09: 新規追加。歩いた距離を積算し、一定距離ごとに1歩分の音を鳴らす
  // (アニメーションの正確な足の接地フレームには同期させず、シンプルな
  // 距離ベースのトリガーにしている)。プレイヤー・見守りモードの雪だるま
  // 両方の移動でこの同じ仕組みを使う。
  const FOOTSTEP_STRIDE = 1.05; // 1歩あたりの距離(m)の目安
  let footstepPrevX = snowmanHomeX;
  let footstepPrevZ = snowmanHomeZ;
  let footstepAccum = 0;

  // --- 足跡(雪面にだけ付く。2.5秒ほどで自然に消える=雪が積もり直す) ---
  // 2026-09: 新規追加。「雪だるまが歩くと少しだけ凹んで足跡がつくが、
  // 2〜3秒で雪が積もって消える」という指摘への対応。実際に地面を凹ませる
  // (ジオメトリ変形)のではなく、雪面の上に薄く暗い楕円のデカールを
  // 置き、時間とともに透明度を下げて消す簡易的な表現。
  const FOOTPRINT_LIFE = 2.5; // 秒
  const footprintPool = [];
  {
    const footprintGeo = new THREE.CircleGeometry(0.1, 10);
    for (let i = 0; i < 26; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xcfd9e0, transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(footprintGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.scale.set(0.75, 1.3, 1); // 少し縦長にして足跡らしい形に
      mesh.visible = false;
      scene.add(mesh);
      footprintPool.push({ mesh, life: 0, active: false });
    }
  }
  let footprintCursor = 0;
  let footprintFootSign = 1;
  function spawnFootprint(x, z, prevX, prevZ) {
    const depth = weather.getSnowDepth();
    if (depth < 0.04) return; // 雪が積もっていない地面には付けない
    const entry = footprintPool[footprintCursor];
    footprintCursor = (footprintCursor + 1) % footprintPool.length;
    const dirX = x - prevX, dirZ = z - prevZ;
    const len = Math.hypot(dirX, dirZ) || 1;
    const sideX = -dirZ / len, sideZ = dirX / len;
    footprintFootSign *= -1; // 左右交互に少しずらして、両足の足跡らしくする
    const sideOffset = 0.13 * footprintFootSign;
    const groundY = terrainHeightAt(x, z) + depth;
    entry.mesh.position.set(x + sideX * sideOffset, groundY + 0.006, z + sideZ * sideOffset);
    if (len > 1e-4) entry.mesh.rotation.z = Math.atan2(dirX, dirZ);
    entry.mesh.material.opacity = 0.5;
    entry.mesh.visible = true;
    entry.life = FOOTPRINT_LIFE;
    entry.active = true;
  }
  function updateFootprints(delta) {
    for (const entry of footprintPool) {
      if (!entry.active) continue;
      entry.life -= delta;
      if (entry.life <= 0) {
        entry.active = false;
        entry.mesh.visible = false;
        continue;
      }
      entry.mesh.material.opacity = 0.5 * (entry.life / FOOTPRINT_LIFE);
    }
  }

  /** 足元の高さが丸太の上面とほぼ同じなら、その丸太の面(いちばん高いもの)。無ければnull。 */
  function logUnderFoot(x, z) {
    const feetY = playerSnowman.group.position.y;
    let best = null;
    for (const h of traversal.surfaceHits(x, z, 0.05)) {
      if (h.kind !== 'log' || !h.log) continue;
      if (Math.abs(feetY - h.topAbs) > 0.22) continue;
      if (!best || h.topAbs > best.topAbs) best = h;
    }
    return best;
  }
  function updateFootsteps(x, z, walking) {
    if (!walking) {
      footstepPrevX = x; footstepPrevZ = z;
      footstepAccum = 0;
      return;
    }
    const prevX = footstepPrevX, prevZ = footstepPrevZ;
    footstepAccum += Math.hypot(x - prevX, z - prevZ);
    footstepPrevX = x; footstepPrevZ = z;
    if (footstepAccum < FOOTSTEP_STRIDE) return;
    footstepAccum = 0;
    spawnFootprint(x, z, prevX, prevZ);
    if (!audioOn || !window.SoundEngine || !window.SoundEngine.Footsteps) return;
    // v1.56-H3: 丸太の上を歩いている(足元の高さが丸太の上面と同じ)なら、雪の足音ではなく木の「コッ」。丸太が大きいほど低い。
    const onLog = logUnderFoot(x, z);
    if (onLog) {
      const size = window.SoundEngine.Sfx ? window.SoundEngine.Sfx.logSize(onLog.log.length, onLog.log.radius) : 0.5;
      window.SoundEngine.Footsteps.step('wood', 1, { size });
      return;
    }
    const { distance, width } = distanceToRiver(x, z, riverSamplesForAvoid);
    const surface = distance < getWaterEdgeDistance(width) ? 'water' : 'grass';
    window.SoundEngine.Footsteps.step(surface);
  }
  let fireSound = null;
  let riverSound = null;
  let windSound = null;
  let insectsSound = null;
  let birdsSound = null;
  let rainSound = null;
  let thunderSound = null;
  const BASE_WIND_INTENSITY = 0.15;
  // riverSound.setSize(0.4) がstart()内で設定する基準値と合わせてある
  // (天候による上乗せ分を計算するための基準として使う)
  const RIVER_SIZE = 0.4;
  const RIVER_BASE_BUBBLE_RATE = 0.3 + RIVER_SIZE * 0.6;
  const RIVER_BASE_SPLASH_AMOUNT = 0.3 + RIVER_SIZE * 0.5;

  // 稲妻の「見た目」が光ったのと同じタイミングで雷鳴を鳴らす
  // (Thunder側の自動スケジューラは使わず、視覚と完全に同期させる)
  weather.onLightning((power) => {
    if (audioOn && thunderSound) thunderSound.strike(power);
  });

  function seasonFromDate() {
    const m = new Date().getMonth() + 1; // 1-12
    if (m >= 3 && m <= 5) return 'spring';
    if (m >= 6 && m <= 8) return 'summer';
    if (m >= 9 && m <= 11) return 'autumn';
    return 'winter';
  }

  function applyCreatureAmbience(hour) {
    if (!insectsSound || !birdsSound) return;
    const tod = getTimeOfDay(hour);
    const season = seasonFromDate();
    insectsSound.setSeason(season);
    birdsSound.setSeason(season);
    // 時間帯によって「そもそも鳴く種類が変わる」(フクロウは夜だけ、
    // セミは昼だけ、等)をここで反映する。density側は「その時間帯に
    // 鳴いている種類の、全体としての賑やかさ」の調整として引き続き使う。
    insectsSound.setTimeOfDay(tod);
    birdsSound.setTimeOfDay(tod);
    if (tod === 'day' || tod === 'morning') {
      birdsSound.setDensity(0.55);
      insectsSound.setDensity(0.12);
    } else if (tod === 'evening') {
      birdsSound.setDensity(0.25);
      insectsSound.setDensity(0.4);
    } else {
      birdsSound.setDensity(0.05);
      insectsSound.setDensity(0.6);
    }
  }

  async function startAudio() {
    if (audioOn) return;
    if (!window.SoundEngine) {
      console.warn('SoundEngine が読み込まれていません(js/audio/*.js のscriptタグを確認してください)');
      return;
    }
    await window.SoundEngine.resume();

    fireSound = new window.SoundEngine.Fire();
    riverSound = new window.SoundEngine.River();
    windSound = new window.SoundEngine.Wind();
    insectsSound = new window.SoundEngine.Insects();
    birdsSound = new window.SoundEngine.Birds();
    if (window.SoundEngine.Rain) rainSound = new window.SoundEngine.Rain();
    if (window.SoundEngine.Thunder) thunderSound = new window.SoundEngine.Thunder();

    fireSound.start();
    fireSound.setRoar(0.5);
    fireSound.setCrackle(0.55);

    riverSound.start();
    riverSound.setSize(0.4);

    windSound.start();
    windSound.setIntensity(0.15);
    windSound.setLeaves(true);
    windSound.setLeavesAmount(0.35);
    windSound.setPanWanderAmount(0.4);

    insectsSound.start();
    birdsSound.start();
    applyCreatureAmbience(options.hourOverride ?? new Date().getHours());

    // Thunderは常時startしておき、strike()を稲妻の発生に合わせて手動で呼ぶ
    // (autoIntensityは0のままにして、Thunder自身の自動雷はオフにしておく)
    if (thunderSound) thunderSound.start();

    audioOn = true;
  }

  /**
   * 天候(雨・雷雨)の見た目の状態を、雨音・風音に反映する。
   * 稲妻の音自体は weather.onLightning() のコールバックで別途鳴らす。
   */
  function updateWeatherAudio() {
    if (!audioOn) return;
    const w = weather.getWeather();
    const intensity = weather.getRainIntensity();

    if (rainSound) {
      if (intensity > 0.02) {
        if (!rainSound.running) rainSound.start();
        rainSound.setIntensity(intensity);
        rainSound.setSurfaceDrops(true);
        rainSound.setSurfaceDropAmount(Math.min(1, intensity * 1.1));
        rainSound.setAttackDrops(w === 'storm');
        rainSound.setAttackDropAmount(0.6);
        rainSound.setCanopyDrips(true);
        rainSound.setCanopyDripAmount(Math.min(1, intensity * 1.15));
      } else if (rainSound.running) {
        rainSound.stop();
      }
    }

    if (windSound) {
      const gust = w === 'storm' ? 0.4 : w === 'rain' ? 0.22 : BASE_WIND_INTENSITY;
      windSound.setIntensity(gust);
    }

    if (riverSound) {
      // 雨・雷雨で川の水量/乱流が増した想定で、泡・飛沫の量を底上げする
      // (既存のriverSound.setSize(0.4)による基準値に対する加算)
      const flowBoost = w === 'storm' ? 0.35 : w === 'rain' ? 0.15 : 0;
      riverSound.setBubbleRate(Math.min(1, RIVER_BASE_BUBBLE_RATE + flowBoost));
      riverSound.setSplashAmount(Math.min(1, RIVER_BASE_SPLASH_AMOUNT + flowBoost));
      // 晴れの時は川全体の音量を少し控えめにする
      const weatherVol = w === 'storm' ? 1.0 : w === 'rain' ? 1.0 : 0.7;
      riverSound.setWeatherVolume(weatherVol);
    }
  }

  const _fwd = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);

  /**
   * プレイヤー(カメラ)の位置・向きから、焚き火・川それぞれの
   * 「リスナー(プレイヤー)から見た相対位置」を毎フレーム計算し、音声エンジンへ渡す。
   * これにより、歩いて近づけば大きくなり、右にあれば右から聞こえる、が実現する。
   */
  function updateGameAudio() {
    if (!audioOn) return;

    camera.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
    _fwd.normalize();
    _right.crossVectors(_fwd, _up).normalize();

    const px = camera.position.x, py = camera.position.y, pz = camera.position.z;

    // --- 焚き火: 固定の点音源 ---
    {
      const dx = fireSoundPos.x - px;
      const dy = fireSoundPos.y - py;
      const dz = fireSoundPos.z - pz;
      const localRight = dx * _right.x + dz * _right.z;
      const localForward = dx * _fwd.x + dz * _fwd.z;
      fireSound.setListenerRelativePosition(localRight, dy, -localForward);
    }

    // --- 川: 中心線上の最寄り点を疑似音源とする ---
    {
      const nearest = nearestRiverPoint(px, pz, riverSamplesForAvoid);
      const riverY = terrainHeightAt(nearest.x, nearest.z) + 0.1;
      const dx = nearest.x - px;
      const dy = riverY - py;
      const dz = nearest.z - pz;
      const localRight = dx * _right.x + dz * _right.z;
      const localForward = dx * _fwd.x + dz * _fwd.z;
      riverSound.setListenerRelativePosition(localRight, dy, -localForward);
    }

    // --- 蜂の巣: 近づくと羽音が聞こえる固定の点音源(HRTF立体音響) ---
    // 2026-09: 以前はcamera.position.distanceTo()による距離だけで音量を
    // 決め、方向感のないGainノードを直接鳴らしていたため、自動カメラが
    // 花畑ショット(巣に近い)でハードカットした瞬間、方向感のない
    // ブーン音が急に大きく聞こえるという不具合があった。焚き火・川と
    // 同じ「カメラから見た相対位置」をHRTFパンナーへ渡す方式に統一する。
    if (window.SoundEngine && window.SoundEngine.Bees && beehiveWorldPos) {
      const dx = beehiveWorldPos.x - px;
      const dy = beehiveWorldPos.y - py;
      const dz = beehiveWorldPos.z - pz;
      const dist = Math.hypot(dx, dy, dz);
      const localRight = dx * _right.x + dz * _right.z;
      const localForward = dx * _fwd.x + dz * _fwd.z;
      window.SoundEngine.Bees.setListenerRelativePosition(localRight, dy, -localForward);
      // 3.5m以内から聞こえ始め、1m以内でほぼ最大になる程度の近接感
      const proximity = isPollinatorActiveNow ? Math.max(0, Math.min(1, (3.5 - dist) / 2.5)) : 0;
      window.SoundEngine.Bees.setProximity(proximity);
    }

    // --- 落ちてくる星: 空を降りてくる間も、地上に落ちてからも、世界の中の点音源 ---
    // (星のいる場所そのものをリスナー相対座標にしてHRTFへ渡す。左右のパンではない)
    const star = window.SoundEngine && window.SoundEngine.StarBells && fallingStars.getActive();
    if (star) {
      const dx = star.x - px, dy = star.y - py, dz = star.z - pz;
      const localRight = dx * _right.x + dz * _right.z;
      const localForward = dx * _fwd.x + dz * _fwd.z;
      window.SoundEngine.StarBells.setListenerRelativePosition(localRight, dy, -localForward);
    }
  }

  // ================================================================
  // v1.38: 落ちてくる星・ポーチ・木への飾り付け
  // ================================================================
  // v1.43: インベントリ(メイン27+ホットバー9)は1つ。ホットバーはその一部。
  const inventory = createInventory({ mainSlots: INVENTORY.mainSlots, hotbarSlots: INVENTORY.hotbarSlots });
  const treeDecor = createTreeDecorations({ conifers: coniferTrees });
  // URLに ?starTest を付けると、星が短い間隔で落ちる(開発・確認用。通常のUIには出さない)
  const starTest = options.starTest !== undefined ? options.starTest : readStarTestMode();
  const starBells = () => (audioOn && window.SoundEngine && window.SoundEngine.StarBells) || null;

  // ================================================================
  // v1.56-H3: 世界の中の効果音(チェスト・置く/拾う・丸太・水しぶき)。音を有効にするまでは何もしない。
  // 位置は「いまのカメラから見た相対位置」(右・上・前=-Z)にして、HRTFで定位させる。
  // ================================================================
  const _sfxF = new THREE.Vector3(), _sfxR = new THREE.Vector3();
  function sfx() { return (audioOn && window.SoundEngine && window.SoundEngine.Sfx) || null; }
  function sfxRelative(x, y, z) {
    camera.getWorldDirection(_sfxF); _sfxF.y = 0;
    if (_sfxF.lengthSq() < 1e-6) _sfxF.set(0, 0, -1);
    _sfxF.normalize();
    _sfxR.crossVectors(_sfxF, _up).normalize();
    const dx = x - camera.position.x, dz = z - camera.position.z;
    return { x: dx * _sfxR.x + dz * _sfxR.z, y: y - camera.position.y, z: -(dx * _sfxF.x + dz * _sfxF.z) };
  }

  // 見守り中の雪だるまが星へ示す反応(気づく→向かう、を確率で)
  const starNotice = { pending: false, timer: 0, approach: false };
  const starInterest = { active: false };
  function rollSnowmanStarReaction() {
    if (!wanderActive || starNotice.pending || starInterest.active) return;
    if (Math.random() >= SNOWMAN_STAR.noticeProbability) return; // 気づかず、ただ過ごす
    starNotice.pending = true;
    starNotice.timer = SNOWMAN_STAR.noticeDelaySec[0]
      + Math.random() * (SNOWMAN_STAR.noticeDelaySec[1] - SNOWMAN_STAR.noticeDelaySec[0]);
    starNotice.approach = Math.random() < SNOWMAN_STAR.approachProbability; // 気づいても向かわないことも多い
  }
  function updateSnowmanStarReaction(delta) {
    if (!starNotice.pending) return;
    if (!wanderActive || !fallingStars.isLanded()) { starNotice.pending = false; return; }
    starNotice.timer -= delta;
    if (starNotice.timer > 0) return;
    starNotice.pending = false;
    if (!starNotice.approach) return;
    starInterest.active = true;
    // 待機中なら、気づいた様子でほどなく歩き出す(すぐには動かない)
    if (wander.waiting) wander.waitTimer = Math.min(wander.waitTimer, 0.8 + Math.random() * 1.8);
  }

  const fallingStars = createFallingStarSystem({
    scene,
    terrainHeightAt,
    snowDepth: snowNow, // v1.56-H4: 雪が積もっている間、星は雪面の上に落ちて、少し埋まった高さに浮かぶ
    testMode: starTest,
    pickLandingSpot: (px, pz) => pickStarLandingSpot({
      rng: Math.random,
      playableRadius: PLAYABLE_RADIUS,
      player: { x: px, z: pz },
      obstacles: collisionObstacles, // 木・岩・テント・焚き火・かまくら(既存の衝突円をそのまま使う)
      riverInfo: (x, z) => distanceToRiver(x, z, riverSamplesForAvoid),
      waterEdge: getWaterEdgeDistance,
      heightAt: terrainHeightAt,
      climbBump: getClimbBump,
      extraReject: (x, z) => Math.hypot(x - campX, z - campZ) < iglooOuterRadiusPlanned + 4,
    }),
    hooks: {
      onFallStart() {
        const b = starBells();
        if (b) b.playFall(FALLING_STAR.fallDurationSec);
      },
      onLanded() {
        const b = starBells();
        if (b) b.playLand();
        rollSnowmanStarReaction();
      },
      onRing() {
        const b = starBells();
        if (b) b.playRing();
      },
      onCollected() {
        inventory.add('star', 1); // ホットバー優先で、空いている枠へ入る
        starNotice.pending = false;
        starInterest.active = false;
        const b = starBells();
        if (b) b.playCollect();
      },
      onTaken() { // 見守りの雪だるまが拾った(ポーチへ入れるのは、拾う側)
        const b = starBells();
        if (b) b.playCollect();
      },
      onExpired() {
        starNotice.pending = false;
        starInterest.active = false;
      },
    },
  });

  // ================================================================
  // v1.69: 月の石。星と同じ仕組み(falling-star.js)で、ずっと珍しく降ってくる。三日月の形で、淡い青白く光る。
  //   星が「重力」を与えるのに対し、月の石は「反重力」。月のかけら(月の石から作る)を組んだ物に貼ると、その物が少し宙に浮く。
  //   地形に埋まっている月の石もある(シードで場所が決まり、拾われるまで残る)。
  //   拾うのは歩行中の自分だけ(見守りの雪だるまは、まだ拾わない)。
  // ================================================================
  const moonStones = createFallingStarSystem({
    scene,
    terrainHeightAt,
    snowDepth: snowNow,
    testMode: starTest,
    config: MOON_STONE,
    kit: { createGeometry: createCrescentGeometry, colors: MOON_STONE.colors, glowStops: MOON_STONE.glowStops },
    pickLandingSpot: (px, pz) => pickStarLandingSpot({
      rng: Math.random, playableRadius: PLAYABLE_RADIUS, player: { x: px, z: pz },
      obstacles: collisionObstacles, riverInfo: (x, z) => distanceToRiver(x, z, riverSamplesForAvoid), waterEdge: getWaterEdgeDistance,
      heightAt: terrainHeightAt, climbBump: getClimbBump,
      extraReject: (x, z) => Math.hypot(x - campX, z - campZ) < iglooOuterRadiusPlanned + 4,
    }),
    hooks: {
      onCollected(info) { inventory.add('moon_stone', 1); debugLog.log('moon.collected', { id: info && info.id }); }, // ホットバー優先で、空いている枠へ入る
      onFallStart(info) { debugLog.log('moon.fall', { id: info && info.id }); },
      onLanded(info) { debugLog.log('moon.landed', { id: info && info.id }); },
      onExpired(info) { debugLog.log('moon.expired', { id: info && info.id }); },
    },
  });
  // 地形に埋まっている月の石(ワールドのシードで場所が決まる)
  const moonBuried = [];
  {
    const mrng = makeRng(((worldGen ? deriveSeed(worldGen.seed, 'moonstones') : 31337) ^ 0x4d6f6f6e) >>> 0 || 1);
    for (let k = 0; k < MOON_STONE.buriedCount; k++) {
      const spot = pickStarLandingSpot({
        rng: mrng, playableRadius: PLAYABLE_RADIUS, player: { x: campX, z: campZ },
        obstacles: collisionObstacles, riverInfo: (x, z) => distanceToRiver(x, z, riverSamplesForAvoid), waterEdge: getWaterEdgeDistance,
        heightAt: terrainHeightAt, climbBump: getClimbBump,
        extraReject: (x, z) => Math.hypot(x - campX, z - campZ) < iglooOuterRadiusPlanned + 4 || moonBuried.some((m) => Math.hypot(m.x - x, m.z - z) < 14),
      });
      if (spot) moonBuried.push({ x: spot.x, z: spot.z, id: moonStones.plantBuried(spot.x, spot.z) });
    }
  }


  // ================================================================
  // v1.54 E3: 見守りの雪だるまが拾える物(汎用の登録簿)とポーチ
  // ================================================================
  // 世界の物を種類ごとの特別なAIで扱わず、collectibles.js のデータと提供元で扱う。
  // 新しい物(カセット・缶など)は、COLLECTIBLE_KINDS に1件と、ここに提供元を足すだけで拾えるようになる。
  function removeLogFromWorld(l) {
    l.collected = true; l.mesh.visible = false;
    logObstacles.remove(l); logAvoidObstacles.remove(l); logSystem.remove(l);
    const i = fallenLogs.indexOf(l); if (i >= 0) fallenLogs.splice(i, 1);
    scene.remove(l.mesh);
  }
  const collectRegistry = createCollectibleRegistry({ kinds: COLLECTIBLE_KINDS });
  const pouch = createPouch({ inventory, capacity: SNOWMAN_COLLECT.pouchCapacity }); // 持ち物の入れ物は既存のインベントリ。ここは拾った数の帳簿
  collectRegistry.registerProvider('star', {
    list: (x, z, r) => fallingStars.getLanded().filter((st) => Math.hypot(st.spotX - x, st.spotZ - z) <= r).map((st) => ({ id: st.id, x: st.spotX, z: st.spotZ, y: st.y })),
    take: (cand) => fallingStars.take(cand.id),
  });
  collectRegistry.registerProvider('twig', {
    list: (x, z, r) => {
      const out = []; const types = COLLECTIBLE_KINDS.twig.woodTypes;
      for (let i = 0; i < fallenLogs.length; i++) {
        const l = fallenLogs[i];
        if (l.collected || !types.includes(l.type) || !(l.physics && l.physics.physicsState === 'static') || shardSystem.isLocked(l)) continue; // v1.69: 据え付けた倒木は拾わない
        const lx = l.mesh.position.x, lz = l.mesh.position.z;
        if (Math.hypot(lx - x, lz - z) <= r) out.push({ id: l.mesh.uuid, x: lx, z: lz, ref: l });
      }
      return out;
    },
    take: (cand) => { const l = cand.ref; if (!l || l.collected) return false; removeLogFromWorld(l); return true; },
  });

  // ================================================================
  // v1.55 E5: 人の痕跡(カセット・空き缶・色鉛筆・小さなおもちゃ・大きな機械)。説明はしない。
  // 世界のシードから置き場所を決める(同じ世界なら同じ場所)。土や雪に半分埋まり、傾いて、色あせている。
  // ================================================================
  const remnantSeed = (worldGen ? worldGen.seed : 12345) >>> 0;
  const campClear = Math.max(9, (typeof iglooOuterRadiusPlanned === 'number' ? iglooOuterRadiusPlanned : 4) + 5); // キャンプの近くには置かない
  const remnantPlans = planRemnants({
    seed: remnantSeed,
    forceSeason: !!options.forceHalloween, // 確認用: 期間外でもジャック・オー・ランタンを地表に出す(?halloween=1)
    radius: PLAYABLE_RADIUS * 0.92,
    trees: coniferTrees,
    riverDistance: (x, z) => { const n = nearestRiverPoint(x, z, riverSamplesForAvoid); return Math.hypot(x - n.x, z - n.z) - getWaterEdgeDistance(n.width); },
    isFree: (x, z) => {
      if (Number.isFinite(getWaterSurfaceAt(x, z, terrainHeightAt))) return false;
      if (Math.hypot(x - campX, z - campZ) < campClear) return false;
      const h = terrainHeightAt(x, z);
      if (Math.abs(terrainHeightAt(x + 1.2, z) - h) > 0.7 || Math.abs(terrainHeightAt(x, z + 1.2) - h) > 0.7) return false; // 急な斜面には置かない
      for (const o of collisionObstacles) if (Math.hypot(x - o.x, z - o.z) < o.radius + 1.2) return false;
      return true;
    },
  });
  const remnantField = createRemnantField({ scene, plans: remnantPlans, terrainHeightAt, defs: REMNANT_DEFS });
  for (const defId of Object.keys(REMNANT_DEFS)) {
    const kindId = REMNANT_DEFS[defId].kind;
    collectRegistry.registerProvider(kindId, {
      list: (x, z, r) => remnantField.list(kindId, x, z, r),
      take: (cand) => remnantField.take(cand.id),
    });
  }
  // ================================================================
  // v1.39 フェーズ1: 視線中心の「狙う」仕組み(常時表示のクロスヘアは出さない)
  // ================================================================
  const interaction = createInteractionSystem({ THREE, reach: INTERACTION.reach });
  scene.add(interaction.highlightObject);

  for (const t of coniferTrees) {
    // 木は動かないので、てっぺんの高さは登録時に1度だけ計算しておく(毎フレーム計算しない)。
    const topY = computeTreeTop(t.mesh).y;
    const midY = (topY + terrainHeightAt(t.x, t.z)) / 2;
    interaction.register({
      kind: 'conifer',
      getPosition: () => ({ x: t.x, y: midY, z: t.z }),
      radius: t.scale * 1.3,
      // 星を手に持っていて、かつ(v1.38からの)近さの条件を満たす時だけ「飾れる」。
      canInteract: () => inventory.getSelected() === 'star'
        && treeDecor.findTarget(playerSnowman.group.position.x, playerSnowman.group.position.z, 'star') === t,
      onInteract: () => { placeStarOnNearbyTree(); },
    });
  }
  // --- v1.46: 軽量物理(cannon-es)と編集(観察)モード ---
  // 世界は基本的に静的。編集モードで持ち上げて離した倒木だけが、局所的に動的になり、
  // 落ちて転がって止まったら静的に戻る。何も起きていない時は物理のコストはゼロ。
  const physics = createPhysics({ groundHeightAt: snowGroundAt }); // v1.56-H4: 雪が積もっている間、丸太は雪面に落ちる
  // v1.49: 世界の静的コライダー(木・岩・テント・焚き火)を登録。登録しただけでは物理世界に入らず、
  // 動的な丸太の近くにある間だけ入る(何も動いていない時のコストはゼロのまま)。
  for (const c of worldColliders) physics.addStaticCollider(c);
  const igloo = { id: 'igloo', kind: 'cylinder', x: campX, z: campZ, y: campY + iglooOuterRadius * 0.45, radius: iglooOuterRadius * 0.9, height: iglooOuterRadius * 0.9 };
  const tentCollider = worldColliders.find((c) => c.id === 'tent');
  onCampPhysicsModeChange = (isIgloo) => {
    if (isIgloo) { physics.removeStaticCollider('tent'); physics.addStaticCollider(igloo); }
    else { physics.removeStaticCollider('igloo'); physics.addStaticCollider(tentCollider); }
  };
  if (campCollisionIsIgloo) onCampPhysicsModeChange(true);
  const logSystem = createFallenLogSystem({ fallenLogs, physics, burialCandidates, groundAt: snowGroundAt, onSettled: (log) => onLogSettled(log) });
  // v1.69: 星のかけら(倒木をくっつける)・月のかけら(組んだ物を浮かせる)。貼れるのは、編集モードでつかんでいる倒木だけ。
  let shardPanelDirty = true;
  // v1.69: デバッグログ。かけら・接着・浮遊・月の石の出来事を記録して、設定画面かパネルのボタンから、JSONで書き出せる。
  const debugLog = createDebugLog({ version: APP.version });
  const shardSystem = createShardSystem({ fallenLogs, physics, logSystem, groundAt: snowGroundAt, log: debugLog.log, onChange: () => { shardPanelDirty = true; } });
  // 塊(接着した丸太)が動き出した/止まった時
  physics.on('woke', (r) => { if (r.group) debugLog.log('phys.group.woke', { leader: r.id, members: r.group.ids.length }); });
  physics.on('settled', (r) => { if (r.group && r.id === r.group.leaderId) debugLog.log('phys.group.settled', { leader: r.id, members: r.group.ids.length, y: +r.position.y.toFixed(3), reason: r.settleReason || '' }); });
  // ================================================================
  // v1.56-H4: 倒木と積雪。
  //  ・隠れる条件: 雪の深さが「丸太の上面の、その場所の地面からの高さ」を超えた時(川にかけた丸太は河床から高い所にあるので、
  //    その位置のまま計算する=雪が深くならないと消えない)
  //  ・雪に埋もれた丸太も、編集モードで選べる(青い輪郭が見える)。つかむと雪面の上へ掘り出される
  //  ・雪の上に置いた丸太は、雪が溶けると、その分だけ一緒に下がって地面に着く(雪が増えても持ち上がらない)
  // ================================================================
  function burialOf(log) { return burialCandidates.find((b) => b.mesh === log.mesh) || null; }
  function refreshLogBury(log) {
    const c = burialOf(log); if (!c || !log.physics) return;
    c.log = log;
    const r = log.physics;
    c.heightM = logBuryHeight(r.position, r.quaternion, log.length, log.radius, terrainHeightAt);
  }
  function onLogSettled(log) {
    shardSystem.tryWeld(log); // v1.69: 星のかけらを持つ倒木どうしが触れて止まったら、くっつく(v1.71: 既定ではOFF。接着は接着モードで)
    refreshLogBury(log);
    const r = log.physics, sn = snowNow();
    // 雪に支えられて止まった(一番低い所が雪面にほぼ着いている)なら、雪の深さを覚える。他の丸太や岩の上に乗っている場合は覚えない
    if (sn > 0 && logMinClearance(r.position, r.quaternion, log.length, log.radius, snowGroundAt) <= 0.12) log.snowRest = sn;
    else log.snowRest = 0;
  }
  for (const log of fallenLogs) refreshLogBury(log);
  snowFollowers.push((sn) => {
    for (const log of fallenLogs) {
      if (log.collected || !log.snowRest || !log.physics || log.physics.physicsState !== 'static') continue;
      if (shardSystem.isLocked(log)) continue; // v1.69: 接着した塊・浮いている物は、雪が溶けても、位置を変えない(剛体の相対姿勢を保つ)
      if (sn >= log.snowRest - 0.003) continue; // 雪が増えた/変わらない: 丸太は動かない(増えたら埋もれる)
      log.physics.position.y -= log.snowRest - sn; // 雪が溶けた分だけ、一緒に下がる
      log.snowRest = sn;
      logSystem.syncPose(log);
      refreshLogBury(log);
    }
  });
  // ================================================================
  // v1.56-H3: 丸太の音。物理の衝突通知(相手・強さ・位置)を、sfx.jsの音に変える。
  //  ・相手: 地面/丸太/岩・焚き火/立ち木の幹/テント・かまくら/チェスト で音色が変わる
  //  ・丸太の大きさ(長さと太さ)で、音の高さと響きの長さが変わる(大きい=低く長い、小さい=高く短い)
  //  ・離したのに衝突の通知が無かった時(ごく低い所から置いた時など)は、そっと置いた音を補う
  //  ・川に落ちた時(水面を下へ越えた瞬間)は、ドボン+しぶき+泡。水中の川底への当たりは鳴らさない
  // ================================================================
  const logById = (id) => fallenLogs.find((l) => l.physicsId === id) || null;
  function colliderSurface(cid) {
    const id = String(cid || '');
    if (id.startsWith('tree')) return 'tree';
    if (id.startsWith('chest')) return 'chest';
    if (id === 'tent' || id === 'igloo') return 'tent';
    return 'rock'; // 岩・焚き火の石
  }
  const pendingLogPlace = new Map(); // physicsId -> 離した時刻
  const logWasInWater = new Map();   // physicsId -> 水に入っているか(前フレーム)
  physics.on('released', (rec) => { pendingLogPlace.set(rec.id, clock.elapsedTime); });
  physics.on('held', (rec) => { pendingLogPlace.delete(rec.id); logWasInWater.delete(rec.id); });
  physics.on('impact', (ev) => {
    pendingLogPlace.delete(ev.id);
    const s = sfx(); if (!s) return;
    const log = logById(ev.id); if (!log) return;
    if (Number.isFinite(dryWaterSurfaceAt(ev.position.x, ev.position.z))) return; // 水の中の川底への当たり(着水の音で足りる)
    const surface = ev.surface === 'collider' ? colliderSurface(ev.colliderId) : ev.surface;
    const other = ev.otherId ? logById(ev.otherId) : null;
    s.logImpact({
      surface, speed: ev.speed, length: log.length, radius: log.radius,
      otherLength: other ? other.length : undefined, otherRadius: other ? other.radius : undefined,
    }, sfxRelative(ev.position.x, ev.position.y, ev.position.z));
  });
  function updateLogSounds() {
    const s = sfx();
    if (physics.isIdle() && !pendingLogPlace.size) { if (logWasInWater.size) logWasInWater.clear(); return; }
    for (const rec of physics.all()) {
      if (rec.physicsState !== 'dynamic') { logWasInWater.delete(rec.id); continue; }
      const log = logById(rec.id); if (!log) continue;
      const surfY = dryWaterSurfaceAt(rec.position.x, rec.position.z);
      const nowIn = Number.isFinite(surfY) && (rec.position.y - (log.radius || 0.15)) <= surfY;
      const prev = logWasInWater.get(rec.id);
      logWasInWater.set(rec.id, nowIn);
      if (prev === false && nowIn && s) { // 水面を下へ越えた瞬間 = 着水
        const v = physics.velocityOf(rec.id);
        const speed = v ? Math.hypot(v.x, v.y, v.z) : 1;
        s.logSplash({ speed, length: log.length, radius: log.radius }, sfxRelative(rec.position.x, surfY, rec.position.z));
      }
    }
    for (const [id, t0] of [...pendingLogPlace]) {
      if (clock.elapsedTime - t0 < 0.4) continue;
      const v = physics.velocityOf(id);
      if (v && Math.hypot(v.x, v.y, v.z) > 1.2) continue; // まだ落下中(高い所から落とした)。着地の衝突を待つ
      pendingLogPlace.delete(id);
      const log = logById(id); const rec = physics.get(id);
      if (!s || !log || !rec || Number.isFinite(dryWaterSurfaceAt(rec.position.x, rec.position.z))) continue;
      s.logPlace({ length: log.length, radius: log.radius }, sfxRelative(rec.position.x, rec.position.y - (log.radius || 0.15), rec.position.z));
    }
  }
  // v1.51: 倒木を雪だるまの障害物にする(幹に沿った円の列)。静止した丸太だけ。小枝は上を歩ける。
  // v1.53 Phase E2: 通行(Traversal)の層。「その面に物理的に届くか」だけで、歩く/ジャンプ/引き上げ/届かないを決める。
  // 丸太に「橋」などの属性は無い。川の上でも、足元を丸太の表面が支えていれば歩ける(支えが無ければ水に入れない)。
  const traversal = createTraversal({
    baseGroundAt: (x, z) => terrainHeightAt(x, z) + weather.getSnowDepth(),
    getLogs: () => fallenLogs.filter((l) => !l.collected && l.physics && l.physics.physicsState === 'static'),
    bumps: climbableBumps, // 小さな岩の盛り上がりも、同じ面の問い合わせで扱う
    waterSurfaceAt: dryWaterSurfaceAt, // river.jsの既存関数を再利用(二つ目の境界は作らない)。v1.56-H4: 雪が水面まで積もって川を覆った所は水ではなく地面として歩ける
    walkOverFn: isWalkOver,
    collision: playerSnowman.collision,
  });
  walk.setTraversalHooks({
    supportAt: (x, z, feetY, airborne) => traversal.supportAt(x, z, feetY, airborne),
    findClimb: (x, z, feetY, dx, dz) => traversal.findClimb(x, z, feetY, dx, dz),
    describeAhead: (x, z, feetY, dx, dz, maxDist) => traversal.describeAhead(x, z, feetY, dx, dz, maxDist), // v1.54: 自動の跳ぶ/よじ登る補助
  });
  const nonWalkVertical = createVerticalState(); // 見守り・未操作時の足元の乗り降り(ジャンプ・落下・引き上げも使う)
  const aiClimb = createClimbController();
  const traversalFailures = createTraversalFailureMemory(); // 失敗した足がかりを一定時間覚えて、同じ不可能な試みを繰り返さない
  let prevSnowX = null, prevSnowZ = null; // 水の境界のため、前フレームの安全な位置
  // 物理的な押し出し(collisionObstacles)に入れるのは、ほぼ立っている丸太だけ(面として扱えないため)。
  const logObstacles = createLogObstacleManager(collisionObstacles, (log) => traversal.isSteepLog(log));
  const logAvoidObstacles = createLogObstacleManager(avoidLogCircles, (log) => !traversal.isSteepLog(log) && traversal.needsAction(log));
  function syncLogObstacles() { for (const log of fallenLogs) { logObstacles.sync(log); logAvoidObstacles.sync(log); } }
  syncLogObstacles();
  // ================================================================
  // v1.69: かけらの持ち物。編集モードでは、持ち物(ホットバー・リュック)とチェストの中身を、まとめて使える。
  //   数は両方の合計。使う時は、持ち物から先に、足りなければチェストから取る。
  // ================================================================
  const poolCount = (id) => inventory.count(id) + chest.storage.count(id);
  function poolTake(id, n = 1) {
    if (poolCount(id) < n) return false;
    let left = n;
    const fromInv = Math.min(left, inventory.count(id));
    if (fromInv > 0 && inventory.remove(id, fromInv)) left -= fromInv;
    if (left > 0) left -= chest.storage.take(id, left);
    return left === 0;
  }
  /** v1.71: 1つ、入れ物(持ち物→チェスト)へ戻す。入りきらなければ false。 */
  function poolGive(id) {
    if (inventory.canAdd(id, 1)) { inventory.add(id, 1); return true; }
    return chest.storage.store(id, 1) > 0;
  }
  /** 星→星のかけら、月の石→月のかけら。入れ物(持ち物→チェスト)に入りきらなければ、元に戻す。 */
  function craftShardsFromPool(kind) {
    const recipe = getRecipe(kind === 'moon' ? 'moon_to_shards' : 'star_to_shards');
    if (!recipe || !poolTake(recipe.input.id, recipe.input.count)) { debugLog.log('craft', { kind, ok: false, reason: 'no-material' }); return false; }
    let left = recipe.output.count;
    while (left > 0 && inventory.canAdd(recipe.output.id, 1)) { inventory.add(recipe.output.id, 1); left -= 1; }
    if (left > 0) left -= chest.storage.store(recipe.output.id, left);
    if (left > 0) { // 入りきらない: できたぶんを戻して、材料も戻す(何も起きなかったことにする)
      debugLog.log('craft', { kind, ok: false, reason: 'storage-full' });
      const made = recipe.output.count - left;
      poolTake(recipe.output.id, made);
      if (!inventory.add(recipe.input.id, recipe.input.count)) chest.storage.store(recipe.input.id, recipe.input.count);
      return false;
    }
    shardPanelDirty = true;
    debugLog.log('craft', { kind, ok: true, pool: { star: poolCount('star'), starShard: poolCount('star_shard'), moonStone: poolCount('moon_stone'), moonShard: poolCount('moon_shard') } });
    return true;
  }
  /** v1.74: 星の松明を作る(枝1+星のかけら1。持ち物→チェストの順に取る)。できなければ、何も変えずに false。 */
  function craftStarTorchFromPool() {
    const recipe = getRecipe('star_torch');
    const inputs = recipe ? recipeInputs(recipe) : [];
    if (!recipe || !inputs.every((i) => poolCount(i.id) >= i.count)) { debugLog.log('craft', { kind: 'star_torch', ok: false, reason: 'no-material' }); return false; }
    for (const i of inputs) poolTake(i.id, i.count);
    const giveBack = () => { for (const i of inputs) for (let n = 0; n < i.count; n++) poolGive(i.id); };
    let made = 0;
    for (let n = 0; n < recipe.output.count; n++) { if (poolGive(recipe.output.id)) made++; else break; }
    if (made < recipe.output.count) { // 入りきらない: できたぶんを戻して、材料も戻す
      if (made > 0) poolTake(recipe.output.id, made);
      giveBack();
      debugLog.log('craft', { kind: 'star_torch', ok: false, reason: 'storage-full' });
      return false;
    }
    shardPanelDirty = true;
    debugLog.log('craft', { kind: 'star_torch', ok: true, pool: { twig: poolCount('twig'), starShard: poolCount('star_shard'), starTorch: poolCount('star_torch') } });
    return true;
  }
  const heldLog = () => { const h = editMode._internals && editMode._internals.getHeld ? editMode._internals.getHeld() : null; return h || null; };
  function attachShardToHeld(kind) {
    const res = attachShardToHeldInner(kind);
    if (!res.ok) debugLog.log('shard.attach.denied', { kind, reason: res.reason });
    return res;
  }
  function attachShardToHeldInner(kind) {
    const log = heldLog();
    if (!log) return { ok: false, reason: 'not-held' };
    if (kind === 'moon') {
      if (!shardSystem.canAttachMoon(log)) return { ok: false, reason: 'structure-has-moon' };
      if (!poolTake('moon_shard', 1)) return { ok: false, reason: 'no-shard' };
      shardSystem.attachMoon(log); return { ok: true };
    }
    if (!shardSystem.canAttachStar(log)) return { ok: false, reason: 'already-has-star' };
    if (!poolTake('star_shard', 1)) return { ok: false, reason: 'no-shard' };
    shardSystem.attachStar(log); return { ok: true };
  }
  /** v1.71: つかんでいる丸太(や塊)から、星のかけら/月のかけらを外して、持ち物へ戻す。 */
  function detachShardFromHeld(kind) {
    const log = heldLog();
    if (!log) return { ok: false, reason: 'not-held' };
    if (glueTool.isActive()) return { ok: false, reason: 'glue-active' };
    const id = kind === 'moon' ? 'moon_shard' : 'star_shard';
    if (kind === 'moon' ? !shardSystem.info(log).structureHasMoon : !log.starShard) return { ok: false, reason: kind === 'moon' ? 'no-moon' : 'no-star' };
    if (!poolGive(id)) return { ok: false, reason: 'storage-full' };
    const res = kind === 'moon' ? shardSystem.removeMoon(log) : shardSystem.removeStar(log);
    if (!res.ok) { poolTake(id, 1); return res; } // 外せなかった: 戻したぶんを取り消す
    if (res.droppedHeld) editMode.forgetHeld(); // 塊をほどいたので、つかんでいる状態は終わる(物理は、外した部分を落として止める)
    debugLog.log('shard.detach.done', { kind, ...res });
    return res;
  }
  function shardPanelState() {
    const log = heldLog(), info = log ? shardSystem.info(log) : null;
    const glueState = glueTool.getState();
    return {
      glue: glueState,
      canDetachStar: !!log && !!(info && info.hasStar) && !glueState.active,
      canDetachMoon: !!log && !!(info && info.structureHasMoon) && !glueState.active,
      editing: editMode.isEnabled(),
      star: poolCount('star'), starShard: poolCount('star_shard'), moonStone: poolCount('moon_stone'), moonShard: poolCount('moon_shard'),
      twig: poolCount('twig'), starTorch: poolCount('star_torch'), canCraftStarTorch: poolCount('twig') >= 1 && poolCount('star_shard') >= 1, // v1.74
      held: !!log, heldHasStar: !!(info && info.hasStar), heldGroupSize: info ? info.groupSize : 0,
      structureHasMoon: !!(info && info.structureHasMoon),
      canAttachStar: !!log && shardSystem.canAttachStar(log) && poolCount('star_shard') > 0,
      canAttachMoon: !!log && shardSystem.canAttachMoon(log) && poolCount('moon_shard') > 0,
    };
  }
  // デバッグログの「その時点の状態」。書き出す時に1回だけ作る(毎フレームの負荷なし)。
  debugLog.setSnapshot(() => {
    const groups = [], seen = new Set();
    for (const l of fallenLogs) {
      const ids = physics.groupOf(l.physicsId);
      if (!ids || seen.has(ids[0])) continue;
      ids.forEach((id) => seen.add(id));
      groups.push({ members: ids.map((id) => { const r = physics.get(id); return { id, state: r.physicsState, y: +r.position.y.toFixed(3), len: +r.length.toFixed(2), star: !!(logSystem.logOfPhysicsId(id) || {}).starShard, moon: !!(logSystem.logOfPhysicsId(id) || {}).moonShard }; }), floating: shardSystem.floating(l) });
    }
    return {
      seed: worldGen ? worldGen.seed : null,
      editing: editMode.isEnabled(),
      panel: shardPanelState(),
      pool: { star: poolCount('star'), starShard: poolCount('star_shard'), moonStone: poolCount('moon_stone'), moonShard: poolCount('moon_shard') },
      shardCounts: shardSystem.count(),
      shardsSaved: shardSystem.serialize(),
      joints: shardSystem.joints(),
      groups,
      physics: physics.stats(),
      moon: { buried: moonBuried.map((m) => ({ id: m.id, x: +m.x.toFixed(1), z: +m.z.toFixed(1), present: moonStones.getLanded().some((s) => s.id === m.id) })), landedNow: moonStones.getLanded().length, config: { intervalSec: MOON_STONE.intervalSec, buriedCount: MOON_STONE.buriedCount } },
      hour: gameHour, weather: weather.getWeather ? weather.getWeather() : undefined,
    };
  });
  // キー: 編集モードで丸太をつかんでいる間に、F=星のかけらを貼る / M=月のかけらを貼る
  window.addEventListener('keydown', (e) => {
    if (!editMode.isEnabled() || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyF') attachShardToHeld('star');
    else if (e.code === 'KeyM') attachShardToHeld('moon');
  });

  const editMode = createEditMode({
    camera, domElement: renderer.domElement, orbitControls, scene, logSystem, terrainHeightAt: snowGroundAt, // v1.56-H4: 雪の上に置ける
    bounds: TERRAIN_SIZE / 2, // 編集者は地形の端まで見て回れる(丸太を置けるのもこの範囲)
    clampXZ: (x, z) => { const d = Math.hypot(x, z); return d > PLAYABLE_RADIUS ? { x: x * PLAYABLE_RADIUS / d, z: z * PLAYABLE_RADIUS / d } : { x, z }; },
    getFocus: () => ({ x: playerSnowman.group.position.x, y: playerSnowman.group.position.y + 0.8, z: playerSnowman.group.position.z }),
    onChange: (st) => { if (options.onEditModeChange) options.onEditModeChange(st); },
  });
  // v1.71: 接着モード。編集モードでつかんだ丸太を、位置と角度を決めて、ほかの丸太へ接着する。接着点(金色の輪)から、再編集・外すができる。
  const glueTool = createGlueTool({
    scene, domElement: renderer.domElement, editMode, logSystem, physics, shardSystem, groundAt: snowGroundAt,
    onChange: () => { shardPanelDirty = true; }, log: debugLog.log,
  });
  // v1.56-H4: 雪に埋もれて見えなくなった倒木は、編集モードの間だけ青い輪郭(雪を透かして見える)で場所を示す。
  // 狙って選べば、つかんだ瞬間に雪面の上へ掘り出される(fallen-log-system.grab)。
  const buriedGhostMat = new THREE.MeshBasicMaterial({ color: 0x9bd0ff, transparent: true, opacity: 0.4, depthTest: false, depthWrite: false });
  const buriedGhosts = new Map();
  function updateBuriedLogGhosts() {
    const on = editMode.isEnabled();
    if (!on && buriedGhosts.size === 0) return;
    for (const log of fallenLogs) {
      const hidden = on && !log.collected && !log.mesh.visible;
      let g = buriedGhosts.get(log);
      if (!hidden) { if (g && g.visible) g.visible = false; continue; }
      if (!g) {
        g = log.mesh.clone(true);
        g.traverse((o) => { if (o.isMesh) { o.material = buriedGhostMat; o.castShadow = false; o.receiveShadow = false; } o.visible = true; o.renderOrder = 996; });
        scene.add(g); buriedGhosts.set(log, g);
      }
      g.visible = true;
      g.position.copy(log.mesh.position); g.quaternion.copy(log.mesh.quaternion); g.scale.copy(log.mesh.scale);
    }
  }
  for (const log of fallenLogs) {
    // v1.48: 大きな幹・枝・小枝は拾えない(丸太として拾えるのは中・短・細い丸太だけ)。編集モードでは全て動かせる。
    if (!log.pickable) continue;
    // v1.41 フェーズ4: 倒木を拾えるようにする(枝としてポーチへ)。
    // 拾ったあとは、その倒木のオブジェクト自体をシーンから取り除く(二重に拾えないように
    // interaction登録もこの時点で外す)。
    const logId = interaction.register({
      kind: 'log',
      getPosition: () => ({ x: log.x, y: terrainHeightAt(log.x, log.z) + Math.max(0.15, log.radius * 1.5), z: log.z }),
      radius: Math.max(0.5, Math.min(1.8, log.length * 0.45)),
      canInteract: () => !log.collected && !shardSystem.isLocked(log) && inventory.canAdd('log', 1), // 持ち物が一杯なら拾えない(倒木は残る)。v1.69: かけらを持つ/接着した倒木は、世界に据え付けられた物なので拾えない
      onInteract: () => {
        if (log.collected || shardSystem.isLocked(log) || !inventory.canAdd('log', 1)) return;
        log.collected = true;
        scene.remove(log.mesh);
        interaction.unregister(logId);
        logSystem.remove(log); // 物理からも外す
        logObstacles.remove(log); logAvoidObstacles.remove(log); // v1.51: 障害物からも外す
        inventory.add('log', 1); // v1.43: 倒木1本 → 丸太×1(v1.41までの「枝」を改名)
        const gs = window.SoundEngine && window.SoundEngine.GatherSounds;
        if (audioOn && gs) {
          const px = playerSnowman.group.position.x, pz = playerSnowman.group.position.z;
          const dx = log.x - px, dz = log.z - pz;
          const localRight = dx * _right.x + dz * _right.z;
          const localForward = dx * _fwd.x + dz * _fwd.z;
          gs.setListenerRelativePosition(localRight, 0, -localForward);
          gs.playPickupBranch();
        }
      },
    });
  }
  for (const rock of rockClusters) {
    interaction.register({
      kind: 'rock',
      getPosition: () => ({ x: rock.x, y: terrainHeightAt(rock.x, rock.z) + rock.scale * 0.5, z: rock.z }),
      radius: rock.scale * 1.1,
      canInteract: () => false,
    });
  }
  // 歩行モード: 小さな物は、狙って拾える(大きな物は、狙えるだけで拾えない)
  function registerRemnantInteraction(it) {
    const kind = COLLECTIBLE_KINDS[it.kind];
    const isSmall = kind && kind.size === 'small' && kind.itemId;
    const iid = interaction.register({
      kind: 'remnant',
      getPosition: () => ({ x: it.x, y: (it.followSnow ? it.root.position.y : terrainHeightAt(it.x, it.z)) + Math.max(0.1, it.height * 0.6), z: it.z }),
      radius: Math.max(0.35, it.height * 1.3),
      canInteract: () => !it.collected && !!isSmall && inventory.canAdd(kind.itemId, 1),
      onInteract: () => {
        if (it.collected || !isSmall || !inventory.canAdd(kind.itemId, 1)) return;
        if (remnantField.take(it.id)) { inventory.add(kind.itemId, 1); interaction.unregister(iid); }
      },
    });
  }
  for (const it of remnantField.items) registerRemnantInteraction(it);
  snowFollowers.push((sn) => remnantField.updateSnow(sn)); // v1.56-H4: ジャック・オー・ランタンは雪面に乗る
  let debugRemnantSeq = 0;
  /** 確認用: ジャック・オー・ランタンを、雪だるまの近くの地面に落とす(拾える・見守りも拾う)。 */
  function debugDropLanterns(n = 3) {
    const cx = playerSnowman.group.position.x, cz = playerSnowman.group.position.z, yaw = playerSnowman.group.rotation.y;
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = yaw + (i - (n - 1) / 2) * 0.7, r = 2.2 + (i % 2) * 0.8;
      const x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      if (Number.isFinite(getWaterSurfaceAt(x, z, terrainHeightAt))) continue;
      const it = remnantField.add({ id: `remnant-jack_o_lantern-dbg${++debugRemnantSeq}`, defId: 'jack_o_lantern', kind: 'jack_o_lantern', x, z, buried: 0.05, tilt: 0.1, yaw: Math.random() * 6.28, seed: 1 });
      if (it) { registerRemnantInteraction(it); out.push(it.id); }
    }
    return out;
  }

  // ================================================================
  // v1.56: 装備スロット(頭・胴・手・足)・ジャック・オー・ランタンの光・地面に置く
  // ================================================================
  const equipment = createEquipment();
  equipment.attachTo(inventory); // 持ち物の画面の左上に出る。持ち物と同じ操作で出し入れできる
  const lanternLights = createLanternLightPool(scene, 4); // PointLightは最大4つ(カメラに近い順。v1.74: 星の松明のために3→4)
  const LANTERN_PLACED = { intensity: 5.4, distance: 15, color: 0xffa640 }; // 焚き火(強さ3.4・範囲10)より明るい
  const LANTERN_WORN = { intensity: 4.4, distance: 12, color: 0xffa640 }; // v1.74: 光の枠は色を持ち越すので、どの光にも色を指定する
  const placedItems = []; // 地面に置かれた物 {id,itemId,x,z,mesh,iid}。見守りの雪だるまは拾わない(登録簿の提供元に入れない)
  let placedSeq = 0;
  /** 置いた物の高さ: 雪が無ければ地面の上、積もっていれば雪面の上(少し埋まる)。雪が増減すれば、雪面に追従する。 */
  function placedItemY(it) {
    const base = terrainHeightAt(it.x, it.z), sn = snowNow();
    return sn > 0 ? base + sn - it.snowSink + it.restLift : base + it.restLift;
  }
  snowFollowers.push(() => { for (const it of placedItems) it.mesh.position.y = placedItemY(it); });
  // --- v1.56-H3: 置く物どうし・置く物と世界の物が、重ならない ---
  // 通り抜けられない物の円(木・岩・テント・かまくら・焚き火・立っている倒木)に、チェストは四角い箱なので角まで含む外接円を足す。
  // すでに地面にある物(置かれた物・人の痕跡)も避ける。水の中と、遊べる範囲の外にも置かない。
  // 重なる位置を狙った時は、いちばん近い空き位置へ自動でずらす(上限内に空きが無ければ置けない=null)。
  const ITEM_PLACE_RADIUS = 0.28;
  // v1.56-H6: 地面に置いた/落ちているジャック・オー・ランタンは、雪だるまの頭と同じ大きさ(頭の半径=本体0.5×0.72=0.36m)。
  //   以前は半径0.2m(置いた物)・約0.21m(落ちている物)で、頭に被る大きさと比べて小さかった。
  const LANTERN_GROUND_RADIUS = 0.36;
  const LANTERN_REST_LIFT = LANTERN_GROUND_RADIUS * 0.86;   // 中心の高さ(平たい形なので半径の0.86倍。底が地面に着く)
  const LANTERN_SNOW_SINK = LANTERN_REST_LIFT - 0.09;        // 雪面に置いた時は、中心が雪面の+0.09m(底の約7割が雪に埋まる)
  const placeRadiusOf = (itemId) => (itemId === 'jack_o_lantern' ? LANTERN_GROUND_RADIUS + 0.06 : itemId === 'star_torch' ? STAR_TORCH.footprint : ITEM_PLACE_RADIUS); // 重なり判定の円の大きさ
  function placementObstacles() { return collisionObstacles.concat([{ x: chestX, z: chestZ, radius: chest.radius }]); }
  function placedFootprints() {
    const out = placedItems.map((it) => ({ x: it.x, z: it.z, radius: placeRadiusOf(it.itemId) }));
    for (const it of remnantField.items) if (!it.collected) out.push({ x: it.x, z: it.z, radius: it.kind === 'jack_o_lantern' ? placeRadiusOf('jack_o_lantern') : 0.25 });
    return out;
  }
  function resolvePlacement(x, z, radius = ITEM_PLACE_RADIUS) {
    return findFreePlacement({
      x, z, radius,
      obstacles: placementObstacles(), placed: placedFootprints(),
      isBlocked: (px, pz) => Number.isFinite(dryWaterSurfaceAt(px, pz)) || Math.hypot(px, pz) > PLAYABLE_RADIUS, // v1.56-H4: 雪が川を覆っていれば、その上にも置ける
    });
  }
  function addPlacedItem(itemId, x, z, yaw = 0, opts = {}) {
    if (!opts.exact) { const spot = resolvePlacement(x, z, placeRadiusOf(itemId)); if (!spot) return null; x = spot.x; z = spot.z; }
    let mesh;
    // v1.56-H4: restLift=地面に置いた時の高さ、snowSink=雪面に置いた時に雪へ埋まる量。雪が積もっていれば雪面の上に乗る(少し埋まる)
    const isLantern = itemId === 'jack_o_lantern';
    const restLift = isLantern ? LANTERN_REST_LIFT : 0.01, snowSink = isLantern ? LANTERN_SNOW_SINK : 0.07;
    if (isLantern) { mesh = createJackOLanternMesh(LANTERN_GROUND_RADIUS); mesh.position.set(x, terrainHeightAt(x, z) + LANTERN_REST_LIFT, z); mesh.rotation.y = yaw; }
    else if (itemId === 'star_torch') { mesh = createStarTorchMesh(); mesh.position.set(x, terrainHeightAt(x, z) + 0.01, z); mesh.rotation.y = yaw; } // v1.74: 地面に真っすぐ立てる
    else {
      const held = buildHeldItem(itemId); if (!held) return null;
      mesh = new THREE.Group(); held.scale.setScalar(1.6); mesh.add(held); mesh.position.set(x, terrainHeightAt(x, z) + 0.01, z); mesh.rotation.y = yaw;
    }
    scene.add(mesh);
    const it = { id: `placed-${++placedSeq}`, itemId, x, z, mesh, iid: null, restLift, snowSink };
    mesh.position.y = placedItemY(it);
    it.iid = interaction.register({
      kind: 'placed',
      getPosition: () => ({ x: it.x, y: it.mesh.position.y + (it.itemId === 'star_torch' ? 0.6 : 0.2), z: it.z }), // v1.74: 松明は背が高いので、少し上を狙える
      radius: 0.45,
      canInteract: () => inventory.canAdd(it.itemId, 1),
      onInteract: () => {
        if (!inventory.canAdd(it.itemId, 1)) return;
        const s = sfx(); if (s) s.itemPickup(it.itemId, sfxRelative(it.x, terrainHeightAt(it.x, it.z) + 0.2, it.z));
        removePlacedItem(it); inventory.add(it.itemId, 1);
      },
    });
    placedItems.push(it);
    if (!opts.silent) { const s = sfx(); if (s) s.itemPlace(itemId, sfxRelative(x, terrainHeightAt(x, z) + 0.1, z)); }
    return it;
  }
  function removePlacedItem(it) {
    const i = placedItems.indexOf(it); if (i >= 0) placedItems.splice(i, 1);
    interaction.unregister(it.iid); scene.remove(it.mesh);
  }
  /** 手に持っている物を1個、足元の前に置く。置けたら置いた物の情報、置けなければnull。 */
  const _aimDir = new THREE.Vector3();
  /** 画面の中心(視線)の先で、最初に地面にぶつかる点。届く範囲(雪だるまから5m以内)になければnull。 */
  function aimGroundPoint() {
    camera.getWorldDirection(_aimDir);
    const o = camera.position;
    for (let t = 0.4; t <= 14; t += 0.1) {
      const x = o.x + _aimDir.x * t, y = o.y + _aimDir.y * t, z = o.z + _aimDir.z * t;
      if (y <= terrainHeightAt(x, z) + weather.getSnowDepth()) {
        const d = Math.hypot(x - playerSnowman.group.position.x, z - playerSnowman.group.position.z);
        return d <= 5 && d >= 0.6 ? { x, z } : null;
      }
    }
    return null;
  }
  /** aim=true(右クリック)なら、狙った地面に置く(マイクラのように)。狙えなければ、足元の前に置く。 */
  function placeHeldItem(aim = false) {
    if (emoteBrain.isBusy() || emoteState.wheelOpen) return null; // v1.73
    const id = inventory.getSelected();
    const def = id && getItemDef(id);
    if (!def || def.category === 'placeable' || !buildHeldItem(id)) return null;
    const yaw = playerSnowman.group.rotation.y;
    const target = aim ? aimGroundPoint() : null;
    const px = target ? target.x : playerSnowman.group.position.x + Math.sin(yaw) * 1.1;
    const pz = target ? target.z : playerSnowman.group.position.z + Math.cos(yaw) * 1.1;
    const spot = resolvePlacement(px, pz, placeRadiusOf(id)); // 水の中・遊べる範囲の外には置かない。重なるなら、いちばん近い空き位置へずらす
    if (!spot) return null;
    if (!inventory.remove(id, 1)) return null;
    return addPlacedItem(id, spot.x, spot.z, yaw, { exact: true });
  }
  const lanternEmitters = [];
  function updateLanterns(delta) {
    // 頭の装備を雪だるまの見た目へ
    const head = equipment.get('head');
    playerSnowman.setHeadCover(head === 'jack_o_lantern' ? 'jack_o_lantern' : null);
    lanternEmitters.length = 0;
    for (const it of remnantField.items) if (!it.collected && it.kind === 'jack_o_lantern') lanternEmitters.push({ x: it.x, y: it.root.position.y + it.height * 0.75, z: it.z, ...LANTERN_PLACED });
    for (const it of placedItems) if (it.itemId === 'jack_o_lantern') lanternEmitters.push({ x: it.x, y: it.mesh.position.y + LANTERN_GROUND_RADIUS * 1.15, z: it.z, ...LANTERN_PLACED });
    // v1.74: 星の松明(焚き火と同じくらいの光)。置いた数が多い時は、カメラに近い順に光の枠(4つ)を使う。光の玉・星くずの見た目は、全部に出る
    for (const it of placedItems) {
      if (it.itemId !== 'star_torch') continue;
      tickStarTorch(it.mesh, clock.elapsedTime);
      lanternEmitters.push({ x: it.x, y: it.mesh.position.y + STAR_TORCH.height + 0.1, z: it.z, intensity: STAR_TORCH.intensity, distance: STAR_TORCH.distance, color: STAR_TORCH.color });
    }
    if (head === 'jack_o_lantern') { playerSnowman.headGroup.getWorldPosition(_lanternHeadPos); lanternEmitters.push({ x: _lanternHeadPos.x, y: _lanternHeadPos.y, z: _lanternHeadPos.z, ...LANTERN_WORN }); }
    lanternLights.update(lanternEmitters, camera.position.x, camera.position.y, camera.position.z, clock.elapsedTime);
  }
  const _lanternHeadPos = new THREE.Vector3();
  // チェストの画面(歩行モード): 持ち物の画面に、チェストのスロットを足して開く。閉じるとふたも閉じる。
  function openChestUi() { chest.open(); chestAutoCloseAt = 0; inventory.attachArea('chest', chest.storage.slots); }
  function closeChestUi() { if (inventory.hasArea('chest')) { inventory.detachArea('chest'); chest.close(); } }

  // --- v1.54: 歩行モードで、プレイヤーがチェストを使う(手に持っている物を1個しまう。手ぶらなら中身を1個取り出す) ---
  // ふたは開けて、少し経つと自動で閉じる。見守りの雪だるまがしまっている最中は、ふたに触らない。
  let chestAutoCloseAt = 0;
  function playerUseChest() {
    if (options.onChestUi) { options.onChestUi(); return { action: 'ui' }; } // 画面があれば、持ち物のようにチェストの中身を見て移し替える
    chest.open(); chestAutoCloseAt = clock.elapsedTime + 1.8;
    const sel = inventory.getSelected();
    if (sel && inventory.count(sel) > 0) {
      if (chest.storage.store(sel, 1) > 0) inventory.remove(sel, 1); // しまえた分だけ持ち物から減る(満杯なら何も起きない)
      return { action: 'store', itemId: sel };
    }
    for (const id of Object.keys(chest.storage.contents())) {
      if (inventory.canAdd(id, 1) && chest.storage.take(id, 1) > 0) { inventory.add(id, 1); return { action: 'take', itemId: id }; }
    }
    return { action: 'none' };
  }
  interaction.register({
    kind: 'chest',
    getPosition: () => ({ x: chestX, y: chest.group.position.y - chestGroundOffset + 0.35, z: chestZ }),
    radius: chest.radius * 1.1,
    canInteract: () => true,
    onInteract: () => { playerUseChest(); },
  });
  interaction.register({
    kind: 'star',
    enabled: () => fallingStars.isLanded(),
    getPosition: () => {
      const st = fallingStars.getActive();
      return st ? { x: st.spotX, y: st.y, z: st.spotZ } : { x: 0, y: -9999, z: 0 };
    },
    radius: FALLING_STAR.groundRadius * 1.4,
    canInteract: () => false, // 今はまだ近づくだけで自動回収する(フェーズ4で手に取る動作に変える)
  });

  // --- v1.39: ホットバーで選んだ物を(空いている方の)手に持たせる ---
  let heldType = null;
  let heldMeshBody = null, heldMeshHands = null;
  function syncHeldItem() {
    const sel = inventory.getSelected(); // 右手 = 選択中のホットバーの中身(視点によらず固定)
    if (sel === heldType) return;
    heldType = sel;
    if (heldMeshBody) { playerSnowman.itemSocket.remove(heldMeshBody); heldMeshBody = null; }
    if (heldMeshHands) { firstPersonHands.itemSocket.remove(heldMeshHands); heldMeshHands = null; }
    if (sel) {
      heldMeshBody = buildHeldItem(sel);
      heldMeshHands = buildHeldItem(sel);
      if (heldMeshBody) playerSnowman.itemSocket.add(heldMeshBody);
      if (heldMeshHands) firstPersonHands.itemSocket.add(heldMeshHands);
    }
  }
  inventory.onChange(syncHeldItem);
  syncHeldItem();

  /** ポーチの星を、いま近くにある針葉樹へ飾る。結果 {ok, reason} を返す。 */
  function placeStarOnNearbyTree() {
    if (inventory.count('star') < 1) return { ok: false, reason: 'empty' };
    const x = playerSnowman.group.position.x, z = playerSnowman.group.position.z;
    const tree = treeDecor.findTarget(x, z, 'star');
    if (!tree) return { ok: false, reason: 'no-tree' };
    if (!treeDecor.place(tree, 'star')) return { ok: false, reason: 'failed' };
    inventory.remove('star', 1);
    return { ok: true };
  }
  function canPlaceStarHere() {
    if (inventory.count('star') < 1) return false;
    return !!treeDecor.findTarget(playerSnowman.group.position.x, playerSnowman.group.position.z, 'star');
  }
  function setInventoryOpen(open) {
    inventoryOpen = !!open && mode === 'walk';
    walk.setFrozen(inventoryOpen);
    if (inventoryOpen) walk.releasePointerForUi(); // マウスでスロットを操作できるようにする(歩行モードは抜けない)
    else { inventory.returnCursor(); walk.endUiRelease(mode === 'walk'); } // 閉じる時、持ち上げ中のスタックを戻し、視点操作を取り戻す
    return inventoryOpen;
  }
  let inventoryOpen = false;

  const clock = new THREE.Clock();
  let running = true;

  // --- FPS/デバッグ計測 ---
  // 「歩行速度が遅くなった気がする」という申告に対して数値で確認できる
  // ように、FPS・フレーム時間・描画統計・カメラ座標などを一定間隔で
  // options.onDebugUpdate へ渡す(毎フレームDOM更新すると逆に重くなる
  // ため、約4回/秒に間引く)。歩行速度自体はdelta(実時間)に基づいて
  // 計算しているのでFPSの変化とは本来独立のはずだが、その確認のために
  // deltaの実測値(frameMs)も一緒に出す。
  let debugFrameCount = 0;
  let debugAccumTime = 0;
  let debugFps = 0;
  let debugFrameMs = 0;
  const DEBUG_UPDATE_INTERVAL = 0.25; // 秒

  // ================================================================
  // v1.73: 座る・寝る(エモート)
  //   見守りモード: 立っている時間が長く続いたあと、ときどき勝手に座る → ぼーっと → あくび → 仰向けで寝る(寝返り) → 起きて座る → 立つ。
  //   歩行モード: Bキーのホイールから「座る/寝る/立つ」。座っている間は歩けず、歩こうとすると(寝ていたら座ってから)立つ。
  //   状態の流れは emote-brain.js、見た目は snowman.js の setEmote()。ここは、場所の確認・移動の止め方・カメラの高さをつなぐ。
  // ================================================================
  const emoteState = { wheelOpen: false, spotT: 99, spotOk: true, canLie: true };
  /** 座る/仰向けになるための場所が空いているか。前(足を投げ出す)と、寝る時は後ろ(体と頭)に、水・木・岩・倒木・急な段差が無いこと。 */
  function emoteSpotFree(px, pz, heading, needBack) {
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const probes = needBack ? [[0.95, 0.4], [-0.9, 0.45], [-1.55, 0.45], [-2.2, 0.45]] : [[0.95, 0.4]];
    const h0 = terrainHeightAt(px, pz);
    for (const [d, r] of probes) {
      const x = px + fx * d, z = pz + fz * d;
      if (Math.hypot(x, z) > PLAYABLE_RADIUS + 2) return false;
      if (traversal.isWaterBlocked(x, z, null)) return false;
      const rc = resolveCollisions(x, z, r);
      if (Math.hypot(rc.x - x, rc.z - z) > 0.04) return false;
      if (Math.abs(terrainHeightAt(x, z) - h0) > 0.7) return false;
      if (getClimbBump(x, z) > 0.12) return false;
    }
    return true;
  }
  function updateEmote(delta) {
    const g = playerSnowman.group;
    const px = g.position.x, pz = g.position.z, hd = g.rotation.y;
    const autoAllowed = wanderActive && !editMode.isEnabled();
    // 場所の確認: 座っている間と、座りたくなった時だけ、0.4秒ごとに
    emoteState.spotT += delta;
    if (emoteState.spotT > 0.4 && (emoteBrain.isBusy() || (autoAllowed && emoteBrain.wantsAutoRest()))) {
      emoteState.spotT = 0;
      emoteState.spotOk = emoteSpotFree(px, pz, hd, false);
      emoteState.canLie = emoteSpotFree(px, pz, hd, true);
    }
    const calm = autoAllowed && wander.waiting && !wander.collectTask && !wander.baseTask && !wander.hop && !wander.hurdle
      && !aiClimb.active && nonWalkVertical.grounded && emoteState.spotOk && !wander.turningAway;
    emoteBrain.update(delta, {
      autoAllowed, calm,
      isNight: getTimeOfDay(gameHour) === 'night',
      canLie: emoteState.canLie,
      interrupt: autoAllowed && starInterest.active, // 星に向かうと決めたら、起きて出かける
    });
    if (mode === 'walk') {
      // 歩行モード: 座っている間・ホイールを開いている間は、歩けない。歩こうとしたら立つ(寝ていたら、起きて座ってから)
      walk.setFrozen(inventoryOpen || emoteState.wheelOpen || emoteBrain.isBusy());
      if (emoteBrain.isBusy() && !emoteState.wheelOpen && !inventoryOpen && walk.hasMoveInput()) emoteBrain.request('stand');
    }
  }
  function setEmoteWheelOpen(open) {
    const want = !!open && mode === 'walk' && !inventoryOpen;
    if (want === emoteState.wheelOpen) return emoteState.wheelOpen;
    emoteState.wheelOpen = want;
    if (want) walk.releasePointerForUi(); // マウスでえらべるように(歩行モードは抜けない)
    else walk.endUiRelease(mode === 'walk'); // 閉じる時、視点操作を取り戻す
    return want;
  }

  function renderFrame() {
    const delta = clock.getDelta();
    const t = clock.getElapsedTime();

    // --- プレイヤー/雪だるまの移動とカメラ配置 ---
    // (river音・天候・影の追従などcamera.positionに依存する処理より前に
    //  済ませておく必要があるため、renderFrame()の最初に行う)
    updateEmote(delta); // v1.73: 座る・寝る(歩行・見守りの移動の前に、いまの状態を決める)
    if (mode === 'walk') {
      walk.update(delta);
    }
    if (wanderActive) {
      if (emoteBrain.isBusy()) wander.walking = false; // v1.73: 座っている・寝ている間は、見守りの移動を止める(動作・目的地はそのまま残す)
      else updateWanderAI(delta);
    }

    let snowX, snowZ, snowHeading, snowWalking;
    if (wanderActive) {
      snowX = wander.pos.x; snowZ = wander.pos.y;
      snowHeading = wander.heading; snowWalking = wander.walking;
    } else if (mode === 'walk') {
      snowX = walk.playerPos.x; snowZ = walk.playerPos.z;
      snowHeading = walk.getHeading(); // v1.58: パッド操作中は体の向き(カメラとは別)
      snowWalking = walk.isMoving();
    } else {
      // 未操作(orbit)かつ見守りモードでもない: 雪だるまはその場で待機
      snowX = playerSnowman.group.position.x; snowZ = playerSnowman.group.position.z;
      snowHeading = playerSnowman.group.rotation.y;
      snowWalking = false;
    }
    updateFootsteps(snowX, snowZ, snowWalking);

    // --- 衝突判定: 木・岩・テント・焚き火を通り抜けないようにする ---
    // (小さな岩はcollisionObstaclesに含めておらず、climbableBumpsとして
    //  足元の高さを底上げすることで「登れる」ようにしている)
    const resolved = resolveCollisions(snowX, snowZ, playerSnowman.collision.collisionRadius);
    snowX = resolved.x;
    snowZ = resolved.z;
    // v1.53 E1: 通行できる倒木は高さを考えて押し出す(乗り越えられる高さなら通す)
    const baseHere = terrainHeightAt(snowX, snowZ) + weather.getSnowDepth();
    const vState = mode === 'walk' && !wanderActive ? null : nonWalkVertical;
    const feetNow = vState ? (vState.inited ? vState.y : baseHere) : (Number.isFinite(walk.getFeetY()) ? walk.getFeetY() : baseHere);
    const feetGrounded = vState ? vState.grounded : walk.isGrounded();
    const climbingNow = vState ? aiClimb.active : walk.isClimbing();
    if (!climbingNow) {
      const logRes = traversal.resolveLogCollisions(snowX, snowZ, playerSnowman.collision.collisionRadius, feetNow, feetGrounded);
      snowX = logRes.x;
      snowZ = logRes.z;
      // ジャンプの着地: 幹の縁のすぐ外なら、そっと幹の上へ寄せる(中心線へ正確に降りなくても乗れる)
      if (!feetGrounded) {
        const vy = vState ? vState.vy : walk.getVerticalVelocity();
        const al = traversal.assistLanding(snowX, snowZ, feetNow, vy, delta);
        snowX = al.x; snowZ = al.z;
      }
    }
    // v1.53 E1: 川は硬い境界。歩行・見守り・未操作のどれでも、水に入る位置へは行かせない(ジャンプでも着水しない)
    if (prevSnowX !== null && Math.hypot(snowX - prevSnowX, snowZ - prevSnowZ) < 6) {
      // 足元の高さを渡す: 丸太などの面に支えられていれば、下が水でも歩ける(支えが無ければ入れない)
      const wg = traversal.guardWater(prevSnowX, prevSnowZ, snowX, snowZ, climbingNow ? null : feetNow);
      snowX = wg.x; snowZ = wg.z;
    }
    prevSnowX = snowX; prevSnowZ = snowZ;
    // 補正後の位置を、次フレームの移動計算の基準にも反映しておく
    // (反映しないと、壁に押し付け続けている間、毎フレーム同じ量だけ
    //  めり込み→押し戻しを繰り返してガタつく)
    if (wanderActive) {
      wander.pos.set(snowX, snowZ);
    } else if (mode === 'walk') {
      walk.playerPos.x = snowX;
      walk.playerPos.z = snowZ;
    }

    // v1.53 E1: 足元の高さ = 平らな地面 + 縦方向の状態(小さな岩・倒木の表面への乗り降り+ジャンプ)。
    // 歩行モードはwalk内のジャンプと合わせて、それ以外は乗り降りだけを滑らかに追従させる。
    if (vState) {
      if (Math.hypot(snowX - (vState.lastX ?? snowX), snowZ - (vState.lastZ ?? snowZ)) > 3) vState.snap(); // テレポートでは落ちない
      vState.lastX = snowX; vState.lastZ = snowZ;
      if (!aiClimb.active) {
        const sup = traversal.supportAt(snowX, snowZ, vState.inited ? vState.y : -Infinity, !vState.grounded);
        vState.update(delta, sup);
      }
    }
    const walkFeet = vState ? NaN : walk.getFeetY();
    const snowGroundY = vState ? vState.y : (Number.isFinite(walkFeet) ? walkFeet : baseHere);
    playerSnowman.group.position.set(snowX, snowGroundY, snowZ);
    playerSnowman.group.rotation.y = snowHeading;
    const emotePose = emoteBrain.getPose(); // v1.73
    playerSnowman.setEmote(emotePose);
    if (emotePose.lie > 0.02) {
      // 寝転ぶと、頭のほう(後ろ)へ体が伸びる。後ろの地面のほうが高ければ(斜面)、その分だけ持ち上げて、めり込まないようにする
      let top = snowGroundY;
      const snowTop = weather.getSnowDepth();
      for (const d of [0.6, 1.2, 1.8, 2.2]) top = Math.max(top, terrainHeightAt(snowX - Math.sin(snowHeading) * d, snowZ - Math.cos(snowHeading) * d) + snowTop);
      playerSnowman.group.position.y += (top - snowGroundY) * emotePose.lie;
    }
    playerSnowman.setWalking(snowWalking && !emoteBrain.isBusy());
    playerSnowman.setJumpHeight(vState ? Math.max(vState.airHeight(), aiClimb.pose) : Math.max(walk.getAirHeight(), walk.getClimbPose())); // 引き上げ中も、伸び縮みで「うんしょ」と見せる // v1.44: ジャンプの伸び縮み・帽子等の慣性の入力
    playerSnowman.update(delta, t);

    // --- v1.38: 落ちてくる星(タイマー・落下・回収)と、見守り中の雪だるまの反応 ---
    // 回収できるのは、歩行モードのプレイヤーか、見守りモードで歩いている雪だるま。
    logSystem.update(delta); // v1.46: 動いている倒木がある時だけ物理を進める(普段はコストゼロ)
    updateBuriedLogGhosts(); // v1.56-H4: 雪に埋もれた倒木の輪郭(編集モードの間だけ)
    updateLogSounds(); // v1.56-H3: 着水の検出と、そっと置いた音の補い(動いている丸太が無ければ何もしない)
    syncLogObstacles(); // v1.51: つかんだ/動いている丸太は障害物から外し、静止したら新しい位置で登録する(状態が変わった時だけ作り直す)
    editMode.update(delta);
    moonStones.update(delta, { playerX: snowX, playerZ: snowZ, canCollect: mode === 'walk' && !wanderActive, isNight: getTimeOfDay(gameHour) === 'night' }); // v1.69
    shardSystem.update(delta); // v1.69: 月のかけらを貼った物が、浮く高さで落ち着いたら静止させる
    glueTool.update(delta); // v1.71: 接着点の輪の表示・接着モードの見張り
    fallingStars.update(delta, {
      playerX: snowX, playerZ: snowZ,
      canCollect: mode === 'walk' && !wanderActive, // v1.54: 見守りの雪だるまは、近づくだけで拾わず、眺めて自分で決める(collectTask)
      isNight: getTimeOfDay(gameHour) === 'night', // 新しい星までの数えは夜のあいだだけ進む
    });
    if (chestAutoCloseAt > 0 && clock.elapsedTime > chestAutoCloseAt && !wander.baseTask) { chest.close(); chestAutoCloseAt = 0; }
    chest.update(delta, { night: getTimeOfDay(gameHour) === 'night', t: clock.elapsedTime });
    updateLanterns(delta);
    updateSnowmanStarReaction(delta);

    // --- v1.39: 視線中心の「狙う」判定(歩行モード中のみ。一人称・三人称どちらも対象) ---
    if (mode === 'walk') {
      camera.getWorldDirection(interactForwardScratch);
      interaction.update(camera.position, interactForwardScratch);
    }
    syncHeldItem();

    // --- 自動シネマティックカメラ(見守りモード中のみ) ---
    if (cinemaMode && wanderActive) {
      const flowerP = poppyField && poppyField.patchCenters.length > 0 ? poppyField.patchCenters[0] : null;
      cameraDirector.update(delta, {
        snowman: { x: snowX, y: snowGroundY, z: snowZ },
        camp: { x: campX, y: terrainHeightAt(campX, campZ), z: campZ },
        fire: { x: fireX, y: terrainHeightAt(fireX, fireZ), z: fireZ },
        flower: flowerP ? { x: flowerP.x, y: terrainHeightAt(flowerP.x, flowerP.z), z: flowerP.z } : null,
      }, camera);
    }

    if (mode === 'walk') {
      // v1.73: 座ると目線が下がり、寝転ぶと、頭のあたり(体の後ろ側)の低い位置になる
      const emPose = emoteBrain.getPose();
      const eyeH = EYE_HEIGHT * (1 - 0.5 * emPose.sit) * (1 - 0.45 * emPose.lie);
      const eyeBack = 1.0 * emPose.lie;
      const eyeX = snowX - Math.sin(snowHeading) * eyeBack, eyeY = snowGroundY + eyeH, eyeZ = snowZ - Math.cos(snowHeading) * eyeBack;
      walk.lookRig.getWorldDirection(walkLookDirScratch);
      if (cameraView === 'first') {
        camera.position.set(eyeX, eyeY, eyeZ);
        camera.quaternion.copy(walk.lookRig.quaternion);
        playerSnowman.group.visible = false;
        firstPersonHands.group.visible = emPose.sit < 0.15; // v1.73: 座ったら、手は見えない
      } else {
        // 三人称(前方・後方共通): マウスの向き(ヨー・ピッチ)にそのまま
        // 追従してカメラを軌道上に配置し、常にアンカー点(胴体よりやや上)
        // をlookAt()で見る。ピッチも含めて追従させることで、マウスの
        // 上下移動がそのまま「見上げる/見下ろす」になる。
        // v1.73: 座ると注目点が下がり、寝転ぶと、体の真ん中あたり(原点より少し後ろ)を見る
        const anchorH = THIRD_PERSON_ANCHOR_HEIGHT * (1 - 0.5 * emPose.sit) * (1 - 0.25 * emPose.lie);
        const anchorBack = 0.35 * emPose.lie;
        const orbitAnchor = bodyCenterScratch.set(snowX - Math.sin(snowHeading) * anchorBack, snowGroundY + anchorH, snowZ - Math.cos(snowHeading) * anchorBack);
        const camSign = cameraView === 'third-back' ? -1 : 1;
        const desiredDistance = cameraView === 'third-back' ? THIRD_PERSON_BACK_DISTANCE : THIRD_PERSON_FRONT_DISTANCE;
        // フェーズD: 木・岩・テント・焚き火へのめり込み回避。水平方向の
        // 単位ベクトルで判定し、めり込みが検知された分だけカメラ距離
        // (ピッチも含めた3D方向のスケール)を短縮する。
        const dirX = camSign * walkLookDirScratch.x, dirZ = camSign * walkLookDirScratch.z;
        const horizLen = Math.hypot(dirX, dirZ) || 1e-6;
        const desiredHorizDist = desiredDistance * horizLen;
        const clampedHorizDist = clampCameraDistanceForObstacles(
          orbitAnchor.x, orbitAnchor.z, dirX / horizLen, dirZ / horizLen, desiredHorizDist
        );
        const actualDistance = clampedHorizDist < desiredHorizDist
          ? desiredDistance * (clampedHorizDist / desiredHorizDist)
          : desiredDistance;
        camera.position.copy(orbitAnchor).addScaledVector(walkLookDirScratch, camSign * actualDistance);
        // 2026-09(v1.25): 以前は真下の1点の高さ(+0.3m)しか見ておらず、斜面や
        // 水面の下には対応できていなかった。共通の補正(周囲の数点+水面)を使う。
        constrainCameraPosition(camera.position);
        camera.lookAt(orbitAnchor);
        playerSnowman.group.visible = true;
        firstPersonHands.group.visible = false;
      }
      // 三人称視点でキャラクターが境界ぎりぎりにいる時、カメラだけが
      // 森の外へ飛び出さないようにする簡単な安全策。
      const camDist = Math.hypot(camera.position.x, camera.position.z);
      if (camDist > PLAYABLE_RADIUS + 6) {
        const s = (PLAYABLE_RADIUS + 6) / camDist;
        camera.position.x *= s;
        camera.position.z *= s;
      }
    } else {
      firstPersonHands.group.visible = false;
      playerSnowman.group.visible = true;
    }

    updateFire(t);
    updateGrass(t, snowX, snowZ); // v1.34: 雪だるまの位置を渡し、近くの草が踏まれて揺れるようにする
    if (poppyField) poppyField.update(t);
    if (pollinators) {
      // 「晴れた日の午前中」だけ蝶・蜂を飛ばす。
      // 2026-09: 以前は6時〜11時とかなり狭い時間帯だったため、実際に開いた
      // 時の現実時刻(デフォルトはリアルタイム同期)によっては一度も
      // 見られないことが多かった。日中の活動時間帯として6時〜18時へ広げる
      // (2026-09改訂2: 「蜂が見当たらない」との指摘を受け、6〜15時から
      // さらに広げた)。
      const isClearMorning = shouldPollinatorsBeActive({
        hour: gameHour,
        rainIntensity: weather.getRainIntensity(),
        fogAmount: weather.getSkyModifier().fogAmount,
        buriedUnderSnow: pollinatorsBuriedUnderSnow,
      });
      pollinators.setActive(isClearMorning);
      pollinators.update(t, delta);
      // 羽音の近接判定・立体音響位置の更新はupdateGameAudio()側
      // (焚き火・川と同じ、カメラの向きを考慮した相対位置計算)にまとめて
      // 行う。ここではその判定に使うフラグだけ更新する。
      isPollinatorActiveNow = isClearMorning;
    }
    updateRiver(t, camera.position); // 川面のさざ波・きらめきを更新
    updateFish(t); // 魚の遊泳を更新
    firstPersonHands.setWalking(mode === 'walk' && cameraView === 'first' && walk.isMoving());
    firstPersonHands.update(delta, t);
    // 松明: 夜間だけ灯す(Snowman 3D Character.md 17節/
    // ambient-soundscape-concept-summary.md 20〜21節で構想していたもの)。
    const isNight = getTimeOfDay(gameHour) === 'night';
    torchOnBody.setLit(isNight);
    torchOnHands.setLit(isNight);
    firstPersonHands.setLeftHandVisible(isNight); // v1.44: 一人称は普段は右手だけ。左手は夜に松明を持つ時だけ見せる
    keepTorchUpright(torchOnBody, playerSnowman.torchSocket);
    keepTorchUpright(torchOnHands, firstPersonHands.torchSocket);
    torchOnBody.update(t, delta);
    torchOnHands.update(t, delta);
    weather.setSeason(season.getSeason()); // 春の融雪を速めるため、季節を渡しておく
    weather.update(delta, t, camera.position); // 雨粒・雲・稲妻を更新(applyTimeOfDayより先に)
    applySeasonAndSnow(delta); // 季節・積雪を反映(地形/草/葉の色、雪だるまの喜び)
    // 2026-09(v1.30): 枯れ葉の発生・落下・積もりを更新。既存のwindStrength的な
    // 状態は無いため、現在の天候(嵐ほど風が強いとみなす)を簡易な「風の強さ」の
    // 代わりに使う。発生の強さ(intensity)はseason.getAutumnProgress()から。
    {
      const w = weather.getWeather();
      const windFactor = w === 'storm' ? 1.0 : w === 'rain' ? 0.45 : 0.15;
      const autumnProgress = season.getAutumnProgress();
      leafFall.update(delta, {
        shedding: season.isAutumnLike(),
        intensity: getSheddingIntensity(autumnProgress),
        windFactor,
        sources: broadleafLeafSources,
      });
    }
    updateGameAudio();
    updateWeatherAudio();

    // ゲーム内時計を進める(現実50秒 ≈ ゲーム内1時間、マインクラフト相当)
    gameHour = (gameHour + delta * GAME_HOURS_PER_REAL_SECOND) % 24;
    // 影のフラスタム(=celestialCenter)を、常にプレイヤーの足元へ追従させる。
    // これにより「視界に入っている周辺だけ影を計算する」形になり、
    // 160m世界全体を一度に影計算するより大幅に軽く、かつどこを歩いても
    // 木・地形の影がちゃんと出るようになる。
    celestialCenter.set(camera.position.x, terrainHeightAt(camera.position.x, camera.position.z), camera.position.z);
    applyTimeOfDay(gameHour);
    const bucket = getTimeOfDay(gameHour);
    if (bucket !== lastCreatureBucket) {
      lastCreatureBucket = bucket;
      applyCreatureAmbience(gameHour);
    }
    if (options.onTimeChange) options.onTimeChange(gameHour);

    if (mode !== 'walk' && !(cinemaMode && wanderActive)) {
      orbitControls.update();
      // 自由カメラでも、地面/水面の下に潜って地形の裏側が見えないようにする
      if (constrainCameraPosition(camera.position)) camera.lookAt(orbitControls.target);
    }

    // v1.68: 川面に映す星空(天地を反転して、画面と同じ解像度で描く)。見えない時・オフの時は描かない。
    if (waterReflectionEnabled && getRiverQuality() !== 'off') starfield.renderReflection(renderer, camera);
    renderer.render(scene, camera);

    // --- デバッグ統計を間引いて通知 ---
    debugFrameCount++;
    debugAccumTime += delta;
    if (debugAccumTime >= DEBUG_UPDATE_INTERVAL) {
      debugFps = debugFrameCount / debugAccumTime;
      debugFrameMs = (debugAccumTime / debugFrameCount) * 1000;
      debugFrameCount = 0;
      debugAccumTime = 0;
      if (options.onDebugUpdate) {
        const info = renderer.info;
        options.onDebugUpdate({
          fps: debugFps,
          frameMs: debugFrameMs,
          mode,
          cameraView: mode === 'walk' ? cameraView : undefined,
          wander: wanderActive,
          gameHour,
          weather: weather.getWeather(),
          weatherAuto: weather.isAutoMode(),
          season: season.getSeason(),
          camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          drawCalls: info.render.calls,
          triangles: info.render.triangles,
          geometries: info.memory.geometries,
          textures: info.memory.textures,
          terrainSize: TERRAIN_SIZE,
          waterQuality: getRiverQuality(),
          // 2026-09(v1.32): 落ち葉が「実際に動いているか」を数字で確認できるように。
          // 舞っている枚数・積もった枚数が0のままなら発生ロジック側、数はあるのに
          // 見えないなら見た目(位置・大きさ・向き)側の問題と切り分けられる。
          leafFalling: leafFall.countFalling(),
          leafPiled: leafFall.countPiled(),
          autumnProgress: season.getAutumnProgress(),
          walkSpeed: walk.getSpeed ? walk.getSpeed() : undefined,
        });
      }
    }
  }

  const debugLogs = new Map(); let debugLogSeq = 0; // 開発・検証用: placeLogで置いた丸太の控え
  let debugManual = false; // 開発・検証用: trueの間は自動で進めず、debugTraversal.advance()で1コマずつ進める
  function animate() {
    if (!running) return;
    if (!debugManual) renderFrame();
    requestAnimationFrame(animate);
  }
  animate();

  // v1.58(スマホのフルスクリーン): 480×270を整数倍にしか拡大しないと、縦横比の違うスマホ画面では
  // 小さく中央に置かれて大きな余白ができる。スマホ(pointer: coarse)では、画面の縦横比に合わせて
  // 描画バッファの幅・高さを変え、整数倍(ピクセルの粗さを保つ)で画面全体を埋める。
  // PCは従来どおり 480×270 の整数倍(余白が出ても、ピクセル表現を優先)。
  const coarsePointer = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  let bufW = BUFFER_WIDTH, bufH = BUFFER_HEIGHT;
  function resize() {
    const cw = mountEl.clientWidth, ch = mountEl.clientHeight;
    if (coarsePointer && cw > 0 && ch > 0) {
      const raw = ch / BUFFER_HEIGHT;
      const lo = Math.max(1, Math.floor(raw)), hi = Math.max(1, Math.ceil(raw));
      // 描画の高さが270に近くなる整数倍を選ぶ(対数距離の小さい方)
      const s = Math.abs(Math.log(ch / lo / BUFFER_HEIGHT)) <= Math.abs(Math.log(ch / hi / BUFFER_HEIGHT)) ? lo : hi;
      const bw = Math.max(96, Math.min(900, Math.ceil(cw / s)));
      const bh = Math.max(120, Math.ceil(ch / s));
      if (bw !== bufW || bh !== bufH) {
        bufW = bw; bufH = bh;
        renderer.setSize(bw, bh, false);
        camera.aspect = bw / bh;
        camera.updateProjectionMatrix();
      }
      const st = renderer.domElement.style;
      st.width = `${bw * s}px`; st.height = `${bh * s}px`; st.flex = 'none';
      return; // 端は最大 s ピクセルだけはみ出して切れる(中央寄せ)
    }
    const scaleX = cw / BUFFER_WIDTH;
    const scaleY = ch / BUFFER_HEIGHT;
    const scale = Math.max(1, Math.floor(Math.min(scaleX, scaleY)));
    renderer.domElement.style.width = `${BUFFER_WIDTH * scale}px`;
    renderer.domElement.style.height = `${BUFFER_HEIGHT * scale}px`;
  }
  window.addEventListener('resize', resize);
  resize();

  // ================================================================
  // v1.57 / E7: ワールドの保存と復元(js/save/save-store.js が、ユーザー・ワールドごとに保存する)
  //  保存する物: 置いた物 / 動かした・拾った倒木 / 拾った痕跡 / チェストの中身 / 持ち物・装備・ポーチ / 天候・積雪 / 雪だるまの位置
  //  保存しない物(毎回きまる物): 時刻・季節(実際の時計と日付) / 落ちてくる星のタイマー / 花や貝などの小さな拾い物(今は保存の対象外)
  //  地形・木・岩・川・最初の倒木は、ワールドのシードから毎回同じに作られるので、保存しない(差分だけを保存する)。
  // ================================================================
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const logHome = new Map(); // 倒木の最初の姿勢。ここから動いたものだけを保存する
  for (const l of fallenLogs) if (l.physics) logHome.set(l, { p: [l.physics.position.x, l.physics.position.y, l.physics.position.z], q: [l.physics.quaternion.x, l.physics.quaternion.y, l.physics.quaternion.z, l.physics.quaternion.w] });
  function captureWorldState() {
    const logs = [];
    fallenLogs.forEach((l, i) => {
      const home = logHome.get(l); if (!home || !l.physics) return;
      const p = l.physics.position, q = l.physics.quaternion;
      const moved = Math.hypot(p.x - home.p[0], p.y - home.p[1], p.z - home.p[2]) > 0.01 || Math.abs(q.x - home.q[0]) + Math.abs(q.y - home.q[1]) + Math.abs(q.z - home.q[2]) + Math.abs(q.w - home.q[3]) > 1e-3;
      if (!moved && !l.collected && !l.snowRest) return;
      logs.push({ i, len: r3(l.length), rad: r3(l.radius), c: l.collected ? 1 : 0, p: [r3(p.x), r3(p.y), r3(p.z)], q: [r3(q.x), r3(q.y), r3(q.z), r3(q.w)], sr: r3(l.snowRest || 0) });
    });
    return {
      inventory: inventory.serialize(), equipment: equipment.serialize(), pouch: pouch.serialize(),
      chest: chest.storage.serialize(),
      placed: placedItems.slice(0, 400).map((it) => ({ id: it.itemId, x: r3(it.x), z: r3(it.z), yaw: r3(it.mesh.rotation.y) })),
      logs: logs.slice(0, 300),
      shards: shardSystem.serialize(), // v1.69: 星のかけら・月のかけらを貼った倒木と、接着した塊(倒木の番号で)
      moonTaken: moonBuried.map((m, i) => (moonStones.getLanded().some((s) => s.id === m.id) ? -1 : i)).filter((i) => i >= 0), // v1.69: 拾われた、埋まっていた月の石
      remnants: remnantField.items.filter((it) => it.collected).map((it) => it.id).slice(0, 400),
      weather: { name: weather.getWeather(), auto: weather.isAutoMode(), snow: r3(weather.getSnowDepth()) },
      snowman: { x: r3(playerSnowman.group.position.x), z: r3(playerSnowman.group.position.z), heading: r3(playerSnowman.group.rotation.y) },
    };
  }
  /** 保存した状態を、いまのシーンに戻す。壊れた部分・知らない物は飛ばして、できる所だけ戻す。戻せなかった数を返す。 */
  function restoreWorldState(st) {
    let skipped = 0;
    if (!st || typeof st !== 'object') return { skipped: 0 };
    const num = (v) => typeof v === 'number' && Number.isFinite(v);
    const guard = (fn) => { try { fn(); } catch (e) { skipped++; console.warn('[save] 復元できなかった部分があります', e); } };
    guard(() => { if (st.pouch) pouch.restore(st.pouch); });
    guard(() => { if (st.chest) chest.restore(st.chest); });
    guard(() => { if (st.equipment) equipment.restore(st.equipment); });
    guard(() => { if (st.inventory) inventory.load(st.inventory); }); // 最後に読むと、変更の通知で画面・装備の見た目も更新される
    // 倒木: 番号(生成順)・長さ・太さが一致するものだけ戻す(生成のしかたが変わっていたら、ずれた物は戻さない)
    guard(() => {
      for (const e of Array.isArray(st.logs) ? st.logs : []) {
        const l = fallenLogs[e.i];
        if (!l || !l.physics || !Array.isArray(e.p) || !Array.isArray(e.q) || e.p.length !== 3 || e.q.length !== 4 || !e.p.concat(e.q).every(num)) { skipped++; continue; }
        if (Math.abs(l.length - e.len) > 0.01 || Math.abs(l.radius - e.rad) > 0.01) { skipped++; continue; }
        if (e.c) { if (!l.collected) { l.collected = true; l.mesh.visible = false; logObstacles.remove(l); logAvoidObstacles.remove(l); logSystem.remove(l); } continue; }
        l.physics.position.x = e.p[0]; l.physics.position.y = e.p[1]; l.physics.position.z = e.p[2];
        l.physics.quaternion.x = e.q[0]; l.physics.quaternion.y = e.q[1]; l.physics.quaternion.z = e.q[2]; l.physics.quaternion.w = e.q[3];
        l.snowRest = num(e.sr) ? e.sr : 0;
        logSystem.syncPose(l); refreshLogBury(l);
      }
      syncLogObstacles();
    });
    guard(() => { if (st.shards) shardSystem.restore(st.shards); }); // v1.69: 倒木の位置を戻したあとに、かけらと接着を戻す
    guard(() => { for (const i of Array.isArray(st.moonTaken) ? st.moonTaken : []) { const m = moonBuried[i]; if (m) moonStones.take(m.id); } }); // v1.69
    guard(() => { for (const id of Array.isArray(st.remnants) ? st.remnants : []) remnantField.take(id); });
    guard(() => {
      for (const e of Array.isArray(st.placed) ? st.placed : []) {
        if (!e || typeof e.id !== 'string' || !isKnownItem(e.id) || !num(e.x) || !num(e.z)) { skipped++; continue; }
        if (Math.hypot(e.x, e.z) > PLAYABLE_RADIUS * 1.5) { skipped++; continue; }
        addPlacedItem(e.id, e.x, e.z, num(e.yaw) ? e.yaw : 0, { exact: true, silent: true });
      }
    });
    guard(() => {
      const w = st.weather; if (!w) return;
      if (num(w.snow)) weather.debugSetSnowDepth(Math.max(0, Math.min(SNOW_DEPTH_MAX, w.snow)));
      weather.setAutoMode(!!w.auto);
      if (!w.auto && typeof w.name === 'string') weather.setWeather(w.name);
    });
    guard(() => {
      const s = st.snowman; if (!s || !num(s.x) || !num(s.z)) return;
      if (Math.hypot(s.x - snowmanHomeX, s.z - snowmanHomeZ) > WANDER_RADIUS * 1.2) return;
      const h = num(s.heading) ? s.heading : 0;
      wander.pos.set(s.x, s.z); wander.target.set(s.x, s.z); wander.legs = []; wander.waiting = true; wander.waitTimer = 2; wander.waitElapsed = 0; wander.heading = h; wander.baseHeading = h;
      playerSnowman.group.position.set(s.x, snowGroundAt(s.x, s.z), s.z); playerSnowman.group.rotation.y = h;
    });
    return { skipped };
  }


  return {
    canvas: renderer.domElement,
    setHour: (hour) => {
      // 指定した時刻へジャンプする(その後は自動でまた時間が進み続ける)
      gameHour = hour;
      const tod = applyTimeOfDay(gameHour);
      lastCreatureBucket = tod;
      applyCreatureAmbience(gameHour);
      return tod;
    },
    getHour: () => gameHour,
    enterWalkMode,
    cycleCameraView,
    getCameraView: () => cameraView,
    getDefaultWalkView: () => DEFAULT_WALK_VIEW,
    setWander,
    isWandering: () => wanderActive,
    setCinemaMode,
    isCinemaMode: () => cinemaMode,
    getMode: () => mode,
    // v1.73: 座る・寝るエモート。kind は 'sit' | 'sleep' | 'stand'。歩行モードの時だけ受ける(見守りは、自分で決める)。
    emote: (kind) => { if (mode !== 'walk' && !(kind === 'stand')) return false; emoteBrain.request(kind); return true; },
    getEmoteState: () => emoteBrain.state,
    /** 検証用(管理者): 状態の確認と、モードに関わらずエモートを要求する・休憩の待ち時間を飛ばす。 */
    debugEmote: () => ({ state: emoteBrain.state, pose: emoteBrain.getPose(), nextRestIn: emoteBrain._s.nextRestIn, spotOk: emoteState.spotOk, canLie: emoteState.canLie, wheelOpen: emoteState.wheelOpen }),
    debugEmoteRequest: (kind) => emoteBrain.request(kind),
    debugEmoteDue: () => { emoteBrain._s.nextRestIn = 0; },
    debugEmoteConfig: (patch) => Object.assign(emoteBrain.config, patch || {}), // 検証用: 待ち時間などを短くする
    setEmoteWheelOpen,
    isEmoteWheelOpen: () => emoteState.wheelOpen,
    // v1.46: 編集(観察)モード。歩行モード中は入れない。
    toggleEditMode: () => { if (mode === 'walk') return false; return editMode.toggle(); },
    isEditMode: () => editMode.isEnabled(),
    // v1.50: 起動画面などで選ぶ3モード(歩行/見守り/編集)。既定値は session-mode.js。
    setSessionMode: (id) => applySessionMode(id, {
      isWalking: () => mode === 'walk', exitWalk: exitWalkMode, enterWalk: () => enterWalkMode(),
      setWander, setAutoCamera: setCinemaMode,
      isEditing: () => editMode.isEnabled(), editEnable: () => editMode.enable(), editDisable: () => editMode.disable(),
    }),
    getSessionMode: () => currentSessionMode({ walking: mode === 'walk', editing: editMode.isEnabled(), wandering: wanderActive }),
    isHoldingLog: () => editMode.isHolding(),
    debugPhysicsStats: () => physics.stats(),
    /** 開発・検証用の操作口(通常のUIには出さない)。ブラウザ実機での通行の確認に使う。 */
    debugTraversal: {
      setManual: (on) => { debugManual = !!on; },
      /** 固定の刻み幅で、n コマ進める(実時間に依らず再現できる)。 */
      advance: (n, dt = 1 / 30) => {
        const orig = clock.getDelta;
        clock.getDelta = () => { clock.elapsedTime += dt; return dt; };
        try { for (let i = 0; i < n; i++) renderFrame(); } finally { clock.getDelta = orig; }
      },
      state: () => ({
        mode, x: playerSnowman.group.position.x, y: playerSnowman.group.position.y, z: playerSnowman.group.position.z,
        ground: terrainHeightAt(playerSnowman.group.position.x, playerSnowman.group.position.z) + weather.getSnowDepth(),
        heading: playerSnowman.group.rotation.y,
        grounded: mode === 'walk' && !wanderActive ? walk.isGrounded() : nonWalkVertical.grounded,
        climbing: mode === 'walk' && !wanderActive ? walk.isClimbing() : aiClimb.active,
        inWater: Number.isFinite(getWaterSurfaceAt(playerSnowman.group.position.x, playerSnowman.group.position.z, terrainHeightAt)),
        supported: traversal.isSupportedBySurface(playerSnowman.group.position.x, playerSnowman.group.position.z, playerSnowman.group.position.y),
        wandering: wanderActive, legs: wander.legs.map((l) => ({ x: l.x, z: l.z, act: l.act || null })), routeKey: wander.routePlan ? wander.routePlan.key : null,
        failures: traversalFailures.size(),
      }),
      teleport: (x, z, heading) => {
        if (mode === 'walk') { walk.playerPos.set(x, 0, z); if (Number.isFinite(heading)) walk.setHeading(heading); }
        wander.pos.set(x, z); prevSnowX = null; nonWalkVertical.snap();
        playerSnowman.group.position.set(x, terrainHeightAt(x, z), z);
        if (Number.isFinite(heading)) playerSnowman.group.rotation.y = heading;
      },
      setHeading: (h) => { walk.setHeading(h); },
      groundAt: (x, z) => terrainHeightAt(x, z) + weather.getSnowDepth(),
      waterAt: (x, z) => Number.isFinite(getWaterSurfaceAt(x, z, terrainHeightAt)),
      walkWaterAt: (x, z) => Number.isFinite(dryWaterSurfaceAt(x, z)),
      /** 川をまたぐのに向いた地点: 長さlenの丸太の両端が、水ではない同じくらいの高さの地面に載る場所を探す。 */
      findCrossing: (len = 16) => {
        const cl = getRiver().centerline; let best = null;
        const endD = len / 2 - 1.0; // 丸太の端が岸に1mだけ載る
        for (let i = 6; i < cl.length - 6; i += 2) {
          const a = cl[i - 3], b = cl[i + 3], c = cl[i];
          let tx = b.x - a.x, tz = b.z - a.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
          const nx = -tz, nz = tx;
          const pA = { x: c.x + nx * endD, z: c.z + nz * endD }, pB = { x: c.x - nx * endD, z: c.z - nz * endD };
          if (Math.hypot(pA.x, pA.z) > PLAYABLE_RADIUS - 8 || Math.hypot(pB.x, pB.z) > PLAYABLE_RADIUS - 8) continue;
          if (getWaterSurfaceAt(pA.x, pA.z, terrainHeightAt) > -Infinity || getWaterSurfaceAt(pB.x, pB.z, terrainHeightAt) > -Infinity) continue;
          // 丸太の下に水がある(川をまたぐ)ことと、両端の外側(進入路・出口)が水ではないこと
          const outA = { x: c.x + nx * (endD + 2.5), z: c.z + nz * (endD + 2.5) }, outB = { x: c.x - nx * (endD + 2.5), z: c.z - nz * (endD + 2.5) };
          if (getWaterSurfaceAt(outA.x, outA.z, terrainHeightAt) > -Infinity || getWaterSurfaceAt(outB.x, outB.z, terrainHeightAt) > -Infinity) continue;
          if (!(getWaterSurfaceAt(c.x, c.z, terrainHeightAt) > -Infinity)) continue;
          const hA = terrainHeightAt(pA.x, pA.z), hB = terrainHeightAt(pB.x, pB.z), hOA = terrainHeightAt(outA.x, outA.z), hOB = terrainHeightAt(outB.x, outB.z);
          const score = Math.abs(hA - hB) * 2 + Math.abs(hOA - hA) + Math.abs(hOB - hB);
          if (!best || score < best.score) best = { score, x: c.x, z: c.z, nx, nz, half: endD, hA, hB, width: c.width };
        }
        return best;
      },
      /** 指定した寸法の丸太を、水平な姿勢(根元(x,z)・軸の高さaxisY・向きyaw)で静止状態として置く。 */
      placeLog: ({ type = 'long_trunk', length, radius, x, z, yaw, axisY, tilt = 0 }) => {
        const spec = { type, seed: 7, length, radius, radiusTop: radius * 0.9, taper: 0.9, bend: 0, age: 'seasoned', foliage: 0, pickable: false };
        const wood = createFallenWood(spec);
        wood.position.set(x, axisY, z);
        wood.quaternion.copy(levelQuaternion(yaw));
        scene.add(wood);
        const log = { x, z, scale: length / 1.6, mesh: wood, type, spec, dims: collisionDims(spec), pickable: false,
          physicalProperties: woodPhysicalProperties(spec), material: woodMaterial(spec) };
        fallenLogs.push(log); logSystem.attach(log); syncLogObstacles();
        burialCandidates.push({ mesh: wood, baseY: wood.position.y, heightM: 0 }); refreshLogBury(log); // v1.56-H4: 本物の倒木と同じく、積雪で隠れる対象にする
        const handle = ++debugLogSeq; debugLogs.set(handle, log); // 配列の位置は変わりうるので、参照で覚える
        return handle;
      },
      removeLog: (handle) => { const l = debugLogs.get(handle); if (!l) return; debugLogs.delete(handle); l.collected = true; l.mesh.visible = false; logObstacles.remove(l); logAvoidObstacles.remove(l); logSystem.remove(l); const i = fallenLogs.indexOf(l); if (i >= 0) fallenLogs.splice(i, 1); scene.remove(l.mesh); },
      clearFailures: () => traversalFailures.clear(),
      /** 開発・検証用: 拾い物・ポーチ・チェストの状態と、星の設置。 */
      collect: {
        plantStar: (x, z) => fallingStars.debugPlant(x, z),
        setCapacity: (n) => pouch.setCapacity(n),
        chestPos: () => ({ x: chestX, z: chestZ, standX: chestStand.x, standZ: chestStand.z }),
        info: () => ({
          carried: Object.fromEntries(pouch.carried()), total: pouch.total(), full: pouch.isFull(), cap: pouch.capacity,
          chest: chest.storage.contents(), chestOpen: chest.isOpen(), lid: +chest.lidAngle().toFixed(2),
          invStar: inventory.count('star'), invTwig: inventory.count('twig'), stars: fallingStars.getLanded().length,
          collectPhase: wander.collectTask ? wander.collectTask.phase : null, basePhase: wander.baseTask ? wander.baseTask.phase : null,
          logs: fallenLogs.filter((l) => !l.collected && ['twig', 'small_branch'].includes(l.type)).length,
        }),
        senseAll: (x, z) => collectRegistry.sense(x, z, { now: clock.elapsedTime }).map((c) => ({ kind: c.kind, d: +c.dist.toFixed(1) })),
        renderInfo: () => ({ programs: renderer.info.programs ? renderer.info.programs.length : -1, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, texs: renderer.info.memory.textures }),
        registry: collectRegistry, pouch, chest, fallingStars, inventory,
        remnants: remnantField, remnantPlans, equipment, lanternLights, placedItems, addPlacedItem,
      },
      /** 開発・検証用: 見守りの雪だるまの次の行き先を指定する(待機を打ち切って、その地点へ歩かせる)。 */
      goTo: (x, z) => { wander.waiting = false; wander.turningAway = 0; wander.legs = [{ x, z }]; wander.detouring = 0; wander.target.set(x, z); wander.activity = 'walk'; wander.nextRestMin = 2; wander.nextRestMax = 4; resetStuckCheck(); },
      wanderInfo: () => ({ target: [wander.target.x, wander.target.y], pos: [wander.pos.x, wander.pos.y], heading: wander.heading, legsList: wander.legs.map((l) => [+l.x.toFixed(1), +l.z.toFixed(1)]), strikes: wander.noApproachStrikes, legs: wander.legs.length, waiting: wander.waiting, turning: wander.turningAway > 0, detouring: wander.detouring, escape: escapeState.level, escapes: escapeState.total, blockedGoals: escapeState.blockedGoals.length }),
      forceCrossing: () => { debugForceCrossing = true; wander.waiting = true; wander.waitTimer = 0; wander.turningAway = 0; },
      planCrossing: (x, z) => { const p = traversal.planLogCrossing(x, z, { isFailed: (k) => traversalFailures.isFailed(k) }); return p ? { key: p.key, action: p.mount.action, rise: p.mount.rise, span: p.span } : null; },
      tv: traversal,
      // v1.56-H5(検証用): 行き詰まり対策(進捗の見張り・乗り越え・最後のジャンプ)
      watchdogInfo: () => ({ ...stagnation.info(), stats: { ...watchdogStats }, hurdle: wander.hurdle ? wander.hurdle.phase : null, hop: !!wander.hop, escapes: escapeState.total, y: nonWalkVertical.y }),
      forceStagnation: (level) => handleStagnation(level),
      planHurdle: (fx, fz, tx, tz) => { const p = traversal.planHurdle(fx, fz, tx, tz, { isBlocked: (x, z) => isNonLogObstacleAt(x, z, 0.7) }); return p ? { approach: p.approach, crest: p.crest, exit: p.exit, rise: p.rise, drop: p.drop } : null; },
      setWanderPos: (x, z) => { wander.pos.set(x, z); nonWalkVertical.snap(); },
      resetWatchdog: () => { stagnation.markProgress(); repeats.clear(); },
      setWatchdogConfig: (c) => Object.assign(stagnation.cfg, c), // 検証用: 見張りの秒数を短くして、速く確かめる
    },
    _editMode: editMode, _logSystem: logSystem, _physics: physics,
    exitWalkMode,
    // --- v1.43: プレイヤーインベントリ(メイン27+ホットバー9。ホットバーもその一部) ---
    captureWorldState, restoreWorldState, // v1.57 / E7
    getInventory: () => inventory.snapshot(),
    onInventoryChange: (fn) => inventory.onChange(fn),
    setInventoryOpen,
    isInventoryOpen: () => inventoryOpen,
    clickInventorySlot: (area, i, button, opts) => inventory.clickSlot(area, i, button, opts),
    inventoryHotkeySwap: (area, i, hotbarIndex) => inventory.hotkeySwap(area, i, hotbarIndex),
    convertLogToWood: () => inventory.convert('log', 1, 'wood', LOG_TO_WOOD),
    canPlaceStarHere,
    placeStarOnNearbyTree,
    selectHotbar: (i) => inventory.select(i),
    hotbarNext: () => inventory.next(),
    hotbarPrev: () => inventory.prev(),
    /** 今狙っている対象へアクションする(左クリック/スマホの専用ボタン)。歩行モード以外では何もしない。
     * v1.41: 対象の有無やアクションの成否に関わらず、右腕を伸ばす動作を再生する
     * (「押せば手が動く」という身体的な手応えを、当たり外れより先に返すため)。 */
    triggerInteract: () => {
      if (mode !== 'walk' || emoteBrain.isBusy() || emoteState.wheelOpen) return false; // v1.73: 座っている間・ホイールを開いている間は、何もしない
      playerSnowman.triggerActionSwing();
      firstPersonHands.triggerActionSwing();
      return interaction.trigger();
    },
    getFocusedKind: () => interaction.getFocusedKind(),
    /** 開発用(コンソールから): 今すぐ星を落とす。通常のUIには出さない。 */
    /**
     * デバッグイベント: ポーチをいっぱいにして(星と小枝を交互に)、見守りの雪だるまにチェストへしまいに行かせる。
     * 見守りで動いていなければ、動きが見えるように見守りの動きを始める。戻り値: 入れた数。
     */
    /** 持ち物の画面を開く側(index.html)が、チェストの画面を開閉する。 */
    closeChestUi: () => closeChestUi(),
    openChestUi: () => openChestUi(),
    /** 手に持っている物を1個、前に置く(Qキー)。 */
    placeHeldItem: (aim) => placeHeldItem(!!aim),
    getEquipment: () => equipment,
    /** デバッグイベント: ジャック・オー・ランタンを、雪だるまの近くの地面に3つ落とす。 */
    debugDropLanterns: (n) => debugDropLanterns(n),
    /** デバッグイベント: ジャック・オー・ランタンを、持ち物に3個入れる。 */
    debugGiveLanterns: (n = 3) => { let k = 0; for (let i = 0; i < n; i++) if (inventory.add('jack_o_lantern', 1)) k++; return k; },
    debugFillPouchToChest: () => {
      let n = 0;
      while (!pouch.isFull() && n < 64) { if (!pouch.take(n % 2 === 0 ? 'star' : 'twig')) break; n++; }
      if (!wanderActive) setWander(true);
      wander.collectTask = null; wander.baseTask = null; wander.legs = []; wander.turningAway = 0; wander.detouring = 0;
      wander.waiting = true; wander.waitTimer = 0; wander.waitElapsed = 0; // 次の行動の選び直し → ポーチが満杯なので、チェストへ帰る
      return { filled: n, total: pouch.total() };
    },
    /** 歩行モードのプレイヤーが、チェストを使う(検証用。通常はインタラクションから呼ばれる)。 */
    debugPlayerUseChest: () => playerUseChest(),
    debugTriggerStar: () => fallingStars.trigger({ x: playerSnowman.group.position.x, z: playerSnowman.group.position.z }),
    debugGetStarState: () => ({ phase: fallingStars.getPhase(), countdown: fallingStars.getCountdown(), star: fallingStars.getActive(), placed: treeDecor.getPlaced(), pouch: inventory.snapshot() }),
    // --- v1.37: スマホの画面上コントローラ(ジョイスティック+A/Bボタン)用API ---
    // enableTouchControls()を呼ぶと、ポインターロック無しでも
    // setVirtualMove/setVirtualRun/triggerJumpでの操作が有効になる
    // (呼び出し側のindex.htmlが、タッチデバイスを検出した時に一度だけ呼ぶ想定)。
    enableTouchControls: () => walk.enableVirtualControls(),
    isTouchControlsEnabled: () => walk.isVirtualControlsEnabled(),
    setVirtualMove: (x, z) => walk.setVirtualMove(x, z),
    setVirtualRun: (running) => walk.setVirtualRun(running),
    triggerJump: () => walk.triggerJump(),
    /** v1.58: 画面のドラッグで視点を回す(dx,dyはラジアン)。歩行モード以外では何もしない。 */
    addTouchLook: (dx, dy) => { if (mode === 'walk') walk.addLook(dx, dy); },
    /** v1.58: 編集モード(スマホ): 移動/回転の切り替えと、つかんでいる丸太を離す。 */
    setEditGizmoMode: (m) => editMode.setMode(m),
    releaseEditHeld: () => editMode.release(),
    startAudio,
    isAudioOn: () => audioOn,
    // 水面の品質('off' | 'standard' | 'high')。offは水面処理を最軽量にし、波紋も出さない。
    setWaterQuality: (q) => {
      setRiverQuality(q);
      weather.setWaterRipplesEnabled(getRiverQuality() !== 'off');
    },
    getWaterQuality: () => getRiverQuality(),
    // v1.66: 川面への星と月の映り込みのオン/オフ(押した瞬間に反映される)
    setWaterReflection: (on) => { waterReflectionEnabled = !!on; },
    getWaterReflection: () => waterReflectionEnabled,
    setWeather: (name) => weather.setWeather(name),
    // v1.64(検証用): 星空の状態の確認と、流れ星をすぐ1つ出す
    // ---- v1.69: 星のかけら・月のかけら(編集モードのパネルから使う) ----
    getShardPanel: () => shardPanelState(),
    getDebugLog: () => debugLog.toObject(),          // v1.69: ログ(出来事 + その時点の状態)をオブジェクトで返す
    downloadDebugLog: () => debugLog.download(),     // v1.69: JSONファイルとして書き出す(ファイル名を返す)
    debugLogEvent: (kind, data) => debugLog.log(kind, data),
    craftShards: (kind) => craftShardsFromPool(kind),
    // v1.74: 星の松明を作る。持ち物の画面(歩行)・かけらパネル(編集)から。数は、持ち物とチェストの合計。
    craftStarTorch: () => craftStarTorchFromPool(),
    getInventoryCraft: () => ({ twig: poolCount('twig'), starShard: poolCount('star_shard'), starTorch: poolCount('star_torch'), canCraftStarTorch: poolCount('twig') >= 1 && poolCount('star_shard') >= 1 }),
    attachShard: (kind) => attachShardToHeld(kind),
    detachShard: (kind) => detachShardFromHeld(kind), // v1.71
    // v1.71: 接着モード
    glueBegin: () => glueTool.begin(), glueCancel: () => glueTool.cancel(), glueConfirm: () => glueTool.confirm(),
    glueSetParam: (name, v) => glueTool.setParam(name, v), glueSetParams: (o) => glueTool.setParams(o), glueSetSnap: (on) => glueTool.setSnap(on),
    glueBeginEdit: () => glueTool.beginEdit(), glueDetach: () => glueTool.detachSelected(), glueClearSelection: () => glueTool.clearSelection(),
    getGlueState: () => glueTool.getState(), _glueTool: glueTool, _editMode: editMode, // _ で始まる物は、確認用(管理者のデバッグ画面から使う)
    debugShards: () => ({ pool: { star: poolCount('star'), starShard: poolCount('star_shard'), moonStone: poolCount('moon_stone'), moonShard: poolCount('moon_shard') }, counts: shardSystem.count(), groups: physics.stats().groups, moon: moonStones.getLanded().length }),
    getStarfieldInfo: () => starfield.getInfo(),
    debugTriggerMeteor: () => starfield.triggerMeteor(),
    debugSetSnowDepth: (d) => weather.debugSetSnowDepth(d), // v1.56-H4: 検証用
    getWeather: () => weather.getWeather(),
    setWeatherAuto: (enabled) => weather.setAutoMode(enabled),
    isWeatherAuto: () => weather.isAutoMode(),
    setSeason: (name) => {
      season.setManualSeason(name);
      lastSeasonKey = null; // 次フレームで確実に重み・落ち葉表示を再適用させる
    },
    getSeason: () => season.getSeason(),
    // 2026-09(v1.31): 紅葉・落ち葉のデバッグ用。実際の日付を待たずに、
    // 秋の進み具合(色・落葉・落ち葉の発生量すべてに連動)を強制したり、
    // 今すぐ大量の葉を舞わせて動きを確認したりできる。
    setAutumnDebugProgress: (v) => season.setDebugAutumnProgress(v),
    // 2026-09(v1.32): 「ボタンを押しても何も起こらない」への対応。実際の
    // 広葉樹の位置(遠く・画面外かもしれない)ではなく、必ずカメラの目の前
    // (少し上・少し先)に葉を発生させることで、木を探さなくても確実に
    // 見えるようにした。
    burstLeafFall: (n) => {
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      const cx = camera.position.x + fwd.x * 2.5;
      const cz = camera.position.z + fwd.z * 2.5;
      const debugSource = [{ x: cx, z: cz, top: camera.position.y + 2.0, radius: 1.5 }];
      return leafFall.burst(n, debugSource);
    },
    getSeasonLabel: () => getSeasonLabel(season.getSeason()),
    isSeasonManual: () => season.isManual(),
    getWorldGenInfo: () => (worldGen ? { enabled: true, seed: worldGen.seed } : { enabled: false }),
    getWeatherDebug: () => ({ rainIntensity: weather.getRainIntensity(), sky: weather.getSkyModifier() }),
    resize,
    stop: () => {
      running = false;
      orbitControls.dispose();
      walk.dispose();
      glueTool.dispose();
    },
  };
}
