// pollinators.js
// 花畑まわりの蝶・蜂と、木に取り付ける蜂の巣。
// 2026-09: 新規追加。「晴れた日の午前中は花に蝶々や蜂が飛んでくる」
// 「花畑の近くの木には蜂の巣がある」という要望に対応する。
//
// 2026-09(改訂1): 「蝶々と蜂を3Dで作ってください」との指摘を受け、常に
// カメラの方を向く2D billboard(THREE.Sprite)から、実際に進行方向へ
// 向きを変える3DのGroup(胴体+ヒンジで羽ばたく羽根)に作り直した。
//
// 2026-09(改訂2・本ファイル): 「マイクラの蜂のような可愛さ(ブロック型に
// しろという意味ではない)」「絵本に出てくるようなイメージ。リアルな蝶や
// 蜂は不要。雪だるまの世界観に合わせて」という指摘を受け、以下の方針で
// 全面的に作り直した。
//
// 【設計方針】
// - シェーディングをMeshStandardMaterial(PBR)からMeshToonMaterialへ統一。
//   雪だるま・木・岩など、この世界の他のすべてのオブジェクトがトゥーン
//   シェーディングなので、蝶・蜂だけ質感が違って「浮いて見える」原因に
//   なっていたと考えられる。
// - 雪だるまと同じ「頭+胴体」「大きな黒目+白いハイライト」「頬の赤み」の
//   構成部品をそのまま流用し(専用の顔パーツ生成関数を共通化)、世界観の
//   統一感を出す。リアルな昆虫の解剖学的な正確さは目指さない。
// - 蜂の胴体は、リング状のパーツを積み重ねる「ハチのくびれ」表現をやめ、
//   1つの丸くて太めの胴体+頭の2パーツ構成にした(雪だるまの「体+頭」と
//   同じ考え方)。縞模様は胴体に密着させた帯にして、分離した歯車のような
//   見た目にならないようにする。
// - 羽根は柔らかくぼかした楕円のアルファマスクにして、パステルカラーを
//   ティントで乗せる(蝶は個体ごとに色を変え、花畑らしい賑やかさを出す)。
// - 「蝶の動きが気持ち悪い」という指摘への対応として、向きを毎フレーム
//   即座にlookAt()するのをやめ、Quaternionのslerpでなめらかに追従させる
//   ようにした(移動方向が反転する瞬間に一瞬で180度振り向く、という
//   不自然な動きが主な原因と考えられる)。
// - 大きさもやや大きめにして、遠くからでも「あ、蝶々/蜂がいる」と
//   気づきやすくした(リアルな縮尺よりも、絵本の中の生き物としての
//   視認性・愛らしさを優先する)。
// - 表示のON/OFFはscene3d.js側から setActive(bool) で制御する。
//
// 2026-09(改訂3): 実機確認のフィードバックを受けて追加調整。
// - 蜂: 全体を拡大(bodyRadius 0.05→0.075)。花へ向かう移動の横揺れ
//   (wob)が「蛇行して気持ち悪い」原因だったため撤去し、直進に変更。
// - 蝶: 「絵本のディズニー風」「Pieris rapae(モンシロチョウ)の姿で
//   黄色」との指摘を受け、専用の羽根テクスチャ(丸い輪郭+前翅の黒斑紋)
//   を新設し、色をランダムなパステル6色から黄色系に統一。全体サイズも
//   拡大した(以前の細長い羽根+ぼやけたアルファが「蛾っぽい」印象の
//   原因と考えられたため)。

import * as THREE from 'three';
import { getToonGradientMap } from './shading.js';

// ================= 共通素材(雪だるまと共通の「顔」の考え方) =================
const EYE_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x2c2822 });
const EYE_HIGHLIGHT_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
const BLUSH_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xf4a0a0, transparent: true, opacity: 0.4 });
const ANTENNA_MATERIAL = new THREE.MeshToonMaterial({ color: 0x2c2822, gradientMap: getToonGradientMap() });

const BEE_BODY_MATERIAL = new THREE.MeshToonMaterial({ color: 0xf0c04a, gradientMap: getToonGradientMap() });
const BEE_STRIPE_MATERIAL = new THREE.MeshToonMaterial({ color: 0x3a2a18, gradientMap: getToonGradientMap() });
const BUTTERFLY_BODY_MATERIAL = new THREE.MeshToonMaterial({ color: 0x4a3a2a, gradientMap: getToonGradientMap() });

