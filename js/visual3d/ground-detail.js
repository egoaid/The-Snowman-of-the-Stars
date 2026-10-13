// ground-detail.js
// 草(風で揺れる)と落ち葉を作る。どちらも大量の同じ形状を効率よく
// 描画するためInstancedMeshを使う。

import * as THREE from 'three';
import { makeRng, randRange } from './rng.js';
import { getRiver, distanceToRiver } from './river.js';
import { getToonGradientMap } from './shading.js';
import { fbm2D } from './noise.js';

const grassVertexShader = `
  uniform float uTime;
  uniform vec2 uPlayerPos;
  uniform float uPlayerRadius;
  uniform float uPlayerPush;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 pos = position;
    float bend = pos.y * pos.y; // 根元(y=0)は固定、先端ほど大きく揺れる(そよ風用)
    float phase = instanceMatrix[3].x * 1.3 + instanceMatrix[3].z * 0.7;
    float sway = sin(uTime * 1.6 + phase) * 0.14 * bend;
    pos.x += sway;
    vec4 worldPosition = instanceMatrix * vec4(pos, 1.0);
    // 2026-09(v1.34〜v1.36): 雪だるまが近づくと草が外側へ押しのけられるように
    // 傾く(踏んで揺れる表現)。根元(y=0)は動かさず、先端ほど大きく押される。
    // 離れれば(uPlayerRadiusの外側へ出れば)自然に元の直立姿勢へ戻る。
    // v1.36: 「動きが分かりにくい」という指摘が続いたため、そよ風用の
    // 二乗の減衰(bend、先端付近でしか効かない)ではなく、根元からほぼ
    // 直線的に効く減衰(bendLinear)を踏み付け専用に使うことで、雪だるまの
    // 真下では草がほぼ真横に倒れるくらい、はっきり動くようにした。
    float bendLinear = clamp(pos.y / 0.34, 0.0, 1.0); // 0.34 = 草の高さ(buildCrossBladeGeometryの引数と合わせる)
    vec2 toBlade = worldPosition.xz - uPlayerPos;
    float distToPlayer = length(toBlade);
    float proximity = smoothstep(uPlayerRadius, 0.0, distToPlayer);
    float pushAmt = proximity * bendLinear * uPlayerPush;
    vec2 pushDir = toBlade / max(distToPlayer, 0.0001);
    float wobble = sin(uTime * 9.0 + phase * 2.0) * proximity * bendLinear * uPlayerPush * 0.35;
    worldPosition.xz += pushDir * (pushAmt + wobble);
    vec4 mvPosition = modelViewMatrix * worldPosition;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const grassFragmentShader = `
  uniform float uLightMul;
  uniform vec3 uColorLow;
  uniform vec3 uColorHigh;
  uniform float uSnowMix;
  varying vec2 vUv;
  void main() {
    vec3 base = mix(uColorLow, uColorHigh, vUv.y);
    // 2026-09(季節システム): 積雪量(uSnowMix)が上がるほど、草の色を
    // 白へ寄せる(雪をかぶった草地の簡易表現)。
    base = mix(base, vec3(0.92, 0.94, 0.97), uSnowMix);
    // このシェーダーは元々シーンのライトを一切参照しない「常時全開」の
    // 明るさだったため、夜になっても他の物体のように暗くならず、
    // 「草が光っている」ように見えるバグの原因になっていた。
    // 時刻・天候から計算した明るさ係数(uLightMul)を掛けることで、
    // 他のオブジェクトと同じように夜は暗く見えるようにする。
    gl_FragColor = vec4(base * uLightMul, 1.0);
  }
