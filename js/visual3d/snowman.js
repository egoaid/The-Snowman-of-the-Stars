// snowman.js
// 主人公キャラクター「雪だるま」。
// デザイン・アニメーションの原案は既存の2Dキャラクター
// (SNOWMAN CHRISTMAS ANIMATION.js)を3D空間へ移植したもの。
// 軽量なプリミティブ(Sphere/Cylinder/Cone/Extrude)のみで構成し、
// 木・焚き火など既存モジュールと同じ「ファクトリ関数 + update(delta,t)」
// の流儀に合わせている。
//
// 提供するもの:
// - createSnowmanCharacter(scale): NPC/プレイヤー共用の3Dモデル本体
//   (Idle・Blink・Walkのアニメーションを持つ。歩行制御・AIはこの
//   モジュールの責務ではなく、外からsetWalking()等で状態を渡す)
// - createFirstPersonHands(scale): 一人称視点用にカメラへ子として
//   ぶら下げる簡易な手(松明を取り付ける想定のTorchSocket付き)
//
// 今回はまだ実装しないもの(将来のフェーズで対応):
// - 音楽(発声)と口・頬の連動の実データ接続(構造だけ用意)
// - NPCの自律AI移動・実際のCollision判定(collisionは数値を返すのみ)
// - 松明の炎・PointLight

import { createJackOLanternMesh } from './lantern.js';
import * as THREE from 'three';
import { getSmoothGradientMap } from './shading.js';
// 2026-09(v1.26): 雪だるまの陰影は、4段のトゥーン階調だと胴体などの丸い面に
// 帯が見えて荒いため、256段+線形補間の滑らかな階調にした。
const getToonGradientMap = getSmoothGradientMap; // 以下の既存のマテリアル定義はこの名前のまま滑らかな階調になる

// --- マテリアル(モジュールスコープで使い回す) ---
const SNOW_MATERIAL = new THREE.MeshToonMaterial({ color: 0xf8f8f6, gradientMap: getToonGradientMap() });
const SNOW_HEAD_MATERIAL = new THREE.MeshToonMaterial({ color: 0xfafaf8, gradientMap: getToonGradientMap() });
const COAL_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x2c2822, roughness: 0.7 });
const EYE_HIGHLIGHT_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 });
const CARROT_MATERIAL = new THREE.MeshToonMaterial({ color: 0xe8700a, gradientMap: getToonGradientMap() });
const MOUTH_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x7a1a1a });
const MOUTH_DOT_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x2c2822, roughness: 0.7 });
const HAT_MATERIAL = new THREE.MeshToonMaterial({ color: 0x1a1612, gradientMap: getToonGradientMap() });
const HAT_BAND_MATERIAL = new THREE.MeshToonMaterial({ color: 0xb03030, gradientMap: getToonGradientMap() });
const STAR_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xffd700 });
// v1.38: 肩から斜めがけの小さなポーチ(革の茶色。ボタンだけ星と同じ金色)
const POUCH_BODY_MATERIAL = new THREE.MeshToonMaterial({ color: 0x9a6a38, gradientMap: getToonGradientMap() });
const POUCH_FLAP_MATERIAL = new THREE.MeshToonMaterial({ color: 0x7a4f28, gradientMap: getToonGradientMap() });
const SCARF_RED_MATERIAL = new THREE.MeshToonMaterial({ color: 0xb03030, gradientMap: getToonGradientMap() });
const SCARF_GREEN_MATERIAL = new THREE.MeshToonMaterial({ color: 0x2a6b3a, gradientMap: getToonGradientMap() });
const BRANCH_MATERIAL = new THREE.MeshToonMaterial({ color: 0x5c3d1e, gradientMap: getToonGradientMap() });
const BLUSH_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xf4a0a0, transparent: true, opacity: 0 });

// v1.41: 左クリック/アクションボタンで再生する「手を伸ばす」動作の長さと大きさ。
// 掴む・拾う・飾る・壊す・木を切る、といった今後の動作すべてがこの1つの
// 見た目のアニメーションを土台にする想定。
const ACTION_SWING_DURATION = 0.32; // 秒
const ACTION_SWING_ANGLE = 1.15; // ラジアン。前へ大きく伸ばす角度
// v1.43: 一人称の手の基準位置(カメラ座標)。下寄り・外寄りで控えめにする。
const FP_HAND_X = 0.46;
const FP_HAND_Y = -0.5;

/**
 * 5稜の星形メッシュを作る(帽子の飾り用)。2D版のdrawStar()を参考にした
 * 簡易な押し出し(Extrude)形状。
 */
export function createStarGeometry(radius) {
  const spikes = 5;
  const shape = new THREE.Shape();
  for (let i = 0; i < spikes * 2; i++) {
    const angle = (i * Math.PI) / spikes - Math.PI / 2;
    const r = i % 2 === 0 ? radius : radius * 0.42;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: radius * 0.35, bevelEnabled: false });
  geo.center();
  return geo;
}

function createStarMesh(radius) {
  return new THREE.Mesh(createStarGeometry(radius), STAR_MATERIAL);
}

/**
 * 枝の腕(または一人称視点の手)を作る。主枝1本+先端で2本に分かれる小枝、
 * という構成。小枝は「上に向かって開くV字」になるよう、主枝の傾き
 * (armOutAngle)を打ち消す方向に補正してから左右に開いている。
 *
 * @param {number} scale
 * @param {number} side -1(左)または1(右)
 * @param {object} [opts]
 * @param {number} [opts.mainLength] 主枝の長さ
 * @param {number} [opts.armOutAngle] 主枝を胴体(または肩)から外側へ傾ける角度(rad)。
 *   省略時は2D版の腕の傾き(側面から見て斜め上)を踏襲した値を使う。
 * @param {number} [opts.twigSplay] 先端の小枝が左右に開く角度(rad)
 */
function createBranchLimb(scale, side, opts = {}) {
  const group = new THREE.Group();
  const mainLength = opts.mainLength ?? 0.55 * scale;
  const armOutAngle = opts.armOutAngle ?? (side > 0 ? -0.75 : 0.75);
  const twigSplay = opts.twigSplay ?? 0.4;

  const mainGeo = new THREE.CylinderGeometry(0.025 * scale, 0.035 * scale, mainLength, 5);
  const main = new THREE.Mesh(mainGeo, BRANCH_MATERIAL);
  main.position.y = mainLength / 2;
  main.castShadow = true;
  group.add(main);

  // 先端の小枝: 主枝(=group)の傾きarmOutAngleを7割ほど打ち消す方向へ
  // 回転させることで、「枝全体は外側へ、先端の小枝だけは上を向いて開く」
  // というV字の見た目を作る。
  const upwardCorrection = -armOutAngle * 0.7;
  function addTwig(splayOffset, length) {
    const twigGeo = new THREE.CylinderGeometry(0.008 * scale, 0.022 * scale, length, 4);
    twigGeo.translate(0, length / 2, 0); // 根元(付け根)が原点に来るようにする
    const twig = new THREE.Mesh(twigGeo, BRANCH_MATERIAL);
    twig.position.y = mainLength;
    twig.rotation.z = upwardCorrection + splayOffset;
    twig.castShadow = true;
    group.add(twig);
  }
  addTwig(twigSplay, 0.24 * scale);
  addTwig(-twigSplay, 0.19 * scale);

  // 先端の位置(主枝の付け根から見た到達点)を、松明などを取り付けられる
  // 目印として公開しておく(group.userData.tip)。
  const tip = new THREE.Object3D();
  tip.position.y = mainLength;
  group.add(tip);
  group.userData.tip = tip;

  // 枝全体は水平に近い角度で外側へ伸ばす(2D版の腕の傾きを踏襲)。
  group.rotation.z = armOutAngle;
  return group;
}

