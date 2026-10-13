// fallen-wood.js (v1.48 Phase A)
// 倒木・大枝・小枝・小枝先など「森の地面に落ちている木」を、種類ごとのパラメータ表から手続き的に作る。
//
// 設計方針:
//  - 見た目(メッシュ)は曲がり・テーパー・枝分かれ・葉の有無を持つが、物理のあたり判定は
//    「幹の円柱1本」(length, radius, radiusTop)だけ。fallen-log-system.js / physics.js は
//    この円柱だけを知っていればよい(見た目より物理を大幅に単純に保つ)。
//  - メッシュの規約は従来と同じ: 原点=幹の根元、幹はローカルY軸方向に length だけ伸びる。
//    物理の中心 = 根元 + 軸 * length/2。
//  - 1本につき描画は 木部1メッシュ + 葉1メッシュ(葉がある時だけ)。ジオメトリは自前で結合する。
//  - 配置は placeFallenWood(純粋関数)。シーン側の判定(川・キャンプ・木)は isBlocked で渡す。

import * as THREE from 'three';
import { getToonGradientMap } from './shading.js';
import { getLeafMaterial } from './tree.js';
import { makeRng, randRange } from './rng.js';

// ---- 種類の表 ----
// length/radius/taper(先端半径÷根元半径)/bend(曲がり。長さに対する横ずれの割合の上限)
// age: 経年の重み { fresh, seasoned, weathered, old }
// branches: 幹から出る枝の本数  branchLen: 枝の長さ(幹の長さに対する割合)  stub: 折れた枝の根元だけが残る確率
// foliage: 葉の残り具合(0=完全に葉なし)  pickable: 今のゲームで「丸太」として拾えるか
// near: 配置の好み('trees'=木の近く / 'logs'=大きな倒木の近く / 'any')
// walkOver: true = 雪だるまが上を歩いて乗り越えられる(障害物にならない)。小枝・小さな枝だけ。
export const WOOD_TYPES = {
  // v1.53 E2: 川に渡せる長さの、ごく普通の倒木(「橋用」の特別扱いは無い。長いだけで、他の倒木と同じ物理・同じ通行の規則)。
  great_trunk:  { label: '非常に長い倒木', length: [14, 20],    radius: [0.24, 0.34],  taper: [0.55, 0.75], bend: [0.008, 0.03], age: { seasoned: 2, weathered: 3, old: 2 }, branches: [1, 3], branchLen: [0.04, 0.09], stub: 0.9, sub: false, foliage: [0, 0],     pickable: false, near: 'trees', maxPitch: 0.3 },
  long_trunk:   { label: '大きく長い倒木', length: [7, 12],     radius: [0.28, 0.42],  taper: [0.45, 0.65], bend: [0.01, 0.04], age: { seasoned: 2, weathered: 3, old: 2 },  branches: [1, 4], branchLen: [0.04, 0.10], stub: 0.9, sub: false, foliage: [0, 0],     pickable: false, near: 'trees', maxPitch: 0.35 },
  thick_trunk:  { label: '太い幹',         length: [3, 5.5],     radius: [0.5, 0.75],   taper: [0.78, 0.92], bend: [0.005, 0.02], age: { seasoned: 2, weathered: 2, old: 3 }, branches: [0, 2], branchLen: [0.04, 0.08], stub: 1.0, sub: false, foliage: [0, 0],     pickable: false, near: 'trees', maxPitch: 0.3 },
  bare_tree:    { label: '葉のない倒木',   length: [4.5, 8],     radius: [0.16, 0.28],  taper: [0.4, 0.6],   bend: [0.02, 0.05], age: { weathered: 3, old: 4 },               branches: [6, 11], branchLen: [0.10, 0.28], stub: 0.55, sub: true,  foliage: [0, 0],     pickable: false, near: 'trees', maxPitch: 0.4 },
  leafy_tree:   { label: '葉の残る倒木',   length: [4, 7],       radius: [0.14, 0.24],  taper: [0.4, 0.58],  bend: [0.02, 0.05], age: { fresh: 3, seasoned: 2 },              branches: [7, 12], branchLen: [0.14, 0.30], stub: 0.12, sub: true,  foliage: [0.25, 1], pickable: false, near: 'trees', maxPitch: 0.4 },
  medium_log:   { label: '中くらいの丸太', length: [2, 3.2],     radius: [0.14, 0.24],  taper: [0.7, 0.9],   bend: [0.005, 0.03], age: { fresh: 1, seasoned: 3, weathered: 2 }, branches: [0, 2], branchLen: [0.05, 0.12], stub: 1.0, sub: false, foliage: [0, 0],     pickable: true,  near: 'logs',  maxPitch: 0.4 },
  short_log:    { label: '短い丸太',       length: [0.8, 1.4],   radius: [0.12, 0.22],  taper: [0.8, 0.95],  bend: [0, 0.01],   age: { fresh: 1, seasoned: 3, weathered: 2 }, branches: [0, 1], branchLen: [0.05, 0.1],  stub: 1.0, sub: false, foliage: [0, 0],     pickable: true,  near: 'any',   maxPitch: 0.5 },
  thin_log:     { label: '細い丸太',       length: [2, 4],       radius: [0.06, 0.1],   taper: [0.4, 0.7],   bend: [0.02, 0.06], age: { fresh: 1, seasoned: 3, weathered: 2 }, branches: [1, 3], branchLen: [0.08, 0.18], stub: 0.5, sub: false, foliage: [0, 0],     pickable: true,  near: 'logs',  maxPitch: 0.5 },
  large_branch: { label: '大きな枝',       length: [1.8, 3],     radius: [0.05, 0.09],  taper: [0.25, 0.45], bend: [0.03, 0.08], age: { seasoned: 2, weathered: 3, old: 1 },  branches: [2, 4], branchLen: [0.2, 0.4],   stub: 0.3, sub: true,  foliage: [0, 0.3],  pickable: false, near: 'logs',  maxPitch: 0.5 },
  medium_branch:{ label: '中くらいの枝',   length: [1, 1.8],     radius: [0.03, 0.05],  taper: [0.25, 0.45], bend: [0.03, 0.08], age: { seasoned: 2, weathered: 3, old: 1 },  branches: [1, 3], branchLen: [0.2, 0.4],   stub: 0.3, sub: false, foliage: [0, 0.2],  pickable: false, near: 'logs',  maxPitch: 0.6 },
  small_branch: { label: '小さな枝',       length: [0.5, 1],     radius: [0.02, 0.03],  taper: [0.3, 0.5],   bend: [0.03, 0.1],  age: { seasoned: 2, weathered: 3, old: 1 },  branches: [0, 2], branchLen: [0.25, 0.45], stub: 0.2, sub: false, foliage: [0, 0],     pickable: false, near: 'any',   maxPitch: 0.7, walkOver: true },
  twig:         { label: '小枝',           length: [0.25, 0.5],  radius: [0.008, 0.015], taper: [0.4, 0.6],  bend: [0.03, 0.1],  age: { weathered: 3, old: 2 },               branches: [0, 1], branchLen: [0.3, 0.5],   stub: 0.0, sub: false, foliage: [0, 0],     pickable: false, near: 'any',   maxPitch: 0.8, walkOver: true },
};

