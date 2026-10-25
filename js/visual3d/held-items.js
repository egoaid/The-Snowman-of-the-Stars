// held-items.js
// 右手(itemSocket)に持たせる、ホットバーで選んだ物の見た目。v1.43で全アイテム分に拡張。
// 手の割り当ては視点によらず固定: 右手=選択中のホットバーの物、左手=松明(snowman.js側のtorchSocket)。
//
// 新しいアイテムを追加するときは、items.jsに定義を足し、ここにビルダーを1つ足すだけでよい
// (ビルダーが無いアイテムは、手には何も持たない)。軽量なプリミティブだけで作る。

import * as THREE from 'three';
import { createStarGeometry } from './snowman.js';
import { FALLING_STAR } from '../config.js';
import { getItemDef } from '../items.js';
import { REMNANT_BUILDERS } from './remnants-visual.js';
import { createJackOLanternMesh } from './lantern.js';
import { createHeldStarTorch } from './star-torch.js'; // v1.74

const toon = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });
const STAR_HOLD_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xffd700, fog: false });
const MATERIALS = {
  stone: toon(0x8b8d8f),
  coal: toon(0x26231f, { roughness: 0.6 }),
  iron: toon(0x9aa3ad, { roughness: 0.55, metalness: 0.35 }),
  diamond: toon(0xb8f0ff, { roughness: 0.15, metalness: 0.1, emissive: 0x2a6f80, emissiveIntensity: 0.35 }),
  log: toon(0x6b4a2b),
  logEnd: toon(0xc9a36b),
  wood: toon(0xb98a52),
  tableTop: toon(0x8a5a2b),
  chestBody: toon(0x8a5a2b),
  chestBand: toon(0x3d3d3d),
};

function lump(geo, mat, lift) { const m = new THREE.Mesh(geo, mat); m.position.y = lift; m.castShadow = true; return m; }

/** 人の痕跡の見た目を、手に持てる大きさへ拡大して使う(同じ作り方。手の中で見えるよう、実物より大きく)。 */
function heldFromRemnant(defId, scale, lift = 0.09, tilt = 0.3) {
  const { group } = REMNANT_BUILDERS[defId]();
  group.scale.setScalar(scale);
  group.position.y = lift; group.rotation.z = tilt;
  const holder = new THREE.Group(); holder.add(group);
  return holder;
}

const HELD_ITEM_BUILDERS = {
  // v1.56: 小枝・人の痕跡・ジャック・オー・ランタンも、右手に持った時に見える
  twig: () => {
    const holder = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.3, 6), MATERIALS.log);
    stick.position.y = 0.1; stick.rotation.z = 0.35; stick.castShadow = true; holder.add(stick);
    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.011, 0.12, 5), MATERIALS.log);
    fork.position.set(0.05, 0.18, 0); fork.rotation.z = -0.5; holder.add(fork);
    return holder;
  },
  cassette_tape: () => heldFromRemnant('cassette_tape', 2.0, 0.05, 0.5),
  empty_can: () => heldFromRemnant('empty_can', 1.5, 0.0, 0.2),
  colored_pencils: () => heldFromRemnant('colored_pencils', 1.3, 0.0, 0.3),
  small_toy: () => heldFromRemnant('small_toy', 1.1, 0.0, 0.15),
  jack_o_lantern: () => { const holder = new THREE.Group(); const j = createJackOLanternMesh(0.11); j.position.y = 0.11; holder.add(j); return holder; },
  star_torch: () => createHeldStarTorch(), // v1.74: 星の松明(手に持つと小さな松明が見える。周りは照らさない)
  star: () => new THREE.Mesh(createStarGeometry(FALLING_STAR.hatRadius * 1.3), STAR_HOLD_MATERIAL),
  // 星のかけら: 星より小さい(約55%)
  star_shard: () => new THREE.Mesh(createStarGeometry(FALLING_STAR.hatRadius * 0.7), STAR_HOLD_MATERIAL),
  crafting_table: () => {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.16), MATERIALS.wood);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 0.18), MATERIALS.tableTop);
    top.position.y = 0.065;
    g.add(base, top); g.position.y = 0.08;
    const holder = new THREE.Group(); holder.add(g); return holder;
  },
  chest: () => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.14), MATERIALS.chestBody);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.205, 0.025, 0.145), MATERIALS.chestBand);
    band.position.y = 0.02;
    g.add(body, band); g.position.y = 0.08;
    const holder = new THREE.Group(); holder.add(g); return holder;
  },
  stone: () => { const m = lump(new THREE.DodecahedronGeometry(0.085, 0), MATERIALS.stone, 0.06); m.scale.set(1, 0.85, 0.95); return m; },
  coal: () => { const m = lump(new THREE.DodecahedronGeometry(0.075, 0), MATERIALS.coal, 0.055); m.scale.set(1, 0.9, 1.05); return m; },
  iron: () => { const m = lump(new THREE.DodecahedronGeometry(0.078, 0), MATERIALS.iron, 0.055); m.scale.set(1.05, 0.85, 0.95); return m; },
  diamond: () => lump(new THREE.OctahedronGeometry(0.085, 0), MATERIALS.diamond, 0.07),
  log: () => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.24, 8), MATERIALS.log);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 8), MATERIALS.logEnd);
    cap.position.y = 0.122;
    g.add(body, cap);
    g.position.y = 0.09; g.rotation.z = 0.5;
    const holder = new THREE.Group(); holder.add(g);
    return holder;
  },
  wood: () => {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.24, 0.035), MATERIALS.wood);
    plank.position.y = 0.09; plank.rotation.z = 0.4; plank.castShadow = true;
    const holder = new THREE.Group(); holder.add(plank);
    return holder;
  },
};

/** 指定の種類を右手に持たせるObject3Dを新しく作る。左手用(松明)・未知の種類・ビルダー無しはnull。 */
export function buildHeldItem(type) {
  const def = getItemDef(type);
  if (!def || def.hand !== 'right') return null;
  const build = HELD_ITEM_BUILDERS[type];
  return build ? build() : null;
}
