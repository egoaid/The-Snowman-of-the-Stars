// starfield.js (v1.64)
// 晴れた夜の星空: 満天の星 + 天の川 + 流れ星。
//
// 方針(このアプリの映像表現に合わせる):
// - 描画は 480×270 の低解像度。星は「1〜3ピクセルの四角い点」にして、拡大してもくっきりした粒のままにする。
// - 星・天の川・流れ星は、すべて「見た目だけ」の層。山脈・地形・雲より奥(深度判定あり、深度は書かない)。
//   太陽・月(半径280m)より少し遠い半径(290m)に置く。カメラの遠方クリップは320m。
// - 空は、太陽・月と同じ軸(daynight.js の EAST × 上)のまわりを、1ゲーム内日で1周する。
// - 見える条件: 夜であること(空の明るさ・太陽の高さ)× 晴れていること(雲・雨・雪・霧が少ない)。
//   月が高いと、暗い星と天の川が弱まる(満月の夜は暗い星が消える)。
// - 流れ星は、空の回転とは無関係に、大気の中を短く横切る光の筋(1ピクセルの線)。晴れた夜だけ。
//
// このファイルは three.js 以外に依存しない。

import * as THREE from 'three';
import { makeRng } from './rng.js';

export const STAR_RADIUS = 290;      // 太陽・月(280)より遠く、遠方クリップ(320)より近い
const MILKY_RADIUS = 292;
const METEOR_RADIUS = 286;

// 天球の回転軸: 太陽・月の軌道面の法線(daynight.js の EAST=(1,0,0.35) と 上(0,1,0) の外積)。
const SKY_AXIS = new THREE.Vector3(1, 0, 0.35).normalize().cross(new THREE.Vector3(0, 1, 0)).normalize();

// 天の川の帯(天球座標系 = 星と一緒に回る座標)。NG = 銀河の北極、GC = 銀河中心の向き(帯の上の1点)。
const NG = new THREE.Vector3(0.38, 0.62, -0.69).normalize();
const GC = (() => {
  const a = new THREE.Vector3(0.2, -0.9, 0.4);
  a.addScaledVector(NG, -a.dot(NG)).normalize();
  return a;
})();
const GU = GC.clone();
const GV = new THREE.Vector3().crossVectors(NG, GU).normalize();

export const STARFIELD_CONFIG = {
  starCount: 7000,
  bandFraction: 0.42,       // 星のうち、天の川の帯に集めるぶんの割合
  bandSigma: 0.15,          // 帯の厚み(銀緯の sin のばらつき)
  starPx: 1.0,              // 暗い星の大きさ(描画バッファ上のピクセル)
  twinkle: 0.18,            // またたきの深さ(0〜1)。弱く
  milkyIntensity: 0.30,     // 天の川の明るさ(加算)
  rotationFactor: 1 / 6,    // 星空の回転の速さ。1なら太陽・月と同じ(1日で一周)。演出のため、太陽・月より遅くする
  reflectionSize: 512,      // 水面に映すための、星空のキューブマップの1面の大きさ
  meteorMax: 3,
  meteorIntervalMin: 22,    // 流れ星の間隔(秒): 晴れた夜に、最短〜最長のあいだで
  meteorIntervalMax: 75,
};

const STAR_COLORS = [
  [0.78, 0.86, 1.0],   // 青白
  [0.92, 0.95, 1.0],   // 白に近い青
  [1.0, 1.0, 1.0],     // 白
  [1.0, 0.93, 0.78],   // 黄白
  [1.0, 0.80, 0.62],   // 橙
];
const STAR_COLOR_WEIGHTS = [0.22, 0.28, 0.25, 0.15, 0.10];

function pickColor(u) {
  let acc = 0;
  for (let i = 0; i < STAR_COLOR_WEIGHTS.length; i++) {
    acc += STAR_COLOR_WEIGHTS[i];
    if (u <= acc) return STAR_COLORS[i];
  }
  return STAR_COLORS[STAR_COLORS.length - 1];
}