// 配置する本数(合計30。仕様の「20〜30個」)。大きいものから順に置く。
export const WOOD_PLAN = [
  ['great_trunk', 2], ['long_trunk', 3], ['thick_trunk', 2], ['bare_tree', 3], ['leafy_tree', 2],
  ['medium_log', 3], ['short_log', 2], ['thin_log', 2],
  ['large_branch', 3], ['medium_branch', 2], ['small_branch', 3], ['twig', 3],
];
export const WOOD_PLAN_TOTAL = WOOD_PLAN.reduce((s, [, n]) => s + n, 0);

// 物理の円柱の下限(細すぎると地面をすり抜けやすい)
const MIN_COLLISION_RADIUS = 0.03;

// ---- 材質(全ての倒木で共有) ----
const AGE_COLORS = { fresh: 0x5a3a22, seasoned: 0x6b4a30, weathered: 0x8b7b68, old: 0xa3998a };
const _woodMaterials = {};
export function getWoodMaterial(age) {
  if (!_woodMaterials[age]) {
    _woodMaterials[age] = new THREE.MeshToonMaterial({ color: AGE_COLORS[age] ?? AGE_COLORS.seasoned, vertexColors: true, gradientMap: getToonGradientMap() });
  }
  return _woodMaterials[age];
}
let _pickMaterial = null;
function getPickMaterial() {
  if (!_pickMaterial) _pickMaterial = new THREE.MeshBasicMaterial({ visible: false });
  return _pickMaterial;
}

