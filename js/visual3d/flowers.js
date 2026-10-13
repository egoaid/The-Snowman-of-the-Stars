// flowers.js
// Coquelicot(ヒナゲシ/フランス虞美人草)の花畑。
// マルセイユなど南フランスの野原でよく見られる、鮮やかな赤い一重咲きの
// 野生のポピーをイメージした、低ポリ・軽量な群生表現。
// 地形全体にばら撒くのではなく、数か所の「花畑パッチ」として
// 部分的に(=地形の一部に)咲かせる。
//
// 草(ground-detail.js)と同じ考え方で、InstancedMesh + 頂点シェーダーの
// 風揺れを使う。茎・花(2枚を十字に交差させた板)を別々のInstancedMeshに
// 分けている。

import * as THREE from 'three';
import { makeRng } from './rng.js';
import { getRiver, distanceToRiver } from './river.js';

// 2026-09: 以前は bend = pos.y*pos.y (茎の高さ0.3に対して最大でも0.09) だったため、
// 実際の揺れ幅が花の頭側(常にフル振幅0.06)よりずっと小さく、風が吹くと
// 花だけが茎の先端から浮いて離れて見える不具合があった。
// 先端(pos.y=0.3)でちょうどbend=1になるよう正規化し、花側と揺れ幅を一致させる。
const stemVertexShader = `
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 pos = position;
    float bend = pow(clamp(pos.y / 0.3, 0.0, 1.0), 1.5); // 根元は固定、先端でbend=1(花側と揃える)
    float phase = instanceMatrix[3].x * 1.1 + instanceMatrix[3].z * 0.9;
    float sway = sin(uTime * 1.3 + phase) * 0.06 * bend;
    pos.x += sway;
    pos.z += sway * 0.5;
    vec4 worldPosition = instanceMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * worldPosition;
  }
`;

const stemFragmentShader = `
  uniform float uLightMul;
  varying vec2 vUv;
  void main() {
    vec3 base = mix(vec3(0.13, 0.27, 0.10), vec3(0.28, 0.44, 0.17), vUv.y);
    gl_FragColor = vec4(base * uLightMul, 1.0);
  }
`;

// 花は茎の先端に付いているので、茎の先端(bend=1)と同じ揺れ幅で
// 一緒に揺らす(stemVertexShaderのbendが先端でちょうど1になるよう
// 正規化してあるので、ここは常にフル振幅でよい)。
const headVertexShader = `
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 pos = position;
    float phase = instanceMatrix[3].x * 1.1 + instanceMatrix[3].z * 0.9;
    float sway = sin(uTime * 1.3 + phase) * 0.06;
    pos.x += sway;
    pos.z += sway * 0.5;
    vec4 worldPosition = instanceMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * worldPosition;
  }
`;

// 2026-09: 「花の中心を単純に黒くしただけ」という指摘を受けて描き直し。
// 実際のヒナゲシ(コクリコ)らしく、中心から外側に向かって
// 黄色い柱頭 → 黒いオシベの輪 → 中心に向かって少し暗い赤の花弁 → 外側は
// 明るい赤の花弁、という同心円状の配色にする。
const headFragmentShader = `
  uniform float uLightMul;
  varying vec2 vUv;
  void main() {
    // ジオメトリ自体が円形の扇(fan)なので、UV上の半径(0=中心, 1=花弁の外周)を
    // そのまま使える(アルファで円を切り抜く必要がない)。
    float d = distance(vUv, vec2(0.5)) * 2.0;
    vec3 stigma = vec3(0.90, 0.76, 0.14);   // 黄色い柱頭(中心)
    vec3 stamen = vec3(0.07, 0.06, 0.05);   // 黒いオシベの輪
    vec3 petalInner = vec3(0.50, 0.04, 0.03); // 花弁の中心寄り(オシベに近く、少し暗い赤)
    vec3 petalOuter = vec3(0.93, 0.16, 0.07); // 花弁の外側(明るい赤)

    vec3 color = stigma;
    color = mix(color, stamen, smoothstep(0.16, 0.24, d));
    color = mix(color, petalInner, smoothstep(0.24, 0.34, d));
    color = mix(color, petalOuter, smoothstep(0.34, 0.98, d));
    gl_FragColor = vec4(color * uLightMul, 1.0);
  }
`;

/**
 * 花の頭を「上向きに傾けた円形の板」1枚で表現する。
 * 2026-09: 実物のヒナゲシは花弁が4枚重なった一つの椀型の顔として見えるため、
 * 十字に2枚重ねるより円盤1枚の方が実物に近く、負荷も半分で済む。
 * 平らな円盤を基準に、X軸まわりに傾け(お辞儀するポピーのように上や
 * 斜め上を向かせる)ことで、真横からでも厚みのある花に見えるようにする。
 * @param {number} radius
 * @param {number} heightOffset - 茎の先端の高さ(この高さを中心に花を置く)
 */
