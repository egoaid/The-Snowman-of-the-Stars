// drop-field.js (v1.79)
// 落とし物の見た目と流れ。小枝・おもちゃ・拾えるサイズの丸太が、地形のあちこちに、空から短くころがるように落ちてきて、
// 地面でぽんと弾み、しばらく残って、小さくなって消える。
//   ・いつ・どれを落とすか: ../drops.js の createDropScheduler(Nodeで試験できる)
//   ・どこへ落とすか: 呼び出し側の pickSpot(種類, 他の落とし物の位置) → {x,z}|null(drops.js の pickDropSpot に、世界の条件を渡したもの)
//   ・おもちゃの見た目は、世界の痕跡のおもちゃ(remnants-visual.js)と同じ(約2.25倍の大きさ)
//   ・拾う処理(雪だるま・歩行中の自分)は呼び出し側。ここは list() / take() を出す。
import * as THREE from 'three';
import { DROPS } from '../config.js';
import { createDropScheduler } from '../drops.js';
import { REMNANT_BUILDERS } from './remnants-visual.js';

const BARK = new THREE.MeshStandardMaterial({ color: 0x6e4c2e, roughness: 0.92, metalness: 0 });
const BARK_DARK = new THREE.MeshStandardMaterial({ color: 0x57391f, roughness: 0.95, metalness: 0 });
const CUT_END = new THREE.MeshStandardMaterial({ color: 0xc9a56a, roughness: 0.85, metalness: 0 });

function cyl(r0, r1, len, mat, y = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, len, 7), mat);
  m.rotation.z = Math.PI / 2; m.position.y = y; m.castShadow = true;
  return m;
}
const BUILDERS = {
  twig() { // 小枝: 細い枝が数本、重なって、先に小さな枝分かれ
    const g = new THREE.Group();
    const a = cyl(0.014, 0.01, 0.8, BARK, 0.02); a.rotation.y = 0.0; g.add(a);
    const b = cyl(0.012, 0.008, 0.6, BARK_DARK, 0.035); b.rotation.y = 0.55; b.position.x = 0.04; g.add(b);
    const c = cyl(0.009, 0.006, 0.34, BARK, 0.05); c.rotation.y = -0.7; c.position.set(0.28, 0.05, 0.1); g.add(c);
    return { group: g, height: 0.08, lift: 0.0 };
  },
  log() { // 拾えるサイズの丸太(短い丸太)。横たわって、両端は切り口
    const g = new THREE.Group();
    const L = 0.75, R = 0.1;
    g.add(cyl(R, R * 1.04, L, BARK, R));
    for (const s of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.CircleGeometry(R * 0.98, 10), CUT_END);
      cap.rotation.y = s * Math.PI / 2; cap.position.set(s * (L / 2 + 0.002), R, 0); g.add(cap);
    }
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), BARK_DARK); knot.position.set(0.1, R * 1.85, 0.02); g.add(knot);
    return { group: g, height: R * 2, lift: 0.0 };
  },
  toy() { // おもちゃ(古びたくまのぬいぐるみ。痕跡のおもちゃと同じ見た目)
    const b = REMNANT_BUILDERS.small_toy();
    b.group.scale.setScalar(2.25);
    return { group: b.group, height: b.height * 2.25, lift: 0.0, tilt: 0.3 };
  },
};