function pickWeighted(rng, weights) {
  const entries = Object.entries(weights);
  let total = 0; for (const [, w] of entries) total += w;
  let r = rng() * total;
  for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
  return entries[entries.length - 1][0];
}

/** 種類と乱数から、寸法・経年・葉の量などの「仕様」を決める(メッシュも物理もこの値だけを使う)。 */
export function rollWoodSpec(typeName, rng) {
  const T = WOOD_TYPES[typeName];
  if (!T) throw new Error('unknown wood type: ' + typeName);
  const length = randRange(rng, T.length[0], T.length[1]);
  const radius = randRange(rng, T.radius[0], T.radius[1]);
  const taper = randRange(rng, T.taper[0], T.taper[1]);
  // 曲がりの横ずれは、物理の円柱から大きく外れないよう「半径の約1.2倍」までにする
  const bendFrac = Math.min(randRange(rng, T.bend[0], T.bend[1]), (radius * 1.2) / length);
  return {
    type: typeName, seed: Math.floor(rng() * 1e6),
    length, radius, radiusTop: radius * taper, taper,
    bend: bendFrac * (rng() < 0.5 ? -1 : 1),
    age: pickWeighted(rng, T.age),
    foliage: randRange(rng, T.foliage[0], T.foliage[1]),
    pickable: T.pickable,
  };
}

/** 物理が使う円柱の寸法(見た目より単純)。 */
export function collisionDims(spec) {
  return { length: spec.length, radius: Math.max(spec.radius, MIN_COLLISION_RADIUS), radiusTop: Math.max(spec.radiusTop, MIN_COLLISION_RADIUS * 0.8) };
}

// ---- ジオメトリの結合ビルダー ----
function createBuilder(withColor) {
  const pos = [], col = [], idx = [];
  const b = {
    pos, col, idx,
    vertex(p, c) { pos.push(p.x, p.y, p.z); if (withColor) col.push(c[0], c[1], c[2]); return pos.length / 3 - 1; },
    count() { return pos.length / 3; },
    build() {
      if (!pos.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      if (withColor) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    },
  };
  return b;
}

const _T = new THREE.Vector3(), _N = new THREE.Vector3(), _B = new THREE.Vector3(), _tmp = new THREE.Vector3();

/** 点列に沿った、半径が変わる管。cutColor があれば両端(start/end指定時)にふたをする。 */
function addTube(b, points, radii, seg, shade, cut) {
  const n = points.length;
  const base = b.count();
  let Nprev = null;
  for (let i = 0; i < n; i++) {
    _T.copy(points[Math.min(n - 1, i + 1)]).sub(points[Math.max(0, i - 1)]).normalize();
    if (!Nprev) {
      _tmp.set(Math.abs(_T.x) < 0.9 ? 1 : 0, Math.abs(_T.x) < 0.9 ? 0 : 1, 0);
      _N.crossVectors(_T, _tmp).normalize();
    } else {
      _N.copy(Nprev).addScaledVector(_T, -Nprev.dot(_T)).normalize();
    }
    _B.crossVectors(_T, _N);
    Nprev = _N.clone();
    const c = shade(i / (n - 1));
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const p = new THREE.Vector3().copy(points[i])
        .addScaledVector(_N, Math.cos(a) * radii[i]).addScaledVector(_B, Math.sin(a) * radii[i]);
      b.vertex(p, c);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = base + i * seg + j, bb = base + i * seg + ((j + 1) % seg);
      const c = base + (i + 1) * seg + j, d = base + (i + 1) * seg + ((j + 1) % seg);
      b.idx.push(a, bb, c, bb, d, c);
    }
  }
  if (cut) {
    const capRing = (ringIdx, facingEnd) => {
      const ring = [];
      for (let j = 0; j < seg; j++) {
        const k = base + ringIdx * seg + j;
        ring.push(b.vertex(new THREE.Vector3(b.pos[k * 3], b.pos[k * 3 + 1], b.pos[k * 3 + 2]), cut));
      }
      const ctr = b.vertex(points[ringIdx], cut);
      for (let j = 0; j < seg; j++) {
        const v0 = ring[j], v1 = ring[(j + 1) % seg];
        if (facingEnd) b.idx.push(ctr, v0, v1); else b.idx.push(ctr, v1, v0);
      }
    };
    if (cut.start !== false) capRing(0, false);
    if (cut.end !== false) capRing(n - 1, true);
  }
}

