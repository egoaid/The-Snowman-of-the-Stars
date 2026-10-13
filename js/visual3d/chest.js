// chest.js (v1.54 E4)
// テントのそばに置く、世界のチェスト。見守りの雪だるまが、集めた物を運んでしまう場所。
//   ・ふたの正面に「星のかけら」の飾りがつく(夜は少しだけ光る)。
//   ・中身は plain なデータ({itemId: 個数})で持つ。将来の保存でそのまま書き出せる(serialize/restore)。
//   ・ふたの開閉は、ふたの角度だけを動かす軽いアニメーション(開く0.9秒・閉じる0.8秒は呼び出し側の待ち時間)。
// 中身の出し入れ(createChestStorage)は three.js に依存しない(Nodeで試験できる)。

import * as THREE from 'three';
import { createStarGeometry } from './snowman.js';
import { getToonGradientMap } from './shading.js';
import { getItemDef } from '../items.js';

/**
 * 中身だけ。スロットの並び(slots)で持つ: 各スロットは { id, count } か null。
 * 見守りの雪だるまも、プレイヤー(インベントリ画面)も、同じ並びを出し入れする(インベントリ側へ attachArea で渡す)。
 * チェストの種類(容量・スタック)の違いは、将来ここで持つ。
 */
export function createChestStorage({ capacitySlots = 27, maxStack = 64 } = {}) {
  const slots = new Array(capacitySlots).fill(null);
  const stackMax = (id) => { const d = getItemDef(id); return d && d.maxStack ? Math.min(d.maxStack, maxStack) : maxStack; };
  const total = () => slots.reduce((n, s) => n + (s ? s.count : 0), 0);
  return {
    slots,
    /** 1個以上入れる。入ったらその個数を返す(満杯なら0)。 */
    store(itemId, n = 1) {
      let left = n;
      const max = stackMax(itemId);
      for (const s of slots) { if (left <= 0) break; if (s && s.id === itemId && s.count < max) { const put = Math.min(max - s.count, left); s.count += put; left -= put; } }
      for (let i = 0; i < slots.length && left > 0; i++) { if (!slots[i]) { const put = Math.min(max, left); slots[i] = { id: itemId, count: put }; left -= put; } }
      return n - left;
    },
    take(itemId, n = 1) {
      let left = n;
      for (let i = slots.length - 1; i >= 0 && left > 0; i--) {
        const s = slots[i]; if (!s || s.id !== itemId) continue;
        const t = Math.min(s.count, left); s.count -= t; left -= t; if (s.count === 0) slots[i] = null;
      }
      return n - left;
    },
    count: (itemId) => slots.reduce((c, s) => c + (s && s.id === itemId ? s.count : 0), 0),
    total,
    contents() { const o = {}; for (const s of slots) if (s) o[s.id] = (o[s.id] || 0) + s.count; return o; },
    isFull: () => slots.every((s) => s && s.count >= stackMax(s.id)),
    serialize: () => ({ slots: slots.map((s) => (s ? { id: s.id, count: s.count } : null)) }),
    restore(d) {
      slots.fill(null);
      if (d && Array.isArray(d.slots)) d.slots.forEach((s, i) => { if (i < slots.length && s && s.count > 0) slots[i] = { id: s.id, count: s.count }; });
      else if (d && d.items) for (const [k, v] of Object.entries(d.items)) if (v > 0) this.store(k, v); // 古い形式
    },
  };
}

const WOOD = new THREE.MeshToonMaterial({ color: 0x8a5a2b, gradientMap: getToonGradientMap() });
const WOOD_DARK = new THREE.MeshToonMaterial({ color: 0x6b4420, gradientMap: getToonGradientMap() });
const BAND = new THREE.MeshToonMaterial({ color: 0x3d3d3d, gradientMap: getToonGradientMap() });
const INSIDE = new THREE.MeshBasicMaterial({ color: 0x120d08 });

/**
 * @param {object} [o]
 * @param {number} [o.scale]
 * @returns チェスト(group: 原点は底面の中央、正面は+z方向)
 */