/**
 * 雪だるまキャラクター本体を作る。
 * 原点は接地面(足の裏)。NPC・プレイヤー(将来の一人称本体)の両方で
 * 使い回せるよう、移動制御(AI/入力)は一切含まない。
 *
 * @param {number} scale 全体の大きさの目安(1で全高約2m、226m地形基準)
 * @returns {{
 *   group: THREE.Group,
 *   update: (delta:number, t:number) => void,
 *   setWalking: (walking:boolean) => void,
 *   setMouthOpen: (amount:number|null) => void,
 *   setIntensity: (amount:number) => void,
 *   collision: { collisionRadius:number, collisionHeight:number, stepHeight:number },
 * }}
 */
export function createSnowmanCharacter(scale = 1) {
  const group = new THREE.Group();

  // --- 寸法(2D版の胴体:頭 ≈ 36:26の比率を踏襲) ---
  const footRadius = 0.22 * scale;
  const footScaleY = 0.62; // 上下に潰す(「潰れた感じの球体」にする)
  const footScaleXZ = 1.2; // 潰れた分、横方向に少し広げてボリュームを保つ
  const bodyRadius = 0.5 * scale;
  const headRadius = bodyRadius * 0.72;

  const footY = footRadius * footScaleY * 0.85;
  const bodyY = footY + footRadius * footScaleY * 0.5 + bodyRadius * 0.82;
  const headY = bodyY + bodyRadius * 0.85 + headRadius * 0.72;

  // --- 足(丸い雪玉。2D版には無い、3D歩行のための新規パーツ。
  //     少し上下に潰れた球体にして、雪玉らしい柔らかさを出している) ---
  const feetGroup = new THREE.Group();
  const footGeo = new THREE.SphereGeometry(footRadius, 10, 8);
  const rightFoot = new THREE.Mesh(footGeo, SNOW_MATERIAL);
  rightFoot.position.set(-bodyRadius * 0.42, footY, 0);
  rightFoot.scale.set(footScaleXZ, footScaleY, footScaleXZ * 1.15);
  rightFoot.castShadow = true;
  rightFoot.receiveShadow = true;
  const leftFoot = rightFoot.clone();
  leftFoot.position.x = bodyRadius * 0.42;
  feetGroup.add(rightFoot, leftFoot);
  group.add(feetGroup);

  // --- 胴体(大) ---
  const bodyGeo = new THREE.SphereGeometry(bodyRadius, 14, 11);
  const body = new THREE.Mesh(bodyGeo, SNOW_MATERIAL);
  body.scale.set(1, 0.92, 1);
  body.position.y = bodyY;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // ボタン(胴体の縦3つ)
  const buttonGeo = new THREE.SphereGeometry(bodyRadius * 0.07, 6, 5);
  for (let i = 0; i < 3; i++) {
    const button = new THREE.Mesh(buttonGeo, COAL_MATERIAL);
    button.position.set(0, bodyY + bodyRadius * (0.42 - i * 0.34), bodyRadius * 0.9);
    group.add(button);
  }

  // --- 頭(全体を1つのGroupにまとめ、頭のゆらぎ(headBob)をまとめて適用する) ---
  const headGroup = new THREE.Group();
  headGroup.position.y = headY;
  group.add(headGroup);

  const headGeo = new THREE.SphereGeometry(headRadius, 14, 11);
  const head = new THREE.Mesh(headGeo, SNOW_HEAD_MATERIAL);
  head.scale.set(1, 0.97, 1);
  head.castShadow = true;
  head.receiveShadow = true;
  headGroup.add(head);

  // 頬の赤み(発声・活動強度に応じて濃くなる)
  const blushGeo = new THREE.SphereGeometry(headRadius * 0.28, 8, 6);
  const blushLeft = new THREE.Mesh(blushGeo, BLUSH_MATERIAL.clone());
  blushLeft.scale.set(1, 0.7, 0.4);
  blushLeft.position.set(-headRadius * 0.55, -headRadius * 0.05, headRadius * 0.78);
  const blushRight = blushLeft.clone();
  blushRight.material = BLUSH_MATERIAL.clone();
  blushRight.position.x = headRadius * 0.55;
  headGroup.add(blushLeft, blushRight);

  // 目(瞬き用にGroupでまとめ、scale.yで開閉を表現する。2D版のblinkScと同じ考え方)
  function createEye(side) {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(headRadius * 0.36 * side, headRadius * 0.12, headRadius * 0.86);
    const eyeGeo = new THREE.SphereGeometry(headRadius * 0.17, 8, 6);
    const eye = new THREE.Mesh(eyeGeo, COAL_MATERIAL);
    eyeGroup.add(eye);
    const highlightGeo = new THREE.SphereGeometry(headRadius * 0.05, 6, 5);
    const highlight = new THREE.Mesh(highlightGeo, EYE_HIGHLIGHT_MATERIAL);
    highlight.position.set(headRadius * 0.05, headRadius * 0.05, headRadius * 0.1);
    eyeGroup.add(highlight);
    return eyeGroup;
  }
  const eyeLeft = createEye(-1);
  const eyeRight = createEye(1);
  headGroup.add(eyeLeft, eyeRight);

  // にんじんの鼻(顔の正面=+Zを向く)
  const noseGeo = new THREE.ConeGeometry(headRadius * 0.11, headRadius * 0.62, 7);
  const nose = new THREE.Mesh(noseGeo, CARROT_MATERIAL);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, headRadius * 0.02, headRadius * 0.95);
  nose.castShadow = true;
  headGroup.add(nose);

  // 口: 閉じた口(炭のドットを並べたスマイル)と、開いた口(潰した球)を
  // 切り替える。2D版のgetMouthShape()の考え方(open量で形が変わる)を、
  // 3D版ではまず「閉/半開/全開」の単純なスケール変化として実装する。
  const closedMouthGroup = new THREE.Group();
  const dotGeo = new THREE.SphereGeometry(headRadius * 0.045, 5, 4);
  for (let i = 0; i < 5; i++) {
    const a = -0.5 + i * 0.25;
    const dot = new THREE.Mesh(dotGeo, MOUTH_DOT_MATERIAL);
    dot.position.set(
      Math.sin(a) * headRadius * 0.4,
      -headRadius * 0.34 - Math.cos(a) * headRadius * 0.08,
      headRadius * 0.92,
    );
    closedMouthGroup.add(dot);
  }
  headGroup.add(closedMouthGroup);

  const openMouthGeo = new THREE.SphereGeometry(headRadius * 0.24, 8, 6);
  const openMouth = new THREE.Mesh(openMouthGeo, MOUTH_MATERIAL);
  openMouth.position.set(0, -headRadius * 0.34, headRadius * 0.88);
  openMouth.scale.set(1, 0.05, 0.5);
  openMouth.visible = false;
  headGroup.add(openMouth);

  // --- マフラー(赤緑ストライプ) ---
  // v1.43: 「襟(固い輪)に見える」を解消。首のくびれに、傾きの違う2重の巻きを作り、
  // 前の左寄りに結び目、そこから長さの違う2本の端が胸へ垂れる。
  // 巻きはTorusの弧を隙間なく並べた輪(継ぎ目を隠すため少し重ねる)。端は胴体の楕円面に
  // 沿わせた帯(頂点カラーで赤緑のしま)にして、胴体にめり込まない・浮かないようにする。
  const scarfGroup = new THREE.Group();
  scarfGroup.position.y = bodyY;
  const scarfSegments = 10;
  const scarfArc = ((Math.PI * 2) / scarfSegments) * 1.04;
  function addScarfWrap(yRel, radius, tube, tiltX, tiltZ) {
    const wrap = new THREE.Group();
    wrap.position.y = bodyRadius * yRel;
    wrap.rotation.set(tiltX, 0, tiltZ);
    for (let i = 0; i < scarfSegments; i++) {
      const segGeo = new THREE.TorusGeometry(bodyRadius * radius, bodyRadius * tube, 6, 8, scarfArc);
      segGeo.rotateX(Math.PI / 2);
      const seg = new THREE.Mesh(segGeo, i % 2 === 0 ? SCARF_RED_MATERIAL : SCARF_GREEN_MATERIAL);
      seg.rotation.y = (i / scarfSegments) * Math.PI * 2 + (yRel > 0.8 ? 0.31 : 0); // 上の巻きは模様をずらす
      seg.castShadow = true;
      wrap.add(seg);
    }
    scarfGroup.add(wrap);
  }
  addScarfWrap(0.74, 0.58, 0.125, 0.07, -0.06);  // 下の巻き(肩のほう)
  addScarfWrap(0.87, 0.52, 0.115, -0.06, 0.09);  // 上の巻き(首のくびれ)

  // 胴体(楕円体: 横半径=bodyRadius、縦半径=bodyRadius*0.92)の、高さyRelでの水平半径
  const bodyRadiusAt = (yRel) => bodyRadius * Math.sqrt(Math.max(0.04, 1 - (yRel / (0.92 * bodyRadius)) ** 2));
  const scarfEnds = []; // 歩行・風でほんの少し胴体から離れるように揺らす
  // v1.44: 端の上部が巻きから切れて見えた(巻きの外側に浮いて始まっていた)。
  // 両方の端を、結び目(巻きに埋まっている)の中心から始め、最初の2段で幅を絞って結び目の
  // 影に隠し、そこから胴体表面へ連続的に広がる形にした(隙間が出ない)。
  const KNOT_AZ = 0.68;
  const KNOT_Y = bodyRadius * 0.7;
  const smooth01 = (x) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
  function addScarfEnd(azimuth, drop, width) {
    const steps = 7;
    const off = 1.04;
    const pts = [], azs = [];
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const yRel = KNOT_Y - drop * t;
      const az = KNOT_AZ + (azimuth - KNOT_AZ) * smooth01(t * 1.6);
      const r = k === 0
        ? bodyRadiusAt(KNOT_Y) * 1.06 + bodyRadius * 0.03   // 結び目と同じ位置
        : bodyRadiusAt(yRel) * off + bodyRadius * 0.025;
      pts.push(new THREE.Vector3(-Math.sin(az) * r, yRel, Math.cos(az) * r));
      azs.push(az);
    }
    const pivot = pts[0].clone();
    const pos = [], col = [], idx = [];
    const red = new THREE.Color(0xb03030), green = new THREE.Color(0x2a6b3a);
    let run = 0;
    for (let k = 0; k <= steps; k++) {
      if (k > 0) run += pts[k].distanceTo(pts[k - 1]);
      const c = Math.floor(run / (bodyRadius * 0.11)) % 2 === 0 ? red : green;
      const p = pts[k].clone().sub(pivot);
      const wx = Math.cos(azs[k]), wz = Math.sin(azs[k]); // 帯の幅方向(水平)
      const w = width * (k === 0 ? 0.45 : k === 1 ? 0.85 : 1) * (k === steps ? 0.92 : 1) * 0.5;
      pos.push(p.x - wx * w, p.y, p.z - wz * w, p.x + wx * w, p.y, p.z + wz * w);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (k > 0) { const i = k * 2; idx.push(i - 2, i - 1, i, i - 1, i + 1, i); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshToonMaterial({ vertexColors: true, side: THREE.DoubleSide, gradientMap: getToonGradientMap() });
    const end = new THREE.Mesh(geo, mat);
    end.castShadow = true;
    const holder = new THREE.Group();
    holder.position.copy(pivot);
    holder.add(end);
    scarfGroup.add(holder);
    // 胴体から「離れる」向き(外向き)へだけ揺れる回転軸(結び目付近の幅方向)。支点は結び目なので、
    // 揺れても上端は結び目から離れない。
    scarfEnds.push({ holder, axis: new THREE.Vector3(Math.cos(KNOT_AZ), 0, Math.sin(KNOT_AZ)), phase: azimuth * 3 });
  }
  addScarfEnd(0.55, bodyRadius * 0.78, bodyRadius * 0.30);  // 長いほうの端
  addScarfEnd(0.84, bodyRadius * 0.52, bodyRadius * 0.27);  // 短いほうの端
  // 結び目(下の巻きの前・左寄り)
  const knot = new THREE.Mesh(new THREE.SphereGeometry(bodyRadius * 0.135, 8, 6), SCARF_RED_MATERIAL);
  knot.position.set(-Math.sin(KNOT_AZ) * (bodyRadiusAt(KNOT_Y) * 1.06 + bodyRadius * 0.03), KNOT_Y, Math.cos(KNOT_AZ) * (bodyRadiusAt(KNOT_Y) * 1.06 + bodyRadius * 0.03));
  knot.scale.set(1.15, 0.85, 0.9);
  knot.castShadow = true;
  scarfGroup.add(knot);
  group.add(scarfGroup);

  // --- シルクハット(Brim + Crown + RedBand + Star。まとめてhatGroupで揺らす) ---
  const hatGroup = new THREE.Group();
  // headGroupの子なので、位置はheadGroup原点(=頭の中心)からの相対値にする
  // (headYを二重に足すと帽子が頭のはるか上空へ飛んでしまうので注意)。
  hatGroup.position.y = headRadius * 0.86;
  headGroup.add(hatGroup); // 頭の子にしておき、headのゆらぎに自動で追従させる

  const brimGeo = new THREE.CylinderGeometry(headRadius * 0.95, headRadius * 0.95, headRadius * 0.12, 12);
  const brim = new THREE.Mesh(brimGeo, HAT_MATERIAL);
  hatGroup.add(brim);

  const crownGeo = new THREE.CylinderGeometry(headRadius * 0.62, headRadius * 0.62, headRadius * 1.15, 10);
  const crown = new THREE.Mesh(crownGeo, HAT_MATERIAL);
  crown.position.y = headRadius * 0.63;
  crown.castShadow = true;
  hatGroup.add(crown);

  const bandGeo = new THREE.CylinderGeometry(headRadius * 0.64, headRadius * 0.64, headRadius * 0.16, 10);
  const band = new THREE.Mesh(bandGeo, HAT_BAND_MATERIAL);
  band.position.y = headRadius * 0.18;
  hatGroup.add(band);

  const star = createStarMesh(headRadius * 0.22);
  star.position.set(headRadius * 0.3, headRadius * 1.28, 0);
  star.rotation.x = Math.PI / 2;
  hatGroup.add(star);

  // --- 枝の腕 ---
  const rightArm = createBranchLimb(scale, -1);
  rightArm.position.set(-bodyRadius * 0.92, bodyY + bodyRadius * 0.3, 0);
  group.add(rightArm);

  const leftArm = createBranchLimb(scale, 1);
  leftArm.position.set(bodyRadius * 0.92, bodyY + bodyRadius * 0.42, 0);
  group.add(leftArm);

  // よろけ演出でrotation.zを揺らす際、createBranchLimbが最初に設定した
  // 傾き(外側への基準角度)を毎フレーム上書きしてしまわないよう、
  // ここで基準値として控えておく。
  const leftArmBaseZ = rightArm.rotation.z;
  const rightArmBaseZ = leftArm.rotation.z;

  // --- ポーチ(v1.38 → v1.44で左肩へ → v1.45でひもを廃止し、お腹のポケットに) ---
  // 設定: ひもは使わず、雪のお腹に直接貼り付いている小さな袋。左右の位置(松明を持つ左手側=
  // モデルのx>0側に寄った位置)はv1.44のまま、高さだけお腹(胴体の中心より少し下)まで下げた。
  // 袋の表側には「星のかけら」が付いている。星のかけらは物と物をくっつける力があり、
  // ツリーの飾り付け・木のおもちゃ作り・川の橋かけに使う(ゲームの中心になる素材)。
  const POUCH_X = 0.62;            // 左右の位置(bodyRadius比。v1.44のポーチと同じ。+x=左手=松明側)
  const POUCH_CENTER_Y = -0.2;     // 袋の中心の高さ(胴体の中心からの比。お腹のあたり)
  const pouchR = bodyRadius * 0.23; // v1.44の0.15から、ひと回り大きく
  const pouchHang = pouchR * 0.75;  // 支点(上端)から袋の中心までの距離
  const pouchSurfaceR = (yRel) => bodyRadius * Math.sqrt(Math.max(0.04, 1 - (yRel / (0.92 * bodyRadius)) ** 2));
  const pouchCenterYRel = bodyRadius * POUCH_CENTER_Y;
  const pouchPivotYRel = pouchCenterYRel + pouchHang;
  const pouchSurf = pouchSurfaceR(pouchPivotYRel);
  const pouchPX = bodyRadius * POUCH_X;
  const pouchPZ = Math.sqrt(Math.max(0.01 * bodyRadius * bodyRadius, pouchSurf * pouchSurf - pouchPX * pouchPX));
  const pouchPos = new THREE.Vector3(pouchPX, bodyY + pouchPivotYRel, pouchPZ);
  const pouchOutward = new THREE.Vector3(pouchPos.x, (pouchPos.y - bodyY) / 0.92, pouchPos.z).normalize();
  const pouchPivot = new THREE.Group(); // ゆれの支点(袋の上端)
  pouchPivot.position.copy(pouchPos).addScaledVector(pouchOutward, bodyRadius * 0.045);
  // ローカル+Zが外向き、ローカル-Yがなるべく下向きになる向きにする(Matrix4.lookAtは+Zが eye-target 方向)
  pouchPivot.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().lookAt(pouchOutward, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0))
  );
  const pouchSway = new THREE.Group(); // 歩行のゆれはこちらに適用(pouchPivotの向きは固定)
  pouchPivot.add(pouchSway);
  const pouchBody = new THREE.Mesh(new THREE.SphereGeometry(pouchR, 12, 9), POUCH_BODY_MATERIAL);
  pouchBody.scale.set(1, 0.9, 0.72);
  pouchBody.position.y = -pouchHang;
  // ふた: 袋の上半分を、少しだけ大きい半球でおおう
  const pouchFlap = new THREE.Mesh(
    new THREE.SphereGeometry(pouchR * 1.06, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.5),
    POUCH_FLAP_MATERIAL
  );
  pouchFlap.scale.set(1, 0.8, 0.76);
  pouchFlap.position.y = -pouchR * 0.62;
  // 星のかけら: 袋の表側(外向き)に付いている、金色の小さな星(平たい5角星)
  const starShard = new THREE.Mesh(createStarGeometry(pouchR * 0.42), STAR_MATERIAL);
  starShard.scale.set(1, 1, 0.5);
  starShard.position.set(0, -pouchR * 0.85, pouchR * 0.72 * 0.95 + pouchR * 0.06);
  starShard.userData.starShard = true;
  pouchSway.add(pouchBody, pouchFlap, starShard);
  group.add(pouchPivot);

  // 左腕の先端(松明の取り付け位置)。
  // 2026-09: 一人称視点で右手に松明があると不自然という指摘を受け、
  // 左手に統一した(こちらの三人称モデルも合わせる)。
  const torchSocket = leftArm.userData.tip;
  // v1.39: ホットバーで選んだ物を持たせる位置(松明が左手にあるため、右手を使う)。
  const itemSocket = rightArm.userData.tip;

  // 2026-09(v1.28): 「雪だるまの表面に変な影のムラが出ることがある」への対応。
  // 雪だるまの大きさ(直径約1m)に対して、太陽の影マップの1マスは約5cmと粗く、
  // 胴体・頭・スカーフ・帽子・腕が重なる部分に、自分自身の影がまだら状に
  // 出ていた。雪だるまは影を落とす(地面には影が落ちる)が、自分では影を
  // 受けない設定にして、表面の陰影は滑らかな明暗(階調)だけにする。
  // scene3d.jsの一括の影設定に上書きされないよう、印(keepShadowFlags)を付ける。
  // (トレードオフ: 木やテントの影が雪だるまの体に落ちる表現は無くなる)
  group.traverse((m) => {
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = false;
    m.userData.keepShadowFlags = true;
  });

  // --- Collision(見た目のジオメトリからではなく、キャラクター設定として独立させる) ---
  const collision = {
    collisionRadius: bodyRadius * 1.05,
    collisionHeight: (headY + headRadius * 1.9) - footY, // 帽子込みの全高に近い値
    stepHeight: footRadius * 1.4,
  };

  // --- アニメーション状態 ---
  const state = {
    headBobPhase: 0,
    scarfPhase: 0,
    actionSwingTimer: -1,
    armPhase: 0,
    walkPhase: 0,
    walking: false,
    walkBlend: 0, // 0=静止 1=歩行(急に切り替えず滑らかに補間する)
    intensity: 0, // 発声・活動の強さ(0〜1)。将来の音声連動用
    mouthOverride: null, // setMouthOpen()で外部から指定された場合はこちらを優先
    // 瞬き(2D版のCHAR.blinkState等をそのまま踏襲。単位は秒)
    blinkState: 0, // 0:開いている 1:閉じていく 2:閉じている 3:開いていく
    blinkProgress: 0,
    blinkTimer: 0,
    nextBlinkTime: 2 + Math.random() * 3,
    // 自律もごもご(2D版のidleMouth*を踏襲)
    idleMouthActive: false,
    idleMouthPhase: 0,
    idleMouthTimer: 0,
    nextIdleMouthTime: 2.5 + Math.random() * 4,
    // 歩行中の「ぴょこん」ホップ(コミカルな歩き方の演出)
    hopActive: false,
    hopProgress: 0,
    hopTimer: 0,
    nextHopIn: 2 + Math.random() * 2.5,
    // 歩行中に時々よろける演出
    stumbleActive: false,
    stumbleProgress: 0,
    stumbleTimer: 0,
    nextStumbleIn: 4 + Math.random() * 6,
    stumbleDir: 1,
    // 2026-09(季節システム): 雪が降っている間、雪だるまが喜ぶ演出用。
    joyful: false,
    joyHopActive: false,
    joyHopProgress: 0,
    joyHopTimer: 0,
    nextJoyHopIn: 0.8 + Math.random() * 1.2,
  };

  /**
   * 歩行中の「ぴょこん」ホップと、時々よろける演出のタイマー処理。
   * どちらも歩いている(walkBlendが高い)時だけ発生させる。
   */
  function updateWalkQuirks(delta) {
    // ホップ: 2〜4.5秒に1回程度、0.35秒かけて小さく飛び跳ねる
    if (state.walkBlend > 0.5) {
      state.hopTimer += delta;
      if (!state.hopActive && state.hopTimer >= state.nextHopIn) {
        state.hopActive = true;
        state.hopProgress = 0;
        state.hopTimer = 0;
      }
    }
    if (state.hopActive) {
      state.hopProgress += delta / 0.35;
      if (state.hopProgress >= 1) {
        state.hopActive = false;
        state.hopProgress = 0;
        state.hopTimer = 0;
        state.nextHopIn = 2 + Math.random() * 2.5;
      }
    }
    const hopHeight = state.hopActive
      ? Math.sin(Math.min(state.hopProgress, 1) * Math.PI) * bodyRadius * 0.35
      : 0;

    // 喜びのぴょんぴょん(雪が降っている時だけ)。歩いていなくても、
    // 立ち止まって雪を見上げている間も小さく跳ねる。
    let joyHopHeight = 0;
    if (state.joyful) {
      state.joyHopTimer += delta;
      if (!state.joyHopActive && state.joyHopTimer >= state.nextJoyHopIn) {
        state.joyHopActive = true;
        state.joyHopProgress = 0;
        state.joyHopTimer = 0;
      }
    }
    if (state.joyHopActive) {
      state.joyHopProgress += delta / 0.28;
      if (state.joyHopProgress >= 1) {
        state.joyHopActive = false;
        state.joyHopProgress = 0;
        state.joyHopTimer = 0;
        state.nextJoyHopIn = 0.8 + Math.random() * 1.4;
      } else {
        joyHopHeight = Math.sin(state.joyHopProgress * Math.PI) * bodyRadius * 0.22;
      }
    }

    // よろけ: 4〜10秒に1回程度、0.6秒かけて片側へ傾いてから立て直す
    if (state.walkBlend > 0.5) {
      state.stumbleTimer += delta;
      if (!state.stumbleActive && state.stumbleTimer >= state.nextStumbleIn) {
        state.stumbleActive = true;
        state.stumbleProgress = 0;
        state.stumbleTimer = 0;
        state.stumbleDir = Math.random() < 0.5 ? -1 : 1;
      }
    }
    if (state.stumbleActive) {
      state.stumbleProgress += delta / 0.6;
      if (state.stumbleProgress >= 1) {
        state.stumbleActive = false;
        state.stumbleProgress = 0;
        state.stumbleTimer = 0;
        state.nextStumbleIn = 4 + Math.random() * 6;
      }
    }
    let stumbleTilt = 0;
    let stumbleLean = 0;
    let stumbleFlail = 0;
    if (state.stumbleActive) {
      const p = Math.min(state.stumbleProgress, 1);
      const wobble = Math.sin(p * Math.PI); // 0→1→0の「傾いて戻る」カーブ
      stumbleTilt = wobble * 0.28 * state.stumbleDir;
      stumbleLean = wobble * 0.12;
      stumbleFlail = Math.sin(p * Math.PI * 4) * (1 - p) * 0.5;
    }
    return { hopHeight: hopHeight + joyHopHeight, stumbleTilt, stumbleLean, stumbleFlail };
  }

  function updateBlink(delta) {
    state.blinkTimer += delta;
    if (state.blinkState === 0 && state.blinkTimer >= state.nextBlinkTime) {
      state.blinkState = 1;
      state.blinkProgress = 0;
      state.blinkTimer = 0;
    }
    if (state.blinkState === 1) {
      state.blinkProgress += delta * 9;
      if (state.blinkProgress >= 1) { state.blinkProgress = 1; state.blinkState = 2; }
    }
    if (state.blinkState === 2) {
      state.blinkProgress += delta * 6;
      if (state.blinkProgress >= 1.1) { state.blinkState = 3; state.blinkProgress = 1; }
    }
    if (state.blinkState === 3) {
      state.blinkProgress -= delta * 10;
      if (state.blinkProgress <= 0) {
        state.blinkState = 0;
        state.blinkProgress = 0;
        state.blinkTimer = 0;
        state.nextBlinkTime = 2 + Math.random() * 5;
      }
    }
    let blinkScale = 1;
    if (state.blinkState === 1) blinkScale = 1 - state.blinkProgress;
    else if (state.blinkState === 2) blinkScale = 0.04;
    else if (state.blinkState === 3) blinkScale = state.blinkProgress;
    eyeLeft.scale.y = blinkScale;
    eyeRight.scale.y = blinkScale;
  }

  function updateMouth(delta) {
    let openAmount;
    if (state.mouthOverride !== null) {
      openAmount = state.mouthOverride;
    } else {
      // 自律もごもご(何もしていない時に時々小さく口を動かす)
      if (!state.idleMouthActive) {
        state.idleMouthTimer += delta;
        if (state.idleMouthTimer >= state.nextIdleMouthTime) {
          state.idleMouthActive = true;
          state.idleMouthTimer = 0;
          state.idleMouthPhase = 0;
        }
        openAmount = 0;
      } else {
        state.idleMouthPhase += delta * 3.2;
        openAmount = Math.max(0, Math.sin(state.idleMouthPhase)) * 0.25;
        if (state.idleMouthPhase >= Math.PI * 2.8) {
          state.idleMouthActive = false;
          state.idleMouthTimer = 0;
          state.nextIdleMouthTime = 2.5 + Math.random() * 5.5;
        }
      }
    }
    openAmount = Math.max(0, Math.min(1, openAmount));
    if (openAmount < 0.04) {
      closedMouthGroup.visible = true;
      openMouth.visible = false;
    } else {
      closedMouthGroup.visible = false;
      openMouth.visible = true;
      openMouth.scale.set(1, 0.15 + openAmount * 0.85, 0.5 + openAmount * 0.3);
    }
  }

  // --- v1.44: ジャンプの伸び縮み+付属品の慣性(物理ではなく、アニメーション状態) ---
  // 流れ: 跳ぶ → 体が少し伸びて軽くなる → 帽子・マフラー・ポーチがふわっと持ち上がる
  //       → 着地で体が少しつぶれる → なめらかに元へ戻る。
  // 呼び出し側は毎フレーム setJumpHeight(地面からの高さ) を渡すだけ(移動処理とは独立)。
  // 速度は高さの差分から求め、離陸・着地もここで検出する。体は下端(接地)を固定して伸縮し、
  // 頭・首・袋は体の伸びに合わせて動くので、体は切り離されて見えない。
  const bodyHalfY = bodyRadius * 0.92;
  const bodyBaseScale = body.scale.clone();
  const hatBaseY = hatGroup.position.y;
  // v1.56-H4: ジャック・オー・ランタンを被っている時は、帽子を深く被る。かぼちゃは頭の球より平たく、
  //   てっぺんが低いので、そのままだと帽子が浅く浮いて見えた。つばの下面が頭のてっぺんから
  //   同じだけ(頭の半径の約17%)下がるよう、帽子を headRadius*0.19 下げる(かぼちゃは丸い頭より縁が低いぶん、少し多め)。
  const HAT_DEEP_WITH_PUMPKIN = headRadius * 0.19;
  let hatSeatDrop = 0; // 現在の帽子の下げ量(なめらかに動かす)
  let hatSeatDropTarget = 0;
  const pouchBaseY = pouchPivot.position.y;
  const pouchRelY = pouchBaseY - bodyY;
  const SQUASH_ON_LANDING = -0.13;  // 着地でつぶれる量(縦のスケール比)
  const STRETCH_RISING = 0.09;      // 上昇中の伸び
  const STRETCH_FALLING = 0.045;    // 下降中の伸び
  const jump = { h: 0, prevH: 0, airborne: false, sq: 0, sqVel: 0, hat: 0, hatVel: 0, scarf: 0, scarfVel: 0, pouch: 0, pouchVel: 0 };
  function spring(value, vel, target, k, c, dt) { // 半陰的オイラー(安定)。k=硬さ c=減衰
    const v2 = vel + (-k * (value - target) - c * vel) * dt;
    return [value + v2 * dt, v2];
  }
  function updateJump(delta) {
    const dt = Math.min(delta, 1 / 30);
    if (!(dt > 0)) return;
    const vy = (jump.h - jump.prevH) / Math.max(delta, 1e-4);
    jump.prevH = jump.h;
    const nowAir = jump.h > 0.02 * scale;
    if (!nowAir && jump.airborne) { // 着地: ぎゅっと沈み、帽子はぽんと浮く
      jump.sq = SQUASH_ON_LANDING; jump.sqVel = 0;
      jump.hatVel += 0.9; jump.scarfVel += 0.5; jump.pouchVel += 0.4;
    }
    jump.airborne = nowAir;
    const air = Math.min(1, jump.h / (0.3 * scale));
    const stretchTarget = nowAir ? (vy > 0 ? STRETCH_RISING : STRETCH_FALLING) * air : 0;
    [jump.sq, jump.sqVel] = spring(jump.sq, jump.sqVel, stretchTarget, 170, 16, dt);
    // 付属品: 空中で「軽くなった」分だけ持ち上がる。帽子はゆっくり・大きく、マフラーとポーチはごく短い遅れで。
    [jump.hat, jump.hatVel] = spring(jump.hat, jump.hatVel, nowAir ? 0.14 * air : 0, 60, 7, dt);
    [jump.scarf, jump.scarfVel] = spring(jump.scarf, jump.scarfVel, nowAir ? air : 0, 120, 12, dt);
    [jump.pouch, jump.pouchVel] = spring(jump.pouch, jump.pouchVel, nowAir ? air : 0, 140, 13, dt);
  }

  /**
   * @param {number} delta 前フレームからの経過秒数
   * @param {number} t 経過時間(秒。焚き火等と同じ`clock.getElapsedTime()`を想定)
   *
   * 呼び出し側への注意: このupdate()は、呼び出し側が事前に設定した
   * group.position(接地位置)・group.rotation.y(向き)に対して、
   * ホップ/よろけ演出をY方向・傾きに"上乗せ"する形で毎フレーム
   * 上書きする。そのため、呼び出し側は自身の移動処理をupdate()の
   * "前"に行うこと。
   */
  // --- v1.56: 頭の装備(ジャック・オー・ランタン)。顔(目・鼻・口・頬)を隠して、かぼちゃの頭に変わる。帽子はそのまま。 ---
  let headCoverKind = null;
  let headCoverMesh = null;
  const faceParts = [head, eyeLeft, eyeRight, nose, blushLeft, blushRight];
  function setHeadCover(kind) {
    if (kind === headCoverKind) return;
    headCoverKind = kind || null;
    if (headCoverMesh) { headGroup.remove(headCoverMesh); headCoverMesh = null; }
    if (headCoverKind === 'jack_o_lantern') {
      headCoverMesh = createJackOLanternMesh(headRadius * 0.98);
      headCoverMesh.position.y = -headRadius * 0.02;
      headGroup.add(headCoverMesh);
    }
    hatSeatDropTarget = headCoverKind === 'jack_o_lantern' ? HAT_DEEP_WITH_PUMPKIN : 0;
    applyHeadCover();
  }
  function applyHeadCover() {
    const covered = !!headCoverKind;
    for (const p of faceParts) p.visible = !covered;
    if (covered) { closedMouthGroup.visible = false; openMouth.visible = false; }
  }

  function update(delta, t) {
    // 雪が降っている間などは、実際の発声強度に関わらず最低限の
    // 「はしゃぎ」を上乗せする(頭の揺れ・腕振り・頬の赤みに反映)。
    const effIntensity = state.joyful ? Math.max(state.intensity, 0.3) : state.intensity;

    // Idle: 頭・帽子・マフラーのゆらぎ(発声強度が高いほど少し大きく揺れる)
    state.headBobPhase += delta * (0.5 + effIntensity * 1.2);
    updateJump(delta);
    const sq = jump.sq;
    const hatLift = Math.max(0, jump.hat), scarfLift = Math.max(0, jump.scarf), pouchLift = Math.max(0, jump.pouch);
    // 頭は体の上端に乗せる(体が伸びた/つぶれた分だけ、そのまま上下する)
    headGroup.position.y = headY + Math.sin(state.headBobPhase) * bodyRadius * 0.03 + 2 * bodyHalfY * sq;
    hatSeatDrop += (hatSeatDropTarget - hatSeatDrop) * Math.min(1, delta * 12); // かぶり直しはすっとなじむ
    hatGroup.position.y = hatBaseY - hatSeatDrop + hatLift * bodyRadius; // 慣性でふわっと浮く(頭の上に離れすぎない範囲)

    state.scarfPhase += delta * 1.8;
    // マフラーの端: 胴体から離れる向きにだけ、ゆっくり揺れる(歩行中は少し大きく)
    for (const e of scarfEnds) {
      const sway = (0.5 + 0.5 * Math.sin(state.scarfPhase + e.phase)) * (0.08 + 0.12 * state.walkBlend) + scarfLift * 0.3;
      e.holder.quaternion.setFromAxisAngle(e.axis, -sway);
    }

    // 歩行の有無をなめらかに補間(0→1で急に足が動き出さないようにする)
    const walkTarget = state.walking ? 1 : 0;
    state.walkBlend += (walkTarget - state.walkBlend) * Math.min(1, delta * 6);

    const { hopHeight, stumbleTilt, stumbleLean, stumbleFlail } = updateWalkQuirks(delta);

    // 腕の振り(歩行中はより大きく振る。よろけた時は少しバタつかせる)
    state.armPhase += delta * (1.0 + effIntensity * 2.0 + state.walkBlend * 2.2);
    const armSwingBase = Math.sin(state.armPhase) * (0.08 + effIntensity * 0.18);
    const armSwingWalk = Math.sin(state.walkPhase) * 0.5 * state.walkBlend;
    // v1.43: アクション(左クリック/✦)の腕のび。一人称の手と同じタイミング・同じ曲線で、
    // 三人称(後ろ・前)でも右腕を前へ伸ばす。これまではタイマーを設定するだけで、ここで
    // 反映していなかったため、一人称でしか動いて見えなかった。
    if (state.actionSwingTimer >= 0) {
      state.actionSwingTimer += delta;
      if (state.actionSwingTimer > ACTION_SWING_DURATION) state.actionSwingTimer = -1;
    }
    const actionCurve = state.actionSwingTimer >= 0
      ? Math.sin(Math.min(1, state.actionSwingTimer / ACTION_SWING_DURATION) * Math.PI)
      : 0;
    // 右腕(アクションで前へ伸びる腕。モデルのx<0側 = +z向きの雪だるまの右手)と左腕(松明)
    rightArm.rotation.x = -armSwingBase - armSwingWalk + actionCurve * ACTION_SWING_ANGLE;
    leftArm.rotation.x = armSwingBase * 1.2 + armSwingWalk;
    rightArm.rotation.z = leftArmBaseZ - stumbleFlail * state.stumbleDir;
    leftArm.rotation.z = rightArmBaseZ + stumbleFlail * state.stumbleDir;

    // 足の交互運動(2つの丸い雪玉を前後に振り子運動させる、可愛らしい歩き方)
    state.walkPhase += delta * (4.2 * Math.max(state.walkBlend, 0.15));
    const strideZ = Math.sin(state.walkPhase) * bodyRadius * 0.3 * state.walkBlend;
    const strideY = Math.abs(Math.sin(state.walkPhase)) * bodyRadius * 0.08 * state.walkBlend;
    rightFoot.position.z = strideZ;
    rightFoot.position.y = footY + strideY;
    leftFoot.position.z = -strideZ;
    leftFoot.position.y = footY + Math.abs(Math.sin(state.walkPhase + Math.PI)) * bodyRadius * 0.08 * state.walkBlend;
    // 歩行に合わせて胴体全体を少しだけ上下させる(通常の細かい上下動)
    body.position.y = bodyY + Math.abs(Math.sin(state.walkPhase * 2)) * bodyRadius * 0.03 * state.walkBlend + bodyHalfY * sq;
    // 体の伸縮(下端=接地は固定)。縦に伸びたら横は少し細く(体積を保つ見た目)。
    body.scale.set(bodyBaseScale.x * (1 - 0.4 * sq), bodyBaseScale.y * (1 + sq), bodyBaseScale.z * (1 - 0.4 * sq));
    // 首のマフラーと左肩のポーチは、体が伸びた分だけ上下して体に付いていく(+ごく短い遅れの持ち上がり)
    scarfGroup.position.y = bodyY + (bodyRadius * 0.8 + bodyHalfY) * sq + scarfLift * bodyRadius * 0.03;
    pouchPivot.position.y = pouchBaseY + (pouchRelY + bodyHalfY) * sq + pouchLift * bodyRadius * 0.02;

    // ポーチは、歩くと少し揺れる(胴体の面に沿った軸まわりに、小さな振り子運動)
    pouchSway.rotation.x = Math.sin(state.walkPhase * 1.0 + 0.6) * 0.16 * state.walkBlend - pouchLift * 0.28;

    // ホップ(ぴょこん)は、呼び出し側が設定した接地位置(position.y)に
    // 対して加算する(呼び出し側は毎フレーム地形の高さでposition.yを
    // 設定し直す前提なので、ここでは単純に+=でよい)。
    group.position.y += hopHeight;
    group.rotation.z = stumbleTilt;
    group.rotation.x = stumbleLean;

    updateBlink(delta);
    updateMouth(delta);
    if (headCoverKind) applyHeadCover(); // 口・まばたきの更新で顔が出てこないように、毎フレーム隠し直す

    blushLeft.material.opacity = effIntensity * 0.35;
    blushRight.material.opacity = effIntensity * 0.35;
  }

  return {
    group,
    update,
    setWalking(walking) { state.walking = !!walking; },
    /** v1.56: 頭の装備を見た目に反映する('jack_o_lantern' か null)。 */
    setHeadCover,
    headGroup,
    getHeadCover: () => headCoverKind,
    /** v1.44: 地面からの高さ(m)。ジャンプ中の伸び縮み・付属品の慣性に使う(毎フレーム渡す)。 */
    setJumpHeight(h) { jump.h = Math.max(0, +h || 0); },
    setMouthOpen(amount) { state.mouthOverride = amount === null || amount === undefined ? null : Math.max(0, Math.min(1, amount)); },
    setIntensity(amount) { state.intensity = Math.max(0, Math.min(1, amount)); },
    /** 雪が降っている時などに呼ぶ。trueの間、小さくぴょんぴょん喜ぶ。 */
    setJoyful(v) { state.joyful = !!v; },
    /** v1.41: 右腕を伸ばす動作を再生する(左クリック/アクションボタン)。連打しても違和感が
     * 出ないよう、再生中に呼ばれた場合は最初からやり直す。 */
    triggerActionSwing() { state.actionSwingTimer = 0; },
    collision,
    // v1.43: 検証・将来の演出用に、ポーチとマフラーの枝を公開する
    pouchGroup: pouchPivot,
    pouchStarShard: starShard,
    bodyMesh: body,
    headGroup,
    hatGroup,
    scarfGroup,
    // v1.44: +z向きの雪だるまの「右手」はモデルのx<0側。右手=ホットバーで選んだ物とアクション、左手=松明。
    torchSocket, // 左手(モデルのx>0側)の先端
    itemSocket, // 右手(モデルのx<0側)の先端
  };
}