// 蝶の羽根の色。「Pieris rapae(モンシロチョウ)の姿で、黄色がよい」との
// 指摘を受け、以前のランダムなパステル多色から、モンシロチョウの前翅先端の
// 黒斑紋を残したまま地色だけを黄色系に統一した(個体差として明度だけ
// わずかに揺らす)。
const BUTTERFLY_COLOR_BASE = 0xf5d94a;

/**
 * 羽根用の、柔らかくぼかした楕円のアルファマスクテクスチャ。
 * 色は付けず白のグラデーションのみにして、実際の色はMaterial.colorの
 * ティントで乗せる(1つのテクスチャを使い回せるので軽量)。
 */
let cachedWingTexture = null;
function getWingTexture() {
  if (cachedWingTexture) return cachedWingTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.92)');
  grad.addColorStop(0.85, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  // ごく薄い葉脈風の線(絵本のイラストらしい、控えめな装飾)
  ctx.strokeStyle = 'rgba(120,100,90,0.18)';
  ctx.lineWidth = 1;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(size * 0.15, size / 2);
    ctx.quadraticCurveTo(size * 0.5, size / 2 + i * size * 0.09, size * 0.85, size / 2 + i * size * 0.03);
    ctx.stroke();
  }
  cachedWingTexture = new THREE.CanvasTexture(canvas);
  return cachedWingTexture;
}

/**
 * ヒンジ式(根元の辺をピボットに、rotation.zで開閉)の羽根ペアを作る。
 * @param {number} tintColor - 羽根の色(ティント)
 * @param {number} opacity
 * @param {number} wingLength - 胴体からの長さ
 * @param {number} wingWidth
 */
