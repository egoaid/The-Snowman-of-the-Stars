// remnants-visual.js (v1.55 E5)
// 人の痕跡の見た目と、世界への置き方。新しく置いた物に見えないよう、色は褪せさせ、土や雪に半分埋め、傾けて置く。
// 種類ごとの見た目は BUILDERS に1つ足すだけ(REMNANT_DEFS と COLLECTIBLE_KINDS にも1件ずつ)。
import * as THREE from 'three';
import { getToonGradientMap } from './shading.js';
import { createJackOLanternMesh } from './lantern.js';

const toonCache = new Map();
function toon(color) {
  let m = toonCache.get(color);
  if (!m) { m = new THREE.MeshToonMaterial({ color, gradientMap: getToonGradientMap() }); toonCache.set(color, m); }
  return m;
}
const mesh = (geo, color, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, toon(color)); m.position.set(x, y, z); m.castShadow = true; return m; };

/** 各ビルダーは、底面の中央が原点・上が+yの group と、だいたいの高さ(m)を返す。 */
const BUILDERS = {
  cassette_tape() {
    const g = new THREE.Group(); const H = 0.016;
    g.add(mesh(new THREE.BoxGeometry(0.108, H, 0.068), 0x5f656b, 0, H / 2, 0));
    g.add(mesh(new THREE.BoxGeometry(0.07, H * 0.3, 0.03), 0xa88b60, 0, H + 0.001, 0.006)); // 色あせたラベル
    for (const x of [-0.026, 0.026]) g.add(mesh(new THREE.CylinderGeometry(0.011, 0.011, H * 0.4, 8), 0x2a2a2a, x, H + 0.002, -0.014));
    return { group: g, height: 0.05 };
  },
  empty_can() {
    const g = new THREE.Group(); const R = 0.033, H = 0.115;
    g.add(mesh(new THREE.CylinderGeometry(R, R, H, 10), 0x8a5f3f, 0, H / 2, 0));
    g.add(mesh(new THREE.CylinderGeometry(R * 1.03, R * 1.03, 0.008, 10), 0x9b9b94, 0, H, 0));
    g.add(mesh(new THREE.CylinderGeometry(R * 1.03, R * 1.03, 0.008, 10), 0x9b9b94, 0, 0.004, 0));
    return { group: g, height: H };
  },
  colored_pencils() {
    const g = new THREE.Group(); const L = 0.17;
    const cols = [0xa84c4c, 0x4c78a8, 0xbd9e45, 0x5b9a5e];
    cols.forEach((c, i) => {
      const a = (i / cols.length) * Math.PI * 2, x = Math.cos(a) * 0.009, z = Math.sin(a) * 0.009;
      const p = mesh(new THREE.CylinderGeometry(0.0055, 0.0055, L, 6), c, x, L / 2, z); p.rotation.z = (Math.random() - 0.5) * 0.12; g.add(p);
      g.add(mesh(new THREE.ConeGeometry(0.0055, 0.02, 6), 0xd8c8a0, x, L + 0.01, z));
    });
    return { group: g, height: L };
  },
  small_toy() { // 古びたぬいぐるみ(くま)
    const g = new THREE.Group(); const c = 0xb98a8f;
    g.add(mesh(new THREE.SphereGeometry(0.07, 9, 7), c, 0, 0.07, 0));
    g.add(mesh(new THREE.SphereGeometry(0.052, 9, 7), c, 0, 0.17, 0.01));
    for (const x of [-0.04, 0.04]) g.add(mesh(new THREE.SphereGeometry(0.02, 6, 5), c, x, 0.215, 0.0));
    for (const x of [-0.02, 0.02]) g.add(mesh(new THREE.SphereGeometry(0.006, 5, 4), 0x2a2420, x, 0.18, 0.055));
    return { group: g, height: 0.23 };
  },
  jack_o_lantern() { const g = new THREE.Group(); const j = createJackOLanternMesh(0.16); j.position.y = 0.15; g.add(j); return { group: g, height: 0.3 }; },
  record_player() { // 大きくて、運べない
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.62, 0.22, 0.46), 0x6c4b31, 0, 0.11, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.018, 14), 0x232323, -0.08, 0.229, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 6), 0x9b9b94, -0.08, 0.25, 0));
    const arm = mesh(new THREE.BoxGeometry(0.2, 0.012, 0.012), 0x9b9b94, 0.12, 0.245, -0.1); arm.rotation.y = 0.5; g.add(arm);
    return { group: g, height: 0.26 };
  },
};
export const REMNANT_BUILDERS = BUILDERS;

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {Array} o.plans planRemnants() の結果
 * @param {(x:number,z:number)=>number} o.terrainHeightAt
 * @param {object} [o.defs] REMNANT_DEFS
 */