/**
 * 一人称視点用の簡易な手。カメラの子として追加する想定
 * (`camera.add(hands.group)`)。キャラクター本体の腕と同じ「枝」の
 * 見た目にし、画面中央を塞がないよう左右に離し、下寄りに配置して
 * 進行方向の視界を広く確保している。
 * 右手には将来の松明取り付け用の空のTorchSocketを用意する。
 *
 * @param {number} scale
 * @returns {{
 *   group: THREE.Group,
 *   torchSocket: THREE.Object3D,
 *   update: (delta:number, t:number) => void,
 *   setWalking: (walking:boolean) => void,
 * }}
 */
export function createFirstPersonHands(scale = 1) {
  const group = new THREE.Group();
  group.renderOrder = 999; // 常に手前に描画されるようにする(他オブジェクトへのめり込み対策)

  function createHand(side) {
    const handGroup = new THREE.Group();
    // v1.43: 画面の下のほうに控えめに見えるよう、さらに下・外寄り・やや小さくした
    // (常に視界の中央を占有しない)。
    handGroup.position.set(FP_HAND_X * scale * side, FP_HAND_Y * scale, -0.6 * scale);
    // 枝が画面の外側から中央上に向かって伸びているように見える角度。
    handGroup.rotation.z = 0.55 * side;
    handGroup.rotation.x = 0.35;
    handGroup.rotation.y = -0.25 * side;

    const limb = createBranchLimb(scale * 0.7, side, {
      mainLength: 0.34 * scale,
      armOutAngle: 0,
      twigSplay: 0.45,
    });
    handGroup.add(limb);

    return { handGroup, limb };
  }

  const left = createHand(-1);
  const right = createHand(1);
  group.add(left.handGroup, right.handGroup);

  // 松明の取り付け位置(左手の枝の先端付近)。
  // 2026-09: 一人称視点で右手に松明があると不自然という指摘を受け、
  // 左手に統一した。
  const torchSocket = new THREE.Object3D();
  torchSocket.position.set(0, 0.34 * scale, 0);
  left.limb.add(torchSocket);

  // v1.39: 一人称視点でもホットバーの持ち物が見えるよう、右手にも取り付け位置を作る。
  const itemSocket = new THREE.Object3D();
  itemSocket.position.set(0, 0.34 * scale, 0);
  right.limb.add(itemSocket);

  left.handGroup.visible = false; // v1.44: 普段は右手だけ。左手は松明を持つ時(夜)だけ見せる
  const state = { walking: false, walkBlend: 0, phase: 0, actionSwingTimer: -1 };
  const baseRotX = { left: left.handGroup.rotation.x, right: right.handGroup.rotation.x };

  function update(delta, t) {
    const walkTarget = state.walking ? 1 : 0;
    state.walkBlend += (walkTarget - state.walkBlend) * Math.min(1, delta * 6);
    state.phase += delta * (state.walkBlend > 0.05 ? 5.5 : 1.2);

    // 静止時: ごく僅かな呼吸のような上下動。歩行時: 手を軽く前後に振る。
    const idleBob = Math.sin(t * 1.4) * 0.006 * scale;
    const walkSwingL = Math.sin(state.phase) * 0.14 * state.walkBlend;
    const walkSwingR = Math.sin(state.phase + Math.PI) * 0.14 * state.walkBlend;
    left.handGroup.position.y = FP_HAND_Y * scale + idleBob;
    right.handGroup.position.y = FP_HAND_Y * scale + idleBob;
    left.handGroup.rotation.x = baseRotX.left + walkSwingL;
    // v1.41: 一人称視点でも、右手を伸ばす動作が見えるようにする(本体側と同じ考え方)。
    if (state.actionSwingTimer >= 0) {
      state.actionSwingTimer += delta;
      if (state.actionSwingTimer > ACTION_SWING_DURATION) state.actionSwingTimer = -1;
    }
    const actionCurve = state.actionSwingTimer >= 0
      ? Math.sin(Math.min(1, state.actionSwingTimer / ACTION_SWING_DURATION) * Math.PI)
      : 0;
    right.handGroup.rotation.x = baseRotX.right + walkSwingR - actionCurve * ACTION_SWING_ANGLE * 0.6;
  }

  return {
    group,
    torchSocket,
    itemSocket,
    update,
    setWalking(walking) { state.walking = !!walking; },
    triggerActionSwing() { state.actionSwingTimer = 0; },
    /** v1.44: 左手(松明の手)を見せるか。夜に松明を持つ時だけtrue。 */
    setLeftHandVisible(v) { left.handGroup.visible = !!v; },
    isLeftHandVisible: () => left.handGroup.visible,
  };
}

