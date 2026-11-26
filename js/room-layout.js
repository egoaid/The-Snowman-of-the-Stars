// room-layout.js (v1.122) — 部屋(My Room)の「家具の定義表」。画面にも three.js にも依存しない(Nodeで試験できる)。
//   ・家具ごとに「置き場所(place)・足あと(foot。歩けない範囲)・雪だるまが使う位置と向き(spots)」を、ここにまとめる。
//   ・intro-room-core.js の SPOTS / SHELVES は、この表から導く(以前は、家具の座標と、別々に書いていた)。
//   ・将来(ドールハウスで、ユーザーが家具を動かす時): makeLayout({ sofa: { x, z, ry } }) のように、置き場所だけを渡せば、
//     使う位置・向き・足あと(障害物)が、家具といっしょに、動く。経路(room-nav.js)と行動の計画(intro-room-core.js)は、その layout を使う。
//   ・「spots」の数字は、既定の置き場所での、世界座標。置き場所が動くと、家具との相対位置を保ったまま、まるごと動く(移動+回転)。
//   座標: x=右, z=手前(奥の窓の壁が z=-2.3)。単位 m。ry=three.js の rotation.y(正面の向きは (sin ry, cos ry))。yaw も同じ向き。

export const ROOM = { x0: -3.6, x1: 3.9, z0: -2.3, z1: 7.0, h: 3.3 }; // 部屋の広さ(m)。stream-room.js も、これを使う

export const FACE_YAW = Math.atan2(-1.2 - 0.4, 0.82 - 0.35) + 0.05; // 椅子の向き(モニターのほうを向く。もとの録画用ワイプの部屋と同じ)
export const TV_YAW = 2.48; // テレビデオ(奥の右の角に、斜めに置く)の正面の、反対の向き = テレビを見る人が、向く向き
const PI = Math.PI;

/**
 * 既定の家具。
 *   id / place {x,z,ry} / foot {ox,oz,hw,hd}(家具の局所座標。hw=局所xの半分の幅・hd=局所zの半分の奥行き。low=true は、またげる低い物で、障害物にしない)
 *   spots {名前: 位置} / shelf {id,w}(本棚)
 * 足あとは、実際の3Dの大きさ(Box3)から取った(verify_roomlayout.mjs が、実物とのずれを調べる)。
 */