function buildFlowerHeadGeometry(radius, heightOffset) {
  const segments = 12;
  const tilt = THREE.MathUtils.degToRad(58); // 0°=真上向きの水平円盤, 90°=真横向きの垂直円盤
  const cosT = Math.cos(tilt), sinT = Math.sin(tilt);

  const positions = [0, heightOffset, 0];
  const uvs = [0.5, 0.5];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    // まず水平な円盤(真上向き)として座標を作り、X軸まわりに傾ける
    const lx = Math.cos(a) * radius;
    const lz = Math.sin(a) * radius;
    const ty = -lz * sinT;
    const tz = lz * cosT;
    positions.push(lx, heightOffset + ty, tz);
    uvs.push(0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5);
  }
  for (let i = 1; i <= segments; i++) indices.push(0, i, i + 1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * Coquelicot(ヒナゲシ)の花畑パッチをいくつか作る。
 * @param {(x:number,z:number)=>number} terrainHeightFn
 * @param {object} [options]
 * @param {number} [options.patchCount] - パッチ(群生地)の数
 * @param {number} [options.perPatch] - 1パッチあたりの本数(候補数。実際は間引かれる)
 * @param {number} [options.patchRadius] - 1パッチのおおよその半径
 * @param {number} [options.halfSize] - Playable Areaの半径
 * @param {{x:number,z:number,radius:number}[]} [options.avoid] - 避ける円形エリア
 * @param {number} [options.seed]
 * @returns {{ group: THREE.Group, update: (t:number)=>void, setLightMul: (v:number)=>void, patchCenters: {x:number,z:number}[] } | null}
 */
export function createPoppyField(terrainHeightFn, options = {}) {
  const patchCount = options.patchCount ?? 3;
  const perPatch = options.perPatch ?? 220;
  const patchRadius = options.patchRadius ?? 9;
  const halfSize = options.halfSize ?? 32;
  const avoid = options.avoid ?? [];
  const rng = makeRng(options.seed ?? 4242);
  const riverSamples = getRiver().centerline;

  // --- パッチの中心をいくつか選ぶ ---
  const patchCenters = [];
  let centerAttempts = 0;
  while (patchCenters.length < patchCount && centerAttempts < patchCount * 80) {
    centerAttempts++;
    const angle = rng() * Math.PI * 2;
    const dist = Math.sqrt(rng()) * halfSize * 0.82;
    const cx = Math.cos(angle) * dist;
    const cz = Math.sin(angle) * dist;

    const { distance, width } = distanceToRiver(cx, cz, riverSamples);
    if (distance < width / 2 + patchRadius * 0.6) continue;

    let blocked = false;
    for (const a of avoid) {
      if (Math.hypot(cx - a.x, cz - a.z) < a.radius + patchRadius * 0.5) { blocked = true; break; }
    }
    if (blocked) continue;

    let tooClose = false;
    for (const p of patchCenters) {
      if (Math.hypot(cx - p.x, cz - p.z) < patchRadius * 2.2) { tooClose = true; break; }
    }
    if (tooClose) continue;

    patchCenters.push({ x: cx, z: cz });
  }
  if (patchCenters.length === 0) return null;

  const totalCandidates = patchCenters.length * perPatch;

  const stemGeo = new THREE.CylinderGeometry(0.008, 0.014, 0.3, 5);
  stemGeo.translate(0, 0.15, 0); // 底面がy=0に来るようにする(接地させやすくする)
  const headGeo = buildFlowerHeadGeometry(0.08, 0.3);

  const stemMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLightMul: { value: 1 } },
    vertexShader: stemVertexShader,
    fragmentShader: stemFragmentShader,
    side: THREE.DoubleSide,
  });
  const headMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLightMul: { value: 1 } },
    vertexShader: headVertexShader,
    fragmentShader: headFragmentShader,
    side: THREE.DoubleSide,
  });

  const stemMesh = new THREE.InstancedMesh(stemGeo, stemMaterial, totalCandidates);
  const headMesh = new THREE.InstancedMesh(headGeo, headMaterial, totalCandidates);
  const dummy = new THREE.Object3D();

  let placed = 0;
  for (const center of patchCenters) {
    for (let i = 0; i < perPatch; i++) {
      const a = rng() * Math.PI * 2;
      // 中心寄りに密度が高くなるよう、べき乗分布で半径を選ぶ
      const r = Math.pow(rng(), 1.6) * patchRadius;
      const x = center.x + Math.cos(a) * r;
      const z = center.z + Math.sin(a) * r;
      if (Math.hypot(x, z) > halfSize) continue;

      const { distance, width } = distanceToRiver(x, z, riverSamples);
      if (distance < width / 2 + 1.0) continue;

      let blocked = false;
      for (const av of avoid) {
        if (Math.hypot(x - av.x, z - av.z) < av.radius) { blocked = true; break; }
      }
      if (blocked) continue;

      const y = terrainHeightFn(x, z);
      const scale = 0.75 + rng() * 0.6;
      const rotY = rng() * Math.PI * 2;
      const tilt = (rng() - 0.5) * 0.22; // まっすぐ生えすぎないよう、少しだけ傾ける

      dummy.position.set(x, y, z);
      dummy.rotation.set(tilt, rotY, tilt * 0.6);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      stemMesh.setMatrixAt(placed, dummy.matrix);
      headMesh.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
  }
  stemMesh.count = placed;
  headMesh.count = placed;
  stemMesh.instanceMatrix.needsUpdate = true;
  headMesh.instanceMatrix.needsUpdate = true;
  stemMesh.castShadow = false;
  stemMesh.receiveShadow = false;
  headMesh.castShadow = false;
  headMesh.receiveShadow = false;

  const group = new THREE.Group();
  group.add(stemMesh, headMesh);

  function update(time) {
    stemMaterial.uniforms.uTime.value = time;
    headMaterial.uniforms.uTime.value = time;
  }
  function setLightMul(v) {
    stemMaterial.uniforms.uLightMul.value = v;
    headMaterial.uniforms.uLightMul.value = v;
  }

  return { group, update, setLightMul, patchCenters };
}