// --- 松明(夜間に雪だるまへ持たせる) ---
const TORCH_STICK_MATERIAL = new THREE.MeshToonMaterial({ color: 0x4a331f, gradientMap: getToonGradientMap() });
const TORCH_FLAME_OUTER = new THREE.MeshBasicMaterial({ color: 0xe0621e, transparent: true, opacity: 0.85 });
const TORCH_FLAME_INNER = new THREE.MeshBasicMaterial({ color: 0xf9c94a, transparent: true, opacity: 0.9 });

/**
 * 松明を作る。棒+炎(campfire.jsと同じ考え方の簡易な炎)+暖色のPointLight。
 * `torchSocket`(createSnowmanCharacter/createFirstPersonHandsが返す
 * 右腕・右手の先端)の子として追加する想定。
 *
 * @param {number} scale
 * @returns {{ group: THREE.Group, light: THREE.PointLight, update: (t:number) => void, setLit: (lit:boolean) => void }}
 */
export function createTorch(scale = 1) {
  const group = new THREE.Group();

  const stickGeo = new THREE.CylinderGeometry(0.02 * scale, 0.026 * scale, 0.5 * scale, 6);
  const stick = new THREE.Mesh(stickGeo, TORCH_STICK_MATERIAL);
  stick.position.y = 0.25 * scale;
  stick.castShadow = true;
  group.add(stick);

  const flameGroup = new THREE.Group();
  flameGroup.position.y = 0.52 * scale;
  const outerGeo = new THREE.ConeGeometry(0.09 * scale, 0.26 * scale, 6);
  const outerFlame = new THREE.Mesh(outerGeo, TORCH_FLAME_OUTER);
  outerFlame.position.y = 0.13 * scale;
  flameGroup.add(outerFlame);
  const innerGeo = new THREE.ConeGeometry(0.05 * scale, 0.17 * scale, 6);
  const innerFlame = new THREE.Mesh(innerGeo, TORCH_FLAME_INNER);
  innerFlame.position.y = 0.09 * scale;
  flameGroup.add(innerFlame);
  group.add(flameGroup);

  // 暖色の光(夜間にもっと周囲を照らせるよう、強さ・届く距離を拡大)
  const light = new THREE.PointLight(0xff9a4a, 2.2, 8 * scale, 2);
  light.position.y = 0.55 * scale;
  group.add(light);

  // 火の粉(焚き火よりずっと少なく・軽量に、松明の先端から立ち上る)
  const emberCount = 8;
  const emberGeo = new THREE.BufferGeometry();
  const emberPositions = new Float32Array(emberCount * 3);
  const emberSpeeds = new Float32Array(emberCount);
  for (let i = 0; i < emberCount; i++) {
    emberPositions[i * 3] = (Math.random() - 0.5) * 0.1 * scale;
    emberPositions[i * 3 + 1] = 0.52 * scale + Math.random() * 0.35 * scale;
    emberPositions[i * 3 + 2] = (Math.random() - 0.5) * 0.1 * scale;
    emberSpeeds[i] = 0.25 + Math.random() * 0.35;
  }
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3));
  const emberMaterial = new THREE.PointsMaterial({
    color: 0xf9c94a,
    size: 0.025 * scale,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  });
  const embers = new THREE.Points(emberGeo, emberMaterial);
  group.add(embers);

  let lit = true;
  function update(t, dt = 0.016) {
    if (!lit) return;
    const flicker = 0.85 + Math.sin(t * 11) * 0.08 + Math.sin(t * 23.1) * 0.05;
    light.intensity = 2.2 * flicker;
    flameGroup.scale.set(1, 0.9 + flicker * 0.25, 1);
    // 単調な横回転だけでなく、少しねじれるようなX/Z方向の揺らぎも加える
    flameGroup.rotation.y = Math.sin(t * 3) * 0.3;
    flameGroup.rotation.x = Math.sin(t * 7.3) * 0.06;
    flameGroup.rotation.z = Math.sin(t * 5.1 + 1.7) * 0.07;

    const positions = emberGeo.attributes.position;
    for (let i = 0; i < emberCount; i++) {
      let y = positions.getY(i) + emberSpeeds[i] * dt;
      if (y > 0.9 * scale) {
        y = 0.52 * scale;
        positions.setX(i, (Math.random() - 0.5) * 0.1 * scale);
        positions.setZ(i, (Math.random() - 0.5) * 0.1 * scale);
      }
      positions.setY(i, y);
    }
    positions.needsUpdate = true;
  }

  function setLit(v) {
    lit = !!v;
    // 2026-09: 明るい時間帯に火のついていない松明の棒だけを持たせているのは
    // 不自然という指摘を受け、消えている間は松明本体(棒)ごと非表示にする。
    group.visible = lit;
    flameGroup.visible = lit;
    light.visible = lit;
    embers.visible = lit;
  }

  return { group, light, update, setLit };
}