export function createBaseChest({ scale = 1.0 } = {}) {
  const W = 0.95 * scale, H = 0.5 * scale, D = 0.6 * scale;
  const group = new THREE.Group();
  const storage = createChestStorage();

  // 箱(底+四方の壁。ふたを開けると中の暗さが見える)
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), WOOD);
  body.position.y = H / 2; body.castShadow = true; body.receiveShadow = true;
  group.add(body);
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.86, D * 0.82), INSIDE);
  inner.rotation.x = -Math.PI / 2; inner.position.y = H + 0.002;
  group.add(inner);
  for (const x of [-W * 0.32, W * 0.32]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.07 * scale, H * 1.02, D * 1.03), BAND);
    band.position.set(x, H / 2, 0);
    group.add(band);
  }

  // ふた(後ろの縁を軸に回る)。半円ではなく、角の丸い平たい箱の見た目(軽く)
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, H, -D / 2);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(W * 1.02, 0.14 * scale, D * 1.04), WOOD_DARK);
  lid.position.set(0, 0.07 * scale, D / 2); lid.castShadow = true;
  lidPivot.add(lid);
  for (const x of [-W * 0.32, W * 0.32]) {
    const lb = new THREE.Mesh(new THREE.BoxGeometry(0.075 * scale, 0.16 * scale, D * 1.06), BAND);
    lb.position.set(x, 0.07 * scale, D / 2);
    lidPivot.add(lb);
  }
  // 星のかけらの飾り(ふたの正面に1つ、その横に小さいのが1つ)
  const shardMat = new THREE.MeshBasicMaterial({ color: 0xffe27a, fog: false });
  const shard = new THREE.Mesh(createStarGeometry(0.085 * scale), shardMat);
  shard.position.set(0, 0.07 * scale, D * 1.04 + 0.012); shard.rotation.z = 0.2;
  lidPivot.add(shard);
  const shard2 = new THREE.Mesh(createStarGeometry(0.04 * scale), shardMat);
  shard2.position.set(W * 0.17, 0.12 * scale, D * 1.04 + 0.012); shard2.rotation.z = -0.35;
  lidPivot.add(shard2);
  group.add(lidPivot);

  // 開閉: ふたの角度(0=閉, -1.25rad≒開)
  const OPEN_ANGLE = -1.25;
  let target = 0, angle = 0;
  const state = { open: false };
  // v1.56-H3: 開閉の効果音。見守りの雪だるまの開閉も、プレイヤーの開閉も、同じ open()/close() を通るので、ここで1回だけ鳴らす。
  const hooks = { onOpen: null, onClose: null };

  return {
    group, storage,
    width: W, depth: D, height: H,
    /** 半径(衝突の円用) */
    radius: Math.hypot(W, D) / 2,
    open() { if (!state.open && hooks.onOpen) hooks.onOpen(); target = OPEN_ANGLE; state.open = true; },
    close() { if (state.open && hooks.onClose) hooks.onClose(); target = 0; state.open = false; },
    /** 開く/閉じる瞬間に呼ぶ関数(効果音用)。すでに開いている/閉じているときの呼び直しでは鳴らさない。 */
    setSoundHooks(h) { hooks.onOpen = (h && h.onOpen) || null; hooks.onClose = (h && h.onClose) || null; },
    isOpen: () => state.open,
    /** ふたが目標の角度に着いたか(開ききった/閉じきった) */
    settled: () => Math.abs(angle - target) < 0.02,
    lidAngle: () => angle,
    update(delta, { night = false, t = 0 } = {}) {
      const k = 1 - Math.exp(-delta * 7);
      angle += (target - angle) * k;
      lidPivot.rotation.x = angle;
      // 星のかけらは、夜だけほんの少し脈打つ(昼は変わらない)
      const s = night ? 1 + 0.06 * Math.sin(t * 2.2) : 1;
      shard.scale.setScalar(s); shard2.scale.setScalar(s);
    },
    /** 世界のどこを向いているか(正面の向き)。回転は group.rotation.y で与える。 */
    frontDirection() { return { x: Math.sin(group.rotation.y), z: Math.cos(group.rotation.y) }; },
    serialize: () => ({ x: group.position.x, z: group.position.z, yaw: group.rotation.y, ...storage.serialize() }),
    restore(s) { if (s) storage.restore(s); },
    dispose() { group.traverse((c) => { if (c.geometry) c.geometry.dispose(); }); },
  };
}
