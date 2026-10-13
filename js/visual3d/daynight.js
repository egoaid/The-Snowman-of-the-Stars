// daynight.js
// 時間経過による空・光・太陽と月の変化を扱う。
//
// 設計方針:
// - 「朝/昼/夕/夜」の4択で瞬時に切り替えるのではなく、24時間ぶんの
//   キーフレーム(色・明るさ)を用意し、現在時刻を挟む2点をなめらかに
//   補間する(夜明け・夕暮れの色の変化がグラデーションで見える)。
// - 太陽と月は、原点を中心にした大きな円周上を1日1周する「見た目だけの
//   スプライト(常にカメラ方向を向く板)」。影を落とす平行光源
//   (DirectionalLight)は、太陽が地平線より上にあれば太陽の方向、
//   夜で月のほうが高ければ月の方向を向くようにする(=影の向きが
//   一日を通して自然に変わり、夜は月明かりの向きに切り替わる)。
// - 毎フレーム呼ばれる前提なので、Color/Vector3のnewを極力避け、
//   使い回すスクラッチ変数だけで完結させている。

import * as THREE from 'three';

// 時刻(0〜24)ごとの空・太陽光・環境光の状態。この間をなめらかに補間する。
const KEYFRAMES = [
  { hour: 0, sky: 0x0a0e1c, sun: 0x8fa0d9, sunIntensity: 0.16, hemiSky: 0x141c38, hemiGround: 0x0a0e12, hemiIntensity: 0.3 },
  { hour: 5, sky: 0x0a0e1c, sun: 0x8fa0d9, sunIntensity: 0.16, hemiSky: 0x141c38, hemiGround: 0x0a0e12, hemiIntensity: 0.3 },
  { hour: 6.5, sky: 0xdba38f, sun: 0xffb37a, sunIntensity: 0.7, hemiSky: 0xc9a0a0, hemiGround: 0x3a2a2a, hemiIntensity: 0.42 },
  { hour: 8, sky: 0xcfa16a, sun: 0xffd9a0, sunIntensity: 1.4, hemiSky: 0xbfae8a, hemiGround: 0x3a3020, hemiIntensity: 0.5 },
  { hour: 12, sky: 0x6fb6ec, sun: 0xffffff, sunIntensity: 1.7, hemiSky: 0xa9d8f2, hemiGround: 0x4d6b3c, hemiIntensity: 0.65 },
  { hour: 16, sky: 0x6fb6ec, sun: 0xffffff, sunIntensity: 1.7, hemiSky: 0xa9d8f2, hemiGround: 0x4d6b3c, hemiIntensity: 0.65 },
  { hour: 17.5, sky: 0xc07868, sun: 0xffab6b, sunIntensity: 1.2, hemiSky: 0xc07868, hemiGround: 0x3a2a2a, hemiIntensity: 0.5 },
  { hour: 19, sky: 0x5a4a6a, sun: 0xaa7a9a, sunIntensity: 0.38, hemiSky: 0x4a3a5a, hemiGround: 0x1a1420, hemiIntensity: 0.4 },
  { hour: 21, sky: 0x0a0e1c, sun: 0x8fa0d9, sunIntensity: 0.16, hemiSky: 0x141c38, hemiGround: 0x0a0e12, hemiIntensity: 0.3 },
  { hour: 24, sky: 0x0a0e1c, sun: 0x8fa0d9, sunIntensity: 0.16, hemiSky: 0x141c38, hemiGround: 0x0a0e12, hemiIntensity: 0.3 },
];

const _lo = new THREE.Color();
const _hi = new THREE.Color();

/**
 * 現在時刻(0〜24)の空・光の状態を計算し、渡された3つのColorへ
 * 直接書き込む(新規オブジェクトを作らないので毎フレーム呼んでも軽い)。
 * @param {number} hour
 * @param {THREE.Color} outSky
 * @param {THREE.Color} outSun
 * @param {THREE.Color} outHemiSky
 * @param {THREE.Color} outHemiGround
 * @returns {{ sunIntensity: number, hemiIntensity: number }}
 */