export const FURNITURE = [
  { id: 'sofa', place: { x: -3.05, z: 2.5, ry: PI / 2 }, foot: { ox: 0, oz: 0, hw: 1.0, hd: 0.55 },
    spots: { sofa: { seat: { x: -2.95, z: 2.5 }, seatY: 0.45, yaw: PI / 2, front: { x: -2.0, z: 2.5 }, frontYaw: -PI / 2, bookTarget: { x: -2.95, y: 0.5, z: 2.1 }, bookRest: { x: -2.95, y: 0.452, z: 2.05 } } } },
  { id: 'sofa2', place: { x: 3.05, z: 4.9, ry: -PI / 2 }, foot: { ox: 0, oz: 0, hw: 1.0, hd: 0.55 },
    spots: { sofa2: { seat: { x: 2.95, z: 4.9 }, seatY: 0.45, yaw: -PI / 2, front: { x: 2.0, z: 4.9 } } } },
  { id: 'desk', place: { x: -1.1, z: 0.75, ry: 0 }, foot: { ox: 0, oz: 0, hw: 1.0, hd: 0.7 },
    spots: {
      cupDesk: { stand: { x: 0.2, z: 1.97 }, yaw: PI, target: { x: -0.26, y: 0.9, z: 1.24 } },
      headsetDesk: { stand: { x: -2.0, z: 1.97 }, yaw: PI, target: { x: -1.55, y: 0.92, z: 1.25 } },
    } },
  { id: 'chair', place: { x: 0.4, z: 0.35, ry: FACE_YAW }, foot: { ox: 0, oz: 0, hw: 0.45, hd: 0.45 },
    spots: { chair: { seat: { x: 0.4, z: 0.35 }, seatY: 0.42, yaw: FACE_YAW, side: { x: 0.71, z: 1.25 } } } },
  { id: 'sideTable', place: { x: -2.95, z: 3.95, ry: 0 }, foot: { ox: 0, oz: 0, hw: 0.27, hd: 0.27 },
    spots: { table: { stand: { x: -2.2, z: 3.49 }, yaw: -PI / 2, target: { x: -2.8, y: 0.6, z: 3.95 } } } },
  { id: 'lampPumpkin', place: { x: -3.4, z: 5.35, ry: PI / 2 }, // 低い本棚(shelfL)の上
    spots: { lamp: { stand: { x: -2.75, z: 4.89 }, yaw: -PI / 2, target: { x: -3.4, y: 1.5, z: 5.35 } } } },
  { id: 'kb', place: { x: -0.25, z: 6.88, ry: 0 }, foot: { ox: 0, oz: 0, hw: 0.12, hd: 0.1 }, // 手前の壁に縦に立てかけたMIDIキーボード
    spots: { kb: { stand: { x: -0.25, z: 6.3 }, yaw: 0 } } },
  { id: 'synth', place: { x: -0.95, z: 6.88, ry: 0 }, foot: { ox: 0, oz: 0, hw: 0.18, hd: 0.1 }, // その横の、大きなシンセ
    spots: { synth: { stand: { x: -0.95, z: 6.3 }, yaw: 0, reach: { x: -0.95, y: 0.6, z: 6.85 } } } },
  { id: 'floorRug', place: { x: 0.2, z: 4.7, ry: 0 }, // 手前の敷物: 大きなシンセを床へ寝かせて、床に座って弾く場所(歩ける)
    spots: { floor: { seat: { x: 0.2, z: 5.3 }, seatY: 0, yaw: PI, front: { x: 0.2, z: 5.95 }, pickup: { x: 0.2, z: 5.35 }, pickupYaw: PI, synth: { x: 0.2, z: 4.62 }, synthReach: { x: 0.2, y: 0.2, z: 4.62 + 0.1 } } } },
  { id: 'tvCushion', place: { x: 1.9, z: 0.25, ry: 0 }, // テレビの前の、床のクッション(床に座る。歩ける)
    spots: { tv: { seat: { x: 1.9, z: 0.25 }, seatY: 0, yaw: TV_YAW, front: { x: 1.4, z: 0.95 } } } },
  { id: 'tvStand', place: { x: 3.15, z: -1.4, ry: -0.66 }, foot: { ox: -0.024, oz: -0.146, hw: 0.674, hd: 0.474 },
    spots: {
      tvDeck: { stand: { x: 2.6, z: -0.4 }, yaw: TV_YAW, target: { x: 3.07, y: 0.5, z: -1.04 } },
      console: { stand: { x: 2.3, z: -1.05 }, yaw: TV_YAW, target: { x: 2.78, y: 0.45, z: -1.66 }, padTarget: { x: 2.71, y: 0.42, z: -1.49 } },
    } },
  { id: 'vhsPile', place: { x: 2.2, z: -1.95, ry: 0.4 }, foot: { ox: 0.133, oz: 0.011, hw: 0.361, hd: 0.279, low: true }, // 床に積んだ、ビデオテープの山(低い)
    spots: { vhsPile: { stand: { x: 2.1, z: -1.15 }, yaw: PI, target: { x: 2.2, y: 0.15, z: -1.95 } } } },
  { id: 'kettle', place: { x: -0.95, z: -1.45, ry: 0 }, foot: { ox: 0, oz: 0, hw: 0.11, hd: 0.11 }, // 窓の前の、運動用のマットと、ケトルベル
    spots: { kettle: { stand: { x: -0.95, z: -0.85 }, yaw: PI, target: { x: -0.95, y: 0.14, z: -1.45 } } } },
  // ---- 本棚(壁ぎわ)。w=横幅、d=奥行き(stream-room.js の makeBookshelf と同じ) ----
  { id: 'shelfR', place: { x: 3.71, z: 1.6, ry: -PI / 2 }, shelf: { id: 'R', w: 3.6 }, foot: { ox: 0, oz: 0, hw: 1.8, hd: 0.19 } }, // 右の壁の大きな本棚
  { id: 'shelfF1', place: { x: -2.75, z: 6.83, ry: PI }, shelf: { id: 'F1', w: 1.5 }, foot: { ox: 0, oz: 0, hw: 0.75, hd: 0.17 } }, // 手前の壁(ドアの左)
  { id: 'shelfF2', place: { x: 3.0, z: 6.84, ry: PI }, shelf: { id: 'F2', w: 1.2 }, foot: { ox: 0, oz: 0, hw: 0.6, hd: 0.16 } }, // 手前の壁(ドアの右)
  { id: 'shelfL', place: { x: -3.43, z: 4.7, ry: PI / 2 }, shelf: { id: 'L', w: 2.4 }, foot: { ox: 0, oz: 0, hw: 1.2, hd: 0.17 } }, // 左の壁の低い本棚(ソファのとなり)
  // ---- 行動には使わないが、歩けない物(stream-room.js が置いている) ----
  { id: 'armchair', place: { x: 2.7, z: 4.3, ry: -PI / 2 - 0.45 }, foot: { ox: 0, oz: -0.002, hw: 0.58, hd: 0.428 } },
  { id: 'sideTableR', place: { x: 3.45, z: 3.2, ry: 0 }, foot: { ox: 0, oz: 0, hw: 0.225, hd: 0.225 } },
  { id: 'plantCorner', place: { x: -3.2, z: 6.4, ry: 0 }, foot: { ox: -0.024, oz: 0.026, hw: 0.406, hd: 0.426 } },
  { id: 'floorLamp', place: { x: -3.4, z: 0.35, ry: 0 }, foot: { ox: 0, oz: 0, hw: 0.19, hd: 0.19 } }, // ソファのわきの、床置きの小さなランプ
];