function gauss(rng) {
  // Box-Muller
  const u = Math.max(1e-9, rng()), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 星の位置・明るさ・色を作る(シードで再現できる。three.js の描画物は作らない)。テストでも使う。 */
export function generateStarData(seed, cfg = STARFIELD_CONFIG) {
  const rng = makeRng(((seed >>> 0) ^ 0x51ed270b) >>> 0 || 1);
  const n = cfg.starCount;
  const pos = new Float32Array(n * 3);
  const mag = new Float32Array(n);
  const col = new Float32Array(n * 3);
  const phase = new Float32Array(n);
  const tmp = new THREE.Vector3();
  const nBand = Math.floor(n * cfg.bandFraction);
  for (let i = 0; i < n; i++) {
    if (i < nBand) {
      // 天の川の帯の近く: 銀経は一様、銀緯は正規分布。銀河中心の側ほど少し濃くする(銀経のかたよらせ)
      let lon = rng() * Math.PI * 2;
      if (rng() < 0.35) lon = gauss(rng) * 0.8; // 銀河中心(lon=0)のまわりに集める
      const sinb = THREE.MathUtils.clamp(gauss(rng) * cfg.bandSigma, -0.95, 0.95);
      const cosb = Math.sqrt(1 - sinb * sinb);
      tmp.set(0, 0, 0)
        .addScaledVector(GU, Math.cos(lon) * cosb)
        .addScaledVector(GV, Math.sin(lon) * cosb)
        .addScaledVector(NG, sinb);
    } else {
      // 全天に一様
      const z = rng() * 2 - 1, t = rng() * Math.PI * 2, r = Math.sqrt(1 - z * z);
      tmp.set(r * Math.cos(t), z, r * Math.sin(t));
    }
    tmp.normalize();
    pos[i * 3] = tmp.x * STAR_RADIUS; pos[i * 3 + 1] = tmp.y * STAR_RADIUS; pos[i * 3 + 2] = tmp.z * STAR_RADIUS;
    // 明るさ: 暗い星がほとんど、明るい星が少し(等級の分布に近い)
    mag[i] = 0.15 + 0.85 * Math.pow(rng(), 5.0);
    const c = pickColor(rng());
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    phase[i] = rng();
  }
  return { pos, mag, col, phase, count: n };
}

const STAR_VERT = /* glsl */`
attribute float aMag;
attribute vec3 aCol;
attribute float aPhase;
uniform float uTime;
uniform float uVis;
uniform float uTwinkle;
uniform float uPx;
uniform float uMoonLight;
uniform float uMoonGlow;
uniform vec3 uMoonDir;
uniform float uHorizon;   // 1=地平線ぎわを暗くする(通常)。0=暗くしない(キューブマップを作る時)
varying vec3 vCol;
varying float vI;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 dir = normalize(wp.xyz - modelMatrix[3].xyz);
  float hor = mix(1.0, smoothstep(0.0, 0.22, dir.y), uHorizon);            // 地平線に近いほど、大気で暗い
  float moonDim = 1.0 - uMoonGlow * smoothstep(0.86, 0.998, dot(dir, uMoonDir)); // 月のまわりは、まぶしくて見えにくい
  float floorMag = uMoonLight * 0.30;                                      // このアプリの月は一晩中出ているので、効果は控えめ
  float m = smoothstep(floorMag - 0.20, floorMag + 0.05, aMag);             // 月明かりで、いちばん暗い星から弱まる(月が無ければ全部見える)
  float tw = 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * (1.5 + aPhase * 2.5) + aPhase * 40.0));
  vI = (0.25 + 0.75 * aMag) * uVis * hor * moonDim * m * tw;
  vCol = aCol;
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_PointSize = uPx * (1.0 + step(0.82, aMag) + step(0.97, aMag));       // 明るい星ほど大きい(1〜3ピクセル)
}
`;
const STAR_FRAG = /* glsl */`
varying vec3 vCol;
varying float vI;
void main() {
  gl_FragColor = vec4(vCol, vI);
}
`;

const MILKY_VERT = /* glsl */`
varying vec3 vDir;
varying vec3 vWorldDir;
void main() {
  vDir = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldDir = normalize(wp.xyz - modelMatrix[3].xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
// 天の川: 銀河面(帯)に沿った明るさ + 銀河中心側のふくらみ + ムラ(fbm) + 帯の中央の暗黒帯。
// 数式は、確認用のプレビュー(tools の numpy 版)と同じ定数を使う。
export const MILKY_GLSL_CONSTANTS = { bandSigma: 0.115, bulgeK: 3.0, dustSigma: 0.05, dustThresholdLo: 0.52, dustThresholdHi: 0.72 };
const MILKY_FRAG = /* glsl */`
uniform vec3 uNG;
uniform vec3 uGC;
uniform vec3 uGV;
uniform float uVis;
uniform float uIntensity;
uniform float uMoonDim;
uniform float uHorizon;
varying vec3 vDir;
varying vec3 vWorldDir;

float hash31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i);
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec3(7.1, 3.7, 5.3);
    a *= 0.5;
  }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  float b = dot(d, uNG);                                         // 銀緯の sin
  float band = exp(-b * b / (2.0 * ${MILKY_GLSL_CONSTANTS.bandSigma.toFixed(3)} * ${MILKY_GLSL_CONSTANTS.bandSigma.toFixed(3)}));
  float cg = dot(d, uGC);
  float bulge = exp(-(1.0 - cg) * ${MILKY_GLSL_CONSTANTS.bulgeK.toFixed(1)});     // 銀河中心側ほど濃い
  float structure = 0.45 + 1.1 * fbm(d * 6.0 + vec3(1.7, 4.2, 9.1));
  float fine = 0.75 + 0.5 * fbm(d * 17.0 + vec3(2.3, 8.8, 1.1));
  float rift = smoothstep(${MILKY_GLSL_CONSTANTS.dustThresholdLo.toFixed(2)}, ${MILKY_GLSL_CONSTANTS.dustThresholdHi.toFixed(2)}, fbm(d * 9.0 + vec3(3.1, 6.6, 2.2)))
             * exp(-b * b / (2.0 * ${MILKY_GLSL_CONSTANTS.dustSigma.toFixed(3)} * ${MILKY_GLSL_CONSTANTS.dustSigma.toFixed(3)}));  // 帯の中央の暗黒帯
  float I = band * (0.30 + 0.70 * bulge) * structure * fine * (1.0 - 0.75 * rift);
  vec3 cool = vec3(0.55, 0.66, 0.95);
  vec3 warm = vec3(1.0, 0.86, 0.66);
  vec3 col = mix(cool, warm, clamp(bulge * 0.9, 0.0, 1.0));
  float hor = mix(1.0, smoothstep(0.0, 0.25, vWorldDir.y), uHorizon);   // 地平線に近いほど暗い
  float a = I * uIntensity * uVis * uMoonDim * hor;
  gl_FragColor = vec4(col, a);
}
`;

/**
 * 星空を作る。scene.add(starfield.group) して、毎フレーム update() を呼ぶ。
 * @param {{seed?:number, config?:object}} [opts]
 */
export function createStarfield(opts = {}) {
  const cfg = { ...STARFIELD_CONFIG, ...(opts.config || {}) };
  const seed = (opts.seed ?? 1) >>> 0;

  const root = new THREE.Group();   // プレイヤーに追従(回転しない)
  root.name = 'starfield';
  const dome = new THREE.Group();   // 空の回転(星・天の川だけ)
  root.add(dome);

  // --- 星 ---
  const data = generateStarData(seed, cfg);
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(data.pos, 3));
  starGeo.setAttribute('aMag', new THREE.BufferAttribute(data.mag, 1));
  starGeo.setAttribute('aCol', new THREE.BufferAttribute(data.col, 3));
  starGeo.setAttribute('aPhase', new THREE.BufferAttribute(data.phase, 1));
  const starMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uVis: { value: 0 }, uTwinkle: { value: cfg.twinkle }, uPx: { value: cfg.starPx },
      uMoonLight: { value: 0 }, uMoonGlow: { value: 0 }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) }, uHorizon: { value: 1 },
    },
    vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.renderOrder = -1;
  dome.add(stars);

  // --- 天の川(内側から見る球)---
  const mwMat = new THREE.ShaderMaterial({
    uniforms: {
      uNG: { value: NG.clone() }, uGC: { value: GC.clone() }, uGV: { value: GV.clone() },
      uVis: { value: 0 }, uIntensity: { value: cfg.milkyIntensity }, uMoonDim: { value: 1 }, uHorizon: { value: 1 },
    },
    vertexShader: MILKY_VERT, fragmentShader: MILKY_FRAG,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, fog: false,
  });
  const mw = new THREE.Mesh(new THREE.SphereGeometry(MILKY_RADIUS, 48, 32), mwMat);
  mw.frustumCulled = false;
  mw.renderOrder = -2;
  dome.add(mw);

  // --- 流れ星 ---
  const meteorRng = makeRng(((seed ^ 0x2545f491) >>> 0) || 1);
  const TRAIL_N = 16;
  const meteors = [];
  for (let i = 0; i < cfg.meteorMax; i++) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
    const m = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false });
    const line = new THREE.Line(g, m);
    line.frustumCulled = false;
    line.visible = false;
    line.renderOrder = -1;
    root.add(line);
    meteors.push({ line, alive: false, t: 0, dur: 1, d0: new THREE.Vector3(), tan: new THREE.Vector3(), speed: 0.8, trail: 0.15, arc: 0.4, bright: 1 });
  }
  let meteorTimer = cfg.meteorIntervalMin * 0.5 + meteorRng() * cfg.meteorIntervalMin;
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

  function spawnMeteor(force = false) {
    const m = meteors.find((x) => !x.alive);
    if (!m) return false;
    // 始点: 仰角 30°〜80° のどこか(方位は自由)
    const el = (30 + meteorRng() * 50) * Math.PI / 180, az = meteorRng() * Math.PI * 2;
    m.d0.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    // 向き: おおむね下向き + ランダムな横向き(流れ星は落ちるように見える)
    _a.set(0, -1, 0); _a.addScaledVector(m.d0, -_a.dot(m.d0)).normalize();
    _b.crossVectors(m.d0, _a).normalize();
    const side = (meteorRng() * 2 - 1) * 0.9;
    m.tan.copy(_a).multiplyScalar(0.55 + meteorRng() * 0.45).addScaledVector(_b, side).normalize();
    m.arc = 0.28 + meteorRng() * 0.30;          // 16〜33° を横切る
    m.speed = 0.55 + meteorRng() * 0.55;        // rad/s
    m.trail = 0.10 + meteorRng() * 0.10;        // 尾の長さ 6〜11°
    m.dur = (m.arc + m.trail) / m.speed;
    m.bright = force ? 1 : 0.65 + meteorRng() * 0.35;
    m.t = 0; m.alive = true; m.line.visible = true;
    return true;
  }

  function updateMeteor(m, dt) {
    m.t += dt;
    if (m.t >= m.dur) { m.alive = false; m.line.visible = false; return; }
    const head = Math.min(m.arc, m.speed * m.t);
    const pos = m.line.geometry.attributes.position.array;
    const colr = m.line.geometry.attributes.color.array;
    const fadeIn = Math.min(1, m.t / 0.06);
    const fadeOut = Math.min(1, (m.dur - m.t) / 0.25);
    const env = fadeIn * fadeOut * m.bright;
    for (let k = 0; k < TRAIL_N; k++) {
      const s = k / (TRAIL_N - 1);
      const ang = Math.max(0, head - s * m.trail);
      _c.copy(m.d0).multiplyScalar(Math.cos(ang)).addScaledVector(m.tan, Math.sin(ang));
      pos[k * 3] = _c.x * METEOR_RADIUS; pos[k * 3 + 1] = _c.y * METEOR_RADIUS; pos[k * 3 + 2] = _c.z * METEOR_RADIUS;
      const f = Math.pow(1 - s, 1.6) * env;       // 先端が明るく、尾へ向かって消える
      colr[k * 3] = 0.95 * f; colr[k * 3 + 1] = 0.97 * f; colr[k * 3 + 2] = 1.0 * f;
    }
    m.line.geometry.attributes.position.needsUpdate = true;
    m.line.geometry.attributes.color.needsUpdate = true;
  }

  // --- 毎フレーム ---
  // 星空の回転角: 時刻から直接求めず、「ゲーム内の経過時間」を積み上げて決める。
  //   (回転を太陽・月より遅くしているので、時刻から求めると、0時をまたぐ時に空が飛んでしまう)
  //   初めの向きはシードで決まる(ワールドごとに、同じ時刻でも星の位置が違う)。
  const state = {
    vis: 0, night: 0, clarity: 1, moonLight: 0, lastMs: null, time: 0,
    angle: 1.1 + ((seed * 0.6180339887) % 1) * Math.PI * 2, lastHour: null,
    moonVis: 0, moonDir: new THREE.Vector3(0, 1, 0),
  };
  const skyRotInv = new THREE.Matrix3();   // 世界の向き → 星空の向き(水面の映り込み用)
  const _qInv = new THREE.Quaternion();
  const _m4 = new THREE.Matrix4();
  const _moonDir = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const smooth = THREE.MathUtils.smoothstep;

  /**
   * @param {object} p
   * @param {number} p.hour           ゲーム内の時刻(0〜24)
   * @param {THREE.Vector3} p.center  星空の中心(プレイヤーに追従)
   * @param {THREE.Vector3} p.sunPos  daynight の太陽の位置(中心からの相対ではなく世界座標)
   * @param {THREE.Vector3} p.moonPos 同、月
   * @param {number} p.skyLum         空の明るさ(0〜1、見た目の輝度)。夜は小さい
   * @param {number} p.clarity        晴れ具合(0〜1)。1=雲・雨・雪・霧なし
   * @param {number} [p.dt]           経過秒(省略すると、内部の時計から求める)
   */
  function update(p) {
    const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    let dt = p.dt;
    if (dt === undefined) dt = state.lastMs === null ? 0 : Math.min(0.25, (nowMs - state.lastMs) / 1000);
    state.lastMs = nowMs;
    state.time += dt;

    root.position.copy(p.center);
    // 空の回転: 太陽・月と同じ軸・同じ向き。ただし速さは rotationFactor 倍(演出として、太陽・月より遅い)
    if (state.lastHour !== null) {
      let dh = p.hour - state.lastHour;
      if (dh > 12) dh -= 24; else if (dh < -12) dh += 24;
      state.angle += (dh / 24) * Math.PI * 2 * cfg.rotationFactor;
    }
    state.lastHour = p.hour;
    _q.setFromAxisAngle(SKY_AXIS, state.angle);
    dome.quaternion.copy(_q);
    _qInv.copy(_q).invert();
    skyRotInv.setFromMatrix4(_m4.makeRotationFromQuaternion(_qInv));

    // 夜の度合い: 空が暗い × 太陽が地平線の下
    const sunS = (p.sunPos.y - p.center.y) / 280;
    const nightLum = 1 - smooth(p.skyLum, 0.10, 0.26);
    const nightSun = 1 - smooth(sunS, -0.20, 0.0);
    const night = Math.min(nightLum, nightSun);
    const clarity = THREE.MathUtils.clamp(p.clarity, 0, 1);
    const vis = night * smooth(clarity, 0.15, 0.85);

    // 月明かり
    const moonS = (p.moonPos.y - p.center.y) / 280;
    const moonLight = smooth(moonS, -0.05, 0.35) * 0.6 * clarity;
    _moonDir.copy(p.moonPos).sub(p.center).normalize();

    state.vis = vis; state.night = night; state.clarity = clarity; state.moonLight = moonLight;
    // 川面に映す月: 月が地平線の上にあり、晴れているほど強い(夜かどうかは、水面シェーダー側で見る)
    state.moonDir.copy(_moonDir);
    state.moonVis = smooth(moonS, 0.0, 0.10) * smooth(clarity, 0.2, 0.8);

    const su = starMat.uniforms;
    su.uTime.value = state.time; su.uVis.value = vis;
    su.uMoonLight.value = moonLight; su.uMoonGlow.value = 0.8 * (moonLight / 0.6);
    su.uMoonDir.value.copy(_moonDir);
    const mu = mwMat.uniforms;
    mu.uVis.value = vis; mu.uMoonDim.value = 1 - 0.45 * (moonLight / 0.6);

    stars.visible = vis > 0.002;
    mw.visible = vis > 0.002;

    // 流れ星: 晴れた夜(見える度合いが高い時)だけ。間隔はゆらぐ
    if (vis > 0.6) {
      meteorTimer -= dt;
      if (meteorTimer <= 0) {
        spawnMeteor();
        meteorTimer = cfg.meteorIntervalMin + meteorRng() * (cfg.meteorIntervalMax - cfg.meteorIntervalMin);
      }
    }
    for (const m of meteors) if (m.alive) updateMeteor(m, dt);
  }

  // --- 水面に映すための、星空のキューブマップ ---
  // 起動時に1回だけ、星と天の川を「回転しない基準の向き」で描いておく。毎フレームは、
  // 水面のシェーダーが、反射方向を星空の回転の逆回転で変換して引くだけ(再描画は要らない)。
  let reflectionRT = null;
  function bakeReflection(renderer) {
    if (reflectionRT || !renderer) return !!reflectionRT;
    reflectionRT = new THREE.WebGLCubeRenderTarget(cfg.reflectionSize, {
      generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    const tmp = new THREE.Scene();
    tmp.background = new THREE.Color(0x000000);
    const camCube = new THREE.CubeCamera(0.1, 400, reflectionRT);
    tmp.add(camCube);
    // 退避 → 基準の状態にする(見える度合い1、月なし、地平線の暗さなし、またたきなし、原点・回転なし)
    const saved = {
      parent: dome.parent, q: dome.quaternion.clone(),
      vis: su_vis(), moonLight: starMat.uniforms.uMoonLight.value, moonGlow: starMat.uniforms.uMoonGlow.value,
      tw: starMat.uniforms.uTwinkle.value, hz: starMat.uniforms.uHorizon.value, mvis: mwMat.uniforms.uVis.value,
      mdim: mwMat.uniforms.uMoonDim.value, mhz: mwMat.uniforms.uHorizon.value, px: starMat.uniforms.uPx.value,
      sv: stars.visible, mv: mw.visible,
    };
    tmp.add(dome);
    dome.quaternion.identity();
    starMat.uniforms.uVis.value = 1; starMat.uniforms.uMoonLight.value = 0; starMat.uniforms.uMoonGlow.value = 0;
    starMat.uniforms.uTwinkle.value = 0; starMat.uniforms.uHorizon.value = 0; starMat.uniforms.uPx.value = 1.5;
    mwMat.uniforms.uVis.value = 1; mwMat.uniforms.uMoonDim.value = 1; mwMat.uniforms.uHorizon.value = 0;
    stars.visible = true; mw.visible = true;
    camCube.position.set(0, 0, 0);
    camCube.update(renderer, tmp);
    // 元に戻す
    root.add(dome);
    dome.quaternion.copy(saved.q);
    starMat.uniforms.uVis.value = saved.vis; starMat.uniforms.uMoonLight.value = saved.moonLight; starMat.uniforms.uMoonGlow.value = saved.moonGlow;
    starMat.uniforms.uTwinkle.value = saved.tw; starMat.uniforms.uHorizon.value = saved.hz; starMat.uniforms.uPx.value = saved.px;
    mwMat.uniforms.uVis.value = saved.mvis; mwMat.uniforms.uMoonDim.value = saved.mdim; mwMat.uniforms.uHorizon.value = saved.mhz;
    stars.visible = saved.sv; mw.visible = saved.mv;
    return true;
  }
  function su_vis() { return starMat.uniforms.uVis.value; }

  /** 水面の映り込み用の値。キューブマップを作っていない時は texture が null(何も映らない)。 */
  function getReflection() {
    // 星の見える度合い × 月が高い時の弱まり(水面では、月自身のきらめきが別に出るので、星は控えめに)
    const strength = state.vis * (1 - 0.3 * (state.moonLight / 0.6));
    return { texture: reflectionRT ? reflectionRT.texture : null, rotation: skyRotInv, strength, moonDir: state.moonDir, moonStrength: state.moonVis };
  }

  function dispose() {
    if (reflectionRT) reflectionRT.dispose();
    starGeo.dispose(); starMat.dispose(); mw.geometry.dispose(); mwMat.dispose();
    for (const m of meteors) { m.line.geometry.dispose(); m.line.material.dispose(); }
  }

  return {
    group: root,
    update,
    dispose,
    bakeReflection,
    getReflection,
    /** 検証用: すぐに流れ星を1つ出す(見える度合いに関係なく)。 */
    triggerMeteor: () => { const r = spawnMeteor(true); if (r) { /* 次の自動発生までの間隔は変えない */ } return r; },
    getInfo: () => ({ moonVis: state.moonVis, rotationFactor: cfg.rotationFactor, angle: state.angle, vis: state.vis, night: state.night, clarity: state.clarity, moonLight: state.moonLight, stars: data.count, meteorsActive: meteors.filter((m) => m.alive).length }),
    /** テスト用: 星のデータ(位置・明るさ)。 */
    _data: data,
  };
}

export { SKY_AXIS, NG as GALACTIC_POLE, GC as GALACTIC_CENTER };