`;

/**
 * 「十字に交差した2枚の板」で1本の草を表現する形状を作る。
 * 板1枚だと真横から見たときに消えてしまう(面が薄すぎて見えない)問題があるため、
 * 90度で交差させることで、どの角度から見ても草として見えるようにする
 * (この十字ビルボード自体は、リアルタイム草表現の定番手法の一つ)。
 *
 * 実際の草の葉は根元から先端に向かって細くなり、かつ根元から緩く弧を描いて
 * 傾く。この2点(先端に向けたテーパー、根元からの弧)が、平らな「板」ではなく
 * 「草の葉」に見えさせるための一般的なポイント(Roystanの草シェーダー解説や
 * SimonDevのThree.js草チュートリアルなど、多くの実装解説で共通して使われている
 * 手法)。以前の実装はこの2点がなく、単純な同じ幅の長方形だったため、
 * どれだけ細くしても「薄い板」にしか見えなかった。
 */
function buildCrossBladeGeometry(width, height, segments = 4, curve = 0.09) {
  function buildStrip(dirX, dirZ) {
    const positions = [];
    const uvs = [];
    const indices = [];
    const halfW = width / 2;
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const y = t * height;
      // 先端に向けて幅を絞る(根元=1倍 → 先端はほぼ0)。指数を掛けて、
      // 根元側はあまり細くならず、先端付近で一気に尖るようにしている
      // (実際の葉に近いテーパーカーブ)。
      const taper = Math.pow(1 - t, 0.65);
      const w = halfW * taper;
      // 根元から先端に向けて緩く弧を描くように、進行方向(dirX,dirZ)へ
      // 少しずつオフセットする(静的な「葉の反り」。風による揺れとは別物で、
      // 常に一定方向へ傾いた自然なカーブを作る)。
      const lean = curve * height * t * t;
      const cx = dirX * lean;
      const cz = dirZ * lean;
      positions.push(cx - dirX * w, y, cz - dirZ * w);
      uvs.push(0, t);
      positions.push(cx + dirX * w, y, cz + dirZ * w);
      uvs.push(1, t);
    }
    for (let s = 0; s < segments; s++) {
      const i0 = s * 2, i1 = s * 2 + 1, i2 = (s + 1) * 2, i3 = (s + 1) * 2 + 1;
      indices.push(i0, i1, i2, i1, i3, i2);
    }
    return { positions, uvs, indices };
  }

  const stripA = buildStrip(1, 0);
  const stripB = buildStrip(0, 1);
  const vertsPerStrip = (segments + 1) * 2;

  const positions = stripA.positions.concat(stripB.positions);
  const uvs = stripA.uvs.concat(stripB.uvs);
  const indices = stripA.indices.concat(stripB.indices.map((i) => i + vertsPerStrip));

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * 風で揺れる草地を作る。
 * @param {(x:number,z:number)=>number} terrainHeightFn
 * @param {object} options
 * @param {number} [options.count]
 * @param {number} [options.halfSize]
 * @param {{x:number,z:number,radius:number}[]} [options.avoid] - 避ける円形エリア(キャンプ地・木の幹など)
 * @returns {{ mesh: THREE.InstancedMesh, update: (time:number)=>void }}
 */
// 2026-09(v1.34): 草の密度ムラ(生えない/まばら/密集)を作るための、地形・
// 木の配置ノイズとは独立した専用のノイズ場。オフセットを大きくずらすことで
// 相関を避けている。低い周波数(0.055)にして、パッチが10〜20m程度の
// まとまりになるようにしてある(60〜116m程度のプレイエリアに対して自然な大きさ)。
export const GRASS_ZONE_OFFSET = 4231.7;
export const GRASS_ZONE_FREQ = 0.055;
export const GRASS_ZONE_NONE_THRESHOLD = -0.2; // これ未満: 生えない(裸地)。ノイズ値のおおよそ下位1/3
export const GRASS_ZONE_SPARSE_THRESHOLD = 0.0; // これ未満: まばら(間引く)、以上: 密集(そのまま)。中央1/3・上位1/3
const GRASS_ZONE_SPARSE_KEEP_PROB = 0.35;
// 2026-09(v1.35〜v1.36): 「地面が見えないぐらい密集しているエリア」の
// 追加要望に対応する第4のゾーン。密集ゾーン(0.0以上)のうち、さらに上位の
// 一部(ノイズ値のおおよそ上位1割)を「超密集」とし、通常の密度に加えて
// 専用の追加パスで大幅に上乗せする(下のextraCount)。このゾーンでは
// 草丈も2倍にする。v1.36では、草のインスタンス数だけで完全に地面を隠す
// のは負荷が高いため、terrain.js側でこのゾーンの地面の色そのものを
// 濃い草地色に寄せる「錯覚」も併用している(export しているのはそのため)。
export const GRASS_ZONE_ULTRA_THRESHOLD = 0.2;
const GRASS_ULTRA_HEIGHT_MUL = 2;
export function grassZoneValue(x, z) {
  return fbm2D((x + GRASS_ZONE_OFFSET) * GRASS_ZONE_FREQ, (z - GRASS_ZONE_OFFSET) * GRASS_ZONE_FREQ, 3);
}

export function createGrassField(terrainHeightFn, options = {}) {
  const count = options.count ?? 3000;
  // 超密集ゾーン専用の追加分。v1.36で「まだ密集度が足りない」という指摘を
  // 受け、比率を0.35→0.9へ大幅に引き上げた(超密集ゾーンは全体面積の
  // 1割程度なので、そこに集中投下しても全体の負荷への影響は限定的)。
  const extraCount = Math.round(count * 0.9);
  const halfSize = options.halfSize ?? 32;
  const avoid = options.avoid ?? [];
  const rng = makeRng(options.seed ?? 999);
  const riverSamples = getRiver().centerline;

  const bladeGeo = buildCrossBladeGeometry(0.05, 0.34);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLightMul: { value: 1 },
      uColorLow: { value: new THREE.Vector3(0.20, 0.33, 0.15) },
      uColorHigh: { value: new THREE.Vector3(0.42, 0.58, 0.28) },
      uSnowMix: { value: 0 },
      // プレイヤー(雪だるま)から遠く離れた初期値にしておき、起動直後に
      // 草全体が押しのけられて見えることを防ぐ。
      uPlayerPos: { value: new THREE.Vector2(9999, 9999) },
      // 2026-09(v1.36): bendLinearへの変更で同じuPlayerPush値でも実際の
      // 押し出し量が大きく増えたため、値そのものは抑えつつ(でないと
      // 草丈を超えて不自然に長く伸びて見える)、雪だるまの真下では
      // ほぼ真横に倒れるくらいはっきり動く強さに調整した。
      uPlayerRadius: { value: 1.8 },
      uPlayerPush: { value: 0.42 },
    },
    vertexShader: grassVertexShader,
    fragmentShader: grassFragmentShader,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.InstancedMesh(bladeGeo, material, count + extraCount);
  const dummy = new THREE.Object3D();

  /** 1本配置する。heightMulを渡すと丈だけを伸ばす(横幅は変えない)。 */
  function placeBlade(index, x, z, heightMul) {
    const y = terrainHeightFn(x, z);
    dummy.position.set(x, y, z);
    dummy.rotation.y = rng() * Math.PI * 2;
    const s = 0.7 + rng() * 0.9;
    dummy.scale.set(s, s * heightMul, s);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  }

  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 5) {
    attempts++;
    const x = randRange(rng, -halfSize, halfSize);
    const z = randRange(rng, -halfSize, halfSize);
    // Phase 2: halfSizeは「Playable Areaの半径」として扱う(正方形の
    // コーナー部分は除外する)。これにより地形の実際の端をはみ出した
    // 位置に草が生えることも防げる。
    if (Math.hypot(x, z) > halfSize) continue;

    // 密度ムラ: ノイズ値が低い場所は裸地(生えない)、中間はまばら(間引く)、
    // 高い場所は密集(間引かない)にする。超密集ゾーンは草丈を2倍にする
    // (本数の上乗せは下の専用パスで行う)。
    const zoneValue = grassZoneValue(x, z);
    if (zoneValue < GRASS_ZONE_NONE_THRESHOLD) continue;
    if (zoneValue < GRASS_ZONE_SPARSE_THRESHOLD && rng() > GRASS_ZONE_SPARSE_KEEP_PROB) continue;
    const heightMul = zoneValue >= GRASS_ZONE_ULTRA_THRESHOLD ? GRASS_ULTRA_HEIGHT_MUL : 1;

    const { distance, width } = distanceToRiver(x, z, riverSamples);
    if (distance < width / 2 + 1.2) continue;

    let blocked = false;
    for (const a of avoid) {
      if (Math.hypot(x - a.x, z - a.z) < a.radius) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    placeBlade(placed, x, z, heightMul);
    placed++;
  }

  // 超密集ゾーン専用の追加パス: 通常配置に「地面が見えないほど濃い」上乗せを
  // する。超密集ゾーンは全体の面積のごく一部なので、その範囲だけを狙って
  // 追加の候補を試す(範囲外に落ちた候補はそのまま捨てる、軽量な処理)。
  let extraPlaced = 0;
  let extraAttempts = 0;
  while (extraPlaced < extraCount && extraAttempts < extraCount * 25) {
    extraAttempts++;
    const x = randRange(rng, -halfSize, halfSize);
    const z = randRange(rng, -halfSize, halfSize);
    if (Math.hypot(x, z) > halfSize) continue;
    if (grassZoneValue(x, z) < GRASS_ZONE_ULTRA_THRESHOLD) continue; // 超密集ゾーン以外は対象外

    const { distance, width } = distanceToRiver(x, z, riverSamples);
    if (distance < width / 2 + 1.2) continue;
    let blocked = false;
    for (const a of avoid) {
      if (Math.hypot(x - a.x, z - a.z) < a.radius) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    placeBlade(count + extraPlaced, x, z, GRASS_ULTRA_HEIGHT_MUL);
    extraPlaced++;
  }

  mesh.count = placed + extraPlaced;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  /**
   * @param {number} time
   * @param {number} [playerX] - 雪だるまの現在位置(渡すと近くの草が押しのけられる)
   * @param {number} [playerZ]
   */
  function update(time, playerX, playerZ) {
    material.uniforms.uTime.value = time;
    if (Number.isFinite(playerX) && Number.isFinite(playerZ)) {
      material.uniforms.uPlayerPos.value.set(playerX, playerZ);
    }
  }

  function setLightMul(v) {
    material.uniforms.uLightMul.value = v;
  }

  /**
   * 季節ごとの草の色を設定する(0〜1のRGB配列、または{x,y,z}相当)。
   * @param {[number,number,number]} low - 根元側の色
   * @param {[number,number,number]} high - 先端側の色
   */
  function setSeasonColors(low, high) {
    material.uniforms.uColorLow.value.set(low[0], low[1], low[2]);
    material.uniforms.uColorHigh.value.set(high[0], high[1], high[2]);
  }

  function setSnowMix(v) {
    material.uniforms.uSnowMix.value = Math.max(0, Math.min(1, v));
  }

  return { mesh, update, setLightMul, setSeasonColors, setSnowMix };
}

/**
 * 木の根元に散らばる落ち葉を作る。
 * (InstancedMeshの頂点カラーが環境によって正しく反映されないことがあるため、
 * 色ごとに別のInstancedMeshに分けて、確実に色が出るようにしている)
 * @param {{x:number, z:number, scale:number}[]} treePositions
 * @param {(x:number,z:number)=>number} terrainHeightFn
 */
export function createFallenLeaves(treePositions, terrainHeightFn, seed = 42) {
  const leavesPerTree = 22;
  const totalCount = treePositions.length * leavesPerTree;
  if (totalCount === 0) return null;

  const rng = makeRng(seed);
  const geo = new THREE.CircleGeometry(0.1, 5);
  geo.rotateX(-Math.PI / 2);

  const paletteColors = [0xb5651d, 0xd68c3a, 0x8a5a2a, 0xc9a227];
  const buckets = paletteColors.map(() => []); // 色ごとの配置情報を貯めるバケツ

  for (const tp of treePositions) {
    const spreadR = 1.2 * (tp.scale || 1) + 1.4;
    for (let i = 0; i < leavesPerTree; i++) {
      const a = rng() * Math.PI * 2;
      const r = rng() * spreadR;
      const x = tp.x + Math.cos(a) * r;
      const z = tp.z + Math.sin(a) * r;
      const y = terrainHeightFn(x, z) + 0.015;
      const s = 0.55 + rng() * 0.6;
      const rotY = rng() * Math.PI * 2;
      const colorIdx = Math.floor(rng() * paletteColors.length);
      buckets[colorIdx].push({ x, y, z, s, rotY });
    }
  }

  const group = new THREE.Group();
  const dummy = new THREE.Object3D();

  paletteColors.forEach((color, i) => {
    const items = buckets[i];
    if (items.length === 0) return;
    const material = new THREE.MeshToonMaterial({ color, gradientMap: getToonGradientMap() });
    const mesh = new THREE.InstancedMesh(geo, material, items.length);
    items.forEach((it, idx) => {
      dummy.position.set(it.x, it.y, it.z);
      dummy.rotation.set(0, it.rotY, 0);
      dummy.scale.set(it.s, it.s, it.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
  });

  // 2026-09(季節システム): 「秋には紅葉(の落ち葉)が見れる」という要望に
  // 対応するため、季節に応じて表示/非表示を切り替えられるようにする
  // (以前は常時表示だったが、それだと季節による違いが感じられないため)。
  group.setVisible = (v) => { group.visible = !!v; };
  return group;
}