function buildWingPair(tintColor, opacity, wingLength, wingWidth) {
  const geo = new THREE.PlaneGeometry(wingLength, wingWidth);
  geo.translate(wingLength / 2, 0, 0); // 内側の辺(x=0)をピボットにする
  const mat = new THREE.MeshBasicMaterial({
    map: getWingTexture(), color: tintColor, transparent: true, opacity,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const right = new THREE.Mesh(geo, mat);
  const left = new THREE.Mesh(geo, mat);
  left.scale.x = -1; // 左右反転して逆側に生やす
  // 2026-09: 「左右の羽が交互に動いているように見える」バグの修正。
  // scale.x=-1で鏡映しているため、左右に全く同じrotation.zを与えると、
  // 鏡映によって回転の向きの手系(handedness)が反転し、見た目上は
  // 左右が逆方向(=交互)に動いてしまっていた。flapWings()側でこの
  // 符号を参照し、左右が同じ向き(同時に上がる/下がる)になるよう補正する。
  right.userData.wingMirrorSign = 1;
  left.userData.wingMirrorSign = -1;
  return { left, right };
}

/**
 * 蝶専用の羽根テクスチャ。以前の柔らかい放射ぼかし(蛾のような輪郭の
 * にじみの原因になっていた)をやめ、丸みのあるはっきりした輪郭に変更。
 * withTip=true の場合、モンシロチョウ(Pieris rapae)らしい前翅先端の
 * 黒い斑紋を追加する(既存のアルファ形状の内側にだけ乗るよう
 * source-atop合成で描く)。
 * @param {boolean} withTip
 */
let cachedButterflyWingTextures = {};
function getButterflyWingTexture(withTip) {
  const key = withTip ? 'tip' : 'plain';
  if (cachedButterflyWingTextures[key]) return cachedButterflyWingTextures[key];
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.translate(size * 0.52, size * 0.5);
  // 丸みのある翅のシルエット(以前の細長い楕円より幅を持たせ、蛾っぽい
  // 細さを解消)
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.46, size * 0.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.fill();
  ctx.restore();
  // ごく薄いエッジのぼかしのみ(完全な直線的エッジは不自然なため)
  ctx.save();
  ctx.filter = 'blur(1.5px)';
  ctx.globalCompositeOperation = 'destination-over';
  ctx.beginPath();
  ctx.ellipse(size * 0.52, size * 0.5, size * 0.47, size * 0.41, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fill();
  ctx.restore();
  if (withTip) {
    // 前翅先端の黒い斑紋(モンシロチョウらしい特徴)。既存の翅の
    // アルファがある部分にだけ重なるよう source-atop で合成する。
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.beginPath();
    ctx.ellipse(size * 0.78, size * 0.26, size * 0.17, size * 0.15, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(35,30,24,0.88)';
    ctx.fill();
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  cachedButterflyWingTextures[key] = tex;
  return tex;
}

/**
 * 蝶用の羽根ペア(丸みのある輪郭+専用テクスチャ)。buildWingPair()と
 * ほぼ同じだが、蜂と共有しない専用テクスチャを使う。
 * @param {boolean} withTip - 前翅の黒斑紋(モンシロチョウらしさ)を入れるか
 */
function buildButterflyWingPair(tintColor, opacity, wingLength, wingWidth, withTip) {
  const geo = new THREE.PlaneGeometry(wingLength, wingWidth);
  // 2026-09(改訂6): 「上下(天に向かって開閉する)動きが正しいが、以前の
  // 軸(rotation.y)だと後ろへ向かって羽ばたいて見える」との指摘に対応。
  // PlaneGeometryは既定でXY平面上にあり、根元の辺(x=0)はY軸方向に伸びて
  // いた。この状態でrotation.zを使うと根元の辺がZ回転軸(原点を通るZ軸)
  // 上に乗っておらずせん断してしまい、rotation.yを使うと根元は固定できる
  // ものの羽先が水平(前後)方向にしか振れず「後ろに羽ばたく」ように見えて
  // いた。そこで羽根の平面をXZ平面に回転させ(根元の辺をZ軸方向に伸ばす)
  // ことで、rotation.zで根元の辺を完全に固定したまま、羽先が上(空)へ
  // 向かって振れる正しい動きにした。
  geo.rotateX(Math.PI / 2);
  geo.translate(wingLength / 2, 0, 0);
  const mat = new THREE.MeshBasicMaterial({
    map: getButterflyWingTexture(withTip), color: tintColor, transparent: true, opacity,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const right = new THREE.Mesh(geo, mat);
  const left = new THREE.Mesh(geo, mat);
  left.scale.x = -1;
  right.userData.wingMirrorSign = 1;
  left.userData.wingMirrorSign = -1; // 上のbuildWingPair()のコメント参照
  return { left, right };
}

/**
 * 雪だるまと同じ考え方の「可愛い顔」(大きな黒目+ハイライト+頬の赤み+
 * 小さな触角)を、指定した頭部メッシュに追加する。蝶・蜂で共通利用する
 * ことで、世界観の統一感を出す。
 * @param {THREE.Group} headGroup - 顔パーツを追加する先(頭の中心が原点)
 * @param {number} headRadius
 */
function attachCuteFace(headGroup, headRadius) {
  // 目(頭の大きさに対してかなり大きめ。これが「可愛さ」の一番の要)
  const eyeGeo = new THREE.SphereGeometry(headRadius * 0.4, 8, 6);
  const highlightGeo = new THREE.SphereGeometry(headRadius * 0.12, 6, 5);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, EYE_MATERIAL);
    eye.position.set(headRadius * 0.42 * side, headRadius * 0.08, headRadius * 0.78);
    headGroup.add(eye);
    const highlight = new THREE.Mesh(highlightGeo, EYE_HIGHLIGHT_MATERIAL);
    highlight.position.set(
      headRadius * 0.42 * side + headRadius * 0.12 * side,
      headRadius * 0.08 + headRadius * 0.12,
      headRadius * 0.78 + headRadius * 0.2
    );
    headGroup.add(highlight);
  }

  // 頬の赤み(雪だるまと同じ色・同じ考え方)
  const blushGeo = new THREE.SphereGeometry(headRadius * 0.32, 7, 5);
  for (const side of [-1, 1]) {
    const blush = new THREE.Mesh(blushGeo, BLUSH_MATERIAL);
    blush.scale.set(1, 0.7, 0.4);
    blush.position.set(headRadius * 0.62 * side, -headRadius * 0.18, headRadius * 0.62);
    headGroup.add(blush);
  }

  // 触角(先端に小さな丸い玉が付いた、絵本によくある可愛い形)
  const antennaMat = ANTENNA_MATERIAL;
  const antennaGeo = new THREE.CylinderGeometry(headRadius * 0.035, headRadius * 0.05, headRadius * 0.9, 5);
  const antennaTipGeo = new THREE.SphereGeometry(headRadius * 0.14, 6, 5);
  for (const side of [-1, 1]) {
    const antenna = new THREE.Mesh(antennaGeo, antennaMat);
    antenna.position.set(headRadius * 0.28 * side, headRadius * 0.75, headRadius * 0.1);
    antenna.rotation.z = side * 0.35;
    antenna.rotation.x = -0.5;
    headGroup.add(antenna);
    const tip = new THREE.Mesh(antennaTipGeo, antennaMat);
    tip.position.set(headRadius * 0.28 * side + side * headRadius * 0.35, headRadius * 1.1, headRadius * 0.4);
    headGroup.add(tip);
  }
}

/**
 * 絵本調の3Dの蝶(小さな丸い頭+胴体+ヒンジで開閉する羽根4枚)を作る。
 * ローカル+Z方向を「進行方向(頭が向く先)」とする。
 */
function createButterflyMesh() {
  const group = new THREE.Group();

  // 2026-09(改訂4): 「羽の構造・飛行方法が間違っている。正しく表現して
  // 欲しい(ディズニー風で)」との指摘を受け、雪だるまと同じ「大きい球+
  // 小さい球」だけの胴体をやめ、実際の鱗翅目(チョウ)の体節に沿った
  // 頭部(head)・胸部(thorax、羽根が付く場所)・腹部(abdomen、後方へ
  // 細く伸びて少し下に垂れる)の3パーツ構成に作り直した。
  // 2026-09(改訂6): 「ボディが大きすぎて気持ち悪い」との指摘に対応し、
  // 胴体を実際のモンシロチョウにより近いスリムな比率へ縮小(羽根の
  // サイズはそのまま。位置決めはthoraxRadius基準なので自動的に追従する)。
  const headRadius = 0.016;
  const thoraxRadius = 0.021;

  // 胸部(体の中心。羽根はここに付く)
  const thorax = new THREE.Mesh(new THREE.SphereGeometry(thoraxRadius, 9, 7), BUTTERFLY_BODY_MATERIAL);
  thorax.scale.set(1, 0.92, 1.05);
  group.add(thorax);

  // 腹部(胸部の後方から細く伸び、先端が少し下に垂れる。実際のモンシロ
  // チョウの体つきに近づけた)
  const abdomen = new THREE.Mesh(new THREE.SphereGeometry(thoraxRadius * 0.62, 8, 6), BUTTERFLY_BODY_MATERIAL);
  abdomen.scale.set(0.85, 0.8, 2.1);
  abdomen.position.set(0, -thoraxRadius * 0.08, -thoraxRadius * 1.15);
  abdomen.rotation.x = 0.32; // 先端を少し下に垂らす
  group.add(abdomen);

  // 頭部(胸部のすぐ前。目・鼻・触角はここに付く)
  const headGroup = new THREE.Group();
  headGroup.position.z = thoraxRadius + headRadius * 0.55;
  const head = new THREE.Mesh(new THREE.SphereGeometry(headRadius, 8, 6), BUTTERFLY_BODY_MATERIAL);
  headGroup.add(head);
  attachCuteFace(headGroup, headRadius);
  group.add(headGroup);

  // 羽根の色はモンシロチョウをイメージした黄色系に統一(個体ごとに
  // 明度だけごくわずかに揺らして単調にならないようにする)
  const shade = 0.9 + Math.random() * 0.2;
  const tint = new THREE.Color(BUTTERFLY_COLOR_BASE).multiplyScalar(shade).getHex();

  // 前翅(大きめ、黒い翅端斑紋あり)・後翅(小さめ、斑紋なし)の2ペア=
  // 計4枚。実際のチョウと同じく、胸部の背側(dorsal、体の中心線より
  // 少し上)の、ごく近い2点(前翅は中胸、後翅は後胸)から生えるように
  // ピボット位置を胸部の中に近づけた(以前は前翅と後翅が胴体半径の
  // 0.8倍も離れており、別々の生き物の羽根のように見えていた)。
  const fore = buildButterflyWingPair(tint, 0.98, 0.2, 0.18, true);
  fore.left.position.set(0, thoraxRadius * 0.55, thoraxRadius * 0.22);
  fore.right.position.set(0, thoraxRadius * 0.55, thoraxRadius * 0.22);
  const hind = buildButterflyWingPair(tint, 0.94, 0.15, 0.15, false);
  hind.left.position.set(0, thoraxRadius * 0.4, -thoraxRadius * 0.2);
  hind.right.position.set(0, thoraxRadius * 0.4, -thoraxRadius * 0.2);
  group.add(fore.left, fore.right, hind.left, hind.right);

  return {
    group,
    // 前翅・後翅を別々にflapできるよう、配列を分けて返す
    // (wings: 従来通りの全羽根まとめた配列。互換性のため維持)
    wings: [fore.left, fore.right, hind.left, hind.right],
    foreWings: [fore.left, fore.right],
    hindWings: [hind.left, hind.right],
  };
}

/**
 * 絵本調の3Dの蜂(丸くて太めの胴体+小さな頭+ヒンジで開閉する羽根2枚)を
 * 作る。マインクラフトの蜂のような「丸みのある可愛さ」をイメージしている
 * (ブロック状の見た目にはしない)。
 */
function createBeeMesh() {
  const group = new THREE.Group();

  // 胴体: まるまると太った1つの球(縞模様は表面に密着させた帯で表現し、
  // 別パーツが浮いているように見えないようにする)。「もう少し大きく」
  // との指摘を受け、以前よりひと回り拡大。
  const bodyRadius = 0.075;
  const body = new THREE.Mesh(new THREE.SphereGeometry(bodyRadius, 12, 9), BEE_BODY_MATERIAL);
  body.scale.set(1, 0.92, 1.15); // 進行方向(Z)へ少しだけ伸ばした、まん丸に近い胴体
  group.add(body);

  // 縞模様(胴体の表面にぴったり沿わせた、平たいリング状の帯)
  for (const zOff of [-bodyRadius * 0.15, bodyRadius * 0.45]) {
    const stripe = new THREE.Mesh(
      new THREE.TorusGeometry(bodyRadius * 0.94, bodyRadius * 0.22, 8, 14),
      BEE_STRIPE_MATERIAL
    );
    stripe.scale.z = 0.55; // 胴体のカーブに沿わせるため、厚みを潰す
    stripe.position.z = zOff;
    group.add(stripe);
  }

  // 頭(胴体より小さい球。ここに大きな目・頬・触角を付ける)
  const headRadius = bodyRadius * 0.62;
  const headGroup = new THREE.Group();
  headGroup.position.z = bodyRadius * 1.05;
  const head = new THREE.Mesh(new THREE.SphereGeometry(headRadius, 10, 8), BEE_BODY_MATERIAL);
  headGroup.add(head);
  attachCuteFace(headGroup, headRadius);
  group.add(headGroup);

  // 羽根(体に対してやや大きめの、淡いブルーホワイトの半透明な羽根。
  // 絵本の妖精の羽根のようなイメージ)
  const wings = buildWingPair(0xeaf3ff, 0.55, bodyRadius * 1.9, bodyRadius * 1.3);
  wings.left.position.set(0, bodyRadius * 0.75, bodyRadius * 0.1);
  wings.right.position.set(0, bodyRadius * 0.75, bodyRadius * 0.1);
  group.add(wings.left, wings.right);

  return { group, wings: [wings.left, wings.right] };
}

/** 蝶・蜂が現れる/消える時のフェード(縮小/拡大)にかける秒数。 */
export const POLLINATOR_FADE_SECONDS = 1.0;

/**
 * 蝶・蜂を飛ばすべきか(飛ばしたい状態か)の判定。
 * 「晴れた日の日中」だけ飛ばす。雨・霧・夜・積雪で埋まっている時は飛ばさない。
 * (scene3d.jsと検証スクリプトで共通に使う)
 * @param {{hour:number, rainIntensity:number, fogAmount:number, buriedUnderSnow:boolean}} s
 */
export function shouldPollinatorsBeActive({ hour, rainIntensity, fogAmount, buriedUnderSnow }) {
  return hour >= 6 && hour < 18
    && rainIntensity < 0.05
    && fogAmount < 0.35
    && !buriedUnderSnow;
}

/**
 * 蝶・蜂をまとめて管理する「花粉媒介者フィールド」を作る。
 * @param {(x:number,z:number)=>number} terrainHeightFn
 * @param {object} opts
 * @param {{x:number,z:number}[]} opts.flowerPatches - 花畑パッチの中心(flowers.jsのpatchCentersをそのまま渡す)
 * @param {number} [opts.patchRadius]
 * @param {{x:number,y:number,z:number}} [opts.hivePos] - 蜂の巣の位置(蜂の巡回の起点。省略時は蜂を作らない)
 * @param {number} [opts.butterflyCount]
 * @param {number} [opts.beeCount]
 */
export function createPollinatorField(terrainHeightFn, opts = {}) {
  const {
    flowerPatches = [],
    patchRadius = 9,
    hivePos = null,
    butterflyCount = 6,
    beeCount = hivePos ? 5 : 0,
  } = opts;

  if (flowerPatches.length === 0) return null;

  const group = new THREE.Group();

  function pickPatch() {
    return flowerPatches[Math.floor(Math.random() * flowerPatches.length)];
  }

  const creatures = [];
  const lookTarget = new THREE.Vector3();
  const moveDir = new THREE.Vector3();
  const prevPos = new THREE.Vector3();
  // 向きの計算専用のダミー(シーンには追加しない、計算専用のオブジェクト)。
  // 「向きをlookAt()で即座に合わせる」のではなく、このダミーで理想の向きを
  // 求めてから、実際のメッシュへはQuaternion.slerp()でなめらかに近づける
  // ことで、急な方向転換時に一瞬で反転する不自然さ(「気持ち悪い」の主因と
  // 考えられる)を解消する。
  const orientHelper = new THREE.Object3D();

  for (let i = 0; i < butterflyCount; i++) {
    const { group: mesh, wings, foreWings, hindWings } = createButterflyMesh();
    const patch = pickPatch();
    creatures.push({
      mesh, wings, foreWings, hindWings,
      kind: 'butterfly',
      homeX: patch.x, homeZ: patch.z,
      radius: patchRadius * (0.4 + Math.random() * 0.5),
      phaseX: Math.random() * Math.PI * 2,
      phaseZ: Math.random() * Math.PI * 2,
      // 2026-09(改訂2): 気まぐれに方向転換しすぎると、向きが激しく振れて
      // 落ち着きなく見えるため、周期をやや長めにしてゆったり飛ばす
      speed: 0.18 + Math.random() * 0.14,
      bobPhase: Math.random() * Math.PI * 2,
      flutterPhase: Math.random() * Math.PI * 2,
      heightMin: 0.5, heightMax: 1.3,
      turnSmoothing: 0.045, // 低いほどゆったり向きが変わる(蝶はのんびり)
    });
    group.add(mesh);
  }

  for (let i = 0; i < beeCount; i++) {
    const { group: mesh, wings } = createBeeMesh();
    const patch = pickPatch();
    mesh.position.set(hivePos.x, hivePos.y, hivePos.z);
    creatures.push({
      mesh, wings,
      kind: 'bee',
      hiveX: hivePos.x, hiveY: hivePos.y, hiveZ: hivePos.z,
      targetX: patch.x, targetZ: patch.z,
      atFlower: false,
      waitTimer: Math.random() * 4,
      // のんびり飛ぶ速さ(3.0〜4.2 m/sだった頃から大幅減速した値を維持)
      speed: 0.8 + Math.random() * 0.5,
      flutterPhase: Math.random() * Math.PI * 2,
      turnSmoothing: 0.12, // 蜂は蝶よりきびきび向きを変える
    });
    group.add(mesh);
  }

  // 2026-09(v1.28): 「雨・雷雨のとき蝶と蜂が空中で一時停止する」不具合の修正。
  // 原因: 表示(group.visible)を、このファイルのsetActive()と、scene3d.jsの
  // applySeasonAndSnow()(積雪で埋まっていない限り常にtrueにする)の2か所が
  // 上書きし合っていた。非アクティブ(雨・夜・霧)でも後者が表示に戻し、
  // update()は非アクティブだと即returnするため、見えたまま固まっていた。
  // 対策: 表示・非表示はこのフィールドだけが持つ(group.visibleは外から
  // 触らない)。setActive()は「飛ばしたいか」の目標だけを設定し、実際の
  // 表示は、約1秒かけて縮小して消える/拡大して現れるフェードで決まる
  // (フェード中も飛び続けるので、突然消えず、止まって見えることもない)。
  let active = false;
  let fade = 0; // 0=完全に消えている, 1=完全に見えている
  group.visible = false;

  function setActive(v) {
    active = !!v;
  }

  /**
   * @param {number} phaseOffset - 前翅に対する位相のズレ(後翅を少し遅れて
   *   動かすことで、4枚が完全に同じ1枚の板のように見えるのを防ぐ)
   * @param {number} ampScale - 振幅の倍率(後翅をわずかに小さく動かす)
   */
  /**
   * @param {number} phaseOffset - 前翅に対する位相のズレ(後翅を少し遅れて
   *   動かすことで、4枚が完全に同じ1枚の板のように見えるのを防ぐ)
   * @param {number} ampScale - 振幅の倍率(後翅をわずかに小さく動かす)
   * @param {'y'|'z'} axis - 羽ばたきの回転軸。既定の'z'は上下(蜂向け)。
   *   2026-09(改訂6): 蝶の正しい羽ばたきは「天に向かって開き、下ろして
   *   閉じる」動き。羽根の根元をZ軸方向に伸ばす向きへジオメトリ側を
   *   修正した上で、既定の'z'軸(上下)を使うことで、根元をせん断させず
   *   正しく上へ開く動きになる(蜂も同じ既定の'z'を使用)。
   */
  function flapWings(wings, t, flutterPhase, flapSpeed, flapAngle, phaseOffset = 0, ampScale = 1, axis = 'z') {
    const angle = (Math.sin(t * flapSpeed + flutterPhase + phaseOffset) * 0.5 + 0.5) * flapAngle * ampScale;
    for (const w of wings) w.rotation[axis] = angle * (w.userData.wingMirrorSign || 1);
  }

  function update(t, dt) {
    // フェード(1秒で 0↔1)。fadeが0より大きい間だけ描画し、動かす。
    const target = active ? 1 : 0;
    const step = dt / POLLINATOR_FADE_SECONDS;
    fade = target > fade ? Math.min(target, fade + step) : Math.max(target, fade - step);
    group.visible = fade > 0;
    if (fade <= 0) return;
    const scale = fade * fade * (3 - 2 * fade); // smoothstep
    for (const c of creatures) {
      c.mesh.scale.setScalar(Math.max(scale, 1e-3));
      prevPos.copy(c.mesh.position);
      if (c.kind === 'butterfly') {
        const x = c.homeX + Math.sin(t * c.speed + c.phaseX) * c.radius;
        const z = c.homeZ + Math.sin(t * c.speed * 0.7 + c.phaseZ) * c.radius * 0.8;
        const groundY = terrainHeightFn(x, z);
        // 2026-09(改訂4): 羽ばたきに連動したごく小さな上下動(フラッター
        // バウンス)を追加。前後・左右への揺れ(以前「気持ち悪い」原因と
        // なったジグザグ)ではなく、垂直方向だけのわずかな弾みなので、
        // 「羽ばたくたびにふわっと浮く」ような自然な軽さに見える。
        // 2026-09(改訂5): 「羽ばたきが大きめで、蝶らしくゆったり」との
        // 指摘を受け、速度を落とし(10→4.2)振幅を大きくした
        // (0.55π→0.85π)。左右の同期バグ修正(上のbuildWingPair内コメント
        // 参照)と合わせて、大きくゆったりと開閉する、誰から見ても
        // 蝶の羽ばたきとわかる動きにした。
        const flapSpeedButterfly = 4.2;
        const flutterBob = Math.sin(t * flapSpeedButterfly + c.flutterPhase) * 0.018;
        const y = groundY + c.heightMin + (Math.sin(t * 1.7 + c.bobPhase) * 0.5 + 0.5) * (c.heightMax - c.heightMin) + flutterBob;
        c.mesh.position.set(x, y, z);
        // 前翅と後翅をわずかに位相・振幅をずらして動かす(実際のチョウの
        // 前翅・後翅の連動に近い、4枚が1枚岩に見えない動き)。ただし
        // 「大きくわかりやすい羽ばたき」を邪魔しない程度に控えめにした。
        flapWings(c.foreWings, t, c.flutterPhase, flapSpeedButterfly, Math.PI * 0.85, 0, 1, 'z');
        flapWings(c.hindWings, t, c.flutterPhase, flapSpeedButterfly, Math.PI * 0.85, 0.1, 0.9, 'z');
      } else {
        // 蜂: 巣←→花のどちらかへ直線的に飛び、着いたらしばらく留まる
        const tx = c.atFlower ? c.hiveX : c.targetX;
        const tz = c.atFlower ? c.hiveZ : c.targetZ;
        const ty = c.atFlower ? c.hiveY : terrainHeightFn(c.targetX, c.targetZ) + 0.5;
        const curX = c.mesh.position.x, curY = c.mesh.position.y, curZ = c.mesh.position.z;
        const dx = tx - curX, dy = ty - curY, dz = tz - curZ;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 0.3) {
          c.waitTimer -= dt;
          if (c.waitTimer <= 0) {
            c.atFlower = !c.atFlower;
            c.waitTimer = 2 + Math.random() * 4;
            if (!c.atFlower) {
              // 次に向かう花をランダムに選び直す
              const patch = pickPatch();
              const angle = Math.random() * Math.PI * 2;
              const r = Math.random() * patchRadius * 0.6;
              c.targetX = patch.x + Math.cos(angle) * r;
              c.targetZ = patch.z + Math.sin(angle) * r;
            }
          }
        } else {
          // 2026-09(改訂3): 「動きが蛇行しすぎて気持ち悪い」との指摘を
          // 受け、進行方向に対して常に垂直に揺らす横方向のジグザグ(wob)を
          // 撤去した。直進させ、生き物らしい揺らぎは羽ばたき・向きの
          // slerpだけに任せる。
          const step = Math.min(dist, c.speed * dt);
          c.mesh.position.set(
            curX + (dx / dist) * step,
            curY + (dy / dist) * step,
            curZ + (dz / dist) * step
          );
        }
        flapWings(c.wings, t, c.flutterPhase, 20, Math.PI * 0.4);
      }

      // 進行方向(直前フレームからの移動方向)を向かせる。ほぼ静止している
      // 場合(到着直後など)は向きを変えない。2026-09(改訂2): 即座に
      // lookAt()で振り向かせるのではなく、理想の向きへQuaternionを
      // なめらかにslerpすることで、方向反転時の不自然な瞬間反転を防ぐ。
      moveDir.subVectors(c.mesh.position, prevPos);
      if (moveDir.lengthSq() > 1e-10) {
        moveDir.normalize();
        lookTarget.copy(c.mesh.position).add(moveDir);
        orientHelper.position.copy(c.mesh.position);
        orientHelper.up.set(0, 1, 0);
        orientHelper.lookAt(lookTarget);
        c.mesh.quaternion.slerp(orientHelper.quaternion, c.turnSmoothing);
      }
    }
  }

  return { group, update, setActive, isActive: () => active, getFade: () => fade };
}

// --- 蜂の巣(木の幹に取り付ける簡易な形状) ---
const HIVE_MATERIAL = new THREE.MeshStandardMaterial({ color: 0xcda05a, roughness: 0.9 });
const HIVE_BAND_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x8a6a38, roughness: 0.9 });

/**
 * 紙スズメバチの巣のような、しずく型の簡易な蜂の巣を作る。
 * @param {number} [scale]
 */
export function createBeehive(scale = 1) {
  const group = new THREE.Group();
  const tiers = 4;
  let y = 0;
  for (let i = 0; i < tiers; i++) {
    const frac = i / (tiers - 1); // 0(下, 太い)〜1(上, 細い)
    const radius = (0.32 - frac * 0.22) * scale;
    const height = 0.22 * scale;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.85, radius, height, 8),
      i % 2 === 0 ? HIVE_MATERIAL : HIVE_BAND_MATERIAL
    );
    mesh.position.y = y + height / 2;
    mesh.castShadow = true;
    group.add(mesh);
    y += height * 0.85;
  }
  // 一番下の出入り口(小さな暗い穴)
  const holeMesh = new THREE.Mesh(
    new THREE.CircleGeometry(0.045 * scale, 8),
    new THREE.MeshBasicMaterial({ color: 0x1a1410 })
  );
  holeMesh.position.set(0, 0.05 * scale, 0.3 * scale);
  holeMesh.rotation.x = -Math.PI / 2;
  group.add(holeMesh);
  return group;
}
