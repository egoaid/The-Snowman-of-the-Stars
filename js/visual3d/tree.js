// tree.js
// 低ポリの針葉樹(モミ/マツ)を作る。幹はCylinder、葉は複数のConeを
// 重ねて階層状にする。トゥーンシェーディングで陰影を段階的にする。

import * as THREE from 'three';
import { getToonGradientMap } from './shading.js';

const TRUNK_MATERIAL = new THREE.MeshToonMaterial({ color: 0x5a3a22, gradientMap: getToonGradientMap() });
const LEAF_MATERIAL = new THREE.MeshToonMaterial({ color: 0x3d6a34, gradientMap: getToonGradientMap() });

// 2026-09(季節システム): 全ての針葉樹がこの1つのMaterialを共有しているため、
// ここの色を変えるだけで、シーン中の全ての木の葉色を一括で変更できる
// (木ごとに個別のMaterialを持たせる必要がない)。季節に応じた葉色は
// scene3d.js側でseason.jsの色を毎フレームなめらかに補間してここへ渡す。
const _leafColorScratch = new THREE.Color();
export function setLeafTint(color) {
  _leafColorScratch.set(color);
  LEAF_MATERIAL.color.copy(_leafColorScratch);
}
/** 全ての針葉樹と共有している葉のMaterial(季節の色・積雪が一括で効く)。倒木の葉も同じものを使う。 */
export function getLeafMaterial() { return LEAF_MATERIAL; }
export function getLeafColor(outColor) {
  return outColor.copy(LEAF_MATERIAL.color);
}

// 2026-09(積雪): 「木の葉の上にも雪が積もり、単純な色変化ではなく厚みが
// 増して丸くなるように」との指摘への対応。すべての針葉樹がLEAF_MATERIAL
// を共有しているため、この1つのMaterialの頂点シェーダーに「法線方向へ
// ふくらませる」処理をonBeforeCompileで注入し、uSnowBulk(0〜1程度、
// メートル換算のふくらみ量)を上げるだけで、シーン中の全ての木の葉が
// 一括で「雪が積もって丸くぽってりした」シルエットになるようにする。
// 個々の葉(円錐)のジオメトリそのものは変えず、法線方向へ頂点を
// 押し出すだけなので、複雑な形状変更をせずに済む軽量な近似。
const leafSnowBulkUniform = { value: 0 };
LEAF_MATERIAL.onBeforeCompile = (shader) => {
  shader.uniforms.uSnowBulk = leafSnowBulkUniform;
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      '#include <common>\nuniform float uSnowBulk;'
    )
    .replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\ntransformed += normal * uSnowBulk;'
    );
};
/**
 * 木の葉に積もった雪の「厚み」(法線方向へのふくらみ量、メートル単位の
 * 目安)。0で通常の葉の形、値が増えるほど丸くぽってりした見た目になる。
 */
export function setLeafSnowBulk(amount) {
  leafSnowBulkUniform.value = amount;
}

// ============================================================================
// 2026-09(v1.30): 広葉樹(混交林・紅葉用)
// ============================================================================
// 針葉樹(円錐を重ねたモミ/マツ)とは別に、丸みのある「塊」を組み合わせた
// 広葉樹を用意する。針葉樹は季節でほとんど色が変わらないのに対し、こちらは
// 秋に黄→橙→赤へ鮮やかに色づき、冬には落葉する(season.jsの
// getBroadleafLeafColor/getBroadleafDefoliationと連動させる)。
//
// 色は、針葉樹と同じ「共有マテリアルの色を書き換える」方式だが、木ごとの
// 見た目に変化を持たせるため、少しずつ色相・彩度をずらした複数
// (BROADLEAF_PALETTE_SIZE個)のマテリアルを用意し、各木の樹冠の塊(ブロブ)
// ごとにどれを使うかを木の種(seed)で決める。setBroadleafTint()を呼ぶと、
// 全パレットが「その基準色を中心に散らした色」へ一括で更新されるため、
// 季節が進んでも(全ての広葉樹の色が個別にばらつきながら)まとまって
// 変化していくように見える。
const BROADLEAF_PALETTE_SIZE = 4;
// 各パレット要素の、基準色からの相対オフセット(色相は加算、彩度・明度は乗算)。
const BROADLEAF_PALETTE_OFFSETS = [
  { h: -0.025, s: 1.05, l: 1.08 },
  { h: 0.02, s: 0.92, l: 0.94 },
  { h: 0.055, s: 1.08, l: 0.86 },
  { h: -0.01, s: 0.82, l: 1.15 },
];
const BROADLEAF_LEAF_MATERIALS = Array.from({ length: BROADLEAF_PALETTE_SIZE }, () =>
  new THREE.MeshToonMaterial({ color: 0x2f6b2a, gradientMap: getToonGradientMap() })
);
const _broadleafBase = new THREE.Color();
const _broadleafHsl = { h: 0, s: 0, l: 0 };
export function setBroadleafTint(color) {
  _broadleafBase.set(color);
  _broadleafBase.getHSL(_broadleafHsl);
  BROADLEAF_LEAF_MATERIALS.forEach((mat, i) => {
    const off = BROADLEAF_PALETTE_OFFSETS[i % BROADLEAF_PALETTE_OFFSETS.length];
    const h = ((_broadleafHsl.h + off.h) % 1 + 1) % 1;
    const s = Math.min(1, Math.max(0, _broadleafHsl.s * off.s));
    const l = Math.min(1, Math.max(0, _broadleafHsl.l * off.l));
    mat.color.setHSL(h, s, l);
  });
}
export function getBroadleafPaletteSize() {
  return BROADLEAF_PALETTE_SIZE;
}