function addCone(b, apexBase, dir, radius, height, seg) {
  const base = b.count();
  const ref = Math.abs(dir.y) < 0.9 ? _tmp.set(0, 1, 0) : _tmp.set(1, 0, 0);
  const U = new THREE.Vector3().crossVectors(dir, ref).normalize();
  const V = new THREE.Vector3().crossVectors(dir, U);
  const apex = apexBase.clone().addScaledVector(dir, height);
  const apexI = b.vertex(apex, null);
  for (let j = 0; j < seg; j++) {
    const a = (j / seg) * Math.PI * 2;
    b.vertex(apexBase.clone().addScaledVector(U, Math.cos(a) * radius).addScaledVector(V, Math.sin(a) * radius), null);
  }
  const ctr = b.vertex(apexBase, null);
  for (let j = 0; j < seg; j++) {
    const v0 = base + 1 + j, v1 = base + 1 + ((j + 1) % seg);
    b.idx.push(apexI, v1, v0); // 外向き
    b.idx.push(ctr, v0, v1);    // 底
  }
}

const AGE_CUT = { fresh: [1.5, 1.25, 0.9], seasoned: [1.4, 1.25, 1.0], weathered: [1.1, 1.05, 1.0], old: [1.0, 1.0, 1.0] };

/**
 * 仕様(spec)からメッシュを作る。原点=根元、幹はローカルY軸方向。
 * @returns {THREE.Group} group.userData.fallenWood = spec
 */