export function createRemnantField({ scene, plans, terrainHeightAt, defs }) {
  const items = [];
  const mound = new THREE.CircleGeometry(1, 10);
  const moundMat = new THREE.MeshToonMaterial({ color: 0x3e382b, gradientMap: getToonGradientMap() });
  function addItem(p) {
    const build = BUILDERS[p.defId];
    if (!build) return null;
    const def = defs[p.defId];
    const { group, height } = build();
    const k = def.size / (p.defId === 'record_player' ? 0.62 : p.defId === 'colored_pencils' ? 0.17 : p.defId === 'small_toy' ? 0.2 : p.defId === 'empty_can' ? 0.115 : p.defId === 'jack_o_lantern' ? 0.3 : 0.108);
    group.scale.setScalar(k);
    const root = new THREE.Group();
    const gy = terrainHeightAt(p.x, p.z);
    // 半分埋まる: 高さの buried 割合だけ地面の下へ沈め、傾ける(長い年月のあいだに、土や雪に沈んだ)
    root.position.set(p.x, gy - p.buried * height * k, p.z);
    root.rotation.set(p.tilt * 0.8, p.yaw, p.tilt * 0.6, 'YXZ');
    root.add(group);
    scene.add(root);
    // 周りの土の盛り上がり(平たい円)。埋まっている感じを出す
    const m = new THREE.Mesh(mound, moundMat);
    m.rotation.x = -Math.PI / 2; m.position.set(p.x, gy + 0.004, p.z); m.scale.setScalar(Math.max(0.12, height * k * 0.9));
    scene.add(m);
    // v1.56-H4: ジャック・オー・ランタンだけは、雪が積もると雪面の上に乗る(少し埋まる)。他の痕跡は従来どおり雪に埋もれる。
    const item = { id: p.id, defId: p.defId, kind: p.kind, x: p.x, z: p.z, plan: p, root, mound: m, collected: false, height: height * k,
      groundY: gy, baseRootY: root.position.y, followSnow: p.kind === 'jack_o_lantern' };
    items.push(item); byId.set(item.id, item);
    return item;
  }
  const byId = new Map();
  for (const p of plans) addItem(p);
  return {
    items,
    /**
     * v1.56-H4: 雪の深さ(m、無ければ0)に合わせて、雪面に乗る物の高さを更新する。
     * 雪がある間: 雪面から、物の高さの約28%だけ埋まった位置(周りの土の盛り上がりの円は雪の下なので隠す)。
     * 雪が溶けたら、そのまま元の地面の位置(元の埋まり方)に戻る=地面に置かれている状態。
     */
    updateSnow(snowDepth) {
      for (const it of items) {
        if (!it.followSnow || it.collected) continue;
        const snowy = snowDepth > 0;
        it.root.position.y = snowy ? it.groundY + snowDepth - it.height * 0.28 : it.baseRootY;
        it.mound.visible = !snowy;
      }
    },
    /** 実行中に、痕跡を1つ足す(確認用のイベントなど)。足した item を返す。 */
    add: (plan) => addItem(plan),
    count: () => items.filter((i) => !i.collected).length,
    get: (id) => byId.get(id) || null,
    /** kind の物のうち、半径内にあるもの(登録簿の提供元用) */
    list(kind, x, z, r) {
      const out = [];
      for (const it of items) { if (it.collected || it.kind !== kind) continue; if (Math.hypot(it.x - x, it.z - z) <= r) out.push({ id: it.id, x: it.x, z: it.z, y: it.root.position.y, ref: it }); }
      return out;
    },
    take(id) {
      const it = byId.get(id);
      if (!it || it.collected) return false;
      it.collected = true; scene.remove(it.root); scene.remove(it.mound);
      return true;
    },
    /** 保存用: 拾われた物のid(同じ世界なら、置き場所はシードから決まるので、これだけ覚えればよい) */
    serialize: () => ({ collected: items.filter((i) => i.collected).map((i) => i.id) }),
    restore(s) { for (const id of (s && s.collected) || []) this.take(id); },
    dispose() { for (const it of items) { scene.remove(it.root); scene.remove(it.mound); } mound.dispose(); moundMat.dispose(); },
  };
}
