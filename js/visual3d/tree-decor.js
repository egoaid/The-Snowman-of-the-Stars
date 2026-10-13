// tree-decor.js
// 針葉樹への飾り付け。v1.40フェーズ3で「隠れたアンカー」方式にした: 木の輪郭に
// 沿った、目には見えない取り付け点をあらかじめ(計算上)いくつも用意しておき、
// 飾るたびに次の空いている点を順番に使う。これにより、1本の木に複数の飾りを
// 重ならずに置ける(v1.38までの「1本に1つ」制限を撤廃。上限は
// config.jsのDECORATION.maxPerTreeで調整できる)。
//
// アンカー点は木ごとに保存せず、そのつど「木の外形(だいたいの円錐)」と
// 「何個目の飾りか」から計算する(黄金角スパイラルで、下の方から上の方へ
// 少しずつ高さと角度をずらしながら並べる)。木が増えても余分な状態を
// 持たずに済む。
//
// 飾りは木のGroupの子として付ける。木が(雪の埋没などで)動いても、
// 飾りが浮いたり取り残されたりせず、木に付いたまま動く。
// 状態はセッション中だけ保持する(保存はしない)。

import * as THREE from 'three';
import { createStarGeometry } from './snowman.js';
import { DECORATION, FALLING_STAR } from '../config.js';

const _childBox = new THREE.Box3();
const _center = new THREE.Vector3();
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // 約137.5°。均等に見える配置になる角度

/** 木のてっぺん(いちばん高い枝葉のかたまりの頂点)の世界座標を求める。 */
export function computeTreeTop(treeGroup, out = new THREE.Vector3()) {
  treeGroup.updateMatrixWorld(true);
  let bestTop = -Infinity;
  for (const child of treeGroup.children) {
    _childBox.setFromObject(child);
    if (_childBox.isEmpty()) continue;
    if (_childBox.max.y > bestTop) {
      bestTop = _childBox.max.y;
      _childBox.getCenter(_center);
    }
  }
  if (!isFinite(bestTop)) { const b = new THREE.Box3().setFromObject(treeGroup); bestTop = b.max.y; treeGroup.getWorldPosition(_center); }
  return out.set(_center.x, bestTop, _center.z);
}

/** 木のだいたいの外形(円錐として近似した、上端・下端・中心・最大半径)を求める。 */
export function computeTreeEnvelope(treeGroup) {
  treeGroup.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(treeGroup);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  return { top: box.max.y, bottom: box.min.y, centerX: center.x, centerZ: center.z, maxRadius: Math.max(size.x, size.z) / 2 };
}

/**
 * index番目(0始まり)の飾りを置く、木のワールド座標上のアンカー点を求める。
 * 下の方(裾野)は広く、上にいくほど狭くなる円錐に沿って、黄金角で少しずつ
 * 回転させながら並べる(クリスマスツリーの飾りのような見え方を狙っている)。
 */
export function computeAnchorPosition(envelope, index, maxPerTree) {
  const t = maxPerTree <= 1 ? 0.7 : 0.35 + 0.55 * (index / (maxPerTree - 1)); // 0=裾野寄り, 1=てっぺん寄り
  const y = envelope.bottom + t * (envelope.top - envelope.bottom);
  const radius = envelope.maxRadius * (0.12 + (1 - t) * 0.78); // 上にいくほど半径が小さくなる(裾広がり)
  const angle = index * GOLDEN_ANGLE;
  return new THREE.Vector3(
    envelope.centerX + Math.cos(angle) * radius,
    y,
    envelope.centerZ + Math.sin(angle) * radius
  );
}

const DECOR_KINDS = {
  star: {
    // 帽子の星と同じ大きさ。
    build() {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffd700, fog: false });
      return new THREE.Mesh(createStarGeometry(FALLING_STAR.hatRadius), mat);
    },
  },
};

/**
 * @param {object} o
 * @param {{x:number,z:number,scale:number,mesh:THREE.Object3D,decorations:string[]}[]} o.conifers
 */
export function createTreeDecorations(o) {
  const conifers = o.conifers;
  const placed = []; // { tree, kind, object }

  function reachOf(t) { return DECORATION.reachBase + t.scale * DECORATION.reachPerScale; }
  function isFull(t) { return t.decorations.length >= DECORATION.maxPerTree; }

  /** (x,z)にいる雪だるまが今すぐ飾れる、いちばん近い(まだ空きのある)針葉樹。無ければnull。 */
  function findTarget(x, z, kind = 'star') {
    let best = null, bestD = Infinity;
    for (const t of conifers) {
      if (t.scale > DECORATION.maxTreeScale) continue;
      if (isFull(t)) continue;
      const d = Math.hypot(t.x - x, t.z - z);
      if (d <= reachOf(t) && d < bestD) { best = t; bestD = d; }
    }
    return best;
  }

  /** 飾る。成功したらtrue。ポーチの個数の増減は呼び出し側が行う。 */
  function place(tree, kind = 'star') {
    const def = DECOR_KINDS[kind];
    if (!def || !tree || isFull(tree)) return false;
    const index = tree.decorations.length; // 何個目か=次に使うアンカー点の番号
    const envelope = computeTreeEnvelope(tree.mesh);
    const worldPos = computeAnchorPosition(envelope, index, DECORATION.maxPerTree);
    const obj = def.build();
    tree.mesh.add(obj);
    obj.position.copy(tree.mesh.worldToLocal(worldPos));
    tree.decorations.push(kind);
    placed.push({ tree, kind, object: obj });
    return true;
  }

  return {
    findTarget,
    place,
    isFull,
    getPlacedCount: () => placed.length,
    getPlaced: () => placed.map((p) => ({ x: p.tree.x, z: p.tree.z, kind: p.kind })),
  };
}
