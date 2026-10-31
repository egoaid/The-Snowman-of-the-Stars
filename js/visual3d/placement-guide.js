// placement-guide.js (v1.90)
// 設置面の表示: 置ける物を持っている間、狙った地面(雪面)に「必要な範囲」の枠を出す。
//   ・置ける所は緑、置けない所は赤。枠は地形(雪面)の高さに沿って曲がる(斜面でも浮かない・埋まらない)。
//   ・円盤(うすい塗り)+ふち(細い帯)。3つの輪と外周を、毎フレーム地面の高さに合わせて動かす。
import * as THREE from 'three';

const SEG = 40, RINGS = 3, LIFT = 0.05;
const OK = new THREE.Color(0x6fe07f), NG = new THREE.Color(0xf0615a);

export function createPlacementGuide(scene) {
  // 塗り: 中心 + RINGS 個の輪
  const fillPos = new Float32Array((1 + RINGS * SEG) * 3);
  const fillIdx = [];
  const ringBase = (k) => 1 + k * SEG;
  for (let i = 0; i < SEG; i++) {
    const j = (i + 1) % SEG;
    fillIdx.push(0, ringBase(0) + i, ringBase(0) + j);
    for (let k = 0; k < RINGS - 1; k++) fillIdx.push(ringBase(k) + i, ringBase(k + 1) + i, ringBase(k + 1) + j, ringBase(k) + i, ringBase(k + 1) + j, ringBase(k) + j);
  }
  const fillGeo = new THREE.BufferGeometry();
  fillGeo.setAttribute('position', new THREE.BufferAttribute(fillPos, 3));
  fillGeo.setIndex(fillIdx);
  const fillMat = new THREE.MeshBasicMaterial({ color: OK, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false });
  const fill = new THREE.Mesh(fillGeo, fillMat);
  // ふち: 外周の細い帯(外側と内側の2つの輪)
  const edgePos = new Float32Array(2 * SEG * 3);
  const edgeIdx = [];
  for (let i = 0; i < SEG; i++) { const j = (i + 1) % SEG; edgeIdx.push(i * 2, i * 2 + 1, j * 2, i * 2 + 1, j * 2 + 1, j * 2); }
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePos, 3));
  edgeGeo.setIndex(edgeIdx);
  const edgeMat = new THREE.MeshBasicMaterial({ color: OK, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: false });
  const edge = new THREE.Mesh(edgeGeo, edgeMat);
  const group = new THREE.Group();
  group.add(fill, edge);
  for (const m of [fill, edge]) { m.frustumCulled = false; m.renderOrder = 6; }
  group.visible = false;
  scene.add(group);

  return {
    group,
    /** 枠を出す。surfaceY(x,z) は、その場所の地面(雪面)の高さ。 */
    show(x, z, radius, ok, surfaceY) {
      const p = fillPos;
      p[0] = x; p[1] = surfaceY(x, z) + LIFT; p[2] = z;
      for (let k = 0; k < RINGS; k++) {
        const r = radius * ((k + 1) / RINGS);
        for (let i = 0; i < SEG; i++) {
          const a = (i / SEG) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
          const o = (ringBase(k) + i) * 3;
          p[o] = px; p[o + 1] = surfaceY(px, pz) + LIFT; p[o + 2] = pz;
        }
      }
      const w = Math.max(0.05, radius * 0.07), q = edgePos;
      for (let i = 0; i < SEG; i++) {
        const a = (i / SEG) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        const ox = x + c * radius, oz = z + s * radius, ix = x + c * (radius - w), iz = z + s * (radius - w);
        q[i * 6] = ox; q[i * 6 + 1] = surfaceY(ox, oz) + LIFT + 0.01; q[i * 6 + 2] = oz;
        q[i * 6 + 3] = ix; q[i * 6 + 4] = surfaceY(ix, iz) + LIFT + 0.01; q[i * 6 + 5] = iz;
      }
      fillGeo.attributes.position.needsUpdate = true; edgeGeo.attributes.position.needsUpdate = true;
      const col = ok ? OK : NG;
      fillMat.color.copy(col); edgeMat.color.copy(col);
      group.visible = true;
    },
    hide() { group.visible = false; },
    isVisible: () => group.visible,
    dispose() { scene.remove(group); fillGeo.dispose(); edgeGeo.dispose(); fillMat.dispose(); edgeMat.dispose(); },
  };
}
