// weather.js
// 天候(晴れ/雨/雷雨)のビジュアル演出を扱う。
//
// 設計方針:
// - 「見た目」はこのファイルが担当し、音(SoundEngine.Rain / SoundEngine.Thunder)は
//   scene3d.js 側から getRainIntensity() / onLightning() を通じて連動させる
//   (音のDSPとThree.jsの描画コードを直接結合させない、という既存の設計方針を踏襲)。
// - 現時点では天候切り替えはUIからの手動指定(setWeather)のみ。
//   将来「一定間隔・確率で自動的に天候が変わる」仕組みを追加しやすいよう、
//   自動切り替え側は setWeather() を定期的に呼ぶだけで済む構造にしてある
//   (このファイル自身はランダム自動切り替えのタイマーを持たない)。
// - 雨は「全粒子を物理的に降らせる」のではなく、プレイヤーを中心にした
//   円柱状の範囲に少数の細長いストリーク(InstancedMesh)をループさせるだけの
//   軽量表現。歩いても違和感が出ないよう、常にカメラ中心で座標を巻き戻す。
// - 雷は「一瞬のシーン全体の光量ブースト(フラッシュ)」+「空に一瞬だけ
//   表示するジグザグの光の筋(稲妻スプライト)」の組み合わせ。

import * as THREE from 'three';
import { makeRng, randRange } from './rng.js';
import { terrainHeightAt } from './terrain.js';
import { getRiver, nearestRiverPoint, getWaterSurfaceAt } from './river.js';
import { getToonGradientMap, getCloudGradientMap } from './shading.js';

const RAIN_COUNT = 320;
const RAIN_RADIUS = 11; // プレイヤーを中心にした雨の描画範囲(半径)
const RAIN_TOP = 10; // プレイヤーから見た雨の降り始めの高さ
// 「地面」を毎フレーム正確に計算するのは重いため、まずは
// 「プレイヤーの目線からこれくらい下だろう」という安価な目安の高さで
// 着地判定だけを行う(実際の見た目の位置は、着地の瞬間にだけ正確な
// 地形の高さを1回だけ計算して合わせる。詳細はspawnImpact()参照)。
const APPROX_GROUND_REL = -1.7;
const HARD_BOTTOM_REL = -20; // 万一(地形より大幅に高い場所にカメラがある等)のための安全装置

const SNOW_COUNT = 260;
const SNOW_RADIUS = 12; // プレイヤーを中心にした雪の描画範囲(半径)
const SNOW_TOP = 9;
const SNOW_APPROX_GROUND_REL = -1.7;
const SNOW_HARD_BOTTOM_REL = -20;
const SNOW_COVERAGE_GAIN = 0.045; // 降雪中、1秒あたりの積雪量の増加
const SNOW_COVERAGE_DECAY = 0.02; // 降雪していない時、1秒あたりの融雪量

// 2026-09(積雪の本格実装): 「色を変えるだけではダメ。積雪を表現すべき」
// との指摘を受け、これまでの0..1の`snowCoverage`(色の混合率としてのみ
// 使用)とは別に、実際の「積雪の深さ(メートル)」を新設する。
// この深さが、雪面メッシュの高さ・木や岩の埋没・川の埋没・かまくらへの
// 切り替えなど、すべての実体を伴う積雪表現の基準値になる。
export const SNOW_DEPTH_MAX = 5; // これ以上は積もらない(この値で「完全埋没」の演出になる)
export const SNOW_DEPTH_RIME_MIN = 2; // 樹氷が起き始める深さ
export const SNOW_DEPTH_RIME_PEAK_START = 2.4;
export const SNOW_DEPTH_RIME_PEAK_END = 3.0;
export const SNOW_DEPTH_RIME_MAX = 3.6; // これを超えると樹氷は徐々に埋没に置き換わる
const SNOW_DEPTH_GAIN_PER_SEC = SNOW_DEPTH_MAX / (9 * 60); // 降り続けて約9分でMAXに達する
const SNOW_DEPTH_DECAY_PER_SEC = SNOW_DEPTH_MAX / (18 * 60); // 融けるのは倍以上ゆっくり

// 天候自動サイクル(オートモード)。「数分に1回判定」という方針(PLAN文書)に
// 沿って、現実時間で1.5〜4分に1回、季節ごとの重みに従って次の天候を選ぶ。
const AUTO_CHECK_MIN = 90;
const AUTO_CHECK_MAX = 240;
// 選び直した結果、今と同じ天候になることも多い(=毎回派手に切り替わると
// 落ち着かない)。同じ天候が選ばれた場合は何も起きず、次の判定まで待つだけ。

const SPLASH_POOL_SIZE = 50;
const SPLASH_TRIGGER_PROB = 0.35; // 着地した雨粒のうち、実際に見た目の飛沫を出す割合
const RIPPLE_TRIGGER_PROB_BASE = 0.3;
const RIPPLE_TRIGGER_PROB_STORM_BONUS = 0.45; // 雷雨時はさらに波紋を出やすくする

const CLOUD_CLUSTER_COUNT = 11;
const CLOUD_RADIUS_MIN = 90;
const CLOUD_RADIUS_MAX = 560;
const CLOUD_HEIGHT = 58;
// 積雲の実際の見た目の特徴(平らな底・カリフラワー状にゴツゴツした上部)を
// 参考にした、雲1つあたりのサイズ感の目安値(以前の約7倍相当)。
const CLOUD_LOBE_RADIUS_MIN = 9;
const CLOUD_LOBE_RADIUS_MAX = 15;
const CLOUD_LOBE_SPACING_MIN = 9;
const CLOUD_LOBE_SPACING_MAX = 16;

const GRAY_TINT = new THREE.Color(0x8d97a0);
const FLASH_COLOR = new THREE.Color(0xf3f6ff);

/**
 * ジグザグの稲妻テクスチャを1枚生成する(中点変位法で枝分かれ風の
 * ギザギザを作る、簡易版)。
 */