export function createFallenWood(spec) {
  const rng = makeRng(spec.seed);
  const T = WOOD_TYPES[spec.type];
  const L = spec.length, R0 = spec.radius, R1 = spec.radiusTop;
  const wood = createBuilder(true);
  const leaf = createBuilder(false);
  const phase = rng() * 20;
  const cut = AGE_CUT[spec.age] || AGE_CUT.seasoned;
  const cutColor = [cut[0], cut[1], cut[2]];
  const branchCut = [cut[0], cut[1], cut[2]]; branchCut.start = false; // 枝は根元側(幹の中)にふたをしない
  const shade = (t) => { const k = 0.88 + 0.16 * (0.5 + 0.5 * Math.sin(t * 13 + phase)); return [k, k, k]; };
  const seg = R0 < 0.04 ? 5 : 7;

  // --- 幹(曲がり・根元の広がり・テーパー) ---
  const n = Math.max(4, Math.min(14, Math.round(L / 0.6)));
  const trunkPts = [], trunkRadii = [];
  const radiusAt = (t) => R0 + (R1 - R0) * t;
  const centerAt = (t) => new THREE.Vector3(0, L * t, spec.bend * L * Math.sin(Math.PI * t));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    trunkPts.push(centerAt(t));
    const flare = t < 0.12 ? 1 + 0.25 * (1 - t / 0.12) : 1;
    trunkRadii.push(radiusAt(t) * flare * (0.94 + rng() * 0.12));
  }
  addTube(wood, trunkPts, trunkRadii, seg, shade, cutColor);

  // --- 枝 ---
  const nb = Math.round(randRange(rng, T.branches[0], T.branches[1]));
  const addBranch = (start, dir, len, r0, depth) => {
    const stubbed = rng() < T.stub;
    const blen = stubbed ? Math.max(0.1, Math.min(len, randRange(rng, 0.12, 0.45))) : len;
    const bseg = blen < 0.4 ? 2 : 3;
    const pts = [], rads = [];
    const d = dir.clone();
    const p = start.clone();
    for (let i = 0; i <= bseg; i++) {
      pts.push(p.clone());
      rads.push(Math.max(0.004, r0 * (1 - 0.65 * (i / bseg))));
      d.x += (rng() - 0.5) * 0.25; d.y += (rng() - 0.5) * 0.12; d.z += (rng() - 0.5) * 0.25; d.normalize();
      p.addScaledVector(d, blen / bseg);
    }
    addTube(wood, pts, rads, 5, shade, branchCut);
    if (!stubbed) {
      if (T.sub && depth === 0 && blen > 0.5) {
        const ns = 1 + Math.floor(rng() * 2);
        for (let s = 0; s < ns; s++) {
          const u = randRange(rng, 0.35, 0.7);
          const k = Math.min(bseg, Math.max(1, Math.round(u * bseg)));
          const sd = d.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (rng() < 0.5 ? -1 : 1) * randRange(rng, 0.5, 1.0)).normalize();
          addBranch(pts[k], sd, blen * 0.45, rads[k] * 0.6, 1);
        }
      }
      if (spec.foliage > 0) {
        for (const u of [0.55, 0.8, 1.0]) {
          if (rng() > spec.foliage) continue;
          const tip = pts[Math.min(bseg, Math.max(1, Math.round(u * bseg)))];
          const sz = Math.min(1.4, 0.55 + blen * 0.5);
          for (let c = 0; c < 3; c++) {
            const cd = d.clone().add(new THREE.Vector3((rng() - 0.5) * 0.9, (rng() - 0.5) * 0.9, (rng() - 0.5) * 0.9)).normalize();
            addCone(leaf, tip, cd, 0.12 * sz, 0.48 * sz, 6);
          }
        }
      }
    }
  };
  const ts = [];
  for (let i = 0; i < nb; i++) ts.push(randRange(rng, 0.12, 0.95));
  ts.sort((a, b) => a - b);
  for (const t of ts) {
    const psi = rng() < 0.7 ? randRange(rng, -1.3, 1.3) : randRange(rng, -Math.PI, Math.PI); // ローカル+X=上向き
    const gamma = randRange(rng, 0.5, 1.0);
    const lateral = new THREE.Vector3(Math.cos(psi), 0, Math.sin(psi));
    const dir = new THREE.Vector3(0, Math.cos(gamma), 0).addScaledVector(lateral, Math.sin(gamma)).normalize();
    const c = centerAt(t);
    const rt = radiusAt(t);
    const start = c.addScaledVector(lateral, rt * 0.5);
    const len = Math.max(0.12, L * randRange(rng, T.branchLen[0], T.branchLen[1]) * (1 - 0.5 * t));
    addBranch(start, dir, len, Math.max(0.006, rt * randRange(rng, 0.28, 0.45)), 0);
  }
  // 葉の残る倒木は、幹の先端(樹冠側)にも葉をつける
  if (spec.foliage > 0 && T.foliage[1] >= 0.5) {
    const tip = centerAt(1);
    for (let c = 0; c < 4; c++) {
      const cd = new THREE.Vector3((rng() - 0.5) * 0.9, 1, (rng() - 0.5) * 0.9).normalize();
      addCone(leaf, tip, cd, 0.2, 0.8, 6);
    }
  }

  const group = new THREE.Group();
  const woodGeo = wood.build();
  const woodMesh = new THREE.Mesh(woodGeo, getWoodMaterial(spec.age));
  woodMesh.castShadow = true; woodMesh.receiveShadow = true;
  group.add(woodMesh);
  const leafGeo = leaf.build();
  if (leafGeo) {
    const leafMesh = new THREE.Mesh(leafGeo, getLeafMaterial());
    leafMesh.castShadow = true; leafMesh.receiveShadow = true;
    group.add(leafMesh);
  }
  // 細いものは見た目だけだと編集モードでつかめないので、透明な太めのあたり判定(レイキャスト専用)を足す
  if (R0 < 0.1) {
    const g = new THREE.CylinderGeometry(0.12, 0.12, L, 6);
    g.translate(0, L / 2, 0);
    const proxy = new THREE.Mesh(g, getPickMaterial());
    proxy.userData.isPickProxy = true;
    group.add(proxy);
  }
  group.userData.fallenWood = spec;
  return group;
}