export function createDropField({ scene, terrainHeightAt, snowDepth = () => 0, rng = Math.random, pickSpot, hooks = {}, cfg = DROPS }) {
  const scheduler = createDropScheduler({ rng, cfg });
  const items = [];
  let seq = 0, clock = 0;
  const rand = (a, b) => a + rng() * (b - a);

  function settleY(x, z) { return terrainHeightAt(x, z) + Math.min(0.25, snowDepth()) * 0.6; }

  function spawn(key) {
    const kc = cfg.kinds[key]; if (!kc) return null;
    const spot = pickSpot(key, items.filter((i) => i.state !== 'gone').map((i) => ({ x: i.x, z: i.z })));
    if (!spot) return null;
    const built = BUILDERS[key]();
    const mesh = built.group;
    const it = {
      id: `drop-${key}-${++seq}`, key, collectKind: kc.collectKind, itemId: kc.itemId, x: spot.x, z: spot.z,
      yaw: rng() * Math.PI * 2, height: built.height, tilt: built.tilt || 0, mesh,
      state: 'falling', t: 0, life: rand(kc.lifetimeSec[0], kc.lifetimeSec[1]), age: 0, fade: 0,
      spinX: rand(-5, 5), spinZ: rand(-5, 5), baseY: settleY(spot.x, spot.z),
    };
    mesh.position.set(it.x, it.baseY + cfg.fall.height, it.z);
    mesh.rotation.y = it.yaw;
    scene.add(mesh);
    items.push(it);
    if (hooks.onSpawn) hooks.onSpawn(it);
    return it;
  }

  function remove(it, reason) {
    if (it.state === 'gone') return;
    it.state = 'gone';
    scene.remove(it.mesh);
    const i = items.indexOf(it); if (i >= 0) items.splice(i, 1);
    if (hooks.onRemoved) hooks.onRemoved(it, reason);
  }

  function update(dt, night) {
    clock += dt;
    // 落とす
    const counts = {};
    for (const it of items) counts[it.key] = (counts[it.key] || 0) + 1;
    for (const key of scheduler.update(dt, !!night, counts)) spawn(key);
    // 進める
    const F = cfg.fall;
    for (const it of items.slice()) {
      const m = it.mesh;
      if (it.state === 'falling') {
        it.t += dt;
        const u = Math.min(1, it.t / F.seconds);
        it.baseY = settleY(it.x, it.z);
        m.position.y = it.baseY + F.height * (1 - u * u);
        m.rotation.x = (1 - u) * it.spinX; m.rotation.z = (1 - u) * it.spinZ + it.tilt * u;
        if (u >= 1) {
          it.state = 'landed'; it.landedAt = clock;
          m.rotation.x = 0; m.rotation.z = it.tilt;
          if (hooks.onLanded) hooks.onLanded(it);
        }
      } else if (it.state === 'landed' || it.state === 'fading') {
        it.age += dt;
        const bt = clock - it.landedAt;
        const bounce = bt < F.bounceSeconds ? F.bounce * Math.sin(Math.PI * bt / F.bounceSeconds) : 0; // ぽんと弾む
        it.baseY = settleY(it.x, it.z);
        m.position.y = it.baseY + bounce;
        if (it.age > it.life && it.state === 'landed') { it.state = 'fading'; it.fade = 0; }
        if (it.state === 'fading') {
          it.fade += dt;
          const k = Math.max(0.001, 1 - it.fade / cfg.fadeSeconds);
          m.scale.setScalar((it.key === 'toy' ? 2.25 : 1) * k);
          if (it.fade >= cfg.fadeSeconds) { if (hooks.onExpired) hooks.onExpired(it); remove(it, 'expired'); }
        }
      }
    }
  }

  const isLanded = (it) => it.state === 'landed';
  return {
    update, spawn,
    /** collectKind の落とし物のうち、地面に落ちて(拾える状態で)、(x,z)から半径r以内にあるもの。 */
    list(collectKind, x, z, r) {
      const out = [];
      for (const it of items) {
        if (it.collectKind !== collectKind || !isLanded(it)) continue;
        if (Math.hypot(it.x - x, it.z - z) <= r) out.push({ id: it.id, x: it.x, z: it.z, y: it.baseY });
      }
      return out;
    },
    get: (id) => items.find((i) => i.id === id) || null,
    /** 拾う(世界から取り除く)。拾えたら true。 */
    take(id) {
      const it = items.find((i) => i.id === id);
      if (!it || !isLanded(it)) return false;
      if (hooks.onTaken) hooks.onTaken(it);
      remove(it, 'taken');
      return true;
    },
    getItems: () => items,
    counts() { const c = {}; for (const it of items) c[it.key] = (c[it.key] || 0) + 1; return c; },
    scheduler,
  };
}