/** GLSLのsmoothstepと同じ、0..1のエルミート補間(JS側での積雪計算用)。 */
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function makeBoltTexture(rng, size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size * 2;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  function jaggedPath(x0, y0, x1, y1, depth, spread) {
    if (depth <= 0) {
      ctx.lineTo(x1, y1);
      return;
    }
    const mx = (x0 + x1) / 2 + randRange(rng, -spread, spread);
    const my = (y0 + y1) / 2;
    jaggedPath(x0, y0, mx, my, depth - 1, spread * 0.55);
    jaggedPath(mx, my, x1, y1, depth - 1, spread * 0.55);
  }

  const cx = canvas.width / 2;
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 外側のグロー(太め・薄い)+ 内側の芯(細め・濃い)の2重描画
  for (const pass of [
    { width: 10, alpha: 0.35 },
    { width: 4, alpha: 0.9 },
  ]) {
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.globalAlpha = pass.alpha;
    ctx.lineWidth = pass.width;
    jaggedPath(cx, 0, cx + randRange(rng, -18, 18), canvas.height, 5, canvas.width * 0.16);
    ctx.stroke();
  }

  // 枝分かれ(短い副枝を1〜2本)
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 2; i++) {
    const startY = randRange(rng, canvas.height * 0.2, canvas.height * 0.6);
    const startX = cx + randRange(rng, -10, 10);
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    jaggedPath(startX, startY, startX + randRange(rng, -40, 40), startY + canvas.height * 0.35, 3, 20);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  return new THREE.CanvasTexture(canvas);
}

/**
 * 雨のストリーク用テクスチャ。上端・下端をフェードさせて、
 * 「棒」ではなく「線」に見えるようにする。
 */