// ---- 材質と物理プロパティ(v1.52 Phase D) ----
// 倒木を「何でできた、どれくらいの重さの物か」で区別できるようにする。ここは純粋なデータで、
// 燃焼・浮遊などの挙動はまだ実装しない(将来の火・月・星の仕組みが、この値を読む)。
//   物理プロパティ(physics.jsが使う): mass(kg)・gravityScale・liftForce・adhesion
//   材質(将来の火が使う)          : flammability(燃えやすさ0-1)・moisture(湿り気0-1)・fuelValue(燃料としての量)・
//                                    burnDuration(燃え続ける秒数の目安)・heatTransfer(熱の伝わりやすさ0-1)・smotherRisk(焚き火に載せると火を覆い隠す危険0-1)
const WOOD_DENSITY = { fresh: 700, seasoned: 550, weathered: 450, old: 380 }; // kg/m3(生木は水分で重い。古く乾くほど軽い)
const WOOD_MOISTURE = { fresh: 0.55, seasoned: 0.25, weathered: 0.12, old: 0.08 };
const WOOD_FLAMMABILITY = { twig: 0.95, small_branch: 0.9, medium_branch: 0.8, thin_log: 0.75, large_branch: 0.7, short_log: 0.6, medium_log: 0.6, bare_tree: 0.6, leafy_tree: 0.5, thick_trunk: 0.45, long_trunk: 0.45, great_trunk: 0.45 };

/** 幹の体積(m3)。円錐台。枝・葉は含めない(枝が多い種類は少し足す)。 */
export function woodVolume(spec) {
  const r0 = spec.radius, r1 = spec.radiusTop, L = spec.length;
  const v = (Math.PI * L / 3) * (r0 * r0 + r0 * r1 + r1 * r1);
  const T = WOOD_TYPES[spec.type];
  return v * (1 + Math.min(0.25, ((T.branches[0] + T.branches[1]) / 2) * 0.02));
}
/** physics.js の register({ physicalProperties }) に渡す値。 */
export function woodPhysicalProperties(spec) {
  return { mass: Math.max(0.05, woodVolume(spec) * (WOOD_DENSITY[spec.age] ?? 550)), gravityScale: 1, liftForce: 0, adhesion: 0 };
}
/** 将来の火・燃焼が読む材質。 */
export function woodMaterial(spec) {
  const T = WOOD_TYPES[spec.type];
  const moisture = Math.min(1, (WOOD_MOISTURE[spec.age] ?? 0.25) + (spec.foliage > 0 ? 0.1 : 0)); // 葉が残る=まだ生きた水分が多い
  const mass = woodVolume(spec) * (WOOD_DENSITY[spec.age] ?? 550);
  return {
    name: 'wood',
    flammability: (WOOD_FLAMMABILITY[spec.type] ?? 0.6) * (1 - 0.6 * moisture),
    moisture,
    fuelValue: mass * (1 - 0.5 * moisture), // 乾いた薪に換算した重さ(kg)
    burnDuration: 20 + 500 * spec.radius * (1 - 0.3 * moisture), // 秒の目安(太いほど長く燃える)
    heatTransfer: Math.max(0.1, Math.min(1, 1.0 - spec.radius / 0.6)), // 細いほど熱が回りやすい(すぐ燃え移る)
    smotherRisk: Math.max(0, Math.min(1, (spec.radius - 0.15) / 0.4)), // 太い丸太を火の上に置くと、火を覆って弱める
  };
}

// ---- 地面への置き方 ----
const UP = new THREE.Vector3(0, 1, 0);