export function computeSkyState(hour, outSky, outSun, outHemiSky, outHemiGround) {
  const h = ((hour % 24) + 24) % 24;
  let lo = KEYFRAMES[0];
  let hi = KEYFRAMES[KEYFRAMES.length - 1];
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    if (h >= KEYFRAMES[i].hour && h <= KEYFRAMES[i + 1].hour) {
      lo = KEYFRAMES[i];
      hi = KEYFRAMES[i + 1];
      break;
    }
  }
  const span = hi.hour - lo.hour || 1;
  const t = (h - lo.hour) / span;

  outSky.copy(_lo.set(lo.sky)).lerp(_hi.set(hi.sky), t);
  outSun.copy(_lo.set(lo.sun)).lerp(_hi.set(hi.sun), t);
  outHemiSky.copy(_lo.set(lo.hemiSky)).lerp(_hi.set(hi.hemiSky), t);
  outHemiGround.copy(_lo.set(lo.hemiGround)).lerp(_hi.set(hi.hemiGround), t);

  return {
    sunIntensity: lo.sunIntensity + (hi.sunIntensity - lo.sunIntensity) * t,
    hemiIntensity: lo.hemiIntensity + (hi.hemiIntensity - lo.hemiIntensity) * t,
  };
}

/**
 * ふわっと光るスプライト用のテクスチャを1回だけ生成する(canvas利用。
 * 毎フレームのコストはゼロ)。
 */
function makeGlowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

/**
 * 2026-09: 「晴れた夜の月はクレーターが見えるくらいシャープなのに、
 * このアプリの月は太陽と同じボヤけたグローになっていて変」という指摘を
 * 受けて追加。輪郭のはっきりした円に、いくつかの円形のクレーター模様を
 * 薄暗く重ねただけの簡単なテクスチャ(1回だけ生成、リアルタイムコストなし)。
 */
function makeMoonCraterTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;

  // 月面のベース(輪郭のはっきりした円。ソフトなグラデーションにはしない)
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = '#eef1f6';
  ctx.fill();

  // ごく僅かな陰影(左上を明るく、右下をわずかに暗く)で立体感を出す
  const shade = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, 0, cx, cy, r * 1.3);
  shade.addColorStop(0, 'rgba(255,255,255,0.35)');
  shade.addColorStop(0.6, 'rgba(255,255,255,0)');
  shade.addColorStop(1, 'rgba(120,130,150,0.25)');
  ctx.save();
  ctx.clip();
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, size, size);

  // クレーター(円の内側にだけ描画されるようclip済み)
  const craters = [
    { x: -0.30, y: -0.18, rr: 0.16 }, { x: 0.20, y: -0.32, rr: 0.10 },
    { x: 0.05, y: 0.05, rr: 0.20 }, { x: -0.15, y: 0.30, rr: 0.12 },
    { x: 0.32, y: 0.12, rr: 0.09 }, { x: -0.35, y: 0.10, rr: 0.07 },
    { x: 0.10, y: -0.02, rr: 0.06 },
  ];
  for (const c of craters) {
    const px = cx + c.x * r * 1.6, py = cy + c.y * r * 1.6, pr = c.rr * r * 1.6;
    const craterGrad = ctx.createRadialGradient(px, py, 0, px, py, pr);
    craterGrad.addColorStop(0, 'rgba(120,128,145,0.55)');
    craterGrad.addColorStop(0.7, 'rgba(140,148,163,0.3)');
    craterGrad.addColorStop(1, 'rgba(140,148,163,0)');
    ctx.fillStyle = craterGrad;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

// 2026-09: 「太陽・月が山脈の手前に重なって見える」バグの本当の原因は
// 深度バッファの精度ではなく、単純な幾何学的な問題だった。
// celestialCenterはプレイヤーの位置を追従するが、山脈リング(半径173〜253)は
// ワールド原点に固定されているため、プレイヤーが太陽の向きと逆方向へ
// Playable Area端(約81m)まで離れると、太陽までの距離(旧RADIUS=150)より
// 山脈までの距離の方が近くなる場面が発生し、太陽が山脈の手前に浮いて見えて
// いた。RADIUS を、Playable Area内のどの位置からでも近景山脈(半径173)より
// 確実に遠くなる値(約254m)より大きい280に引き上げて解消する。
const RADIUS = 280; // 見た目の太陽・月までの距離(演出用。影の光源とは別)
const EAST = new THREE.Vector3(1, 0, 0.35).normalize();
const _sunPos = new THREE.Vector3();
const _moonPos = new THREE.Vector3();
const _lightDir = new THREE.Vector3();

function celestialPosition(hour, offsetHours, center, out) {
  const angle = ((hour + offsetHours - 6) / 24) * Math.PI * 2;
  const horiz = Math.cos(angle);
  const vert = Math.sin(angle);
  out.set(
    center.x + EAST.x * RADIUS * horiz,
    center.y + RADIUS * vert * 0.85 + 12,
    center.z + EAST.z * RADIUS * horiz
  );
  return out;
}

/**
 * 太陽・月のスプライトを作る。scene.add(group)して使う。
 */
export function createCelestialBodies() {
  const group = new THREE.Group();
  const glowTex = makeGlowTexture();
  const moonCraterTex = makeMoonCraterTexture();

  const sunMaterial = new THREE.SpriteMaterial({
    map: glowTex, color: 0xfff3d6, transparent: true, depthWrite: false, fog: false,
  });
  const sunSprite = new THREE.Sprite(sunMaterial);
  // RADIUS を150→280へ拡大した分(約1.87倍)、見た目のサイズが小さくならないよう
  // スプライトのscaleも同じ比率で拡大している。
  sunSprite.scale.set(41, 41, 1);

  // 月は「ボヤけたグロー」と「輪郭のはっきりしたクレーター模様」の2枚重ね。
  // 晴天時はクレーター模様(moonCrispSprite)をはっきり見せ、
  // 曇り・雨天時はそれを薄くしてグローだけの淡いシルエットに近づける
  // (setMoonClarity()で制御)。
  const moonMaterial = new THREE.SpriteMaterial({
    map: glowTex, color: 0xc9d3ea, transparent: true, depthWrite: false, fog: false, opacity: 0.55,
  });
  const moonSprite = new THREE.Sprite(moonMaterial);
  moonSprite.scale.set(28, 28, 1);

  const moonCrispMaterial = new THREE.SpriteMaterial({
    map: moonCraterTex, color: 0xffffff, transparent: true, depthWrite: false, fog: false, opacity: 1,
  });
  const moonCrispSprite = new THREE.Sprite(moonCrispMaterial);
  moonCrispSprite.scale.set(17, 17, 1);
  // 同じ位置に重ねて描くので、常にグロー(奥)→クレーター(手前)の順で描画されるよう
  // renderOrderで明示しておく(depthWriteがどちらもfalseなので順序が揺れやすいため)。
  moonSprite.renderOrder = 0;
  moonCrispSprite.renderOrder = 1;

  group.add(sunSprite, moonSprite, moonCrispSprite);

  /**
   * 月のシャープさを設定する。
   * @param {number} clarity - 0(曇り/雨でボヤけている)〜1(快晴でクレーターまで見える)
   */
  function setMoonClarity(clarity) {
    const c = Math.max(0, Math.min(1, clarity));
    moonCrispMaterial.opacity = c;
    // 曇っているときはグロー側を大きく・淡く広げて「ボヤけている」質感を強める
    moonMaterial.opacity = 0.35 + (1 - c) * 0.45;
    const glowScale = 28 + (1 - c) * 13;
    moonSprite.scale.set(glowScale, glowScale, 1);
  }

  /**
   * @param {number} hour
   * @param {THREE.Vector3} center - 天体が回る中心(だいたいキャンプ地でよい)
   * @returns {{ sunPos: THREE.Vector3, moonPos: THREE.Vector3, lightDir: THREE.Vector3, isSunActive: boolean }}
   */
  function update(hour, center) {
    celestialPosition(hour, 0, center, _sunPos);
    celestialPosition(hour, 12, center, _moonPos);
    sunSprite.position.copy(_sunPos);
    moonSprite.position.copy(_moonPos);
    moonCrispSprite.position.copy(_moonPos);

    // 地平線の下にある方は薄く/非表示にする
    sunSprite.visible = _sunPos.y > center.y - 4;
    const moonVisible = _moonPos.y > center.y - 4;
    moonSprite.visible = moonVisible;
    moonCrispSprite.visible = moonVisible;

    const isSunActive = _sunPos.y >= _moonPos.y;
    const activePos = isSunActive ? _sunPos : _moonPos;
    _lightDir.copy(activePos).sub(center).normalize();

    return { sunPos: _sunPos, moonPos: _moonPos, lightDir: _lightDir, isSunActive };
  }

  return { group, update, setMoonClarity };
}