// 2026-09(v1.34改訂): 広葉樹の枝分かれ構造(段数・本数・葉の数・大きさ)を
// 設定パネルから調整できるようにするためのパラメータ。'full'=大木(1本だけ、
// キャンプの目印。思い切り複雑にする)、'simple'=背景の森の広葉樹(本数が
// 多いので既定は控えめ)。tiersが増えるほど、branchCountsの各要素の掛け算
// 分だけメッシュ数が増えていく点に注意(例: [3,3,3]なら3+9+27=39本の枝)。
const BROADLEAF_SHAPE_PARAMS = {
  full: { tiers: 3, branchCounts: [3, 3, 3, 3], leavesPerTwig: 2, leafSizeScale: 1.1 },
  simple: { tiers: 1, branchCounts: [6, 3, 3, 3], leavesPerTwig: 2, leafSizeScale: 1.0 },
};

/**
 * 広葉樹の枝分かれパラメータを変更する。既に生成済みのツリーには影響しない
 * (ジオメトリを都度組み替えるコストが高いため、地形自動生成と同様に
 * 「設定→ページ再読み込みで反映」という運用を想定している)。
 * @param {'full'|'simple'} detail
 * @param {{tiers?:number, branchCounts?:number[], leavesPerTwig?:number, leafSizeScale?:number}} params
 */
export function setBroadleafShapeParams(detail, params) {
  const target = BROADLEAF_SHAPE_PARAMS[detail];
  if (!target || !params) return;
  if (Number.isFinite(params.tiers)) {
    target.tiers = Math.max(1, Math.min(4, Math.round(params.tiers)));
  }
  if (Array.isArray(params.branchCounts)) {
    target.branchCounts = target.branchCounts.map((existing, i) => {
      const v = params.branchCounts[i];
      return Number.isFinite(v) ? Math.max(1, Math.min(8, Math.round(v))) : existing;
    });
  }
  if (Number.isFinite(params.leavesPerTwig)) {
    target.leavesPerTwig = Math.max(1, Math.min(3, Math.round(params.leavesPerTwig)));
  }
  if (Number.isFinite(params.leafSizeScale)) {
    target.leafSizeScale = Math.max(0.5, Math.min(1.8, params.leafSizeScale));
  }
}

/**
 * 現在の広葉樹の枝分かれパラメータを取得する(設定パネルの初期値表示用)。
 * @param {'full'|'simple'} detail
 */
export function getBroadleafShapeParams(detail) {
  const target = BROADLEAF_SHAPE_PARAMS[detail];
  if (!target) return null;
  return { ...target, branchCounts: [...target.branchCounts] };
}

/**
 * 円柱(枝)は根元が太く先端が細いテーパー形状にしてある(見た目のリアルさの
 * ため)。子の枝を生やす際、子の根元の太さを親の"先端"の太さ(この定数を
 * 掛けた値)に必ず揃えることで、接合点で太さが不連続にジャンプする段差を
 * 防ぐ(v1.33までは子の太さを無関係な独自の式で決めていたため、パラメータを
 * どう変えても接合点に段差が残る構造的な欠陥があった)。
 */