/**
 * 水平方向yaw(軸が+xから何ラジアン回っているか。fallen-log-systemのyawと同じ)で、
 * 地形に沿わせて置く姿勢を求める。幹の軸は地形の傾きに合わせて傾け、根元から先端まで
 * 地面に沈みすぎず・浮きすぎないようにする。置けない(急すぎる/浮きすぎる)場合は ok=false。
 * @returns {{ok:boolean, base?:THREE.Vector3, center?:THREE.Vector3, quaternion?:THREE.Quaternion, axis?:THREE.Vector3, pitch?:number}}
 */
export function computeWoodPose(spec, x, z, yaw, groundHeightAt, rollJitter = 0) {
  const L = spec.length;
  const cy = Math.cos(yaw), sy = -Math.sin(yaw);
  const maxPitch = WOOD_TYPES[spec.type].maxPitch;
  const g0 = groundHeightAt(x - cy * L / 2, z - sy * L / 2);
  const g1 = groundHeightAt(x + cy * L / 2, z + sy * L / 2);
  const rawPitch = Math.atan2(g1 - g0, L);
  if (Math.abs(rawPitch) > maxPitch + 0.1) return { ok: false };
  const pitch = Math.max(-maxPitch, Math.min(maxPitch, rawPitch));
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const axis = new THREE.Vector3(cy * cp, sp, sy * cp);
  const samples = Math.max(5, Math.ceil(L / 0.5) + 1); // 0.5m間隔で地面の高さを見る
  let cyMin = -Infinity;
  const gs = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const s = (t - 0.5) * L;
    const g = groundHeightAt(x + cy * cp * s, z + sy * cp * s);
    const r = spec.radius + (spec.radiusTop - spec.radius) * t;
    gs.push({ g, r, s });
    cyMin = Math.max(cyMin, g + r * 0.55 - s * sp); // 沈みは半径の45%まで
  }
  let gapMax = 0;
  for (const { g, r, s } of gs) gapMax = Math.max(gapMax, cyMin + s * sp - g - r);
  if (gapMax > 0.2 + 0.5 * spec.radius) return { ok: false }; // 谷をまたいで宙に浮く
  const center = new THREE.Vector3(x, cyMin, z);
  const base = center.clone().addScaledVector(axis, -L / 2);
  // 枝が上を向くように、軸まわりに回す(ローカル+X → 世界の上向き寄り)
  const qAxis = new THREE.Quaternion().setFromUnitVectors(UP, axis);
  const ex = new THREE.Vector3(1, 0, 0).applyQuaternion(qAxis);
  const upProj = UP.clone().addScaledVector(axis, -UP.dot(axis)).normalize();
  const ang = Math.atan2(axis.dot(new THREE.Vector3().crossVectors(ex, upProj)), ex.dot(upProj)) + rollJitter;
  const quaternion = qAxis.clone().multiply(new THREE.Quaternion().setFromAxisAngle(UP, ang));
  return { ok: true, base, center, quaternion, axis, pitch };
}

function segDist2D(ax, az, bx, bz, cx, cz, dx, dz) {
  // 2本の線分(XZ平面)の最短距離
  const ux = bx - ax, uz = bz - az, vx = dx - cx, vz = dz - cz, wx = ax - cx, wz = az - cz;
  const a = ux * ux + uz * uz, b = ux * vx + uz * vz, c = vx * vx + vz * vz, d = ux * wx + uz * wz, e = vx * wx + vz * wz;
  const D = a * c - b * b;
  let sN, sD = D, tN, tD = D;
  if (D < 1e-9) { sN = 0; sD = 1; tN = e; tD = c; }
  else {
    sN = b * e - c * d; tN = a * e - b * d;
    if (sN < 0) { sN = 0; tN = e; tD = c; } else if (sN > sD) { sN = sD; tN = e + b; tD = c; }
  }
  if (tN < 0) { tN = 0; if (-d < 0) sN = 0; else if (-d > a) sN = sD; else { sN = -d; sD = a; } }
  else if (tN > tD) { tN = tD; if (-d + b < 0) sN = 0; else if (-d + b > a) sN = sD; else { sN = -d + b; sD = a; } }
  const sc = Math.abs(sN) < 1e-9 ? 0 : sN / sD, tc = Math.abs(tN) < 1e-9 ? 0 : tN / tD;
  const px = wx + sc * ux - tc * vx, pz = wz + sc * uz - tc * vz;
  return Math.hypot(px, pz);
}