function makeRainStreakTexture() {
  const w = 8;
  const h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  // 縦方向(長さ): 上下端をフェードさせ、線の先端・尾を自然にする。
  // (以前は横方向にもdestination-inでグラデーションを掛けて細さを
  //  表現しようとしたが、環境によってはこの合成方法でアルファがほぼ
  //  消えてしまい、雨が全く見えなくなる不具合が起きたため、縦方向のみの
  //  シンプルな構成に戻した。太さの調整は板ポリのgeometryの幅だけで行う)
  const vGrad = ctx.createLinearGradient(0, 0, 0, h);
  vGrad.addColorStop(0, 'rgba(255,255,255,0)');
  vGrad.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  vGrad.addColorStop(0.75, 'rgba(255,255,255,0.9)');
  vGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = vGrad;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  // このテクスチャは板ポリが非常に細いため、遠方では画面上で1px未満に
  // なることがある。ミップマップ生成に任せると縮小時にほぼ透明へ平均化
  // されてしまい、「離れると雨が消える」原因になっていたため、ミップマップを
  // 使わずリニアフィルタで直接サンプリングするようにする。
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/**
 * 雪片用の、柔らかくぼかした小さな円テクスチャ。
 * 雨のような「線」ではなく、ふわっとした「点」にする。
 */
function makeSnowflakeTexture() {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/**
 * 地面の水飛沫用の、小さく輪郭のはっきりした点テクスチャ。
 * ほぼハードエッジの円にし、縁のぼかしは輪郭のギザギザ(エイリアシング)を
 * 消す最小限の1〜2px相当だけに留める(以前よりさらに輪郭をくっきりさせた)。
 */
function makeSplashTexture() {
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.88, 'rgba(235,244,248,1)');
  grad.addColorStop(0.96, 'rgba(235,244,248,0.6)');
  grad.addColorStop(1, 'rgba(235,244,248,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// ================= 虹(雨上がり) =================
// 太陽と反対側(反太陽点)を中心とした角度42°の円弧として作る
// (実際の主虹の見え方に近い簡易モデル)。地面に近い両端は視覚的に
// 消えるよう、フェードで処理している。
const RAINBOW_DISTANCE = 180; // カメラからの見かけ上の距離(角度サイズのみに影響)
const RAINBOW_RADIUS = RAINBOW_DISTANCE * Math.tan(THREE.MathUtils.degToRad(42));
// 以前は radius*0.05 で細すぎたため太くした
const RAINBOW_BAND_WIDTH = RAINBOW_RADIUS * 0.17; // 2026-09: 「虹が細いので幅を太く」に対応(0.09→0.17)

const rainbowVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const rainbowFragmentShader = `
  varying vec2 vUv;
  uniform float uOpacity;
  vec3 rainbowGradient(float t) {
    vec3 c0 = vec3(0.86, 0.10, 0.10); // 赤(外側)
    vec3 c1 = vec3(0.95, 0.55, 0.10); // 橙
    vec3 c2 = vec3(0.95, 0.90, 0.15); // 黄
    vec3 c3 = vec3(0.20, 0.75, 0.25); // 緑
    vec3 c4 = vec3(0.15, 0.45, 0.85); // 青
    vec3 c5 = vec3(0.35, 0.18, 0.55); // 藍・紫(内側)
    float seg = clamp(t, 0.0, 1.0) * 5.0;
    float f = fract(seg);
    vec3 a; vec3 b;
    if (seg < 1.0) { a = c0; b = c1; }
    else if (seg < 2.0) { a = c1; b = c2; }
    else if (seg < 3.0) { a = c2; b = c3; }
    else if (seg < 4.0) { a = c3; b = c4; }
    else { a = c4; b = c5; }
    return mix(a, b, f);
  }
  void main() {
    vec3 color = rainbowGradient(vUv.y);
    // 2026-09(訂正): 前回「不透明度を上げて」しまったが、正しくは逆で
    // 「透明度を上げる(=より透けて見える)」との指摘。特に地表に近い
    // 弧の両端は、それよりもさらに透明度を高くする(実際の虹も地表付近は
    // 淡く見えることが多い)。edgeFadeの遷移域を0.10→0.28まで広げて、
    // 地表付近がより広く・より強く透けるようにした。
    float edgeFade = smoothstep(0.0, 0.28, vUv.x) * smoothstep(1.0, 0.72, vUv.x);
    float bandFade = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
    // 不透明度ではなく透明度を上げる指摘に対応し、最大不透明度を
    // 0.97→0.5まで下げ、全体的に透けて見えるようにした。
    gl_FragColor = vec4(color, uOpacity * edgeFade * bandFade * 0.5);
  }
`;

/** 半円弧の帯状ジオメトリを、ローカル空間のZ=+distance平面上に作る。
 *  (Object3D.lookAt()は対象カメラと異なりローカル+Z軸を目標方向へ
 *   向けるため、+distance側に置くことで反太陽点側に配置される) */
function buildRainbowGeometry(radius, bandWidth, distance, segments = 64) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const rOuter = radius + bandWidth / 2;
  const rInner = radius - bandWidth / 2;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments; // 0(片方の地平線側)→1(反対側の地平線側)
    const theta = t * Math.PI; // 上向きの半円(0..π)
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    positions.push(rOuter * cosT, rOuter * sinT, distance);
    uvs.push(t, 0);
    positions.push(rInner * cosT, rInner * sinT, distance);
    uvs.push(t, 1);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, e = (i + 1) * 2 + 1;
    indices.push(a, b, c, b, e, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

export function createWeatherSystem(scene, options = {}) {
  const rng = makeRng(options.seed ?? 9001);

  // ================= 状態 =================
  let currentWeather = 'clear'; // 'clear' | 'rain' | 'storm' | 'snow'
  let rainIntensity = 0; // 0..1 (平滑化済み・実際に描画/音に使う値)
  let targetRainIntensity = 0;
  let snowIntensity = 0; // 0..1 (降雪の見た目の強さ)
  let targetSnowIntensity = 0;
  let snowCoverage = 0; // 0..1 (積雪量。降っている間ゆっくり増え、止むとゆっくり融ける)
  let snowDepth = 0; // メートル単位の実際の積雪の深さ(0〜SNOW_DEPTH_MAX)
  let currentSeason = 'winter'; // scene3d.js側からsetSeason()で毎フレーム渡される
  let cloudAmount = 0; // 0..1
  let targetCloudAmount = 0.05;
  let stormFactor = 0; // 雷雨らしさ(頻度・暗さの追加分)
  let targetStormFactor = 0;
  let flashStrength = 0; // 稲妻フラッシュの残光(毎フレーム減衰)
  let nextStrikeTimer = Infinity;
  const lightningCallbacks = [];

  // ================= 天候自動サイクル =================
  let autoMode = false;
  let weatherWeights = null; // scene3d.js側(season.js経由)から setWeatherWeights() で渡される
  let autoCheckTimer = randRange(rng, AUTO_CHECK_MIN, AUTO_CHECK_MAX);

  // ================= 雨(InstancedMeshのストリーク) =================
  const rainGeo = new THREE.PlaneGeometry(0.02, 0.7);
  const rainTex = makeRainStreakTexture();
  const rainMat = new THREE.MeshBasicMaterial({
    color: 0xcfe0ea,
    map: rainTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const rainMesh = new THREE.InstancedMesh(rainGeo, rainMat, RAIN_COUNT);
  rainMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rainMesh.frustumCulled = false;
  rainMesh.visible = false;
  rainMesh.castShadow = false;
  rainMesh.receiveShadow = false;
  // 雨・雲はどちらも depthWrite:false の半透明InstancedMeshで、
  // どちらもオブジェクト自身の変形(position)は原点のままインスタンスだけを
  // 動かしているため、three.jsの「距離順ソート」が両者を同じ距離とみなし、
  // 追加した順(=雲が後から追加される)で雲が手前に描かれてしまうバグが
  // あった。雨は常に雲より手前(プレイヤーに近い)にあるべきものなので、
  // renderOrderで明示的に「雨は雲より後(=手前)に描く」ことを固定する。
  rainMesh.renderOrder = 10;
  scene.add(rainMesh);

  const drops = [];
  for (let i = 0; i < RAIN_COUNT; i++) {
    drops.push({
      ox: randRange(rng, -RAIN_RADIUS, RAIN_RADIUS),
      oz: randRange(rng, -RAIN_RADIUS, RAIN_RADIUS),
      y: randRange(rng, APPROX_GROUND_REL, RAIN_TOP),
      speed: randRange(rng, 9, 14),
      swayPhase: randRange(rng, 0, Math.PI * 2),
    });
  }
  const dummy = new THREE.Object3D();

  // ================= 雪(InstancedMeshの柔らかい点) =================
  const snowGeo = new THREE.PlaneGeometry(0.09, 0.09);
  const snowTex = makeSnowflakeTexture();
  const snowMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map: snowTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const snowMesh = new THREE.InstancedMesh(snowGeo, snowMat, SNOW_COUNT);
  snowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  snowMesh.frustumCulled = false;
  snowMesh.visible = false;
  snowMesh.castShadow = false;
  snowMesh.receiveShadow = false;
  snowMesh.renderOrder = 10;
  scene.add(snowMesh);

  const flakes = [];
  for (let i = 0; i < SNOW_COUNT; i++) {
    flakes.push({
      ox: randRange(rng, -SNOW_RADIUS, SNOW_RADIUS),
      oz: randRange(rng, -SNOW_RADIUS, SNOW_RADIUS),
      y: randRange(rng, SNOW_APPROX_GROUND_REL, SNOW_TOP),
      speed: randRange(rng, 0.6, 1.5),
      swayPhase: randRange(rng, 0, Math.PI * 2),
      swaySpeed: randRange(rng, 0.4, 1.0),
      s: randRange(rng, 0.6, 1.3),
    });
  }

  // ================= 地面の水飛沫(使い回すスプライトのプール) =================
  const splashTex = makeSplashTexture();
  const splashPool = [];
  for (let i = 0; i < SPLASH_POOL_SIZE; i++) {
    const mat = new THREE.SpriteMaterial({
      map: splashTex,
      color: 0xdcebf2,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.18, 0.18, 1);
    sprite.visible = false;
    scene.add(sprite);
    splashPool.push({ sprite, life: 0, maxLife: 0.32, baseY: 0 });
  }
  let splashCursor = 0;

  // ================= 川面の波紋 =================
  // 2026-09(v1.27): 以前はここに、リング画像を貼った平面(28枚)のプールがあり、
  // 拡大しながら透明にして消していた(=水面とは別の2D板を重ねただけ)。
  // 今は、着水位置を「Ripple Source」として水面シェーダー(river.js/
  // water-ripples.js)へ渡すだけで、波の描画は水面シェーダーが行う。
  // 品質がoff(水面処理オフ)の時は、着水しても何も登録しない。
  const onWaterImpact = typeof options.onWaterImpact === 'function' ? options.onWaterImpact : null;
  let waterRipplesEnabled = true;

  /**
   * 雨粒が着地した瞬間に1回だけ呼ばれる。ここでだけ正確な地形の高さ・
   * 川かどうかの判定を行い(=毎フレームではなく着地時だけなので軽い)、
   * 地面なら水飛沫、川面なら波紋を、確率で間引きながら出す。
   */
  function spawnImpact(worldX, worldZ) {
    const river = getRiver();
    const nearest = nearestRiverPoint(worldX, worldZ, river.centerline);
    // 2026-09(v1.27): 以前は「中心線から川幅/2以内」という近似だったが、実際の
    // 水面メッシュと同じ判定(水面の高さ > 地形の高さ)にした。水際でも、
    // 実際に水がある所だけ波紋、無い所は水飛沫になる。
    const isWater = Number.isFinite(getWaterSurfaceAt(worldX, worldZ, terrainHeightAt, river));

    if (isWater) {
      if (!waterRipplesEnabled || !onWaterImpact) return; // 水面処理オフ: 波紋を出さない
      // 雷雨(乱流が強い想定)ほど波紋を出やすくし、重なって見えるようにする
      const rippleProb = RIPPLE_TRIGGER_PROB_BASE + stormFactor * RIPPLE_TRIGGER_PROB_STORM_BONUS;
      if (rng() >= rippleProb) return;
      onWaterImpact(worldX, worldZ, nearest.tangentX, nearest.tangentZ);
    } else {
      if (rng() >= SPLASH_TRIGGER_PROB) return;
      const groundY = terrainHeightAt(worldX, worldZ) + 0.05;
      const slot = splashPool[splashCursor];
      splashCursor = (splashCursor + 1) % splashPool.length;
      slot.life = slot.maxLife;
      slot.baseY = groundY;
      slot.sprite.position.set(worldX, groundY, worldZ);
      slot.sprite.visible = true;
    }
  }

  // ================= 雲(低ポリの塊(球)を集めた立体クラスタ) =================
  // 「2Dの板」ではなく、空間内に実在する立体を集めて雲の塊にする。
  // これによりどの角度から見ても不自然にならず、シーンの太陽/空光の
  // 陰影(トゥーンシェーディング)がそのまま雲にも乗って立体感が出る。
  // 枚数(=描画コスト)を増やさず、既存のIcosahedronGeometry+MeshToonMaterialという
  // このプロジェクトの低ポリ表現の作法(rocks.js等)にそのまま乗せている。
  const cloudPuffGeo = new THREE.IcosahedronGeometry(1, 1);
  // 積雲は下側が上昇気流に押しつぶされたように平らで、上側はカリフラワー状に
  // 丸くゴツゴツしている(実際の積雲の観測・文献に共通する特徴)。
  // 球の下側の頂点を一定の高さで水平に切り詰めることで、この「平らな底」を
  // 個々のパフ(塊)の時点で表現しておく(参照: Marinacci, "Procedural Geometry:
  // Low Poly Clouds" のchopBottom手法)。全パフ共通のジオメトリなので、
  // 複数のパフを積み重ねたときにも底面が概ね揃って見える。
  {
    const posAttr = cloudPuffGeo.attributes.position;
    const bottomY = -0.4;
    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i);
      if (y < bottomY) posAttr.setY(i, bottomY);
    }
    posAttr.needsUpdate = true;
    cloudPuffGeo.computeVertexNormals();
  }
  // 個々のパフの不透明度は天候にかかわらずほぼ一定の高い値に固定する。
  // (以前はcloudAmount(0.05〜0.9)をそのまま不透明度に使っていたため、
  //  特に晴れ〜曇り程度の低い値ではパフ同士が重なった部分だけ濃く見える
  //  「輪郭の透けたシャボン玉」のような見た目になっていた。実際の雲は
  //  重なっていても一枚の不透明な塊に見えるため、不透明度はほぼ固定し、
  //  天候による変化は「どれだけの雲が表示されるか(下記cluster単位の
  //  表示/非表示)」と「色味(晴れ=白、嵐=グレー)」で表現する)
  const CLOUD_BASE_OPACITY = 0.96;
  const cloudPuffMat = new THREE.MeshToonMaterial({
    color: 0xf5f6f7,
    gradientMap: getCloudGradientMap(),
    transparent: true,
    opacity: CLOUD_BASE_OPACITY,
    depthWrite: false,
    fog: false,
  });
  const CLOUD_COLOR_CLEAR = new THREE.Color(0xfafbfc);
  const CLOUD_COLOR_STORM = new THREE.Color(0x6d747c);
  const CLOUD_FADE_BAND = 0.16;

  const cloudClusters = [];
  let totalPuffs = 0;
  for (let i = 0; i < CLOUD_CLUSTER_COUNT; i++) {
    const puffs = [];

    // --- コアローブ(核となる大きな塊。平らな底=雲の土台を形成する) ---
    // 1本の主軸方向に沿って並べることで、積雲らしい「横に長い塊」の
    // シルエットにする(単純に円周上へ放射状に配置すると丸すぎて見える)。
    const lobeCount = 3 + Math.floor(rng() * 3); // 3〜5個
    const axisAngle = randRange(rng, 0, Math.PI * 2);
    const axisX = Math.cos(axisAngle);
    const axisZ = Math.sin(axisAngle);
    const lobes = [];
    for (let j = 0; j < lobeCount; j++) {
      const along = (j - (lobeCount - 1) / 2) * randRange(rng, CLOUD_LOBE_SPACING_MIN, CLOUD_LOBE_SPACING_MAX);
      const lateral = randRange(rng, -3, 3);
      const lobeRadius = randRange(rng, CLOUD_LOBE_RADIUS_MIN, CLOUD_LOBE_RADIUS_MAX) * (j === Math.floor(lobeCount / 2) ? 1.15 : 1);
      const offset = new THREE.Vector3(
        axisX * along - axisZ * lateral,
        randRange(rng, -0.6, 0.6),
        axisZ * along + axisX * lateral
      );
      lobes.push({ offset, radius: lobeRadius });
      puffs.push({
        offset,
        radius: lobeRadius,
        squash: randRange(rng, 0.5, 0.65), // 底のローブは扁平にして「平ら」を強調
        instanceIndex: totalPuffs++,
      });
    }

    // --- ディテールパフ(各ローブの上面に乗る、小さめの塊。表面の凹凸=カリフラワー感を作る) ---
    for (const lobe of lobes) {
      const detailCount = 3 + Math.floor(rng() * 4); // 3〜6個
      for (let k = 0; k < detailCount; k++) {
        const ang = randRange(rng, 0, Math.PI * 2);
        const horizDist = lobe.radius * randRange(rng, 0.25, 0.7);
        const detailRadius = lobe.radius * randRange(rng, 0.35, 0.6);
        puffs.push({
          offset: new THREE.Vector3(
            lobe.offset.x + Math.cos(ang) * horizDist,
            lobe.offset.y + lobe.radius * randRange(rng, 0.35, 0.9),
            lobe.offset.z + Math.sin(ang) * horizDist * 0.85
          ),
          radius: detailRadius,
          squash: randRange(rng, 0.78, 1.0), // 上のパフは丸みを残す
          instanceIndex: totalPuffs++,
        });
      }
    }

    cloudClusters.push({
      puffs,
      angle: randRange(rng, 0, Math.PI * 2),
      radius: randRange(rng, CLOUD_RADIUS_MIN, CLOUD_RADIUS_MAX),
      baseY: CLOUD_HEIGHT + randRange(rng, -6, 8),
      driftSpeed: randRange(rng, 0.15, 0.4) * (rng() < 0.5 ? 1 : -1),
      bobPhase: randRange(rng, 0, Math.PI * 2),
      // このクラスタが「出現し始める」cloudAmountのしきい値。0〜1に均等に
      // 散らして少しジッターを加えることで、雲量が増えるにつれて雲が
      // 1つずつ増えていくようにする(全クラスタが同時に薄く/濃くなるのではなく)。
      activation: Math.min(1, Math.max(0, (i / (CLOUD_CLUSTER_COUNT - 1)) + randRange(rng, -0.04, 0.04))),
    });
  }

  const cloudMesh = new THREE.InstancedMesh(cloudPuffGeo, cloudPuffMat, totalPuffs);
  cloudMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cloudMesh.frustumCulled = false;
  cloudMesh.renderOrder = 0; // 雨(renderOrder=10)より必ず奥に描かれるようにする
  scene.add(cloudMesh);

  // ================= 稲妻(ジグザグスプライト) =================
  const boltTextures = [makeBoltTexture(rng), makeBoltTexture(rng), makeBoltTexture(rng)];
  const boltMat = new THREE.SpriteMaterial({
    map: boltTextures[0],
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
  });
  const boltSprite = new THREE.Sprite(boltMat);
  boltSprite.scale.set(14, 28, 1);
  boltSprite.visible = false;
  scene.add(boltSprite);
  let boltFade = 0; // 0になるまでフェードアウトさせる残り時間

  // --- 虹(雨上がり) ---
  const rainbowGeo = buildRainbowGeometry(RAINBOW_RADIUS, RAINBOW_BAND_WIDTH, RAINBOW_DISTANCE);
  const rainbowMaterial = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 } },
    vertexShader: rainbowVertexShader,
    fragmentShader: rainbowFragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    // AdditiveBlendingだと明るい空の色に加算されて白っぽく見えてしまうため、
    // 通常のアルファブレンディングに変更(はっきりした虹色にするため)
    blending: THREE.NormalBlending,
    fog: false,
  });
  const rainbowMesh = new THREE.Mesh(rainbowGeo, rainbowMaterial);
  rainbowMesh.visible = false;
  rainbowMesh.frustumCulled = false; // 巨大なジオメトリなので誤ってカリングされないようにする
  scene.add(rainbowMesh);

  let rainbowTimer = 0; // 残り表示時間(秒)
  let rainbowFade = 0; // 実際に使う不透明度(滑らかにフェードイン/アウト)
  let wasRaining = false;
  let rainPeakIntensity = 0;
  // デバッグ用: 天候セレクトから「虹(デバッグ表示)」を選んだ間、
  // 本来の発生条件(雨が降って止んだ・太陽高度など)を無視して常時表示する
  let forceRainbowDebug = false;
  const sunDirState = new THREE.Vector3(0.3, 0.7, 0.2).normalize();
  // デバッグ表示専用: 実際の太陽が真昼で天頂近くにあると反太陽点が
  // ほぼ真下を向いてしまい、虹が地面の下に隠れて見えなくなる。
  // デバッグ時は実際の時刻に関係なく、虹が見やすい太陽高度(約35°)を
  // 固定で使う。
  const DEBUG_RAINBOW_SUN_DIR = new THREE.Vector3(0.55, 0.58, 0.32).normalize();
  // 2026-09(改訂): 「虹の位置が低すぎて見えない」との指摘への対応。
  // 虹の見かけの高さは物理的には (42° - 太陽高度) で決まるため、太陽が
  // ある程度高い時間帯(日中でよく起こる)では虹の頂点が地平線から
  // わずか数°しか離れず、木や地形に隠れてほぼ見えなくなってしまう。
  // 上のDEBUG_RAINBOW_SUN_DIR(太陽高度約35°)ですら頂点はわずか約7°しか
  // 上がらず、根本的な解決になっていなかった。
  // 実際の太陽の見た目・ライティングには一切影響させず、「虹の位置を
  // 計算する時だけ」太陽高度に上限(約18°)を設ける演出上の簡略化を
  // 導入し、どんな時刻でも虹の頂点が地平線から約24°以上は必ず離れて
  // よく見えるようにする。
  const RAINBOW_ARC_SUN_ELEVATION_CAP_Y = Math.sin(THREE.MathUtils.degToRad(18));
  const rainbowAntisolarScratch = new THREE.Vector3();
  const rainbowLookTargetScratch = new THREE.Vector3();

  /** その日の太陽方向を渡してもらい、虹を反太陽点に向ける基準にする。 */
  function setSunDirection(dir) {
    sunDirState.copy(dir);
  }

  function updateRainbow(d, cameraPos) {
    if (forceRainbowDebug) {
      // デバッグ表示中は自然発生の条件判定を丸ごとスキップし、常に表示し続ける
      rainbowTimer = 5;
    } else {
      // 雨がある程度降った後、止んだ瞬間を検知する
      if (rainIntensity > 0.15) {
        wasRaining = true;
        rainPeakIntensity = Math.max(rainPeakIntensity, rainIntensity);
      } else if (wasRaining && rainIntensity <= 0.05) {
        wasRaining = false;
        // 太陽がある程度高く(日中〜夕方)、そこそこの雨だった場合だけ虹を出す
        if (rainPeakIntensity > 0.3 && sunDirState.y > 0.08) {
          rainbowTimer = randRange(rng, 45, 80);
        }
        rainPeakIntensity = 0;
      }
      if (rainbowTimer > 0) {
        rainbowTimer -= d;
        // 太陽が沈んだ、または再び雨が降り出したら消す
        if (sunDirState.y <= 0.02 || rainIntensity > 0.12) rainbowTimer = 0;
      }
    }
    const targetOpacity = rainbowTimer > 0 ? 1 : 0;
    rainbowFade += (targetOpacity - rainbowFade) * Math.min(1, d * 0.5);
    rainbowMesh.visible = rainbowFade > 0.01;
    if (rainbowMesh.visible) {
      rainbowMaterial.uniforms.uOpacity.value = rainbowFade;
      const sunDirForArc = forceRainbowDebug ? DEBUG_RAINBOW_SUN_DIR : sunDirState;
      // 見かけの太陽高度に上限をかけてから反太陽点を求める(上のコメント
      // 参照)。水平方向(方位)は元の太陽の向きをそのまま維持する。
      const cappedY = Math.min(sunDirForArc.y, RAINBOW_ARC_SUN_ELEVATION_CAP_Y);
      const horizLen = Math.hypot(sunDirForArc.x, sunDirForArc.z) || 1e-6;
      const horizScale = Math.sqrt(Math.max(0, 1 - cappedY * cappedY)) / horizLen;
      rainbowAntisolarScratch.set(
        -sunDirForArc.x * horizScale,
        -cappedY,
        -sunDirForArc.z * horizScale
      );
      rainbowMesh.position.copy(cameraPos);
      rainbowMesh.up.set(0, 1, 0);
      rainbowLookTargetScratch.copy(cameraPos).add(rainbowAntisolarScratch);
      rainbowMesh.lookAt(rainbowLookTargetScratch);
    }
  }


  function positionBolt(cameraPos) {
    const angle = randRange(rng, 0, Math.PI * 2);
    const dist = randRange(rng, CLOUD_RADIUS_MIN * 0.8, CLOUD_RADIUS_MAX);
    boltSprite.position.set(
      cameraPos.x + Math.cos(angle) * dist,
      CLOUD_HEIGHT - randRange(rng, 2, 10),
      cameraPos.z + Math.sin(angle) * dist
    );
    const scale = randRange(rng, 11, 18);
    boltSprite.scale.set(scale * 0.55, scale, 1);
    boltMat.map = boltTextures[Math.floor(rng() * boltTextures.length)];
    boltMat.needsUpdate = true;
  }

  function triggerLightning(cameraPos) {
    const power = randRange(rng, 0.35, 1) * (0.6 + stormFactor * 0.4);
    positionBolt(cameraPos);
    boltSprite.visible = true;
    boltMat.opacity = Math.min(1, 0.7 + power * 0.3);
    boltFade = randRange(rng, 0.12, 0.22);
    flashStrength = Math.min(1, power);
    for (const cb of lightningCallbacks) cb(power);
  }

  function scheduleNextStrike() {
    // 遷移中(暗さが増していく途中)でも「雷雨」としての最終的な頻度感に
    // 近い間隔になるよう、目標値(targetStormFactor)を使って計算する
    const gap = randRange(rng, 3.5, 9) / (0.5 + targetStormFactor);
    nextStrikeTimer = gap;
  }

  // ================= 天候切り替え =================
  /**
   * 実際に天候を適用する内部関数。手動切替(setWeather)・自動サイクルの
   * どちらからもここを通す(オートモードのON/OFF状態はここでは触らない)。
   */
  function applyWeatherInternal(name) {
    if (name === 'rainbow-debug') {
      // 虹の見た目を確認するためのデバッグ専用モード。
      // 雨・雷雨をやめて晴れに近い状態にしつつ、虹だけ強制表示する。
      forceRainbowDebug = true;
      currentWeather = 'clear';
      targetRainIntensity = 0;
      targetSnowIntensity = 0;
      targetCloudAmount = 0.15;
      targetStormFactor = 0;
      nextStrikeTimer = Infinity;
      return;
    }
    if (name !== 'clear' && name !== 'rain' && name !== 'storm' && name !== 'snow') return;
    forceRainbowDebug = false; // 通常の天候に戻したらデバッグ強制表示を解除
    currentWeather = name;
    if (name === 'clear') {
      targetRainIntensity = 0;
      targetSnowIntensity = 0;
      targetCloudAmount = 0.05;
      targetStormFactor = 0;
      nextStrikeTimer = Infinity;
    } else if (name === 'rain') {
      targetRainIntensity = 0.6;
      targetSnowIntensity = 0;
      targetCloudAmount = 0.55;
      targetStormFactor = 0;
      nextStrikeTimer = Infinity;
    } else if (name === 'storm') {
      targetRainIntensity = 0.95;
      targetSnowIntensity = 0;
      targetCloudAmount = 0.9;
      targetStormFactor = 1;
      // 切り替え直後は確認しやすいよう、最初の一発は少し早めに鳴らす
      nextStrikeTimer = randRange(rng, 1.5, 4);
    } else if (name === 'snow') {
      targetRainIntensity = 0;
      targetSnowIntensity = 0.85;
      targetCloudAmount = 0.6;
      targetStormFactor = 0;
      nextStrikeTimer = Infinity;
    }
  }

  /** 手動での天候切り替え(UIの手動選択用)。呼ぶとオートモードは解除される。 */
  function setWeather(name) {
    autoMode = false;
    applyWeatherInternal(name);
  }

  /**
   * 天候の自動サイクルのON/OFF。
   * @param {boolean} enabled
   */
  function setAutoMode(enabled) {
    autoMode = !!enabled;
    if (autoMode) autoCheckTimer = randRange(rng, AUTO_CHECK_MIN, AUTO_CHECK_MAX);
  }

  function isAutoMode() {
    return autoMode;
  }

  /**
   * 季節ごとの天候の出やすさ(season.jsのgetWeatherWeights()の戻り値)を渡す。
   * オートモード中、次の判定タイミングでこの重みに従って天候を選ぶ。
   */
  function setWeatherWeights(weights) {
    weatherWeights = weights;
  }

  /** weatherWeightsから重み付き確率で1つの天候名を選ぶ。 */
  function pickWeightedWeather() {
    const w = weatherWeights || { clear: 0.6, rain: 0.3, storm: 0.1, snow: 0 };
    const entries = Object.entries(w).filter(([, v]) => v > 0);
    const total = entries.reduce((sum, [, v]) => sum + v, 0);
    if (total <= 0) return 'clear';
    let r = rng() * total;
    for (const [name, v] of entries) {
      r -= v;
      if (r <= 0) return name;
    }
    return entries[entries.length - 1][0];
  }

  // ================= 毎フレーム更新 =================
  function update(delta, elapsed, cameraPos) {
    const d = Math.min(delta, 0.1); // タブ非アクティブ復帰時の巨大delta対策
    rainIntensity += (targetRainIntensity - rainIntensity) * Math.min(1, d * 1.1);
    snowIntensity += (targetSnowIntensity - snowIntensity) * Math.min(1, d * 1.1);
    cloudAmount += (targetCloudAmount - cloudAmount) * Math.min(1, d * 0.5);
    stormFactor += (targetStormFactor - stormFactor) * Math.min(1, d * 0.6);

    // --- 積雪量(降っている間ゆっくり増え、止むとゆっくり融ける) ---
    // 2026-09(春の融雪): 「春になっても雪が溶けにくいのは変。早めに
    // 溶かして」との指摘に対応。春(currentSeason==='spring')の間は、
    // 融雪速度を大幅に速める(冬の間や、単に晴れ間で一時的に降っていない
    // だけの時は、これまで通りゆっくりにしておく)。
    const meltRateMul = currentSeason === 'spring' ? 4.5 : 1;
    if (currentWeather === 'snow' && snowIntensity > 0.1) {
      snowCoverage = Math.min(1, snowCoverage + SNOW_COVERAGE_GAIN * d);
      snowDepth = Math.min(SNOW_DEPTH_MAX, snowDepth + SNOW_DEPTH_GAIN_PER_SEC * d);
    } else {
      snowCoverage = Math.max(0, snowCoverage - SNOW_COVERAGE_DECAY * meltRateMul * d);
      snowDepth = Math.max(0, snowDepth - SNOW_DEPTH_DECAY_PER_SEC * meltRateMul * d);
    }

    // --- 天候の自動サイクル(オートモード中のみ) ---
    if (autoMode) {
      autoCheckTimer -= d;
      if (autoCheckTimer <= 0) {
        const next = pickWeightedWeather();
        applyWeatherInternal(next); // オートモード自体は解除しない
        autoCheckTimer = randRange(rng, AUTO_CHECK_MIN, AUTO_CHECK_MAX);
      }
    }

    // --- 雨のストリーク ---
    const rainVisible = rainIntensity > 0.01;
    rainMesh.visible = rainVisible;
    if (rainVisible) {
      rainMat.opacity = 0.25 + rainIntensity * 0.45;
      const fallSpeedMul = 0.6 + rainIntensity * 0.7;
      const groundPlaneRel = APPROX_GROUND_REL;
      for (let i = 0; i < RAIN_COUNT; i++) {
        const drop = drops[i];
        drop.y -= drop.speed * fallSpeedMul * d;
        if (drop.y < groundPlaneRel || drop.y < HARD_BOTTOM_REL) {
          // 着地: この瞬間の実際の(x,z)で1回だけ正確な地形/川判定をする
          const worldX = cameraPos.x + drop.ox;
          const worldZ = cameraPos.z + drop.oz;
          spawnImpact(worldX, worldZ);

          drop.y = RAIN_TOP;
          drop.ox = randRange(rng, -RAIN_RADIUS, RAIN_RADIUS);
          drop.oz = randRange(rng, -RAIN_RADIUS, RAIN_RADIUS);
        }
        const sway = Math.sin(elapsed * 1.5 + drop.swayPhase) * 0.15;
        const wx = drop.ox + sway;
        const wz = drop.oz;
        dummy.position.set(cameraPos.x + wx, cameraPos.y + drop.y, cameraPos.z + wz);
        // 平面ジオメトリはそのままだと特定の角度から見ると消えてしまうため、
        // 常にプレイヤー(カメラ)の方を向くようY軸だけビルボード回転させる
        // (X方向に少し傾けているのは、雨が斜めに降っている見た目にするため)
        const yaw = Math.atan2(-wx, -wz);
        dummy.rotation.set(0.14, yaw, 0);
        // dummyは雲のパフ描画とも共有しているオブジェクトで、雲側は非表示の
        // クラスタをscale=(0,0,0)にして消す実装になっている。ここでscaleを
        // 明示的にリセットしないと、前フレームで雲側が最後にセットした
        // scale(たまたま0のことが多い)を雨がそのまま引き継いでしまい、
        // 雨粒が全て大きさゼロで描画される(=雨が全く見えなくなる)バグに
        // なっていた。これが「雨の線が消えた」の本当の原因。
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        rainMesh.setMatrixAt(i, dummy.matrix);
      }
      rainMesh.instanceMatrix.needsUpdate = true;
    }

    // --- 雪(ふわふわ揺れながらゆっくり落ちる) ---
    const snowVisible = snowIntensity > 0.01;
    snowMesh.visible = snowVisible;
    if (snowVisible) {
      snowMat.opacity = 0.35 + snowIntensity * 0.55;
      for (let i = 0; i < SNOW_COUNT; i++) {
        const f = flakes[i];
        f.y -= f.speed * d;
        if (f.y < SNOW_APPROX_GROUND_REL || f.y < SNOW_HARD_BOTTOM_REL) {
          f.y = SNOW_TOP;
          f.ox = randRange(rng, -SNOW_RADIUS, SNOW_RADIUS);
          f.oz = randRange(rng, -SNOW_RADIUS, SNOW_RADIUS);
        }
        const sway = Math.sin(elapsed * f.swaySpeed + f.swayPhase) * 0.5;
        const wx = f.ox + sway;
        const wz = f.oz + Math.cos(elapsed * f.swaySpeed * 0.7 + f.swayPhase) * 0.3;
        dummy.position.set(cameraPos.x + wx, cameraPos.y + f.y, cameraPos.z + wz);
        dummy.rotation.set(0, 0, elapsed * 0.3 + f.swayPhase);
        dummy.scale.set(f.s, f.s, f.s);
        dummy.updateMatrix();
        snowMesh.setMatrixAt(i, dummy.matrix);
      }
      snowMesh.instanceMatrix.needsUpdate = true;
    }

    // --- 地面の水飛沫(跳ねて消える。小さく・くっきりに) ---
    for (const s of splashPool) {
      if (s.life <= 0) continue;
      s.life -= d;
      if (s.life <= 0) {
        s.sprite.visible = false;
        continue;
      }
      const t = 1 - s.life / s.maxLife; // 0(発生時)→1(消える直前)
      const hop = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.05; // ごく小さく跳ねてから落ちる
      s.sprite.position.y = s.baseY + hop;
      s.sprite.material.opacity = (1 - t) * 0.9;
      const sc = 0.05 + 0.03 * (1 - t);
      s.sprite.scale.set(sc, sc, 1);
    }

    // --- 雲(立体クラスタをゆっくり移動させる) ---
    // 不透明度は常に一定(CLOUD_BASE_OPACITY)にし、天候による変化は
    // 「どのクラスタが見えているか(activationしきい値によるスケール)」と
    // 「色味(晴れ=白、嵐=グレー)」だけで表現する。これにより、雲同士が
    // 重なっても透けて見えることがなく、実際の雲のような一枚の塊に見える。
    const cloudColorMix = Math.min(1, cloudAmount * 0.55 + stormFactor * 0.6);
    cloudPuffMat.color.copy(CLOUD_COLOR_CLEAR).lerp(CLOUD_COLOR_STORM, cloudColorMix);
    {
      for (const c of cloudClusters) {
        c.angle += c.driftSpeed * d * 0.02;
        const cx = Math.cos(c.angle) * c.radius;
        const cz = Math.sin(c.angle) * c.radius;
        const cy = c.baseY + Math.sin(elapsed * 0.06 + c.bobPhase) * 0.6; // ごくゆっくり上下にも揺れる
        // cloudAmountがこのクラスタのactivationしきい値を超えるにつれて
        // 0→1へスムーズに大きくなる(透明度ではなくサイズでフェードする)
        const vis = Math.max(0, Math.min(1, (cloudAmount - c.activation) / CLOUD_FADE_BAND + 0.5));
        for (const p of c.puffs) {
          dummy.position.set(cx + p.offset.x, cy + p.offset.y, cz + p.offset.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(p.radius * vis, p.radius * p.squash * vis, p.radius * vis);
          dummy.updateMatrix();
          cloudMesh.setMatrixAt(p.instanceIndex, dummy.matrix);
        }
      }
      cloudMesh.instanceMatrix.needsUpdate = true;
    }

    // --- 雷の発生スケジュール(雷雨中のみ) ---
    if (currentWeather === 'storm' && Number.isFinite(nextStrikeTimer)) {
      nextStrikeTimer -= d;
      if (nextStrikeTimer <= 0) {
        triggerLightning(cameraPos);
        scheduleNextStrike();
      }
    }

    // --- フラッシュ・稲妻スプライトの減衰 ---
    if (flashStrength > 0) flashStrength = Math.max(0, flashStrength - d * 3.0);
    if (boltFade > 0) {
      boltFade -= d;
      boltMat.opacity = Math.max(0, boltMat.opacity - d * 5.5);
      if (boltFade <= 0 || boltMat.opacity <= 0) {
        boltSprite.visible = false;
        boltFade = 0;
      }
    }

    // --- 虹(雨上がり) ---
    updateRainbow(d, cameraPos);
  }

  // ================= 空・光への影響量 =================
  function getSkyModifier() {
    const darken = cloudAmount * 0.55 + stormFactor * 0.22;
    const brightnessMul = Math.max(0.2, 1 - darken);
    const colorTint = Math.min(1, cloudAmount * 0.75 + stormFactor * 0.25);
    const fogAmount = Math.min(1, cloudAmount * 0.7 + rainIntensity * 0.5 + snowIntensity * 0.35);
    return { brightnessMul, colorTint, fogAmount, flashBoost: flashStrength };
  }

  function onLightning(cb) {
    if (typeof cb === 'function') lightningCallbacks.push(cb);
  }

  /**
   * 樹氷(рime ice)の強さ(0..1)。積雪の深さが2〜3m程度の時にだけ起きる
   * 現象なので、単調増加ではなく「山型」のカーブにする。
   * (SNOW_DEPTH_RIME_MIN, PEAK_START, PEAK_END, MAX は現在のsnowDepthを
   *  基準にしたしきい値。詳細はファイル冒頭のコメントを参照)
   */
  function getRimeIntensity() {
    if (snowDepth <= SNOW_DEPTH_RIME_MIN || snowDepth >= SNOW_DEPTH_RIME_MAX) return 0;
    if (snowDepth < SNOW_DEPTH_RIME_PEAK_START) {
      return smoothstep(SNOW_DEPTH_RIME_MIN, SNOW_DEPTH_RIME_PEAK_START, snowDepth);
    }
    if (snowDepth <= SNOW_DEPTH_RIME_PEAK_END) return 1;
    return 1 - smoothstep(SNOW_DEPTH_RIME_PEAK_END, SNOW_DEPTH_RIME_MAX, snowDepth);
  }

  return {
    update,
    setWeather,
    getWeather: () => currentWeather,
    getRainIntensity: () => rainIntensity,
    getSnowIntensity: () => snowIntensity,
    getSnowCoverage: () => snowCoverage,
    getSnowDepth: () => snowDepth,
    /** v1.56-H4(検証用): 積雪の深さ(m)を直接指定する。実際の降雪を待たずに、雪の上の挙動を確認する。 */
    debugSetSnowDepth: (d) => { snowDepth = Math.max(0, Math.min(SNOW_DEPTH_MAX, d)); },
    getRimeIntensity,
    setSeason: (s) => { currentSeason = s; },
    setAutoMode,
    isAutoMode,
    setWeatherWeights,
    getSkyModifier,
    onLightning,
    setSunDirection,
    // 水面処理がoffの時は、川への着水で波紋を登録しない(false)
    setWaterRipplesEnabled: (enabled) => { waterRipplesEnabled = !!enabled; },
    GRAY_TINT,
    FLASH_COLOR,
  };
}