const BRANCH_TAPER = 0.6;

/**
 * 分岐点(複数の枝が1点から広がる場所)に添える、小さな低ポリ球。
 * 円柱は直線的な側面しか持たないため、複数の枝が1点から別れる場所には
 * 隙間ができてしまう。実際の木では樹皮がここで盛り上がって隙間を覆っている
 * ため、それを低コストな球1個で近似する(素朴な木生成アルゴリズムで
 * よく使われる定番の手法)。
 */
function sphericalDir(azimuth, elevation) {
  return new THREE.Vector3(
    Math.cos(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.sin(azimuth) * Math.cos(elevation)
  );
}

/**
 * 広葉樹のGroupを作る。原点は木の根元(接地面)。針葉樹(createPineTree)と
 * 同じ引数・座標系にしてあるので、配置ループの中でそのまま差し替えられる。
 *
 * 2026-09(v1.34改訂): 「全パラメータを最大にしても納得のいく形状にならない」
 * 「分岐部分に段差が残る」という指摘への対応。原因は、子の枝の太さを
 * 親の枝の"先端の太さ"とは無関係な独自の式で決めていたため、太さが不連続に
 * ジャンプする段差がどのパラメータでも構造的に残ってしまっていたこと
 * だった(BRANCH_TAPER参照)。今回、子の根元の太さを必ず親の先端の太さに
 * 揃えて段差そのものをなくし、さらに各分岐点に小さな球(addJointBlend)を
 * 添えて、複数の枝が1点から広がる際にできる隙間を自然に覆うようにした。
 * あわせて段数を最大4段まで、各段の分岐数も2〜3本を基本とした再帰構造に
 * 書き直し(実際の広葉樹に近い、繰り返しの二又・三又分岐)、枝先には
 * 葉の塊を複数個(leavesPerTwig)まとめて付けられるようにして、より
 * 生い茂った印象にした。
 *
 * 段数・枝分かれの本数・葉の数・大きさはBROADLEAF_SHAPE_PARAMS
 * (setBroadleafShapeParamsで変更可)で調整できる。メッシュ数(≒描画コール数)
 * は各段の本数の掛け算+分岐点の球の数+葉の数の分だけ増えるため、段数を
 * 増やすほど重くなる点に注意(既定は本数が1本しかない大木='full'で
 * 約107メッシュ、多数配置される背景の森='simple'では約20メッシュに
 * 抑えてある)。
 *
 * @param {number} scale
 * @param {number} seed
 * @param {{angle:number,dirX:number,dirZ:number}|null} [leanOptions] - createPineTreeと同じ(川岸の斜面用)
 * @param {'full'|'simple'} [detail] - 'full'=大木用(既定3段の豊かな分岐)、'simple'=背景の森用(既定1段、軽量)
 * @returns {{ group: THREE.Group, canopyBlobs: THREE.Mesh[], canopyTop: number, canopyRadius: number }}
 */
export function createBroadleafTree(scale = 1, seed = 0, leanOptions = null, detail = 'full') {
  const group = new THREE.Group();
  const rng = makeLocalRng(seed);

  const trunkHeight = 1.5 * scale;
  const trunkRadius = 0.22 * scale; // 広葉樹は針葉樹よりやや太めの幹にする
  let canopyBaseY;
  let branchOrigin = new THREE.Vector3(0, 0, 0);
  let branchTiltEuler = new THREE.Euler(0, 0, 0);
  let trunkTipRadius; // 幹の実際の先端の太さ(直立か斜面生えかで異なる)

  if (leanOptions) {
    const { angle, dirX, dirZ } = leanOptions;
    const lowerLen = trunkHeight * 0.35;
    const upperLen = trunkHeight * 0.75;
    const lowerGeo = new THREE.CylinderGeometry(trunkRadius * 0.85, trunkRadius * 1.05, lowerLen, 7);
    lowerGeo.translate(0, lowerLen / 2, 0);
    const lowerTrunk = new THREE.Mesh(lowerGeo, TRUNK_MATERIAL);
    lowerTrunk.rotation.x = dirZ * angle;
    lowerTrunk.rotation.z = -dirX * angle;
    lowerTrunk.castShadow = true;
    lowerTrunk.receiveShadow = true;
    group.add(lowerTrunk);
    const pivot = new THREE.Vector3(0, lowerLen, 0);
    pivot.applyEuler(new THREE.Euler(dirZ * angle, 0, -dirX * angle));
    const upperGeo = new THREE.CylinderGeometry(trunkRadius * 0.75, trunkRadius * 0.95, upperLen, 7);
    const upperTrunk = new THREE.Mesh(upperGeo, TRUNK_MATERIAL);
    upperTrunk.position.set(pivot.x, pivot.y + upperLen / 2, pivot.z);
    upperTrunk.castShadow = true;
    upperTrunk.receiveShadow = true;
    group.add(upperTrunk);
    canopyBaseY = pivot.y + upperLen;
    branchOrigin = new THREE.Vector3(pivot.x, canopyBaseY, pivot.z);
    branchTiltEuler = new THREE.Euler(dirZ * angle, 0, -dirX * angle);
    trunkTipRadius = trunkRadius * 0.75; // upperGeoのradiusTopと一致させる
  } else {
    const trunkGeo = new THREE.CylinderGeometry(trunkRadius * 0.6, trunkRadius, trunkHeight, 7);
    const trunk = new THREE.Mesh(trunkGeo, TRUNK_MATERIAL);
    trunk.position.y = trunkHeight / 2;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    group.add(trunk);
    canopyBaseY = trunkHeight;
    branchOrigin = new THREE.Vector3(0, canopyBaseY, 0);
    trunkTipRadius = trunkRadius * 0.6; // trunkGeoのradiusTopと一致させる
  }

  const canopySpan = 1.5 * scale;
  const canopyBlobs = [];
  const upAxis = new THREE.Vector3(0, 1, 0);
  let highestBlobTop = canopyBaseY;
  let maxHorizExtent = 0.3 * scale;

  /** 枝(細い円柱)を1本生やし、その先端の位置を返す。radiusは根元(太い方)の太さ。 */
  function addBranchSegment(origin, dir, len, radius) {
    const geo = new THREE.CylinderGeometry(radius * BRANCH_TAPER, radius, len, 5);
    geo.translate(0, len / 2, 0);
    const mesh = new THREE.Mesh(geo, TRUNK_MATERIAL);
    mesh.position.copy(origin);
    mesh.quaternion.setFromUnitVectors(upAxis, dir);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.isBroadleafBranch = true; // 幹本体(トランク)と区別するための印(検証用)
    group.add(mesh);
    return origin.clone().addScaledVector(dir, len);
  }

  /** 分岐点に、その場所の太さに合わせた小さな球を1個添える(段差・隙間の解消)。 */
  function addJointBlend(pos, radius) {
    if (radius <= 0) return;
    const geo = new THREE.IcosahedronGeometry(radius, 0);
    const mesh = new THREE.Mesh(geo, TRUNK_MATERIAL);
    mesh.position.copy(pos);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.isBroadleafJoint = true; // 検証用の印
    group.add(mesh);
    highestBlobTop = Math.max(highestBlobTop, pos.y + radius);
    maxHorizExtent = Math.max(maxHorizExtent, Math.hypot(pos.x, pos.z) + radius);
  }

  /**
   * 枝先に葉の塊(Icosahedron)を1個付ける。
   * 2026-09(v1.35改訂): 「岩のようにゴツゴツして見える」という指摘への対応。
   * 分割の粗いIcosahedron(detail=1、80面)に単一の低周波の膨らみだけを
   * 与えていたため、少数の平らな面が膨らんだ「岩」のような見た目になって
   * いた。分割をより細かくし(大木は detail=2、背景の森は detail=1 のまま
   * 負荷を抑制)、粗い膨らみ+中間+細かい凹凸の3層を重ねることで、
   * 葉が茂った房のような、より有機的な質感に近づけた。
   */
  function addLeafCluster(pos, radius, idx, total) {
    const icoDetail = detail === 'full' ? 2 : 1;
    const geo = new THREE.IcosahedronGeometry(radius, icoDetail);
    const posAttr = geo.attributes.position;
    for (let v = 0; v < posAttr.count; v++) {
      const vx = posAttr.getX(v), vy = posAttr.getY(v), vz = posAttr.getZ(v);
      const len = Math.hypot(vx, vy, vz) || 1;
      const nx = vx / len, ny = vy / len, nz = vz / len;
      const coarse = Math.sin((nx * 5 + ny * 4 + nz * 6) + seed * 2.3 + idx * 1.7) * 0.07;
      const mid = Math.sin((nx * 11 - ny * 9 + nz * 8) * 1.4 + seed * 3.7 + idx * 2.9) * 0.045;
      const fine = Math.cos((nx * 21 + ny * 19 - nz * 23) * 1.1 + seed * 1.6 + idx * 4.1) * 0.03;
      const bump = 1 + coarse + mid + fine;
      posAttr.setXYZ(v, vx * bump, vy * bump, vz * bump);
    }
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
    const material = BROADLEAF_LEAF_MATERIALS[Math.floor(rng() * BROADLEAF_PALETTE_SIZE)];
    const blob = new THREE.Mesh(geo, material);
    blob.position.copy(pos);
    const squishY = 0.68 + rng() * 0.17;
    const stretchH = 1.0 + rng() * 0.2;
    blob.scale.set(stretchH, squishY, stretchH);
    blob.castShadow = true;
    blob.receiveShadow = true;
    blob.userData.defoliationThreshold = (idx + rng() * 0.6) / (total - 0.4 + rng() * 0.6);
    group.add(blob);
    canopyBlobs.push(blob);
    highestBlobTop = Math.max(highestBlobTop, pos.y + radius * squishY);
    maxHorizExtent = Math.max(maxHorizExtent, Math.hypot(pos.x, pos.z) + radius);
  }

  // --- 枝分かれの再帰生成 ---
  // BROADLEAF_SHAPE_PARAMS[detail] から段数・各段の本数・枝先の葉の数・
  // 葉の塊の大きさ倍率を読み取る。tiersが1なら一次枝の先端にそのまま葉を
  // 付け、2以上ならその段の先端からさらに次の段の枝を生やし、最後の段の
  // 先端にだけ葉の塊(1〜3個)を付ける。
  const shapeParams = BROADLEAF_SHAPE_PARAMS[detail] || BROADLEAF_SHAPE_PARAMS.full;
  const tiers = Math.max(1, Math.min(4, shapeParams.tiers | 0));
  const branchCounts = [];
  for (let t = 0; t < tiers; t++) {
    branchCounts.push(Math.max(1, shapeParams.branchCounts[t] || 2));
  }
  const leavesPerTwig = Math.max(1, shapeParams.leavesPerTwig || 1);
  const leafSizeScale = shapeParams.leafSizeScale || 1;
  let totalLeaves = leavesPerTwig;
  for (const c of branchCounts) totalLeaves *= c;
  let leafIdx = 0;

  /**
   * origin/azimuth/elevation/parentTipRadiusは「この段の親の枝の先端・
   * 向き・太さ」。level===0のときは幹の先端(branchOrigin)から生える
   * 一次枝の段。子の太さは必ずparentTipRadius(親の先端の太さ)を基準に
   * 決めるため、接合点で太さがジャンプする段差は原理的に発生しない。
   *
   * isLeaderPath: 2026-09(v1.35)「俯瞰で見ると中心がドーナツ状に空洞に
   * なっている」という指摘への対応。全ての枝が幹の先端から外側・斜め上へ
   * 広がっていく構造だと、樹冠の真上(幹の軸の真上)に葉が来ず、上から見ると
   * 中心に穴が空いて見えてしまっていた。一次枝の1本(index 0)を「頂芽の
   * 主軸」として扱い、他の枝のような外側への広がりを持たせず、常にほぼ
   * 真上(仰角70〜88度)へ伸ばし続けることで、樹冠の中心にも葉が来るように
   * した(実際の木の頂芽優勢と同じ考え方)。
   */
  function growLevel(origin, azimuth, elevation, parentTipRadius, level, isLeaderPath) {
    const count = branchCounts[level];
    if (count <= 0) return;
    // この分岐点に球を1個添えて、これから広がる枝どうしの隙間を覆う。
    addJointBlend(origin, parentTipRadius);

    const isFirstLevel = level === 0;
    // 一次枝のうち、index0は樹冠の中心を埋める「頂芽の主軸」、
    // 続く最大1本は「共同主幹」(幹に近い太さ・より直立)として扱う。
    const hasLeader = isFirstLevel && count >= 1;
    const coDominantCount = isFirstLevel ? Math.min(hasLeader ? count - 1 : count, 1) : 0;
    for (let i = 0; i < count; i++) {
      const isLeaderBranch = isFirstLevel && hasLeader && i === 0;
      const isCoDominant = isFirstLevel && !isLeaderBranch && i < (hasLeader ? 1 + coDominantCount : coDominantCount);
      let az, elevDeg, len, baseRadius;
      if (isLeaderBranch) {
        // 頂芽の主軸: ほぼ真上へ、外側への広がりをほとんど持たせない。
        az = rng() * Math.PI * 2;
        elevDeg = 74 + rng() * 14;
        len = (0.4 + rng() * 0.12) * canopySpan;
        baseRadius = parentTipRadius * (0.7 + rng() * 0.15);
      } else if (isFirstLevel) {
        if (isCoDominant) {
          az = rng() * Math.PI * 2;
          elevDeg = 50 + rng() * 20;
          len = (0.42 + rng() * 0.14) * canopySpan;
          // 幹の先端とほぼ同じ太さにして、幹がそのまま自然に続いているように見せる。
          baseRadius = parentTipRadius * (0.75 + rng() * 0.15);
        } else {
          const sideIdx = i - (hasLeader ? 1 : 0) - coDominantCount;
          const sideCount = Math.max(1, count - (hasLeader ? 1 : 0) - coDominantCount);
          az = (sideIdx / sideCount) * Math.PI * 2 + rng() * 0.6;
          elevDeg = 24 + rng() * 24;
          len = (0.62 + rng() * 0.28) * canopySpan;
          baseRadius = parentTipRadius * (0.5 + rng() * 0.15);
        }
      } else if (isLeaderPath) {
        // 頂芽の主軸の続き: 段が進んでも仰角を高く保ち、中心付近に留める。
        az = azimuth + (rng() - 0.5) * 0.6;
        elevDeg = 68 + rng() * 16;
        len = (0.4 + rng() * 0.25) * canopySpan * Math.pow(0.88, Math.max(0, level - 1));
        baseRadius = parentTipRadius * (0.66 + rng() * 0.2);
      } else {
        az = azimuth + (i % 2 === 0 ? -1 : 1) * (0.42 + rng() * 0.38);
        elevDeg = (elevation * 180) / Math.PI + (rng() - 0.2) * 32;
        // 段が進むほど枝を少し短くしていく(先端に向けて小枝らしく)。
        len = (0.42 + rng() * 0.3) * canopySpan * Math.pow(0.88, Math.max(0, level - 1));
        baseRadius = parentTipRadius * (0.62 + rng() * 0.2);
      }
      const elevRad = (elevDeg * Math.PI) / 180;
      const dir = sphericalDir(az, elevRad).applyEuler(branchTiltEuler);
      const tip = addBranchSegment(origin, dir, len, baseRadius);
      const tipRadius = baseRadius * BRANCH_TAPER;
      const childIsLeaderPath = isLeaderBranch || (level > 0 && isLeaderPath);
      if (level === tiers - 1) {
        // 枝先に葉の塊を1〜3個、少しずつ位置をずらしてまとめて付ける
        // (房のようにまとまり、より生い茂った印象になる)。
        for (let li = 0; li < leavesPerTwig; li++) {
          const jitterScale = len * 0.3;
          const jitter = new THREE.Vector3(
            (rng() - 0.5) * jitterScale,
            (rng() - 0.5) * jitterScale,
            (rng() - 0.5) * jitterScale
          );
          const blobRadius = (0.3 + rng() * 0.13) * len * leafSizeScale;
          addLeafCluster(tip.clone().add(jitter), blobRadius, leafIdx, totalLeaves);
          leafIdx++;
        }
      } else {
        growLevel(tip, az, elevRad, tipRadius, level + 1, childIsLeaderPath);
      }
    }
  }
  growLevel(branchOrigin, 0, 0, trunkTipRadius, 0, false);

  return {
    group,
    canopyBlobs,
    canopyTop: highestBlobTop,
    canopyRadius: Math.max(canopySpan, maxHorizExtent),
  };
}

function makeLocalRng(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 広葉樹の樹冠の塊(createBroadleafTreeが返すcanopyBlobsの配列を束ねたもの)
 * に、落葉の進み具合(0=満開、1=完全に落葉)を適用する。
 * @param {THREE.Mesh[]} allCanopyBlobs 複数の木のcanopyBlobsを連結した配列
 * @param {number} fraction
 */
export function applyBroadleafDefoliation(allCanopyBlobs, fraction) {
  for (const blob of allCanopyBlobs) {
    blob.visible = fraction < blob.userData.defoliationThreshold;
  }
}

/**
 * 針葉樹のGroupを作る。原点は木の根元(接地面)。
 * @param {number} scale - 全体の大きさ
 * @param {number} seed - 形状のランダムさ(木ごとに少し変える)
 * @param {{angle:number,dirX:number,dirZ:number}|null} [leanOptions] -
 *   川岸の斜面などに生えた木を表現する時だけ渡す。指定すると、根元付近は
 *   斜面に垂直な向き(angle・dirで指定した方向へ傾く)で生え始め、
 *   途中から向きを変えて上(世界座標のY+)へ伸びる、という2段構えの
 *   幹にする。指定しなければ(既定)今までどおりの、まっすぐ1本の幹になる。
 */
export function createPineTree(scale = 1, seed = 0, leanOptions = null) {
  const group = new THREE.Group();

  const trunkHeight = 1.6 * scale;
  const trunkRadius = 0.18 * scale;
  let canopyBaseY;

  if (leanOptions) {
    // --- 斜面の木: 根元は斜面に垂直な向きで生え、途中で上向きに曲がる ---
    const { angle, dirX, dirZ } = leanOptions;
    const lowerLen = trunkHeight * 0.38; // 斜面に垂直な下段の長さ
    const upperLen = trunkHeight * 0.72; // 上向きに曲がってからの上段の長さ

    // 下段(斜面に垂直): 通常のCylinderを作ってから、根元を軸にangleだけ
    // 傾ける(rotation.x/zの組み合わせで、dirX/dirZ方向へ倒す)。
    const lowerGeo = new THREE.CylinderGeometry(trunkRadius * 0.85, trunkRadius * 1.05, lowerLen, 7);
    lowerGeo.translate(0, lowerLen / 2, 0); // 根元(y=0)を回転の軸にする
    const lowerTrunk = new THREE.Mesh(lowerGeo, TRUNK_MATERIAL);
    lowerTrunk.rotation.x = dirZ * angle; // X軸まわりの回転はZ方向への倒れになる
    lowerTrunk.rotation.z = -dirX * angle; // Z軸まわりの回転はX方向への倒れになる
    lowerTrunk.castShadow = true;
    lowerTrunk.receiveShadow = true;
    group.add(lowerTrunk);

    // 下段の先端位置(=上段の根元位置)を計算
    const pivot = new THREE.Vector3(0, lowerLen, 0);
    pivot.applyEuler(new THREE.Euler(dirZ * angle, 0, -dirX * angle));

    // 上段(まっすぐ上向き): 世界座標のY+方向にそのまま伸ばす
    const upperGeo = new THREE.CylinderGeometry(trunkRadius * 0.7, trunkRadius * 0.9, upperLen, 7);
    const upperTrunk = new THREE.Mesh(upperGeo, TRUNK_MATERIAL);
    upperTrunk.position.set(pivot.x, pivot.y + upperLen / 2, pivot.z);
    upperTrunk.castShadow = true;
    upperTrunk.receiveShadow = true;
    group.add(upperTrunk);

    canopyBaseY = pivot.y + upperLen * 0.55;
  } else {
    // --- 通常の木: 今までどおり、まっすぐ1本の幹 ---
    const trunkGeo = new THREE.CylinderGeometry(trunkRadius * 0.7, trunkRadius, trunkHeight, 7);
    const trunk = new THREE.Mesh(trunkGeo, TRUNK_MATERIAL);
    trunk.position.y = trunkHeight / 2;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    group.add(trunk);

    canopyBaseY = trunkHeight * 0.55;
  }

  const tiers = 5;
  const canopyTotalHeight = 3.2 * scale;
  const tierStep = canopyTotalHeight / tiers;

  for (let t = 0; t < tiers; t++) {
    const tFrac = t / (tiers - 1); // 0(下)〜1(上)
    const radius = (1.1 - tFrac * 0.75) * scale;
    const height = tierStep * 1.35;
    const y = canopyBaseY + tierStep * t * 0.78;
    const segments = 8;
    // 2026-09: 見た目のリアルさ向上。以前は高さ方向1段(heightSegments=1)
    // の単純な円錐で、裾だけを揺らしていたため「ただの幾何学的な円錐」に
    // 見えていた。heightSegments=3にして側面にも複数の輪(リング)を持たせ、
    // 裾だけでなく側面全体に房状の凹凸をつけることで、より葉の茂みらしい
    // 不規則なシルエットにする。
    // (三角形数は1本の円錐あたり16→約48枚に増えるが、木1本あたり数十枚
    // 程度の増加でしかなく、GPU負荷への影響は無視できるレベル)
    const heightSegments = 3;
    const coneGeo = new THREE.ConeGeometry(radius, height, segments, heightSegments);
    const posAttr = coneGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vy = posAttr.getY(i);
      const vz = posAttr.getZ(i);
      const r = Math.hypot(vx, vz);
      if (r < 1e-6) continue; // 頂点(先端)や底面キャップの中心点はそのまま
      // 重要: 乱数の種を「頂点インデックス」ではなく「頂点の角度+高さ」に
      // することで、同じ位置にある重複頂点(側面の裾リングと底面キャップの
      // 外周リングなど)が必ず同じズレ量になり、面同士に隙間ができない
      // ようにしている(以前あった造形バグの修正方針を踏襲)。
      const angle = Math.atan2(vz, vx);
      const heightFrac = (vy + height / 2) / height; // 0(裾)〜1(先端)
      // 粗い房のかたまり(周波数5)と、葉先の細かい凹凸(周波数11)を
      // 重ねて、単調な円錐ではなく自然な茂みのシルエットにする。
      const bump =
        Math.sin(angle * 5 + seed * 3.7) * 0.07 +
        Math.sin(angle * 11 - seed * 2.1 + heightFrac * 5.0) * 0.045;
      posAttr.setX(i, vx * (1 + bump));
      posAttr.setZ(i, vz * (1 + bump));
    }
    posAttr.needsUpdate = true;
    coneGeo.computeVertexNormals();

    const cone = new THREE.Mesh(coneGeo, LEAF_MATERIAL);
    cone.position.y = y + height / 2;
    cone.rotation.y = seed + t; // 層ごとに少し回転させ、単調な積み重なりを避ける
    cone.castShadow = true;
    cone.receiveShadow = true;
    group.add(cone);
  }

  return group;
}

/**
 * 地形の上に正しく配置する(接地点の高さをサンプリングする)。
 * 2026-09: 以前は中心点(x,z)1点だけの高さを使っていたため、地形に
 * うねり(細かい起伏)がある場所では、木の根元の footprint(トランクの
 * 太さ分の範囲)の中で最も低い側が地面から浮いて見える不具合があった。
 * footprintRadius を指定すると、その半径上の数点もサンプリングし、
 * 一番低い高さに合わせて設置することで、footprint 内のどの方向でも
 * 地面に埋まる側にはなっても、浮くことは無いようにする
 * (見えない程度にわずかに埋まるのは問題にならないが、浮くと目立つため)。
 * @param {THREE.Object3D} obj
 * @param {number} x
 * @param {number} z
 * @param {(x:number,z:number)=>number} terrainHeightFn
 * @param {number} [footprintRadius] - 根元のおおよその半径(0なら中心点のみ)
 */
export function placeOnTerrain(obj, x, z, terrainHeightFn, footprintRadius = 0.3) {
  let y = terrainHeightFn(x, z);
  if (footprintRadius > 0) {
    const samples = 6;
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * Math.PI * 2;
      const sy = terrainHeightFn(x + Math.cos(a) * footprintRadius, z + Math.sin(a) * footprintRadius);
      if (sy < y) y = sy;
    }
  }
  obj.position.set(x, y, z);
}

/**
 * 倒木を作る(台風などで倒れた木)。通常の針葉樹を横に倒しただけの
 * 簡易版だが、根元を接地点として扱えるので配置は同じ関数で行える。
 * @param {number} scale
 * @param {number} seed
 */
export function createFallenTree(scale = 1, seed = 0) {
  const tree = createPineTree(scale, seed);
  const fallDir = seed % 2 === 0 ? 1 : -1;
  tree.rotation.z = (Math.PI / 2) * fallDir;
  tree.rotation.y = (seed * 0.9) % (Math.PI * 2);
  return tree;
}