/**
 * 倒木を自然に分布させる(純粋関数。川やキャンプ・木の位置はコールバック/配列で受け取る)。
 * @param {object} p
 * @param {()=>number} p.rng
 * @param {(x:number,z:number)=>number} p.groundHeightAt
 * @param {(x:number,z:number,r:number)=>boolean} p.isBlocked  置けない場所(川・キャンプ・範囲外など)なら true
 * @param {Array<{x:number,z:number,radius:number}>} [p.treeAnchors] 木の位置(倒木は木の近くに多い)
 * @param {number} [p.range] 一様に選ぶ範囲(±range)
 * @param {Array} [p.plan]
 * @returns {Array<{spec, dims, pose, x, z, yaw}>}
 */
export function placeFallenWood({ rng, groundHeightAt, isBlocked, treeAnchors = [], range = 57, plan = WOOD_PLAN, maxAttemptsPerItem = 120 }) {
  const placed = [];
  const heavy = [];
  const overlaps = (cand) => {
    for (const o of placed) {
      const clear = cand.spec.radius + o.spec.radius + 0.05;
      const d = segDist2D(cand.a.x, cand.a.z, cand.b.x, cand.b.z, o.a.x, o.a.z, o.b.x, o.b.z);
      if (d < clear) return true;
    }
    return false;
  };
  for (const [typeName, count] of plan) {
    const T = WOOD_TYPES[typeName];
    for (let k = 0; k < count; k++) {
      for (let attempt = 0; attempt < maxAttemptsPerItem; attempt++) {
        const spec = rollWoodSpec(typeName, rng);
        let x, z;
        const roll = rng();
        if (T.near === 'logs' && heavy.length && roll < 0.65) {
          const a = heavy[Math.floor(rng() * heavy.length)];
          const ang = rng() * Math.PI * 2, dist = 1.2 + rng() * 4;
          x = a.x + Math.cos(ang) * dist; z = a.z + Math.sin(ang) * dist;
        } else if ((T.near === 'trees' || T.near === 'logs' || T.near === 'any') && treeAnchors.length && roll < 0.7) {
          const a = treeAnchors[Math.floor(rng() * treeAnchors.length)];
          const ang = rng() * Math.PI * 2, dist = a.radius + 0.8 + rng() * 7;
          x = a.x + Math.cos(ang) * dist; z = a.z + Math.sin(ang) * dist;
        } else {
          x = randRange(rng, -range, range); z = randRange(rng, -range, range);
        }
        const yaw = rng() * Math.PI * 2;
        const pose = computeWoodPose(spec, x, z, yaw, groundHeightAt, (rng() - 0.5) * 0.8);
        if (!pose.ok) continue;
        // 幹に沿った点がどれも置ける場所か
        let blocked = false;
        const steps = Math.max(2, Math.ceil(spec.length / 1.2));
        for (let i = 0; i <= steps && !blocked; i++) {
          const s = (i / steps - 0.5) * spec.length;
          blocked = isBlocked(x + pose.axis.x * s, z + pose.axis.z * s, spec.radius);
        }
        if (blocked) continue;
        const h = Math.cos(pose.pitch) * spec.length / 2;
        const cand = {
          spec, x, z, yaw, pose, dims: collisionDims(spec),
          a: { x: x - Math.cos(yaw) * h, z: z + Math.sin(yaw) * h },
          b: { x: x + Math.cos(yaw) * h, z: z - Math.sin(yaw) * h },
        };
        if (overlaps(cand)) continue;
        placed.push(cand);
        if (spec.radius >= 0.14 && spec.length >= 2) heavy.push({ x, z });
        break;
      }
    }
  }
  return placed;
}