/** 部屋の中心あたりの、目印(経路には使わない。見た目の中心)。 */
export const HUB = { x: 0.0, z: 3.4 };

// ---------------------------------------------------------------- 幾何
/** three.js の rotation.y = ry で回した時の、局所(dx,dz) → 世界(の差)。 */
export const rotY = (dx, dz, ry) => { const c = Math.cos(ry), s = Math.sin(ry); return [dx * c + dz * s, -dx * s + dz * c]; };

const clone = (o) => JSON.parse(JSON.stringify(o));
/** 位置の入れ物(x,z を持つ物・yaw で終わる名前の数)を、家具の動き(p0 → p1)に合わせて、まるごと動かす。y(高さ)は、そのまま。 */
function moveSpot(o, p0, p1) {
  const dry = p1.ry - p0.ry, out = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'number') out[k] = /yaw$/i.test(k) ? v + dry : v;
    else if (v && typeof v === 'object') {
      if (typeof v.x === 'number' && typeof v.z === 'number') { const [rx, rz] = rotY(v.x - p0.x, v.z - p0.z, dry); out[k] = { ...v, x: p1.x + rx, z: p1.z + rz }; }
      else out[k] = v;
    } else out[k] = v;
  }
  return out;
}
const samePlace = (a, b) => a.x === b.x && a.z === b.z && a.ry === b.ry;

/**
 * 家具の置き場所を決めて、レイアウトを作る。
 * placements = { 家具のid: { x?, z?, ry? } }(書かなかった家具は、既定の場所)。
 * 戻り値: { furniture[{id,place,foot,w?,spots}], byId, spots(名前→位置), shelves[{id,x,z,ry,w}], obstacles[{id,cx,cz,hw,hd,ry}] }
 */
export function makeLayout(placements = {}) {
  const furniture = [], spots = { hub: { ...HUB } }, shelves = [], obstacles = [], byId = {};
  for (const f of FURNITURE) {
    const p0 = f.place, p1 = placements[f.id] ? { ...p0, ...placements[f.id] } : { ...p0 }, moved = !samePlace(p0, p1);
    const mySpots = {};
    for (const [name, sp] of Object.entries(f.spots || {})) { mySpots[name] = moved ? moveSpot(sp, p0, p1) : clone(sp); spots[name] = mySpots[name]; }
    const e = { id: f.id, place: p1, foot: f.foot || null, spots: mySpots };
    if (f.shelf) { e.shelfId = f.shelf.id; e.w = f.shelf.w; shelves.push({ id: f.shelf.id, x: p1.x, z: p1.z, ry: p1.ry, w: f.shelf.w }); }
    if (f.foot && !f.foot.low) { const [ox, oz] = rotY(f.foot.ox, f.foot.oz, p1.ry); obstacles.push({ id: f.id, cx: p1.x + ox, cz: p1.z + oz, hw: f.foot.hw, hd: f.foot.hd, ry: p1.ry }); }
    furniture.push(e); byId[f.id] = e;
  }
  return { furniture, byId, spots, shelves, obstacles };
}

export const DEFAULT_LAYOUT = makeLayout();
