// campfire.js
// 焚き火を作る。組んだ薪(円柱)+炎(発光マテリアル)+暖色のPointLight+
// 上昇する燠のパーティクル。update(time)でゆらめきを更新する。
// 原点は焚き火の中心・接地面。

import * as THREE from 'three';
import { getToonGradientMap } from './shading.js';

const LOG_MATERIAL = new THREE.MeshToonMaterial({ color: 0x4a331f, gradientMap: getToonGradientMap() });
const STONE_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x7d7a74, roughness: 0.9 });
const FLAME_MATERIAL_OUTER = new THREE.MeshBasicMaterial({ color: 0xe0621e, transparent: true, opacity: 0.85 });
const FLAME_MATERIAL_INNER = new THREE.MeshBasicMaterial({ color: 0xf9c94a, transparent: true, opacity: 0.9 });

function addLog(group, angleDeg, length, radius) {
  const angle = (angleDeg * Math.PI) / 180;
  const geo = new THREE.CylinderGeometry(radius, radius * 1.2, length, 6);
  const log = new THREE.Mesh(geo, LOG_MATERIAL);
  log.position.set(Math.cos(angle) * length * 0.32, length * 0.28, Math.sin(angle) * length * 0.32);
  log.rotation.z = Math.PI / 2 - angle;
  log.rotation.x = 0.5;
  log.castShadow = true;
  log.receiveShadow = true;
  group.add(log);
}

/**
 * 焚き火のGroupと更新関数を作る。
 * @param {number} scale
 * @returns {{ group: THREE.Group, update: (t:number)=>void, light: THREE.PointLight }}
 */
export function createCampfire(scale = 1, { lit = true, withLight = true } = {}) { // v1.87: lit=火がついているか。withLight=false なら、光は作らない(置いた焚き火は、ランタンなどと光の枠を分け合う)
  const group = new THREE.Group();

  // 組んだ薪(4本、テント状に)
  addLog(group, 20, 1.1 * scale, 0.06 * scale);
  addLog(group, 110, 1.1 * scale, 0.06 * scale);
  addLog(group, 200, 1.1 * scale, 0.06 * scale);
  addLog(group, 290, 1.1 * scale, 0.06 * scale);

  // 石の輪
  const stoneCount = 12;
  for (let i = 0; i < stoneCount; i++) {
    const a = (i / stoneCount) * Math.PI * 2;
    const r = 0.55 * scale * (0.92 + 0.16 * Math.sin(i * 12.9));
    const stoneGeo = new THREE.IcosahedronGeometry(0.08 * scale, 0);
    const stone = new THREE.Mesh(stoneGeo, STONE_MATERIAL);
    stone.position.set(Math.cos(a) * r, 0.05 * scale, Math.sin(a) * r);
    stone.rotation.set(Math.random(), Math.random(), Math.random());
    stone.castShadow = true;
    stone.receiveShadow = true;
    group.add(stone);
  }

  // 炎(複数の縦長コーンを重ねる)
  const flameGroup = new THREE.Group();
  flameGroup.position.y = 0.05 * scale;
  const outerGeo = new THREE.ConeGeometry(0.22 * scale, 0.6 * scale, 8);
  const outerFlame = new THREE.Mesh(outerGeo, FLAME_MATERIAL_OUTER);
  outerFlame.position.y = 0.3 * scale;
  flameGroup.add(outerFlame);

  const innerGeo = new THREE.ConeGeometry(0.12 * scale, 0.4 * scale, 8);
  const innerFlame = new THREE.Mesh(innerGeo, FLAME_MATERIAL_INNER);
  innerFlame.position.y = 0.22 * scale;
  flameGroup.add(innerFlame);

  group.add(flameGroup);

  // 暖色の光(夜間にもっと周囲を照らせるよう、強さ・届く距離を拡大)
  const light = withLight ? new THREE.PointLight(0xff9a4a, 3.4, 10 * scale, 2) : null;
  if (light) { light.position.set(0, 0.6 * scale, 0); group.add(light); }

  // 燠(上昇するパーティクル)
  const emberCount = 20;
  const emberGeo = new THREE.BufferGeometry();
  const emberPositions = new Float32Array(emberCount * 3);
  const emberSpeeds = new Float32Array(emberCount);
  for (let i = 0; i < emberCount; i++) {
    emberPositions[i * 3] = (Math.random() - 0.5) * 0.3 * scale;
    emberPositions[i * 3 + 1] = Math.random() * 1.2 * scale;
    emberPositions[i * 3 + 2] = (Math.random() - 0.5) * 0.3 * scale;
    emberSpeeds[i] = 0.3 + Math.random() * 0.4;
  }
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3));
  const emberMaterial = new THREE.PointsMaterial({
    color: 0xf9c94a,
    size: 0.035 * scale,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const embers = new THREE.Points(emberGeo, emberMaterial);
  group.add(embers);

  // v1.87: 火の点け消し。消えている間は、炎・燠(と光)を隠して、動かさない。薪と石の輪だけが残る。
  let isLit = lit;
  function setLit(on) {
    isLit = !!on;
    flameGroup.visible = isLit; embers.visible = isLit;
    if (light) light.visible = isLit;
  }
  setLit(isLit);

  function update(time) {
    if (!isLit) return;
    const flicker = 0.85 + Math.sin(time * 11) * 0.08 + Math.sin(time * 23.1) * 0.05;
    if (light) light.intensity = 3.2 * flicker;
    flameGroup.scale.set(1, 0.9 + flicker * 0.25, 1);
    flameGroup.rotation.y = Math.sin(time * 3) * 0.3;

    const positions = emberGeo.attributes.position;
    for (let i = 0; i < emberCount; i++) {
      let y = positions.getY(i) + emberSpeeds[i] * 0.016;
      if (y > 1.4 * scale) y = 0;
      positions.setY(i, y);
    }
    positions.needsUpdate = true;
  }

  return { group, update, light, setLit, isLit: () => isLit };
}
