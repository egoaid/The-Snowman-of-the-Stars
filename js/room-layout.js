// room-layout.js (v1.122) — 部屋(My Room)の「家具の定義表」。画面にも three.js にも依存しない(Nodeで試験できる)。
//   ・家具ごとに「置き場所(place)・足あと(foot。歩けない範囲)・雪だるまが使う位置と向き(spots)」を、ここにまとめる。
//   ・intro-room-core.js の SPOTS / SHELVES は、この表から導く(以前は、家具の座標と、別々に書いていた)。
//   ・将来(ドールハウスで、ユーザーが家具を動かす時): makeLayout({ sofa: { x, z, ry } }) のように、置き場所だけを渡せば、
//     使う位置・向き・足あと(障害物)が、家具といっしょに、動く。経路(room-nav.js)と行動の計画(intro-room-core.js)は、その layout を使う。
//   ・「spots」の数字は、既定の置き場所での、世界座標。置き場所が動くと、家具との相対位置を保ったまま、まるごと動く(移動+回転)。
//   v1.124: 家具には、入り方(source)がある: desk=デスク一式(初期から部屋にある。外せない)/ starter=Dollhouseを初めて開いた時に、設置済みの初期セット /
//   stock=初めからDollhouseに入っているが、未設置 / collect=main_gameの地形から回収 / legacy=v1.123までの部屋にあったが、仕様の一覧に無い物。
//   壁に付ける物(mount:'wall')は、床の位置(x,z)ではなく、壁の位置(どの壁・壁に沿った位置u・高さy)で置く。
//   v1.123: 家具には、「初期から部屋にある物(core)」と「地形から回収して、Dollhouseで置く物」がある。置いてある物だけで、レイアウトを作れる
//   (makeLayout の opts.only)。置いていない家具は、使う位置も、足あとも、行動も、無い。置く・外すの記録は、room-state.js。
//   座標: x=右, z=手前(奥の窓の壁が z=-2.3)。単位 m。ry=three.js の rotation.y(正面の向きは (sin ry, cos ry))。yaw も同じ向き。

export const ROOM = { x0: -3.6, x1: 3.9, z0: -2.3, z1: 7.0, h: 3.3 }; // 部屋の広さ(m)。stream-room.js も、これを使う

export const FACE_YAW = Math.atan2(-1.2 - 0.4, 0.82 - 0.35) + 0.05; // 椅子の向き(モニターのほうを向く。もとの録画用ワイプの部屋と同じ)
export const TV_YAW = 2.48; // テレビデオ(奥の右の角に、斜めに置く)の正面の、反対の向き = テレビを見る人が、向く向き
const PI = Math.PI;

/**
 * 既定の家具。
 *   id / place {x,z,ry} / foot {ox,oz,hw,hd}(家具の局所座標。hw=局所xの半分の幅・hd=局所zの半分の奥行き。low=true は、またげる低い物で、障害物にしない)
 *   spots {名前: 位置} / shelf {id,w}(本棚)
 *   core=true: 初期から部屋にある物(デスク一式。外せない)。movable=false: 置き場所を、まだ動かせない(机まわりの小物が、椅子・机の位置から、決められているため)。
 *   attachedTo='desk': 机の上の小物(位置は、机・椅子に対して決まる。場所は、動かせない)。
 * 足あとは、実際の3Dの大きさ(Box3)から取った(verify_roomlayout.mjs が、実物とのずれを調べる)。
 */
export const FURNITURE = [
  { id: 'sofa', place: { x: -3.05, z: 2.5, ry: PI / 2 }, foot: { ox: 0, oz: 0, hw: 1.0, hd: 0.55 },
    spots: { sofa: { seat: { x: -2.95, z: 2.5 }, seatY: 0.45, yaw: PI / 2, front: { x: -2.0, z: 2.5 }, frontYaw: -PI / 2, bookTarget: { x: -2.95, y: 0.5, z: 2.1 }, bookRest: { x: -2.95, y: 0.452, z: 2.05 } } } },
  { id: 'sofa2', place: { x: 3.05, z: 4.9, ry: -PI / 2 }, foot: { ox: 0, oz: 0, hw: 1.0, hd: 0.55 },
    spots: { sofa2: { seat: { x: 2.95, z: 4.9 }, seatY: 0.45, yaw: -PI / 2, front: { x: 2.0, z: 4.9 } } } },
  { id: 'desk', core: true, movable: false, place: { x: -1.1, z: 0.75, ry: 0 }, foot: { ox: 0, oz: 0, hw: 1.0, hd: 0.7 },
    spots: {
      cupDesk: { stand: { x: 0.2, z: 1.97 }, yaw: PI, target: { x: -0.26, y: 0.9, z: 1.24 } },
      headsetDesk: { stand: { x: -2.0, z: 1.97 }, yaw: PI, target: { x: -1.55, y: 0.92, z: 1.25 } },
    } },
  { id: 'chair', core: true, movable: false, place: { x: 0.4, z: 0.35, ry: FACE_YAW }, foot: { ox: 0, oz: 0, hw: 0.45, hd: 0.45 },
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
    spots: { tvDeck: { stand: { x: 2.6, z: -0.4 }, yaw: TV_YAW, target: { x: 3.07, y: 0.5, z: -1.04 } } } },
  { id: 'console', attachedTo: 'tvStand', movable: false, place: { x: 3.15, z: -1.4, ry: -0.66 }, // 初代PS風のゲーム機とコントローラー(テレビ台の上。別の回収品。テレビ台について行く)
    spots: { console: { stand: { x: 2.3, z: -1.05 }, yaw: TV_YAW, target: { x: 2.78, y: 0.45, z: -1.66 }, padTarget: { x: 2.71, y: 0.42, z: -1.49 } } } },
  { id: 'vhsPile', place: { x: 2.2, z: -1.95, ry: 0.4 }, foot: { ox: 0.133, oz: 0.011, hw: 0.361, hd: 0.279, low: true }, // 床に積んだ、ビデオテープの山(低い)
    spots: { vhsPile: { stand: { x: 2.1, z: -1.15 }, yaw: PI, target: { x: 2.2, y: 0.15, z: -1.95 } } } },
  { id: 'kettle', place: { x: -0.95, z: -1.45, ry: 0 }, foot: { ox: 0, oz: 0, hw: 0.11, hd: 0.11 }, // 窓の前の、運動用のマットと、ケトルベル
    spots: { kettle: { stand: { x: -0.95, z: -0.85 }, yaw: PI, target: { x: -0.95, y: 0.14, z: -1.45 } } } },
  // ---- 机の上の小物(回収して、置く物。机・椅子に対して位置が決まるので、場所は、まだ動かせない) ----
  { id: 'cup', attachedTo: 'desk', movable: false, place: { x: -0.26, z: 1.24, ry: 0 } }, // コーヒーカップ
  { id: 'headset', attachedTo: 'desk', movable: false, place: { x: -1.55, z: 1.25, ry: 0 } }, // ヘッドホン(ヘッドセット)
  { id: 'mixer', attachedTo: 'desk', movable: false, place: { x: -0.8, z: 1.22, ry: 0.15 } }, // 小型ミキサー
  { id: 'mic', attachedTo: 'desk', movable: false, place: { x: 0.05, z: 1.5, ry: 0 } }, // 卓上マイク
  // ---- 見た目だけの物(行動には使わない) ----
  { id: 'clock', mount: 'wall', place: { wall: 'N', u: 2.6, y: 0.95 } }, // 壁の振り子時計(奥の壁。窓の右)
  // ---- 壁に付ける物(wall: N=奥の窓の壁 / S=手前のドアの壁 / W=左の壁 / E=右の壁。u=壁に沿った位置(N・Sは x、W・Eは z)、y=高さ) ----
  { id: 'corkBoard', mount: 'wall', place: { wall: 'W', u: 3.0, y: 1.75 } }, // メモが貼ってあるコルクボードの額(説明書のメモ・日記)
  { id: 'fairyLights', mount: 'wall', place: { wall: 'W', u: 2.75, y: 2.84 } }, // 壁の上の、横長のフェアリーライト(電球14個)
  { id: 'pictureFairy', mount: 'wall', place: { wall: 'W', u: 1.0, y: 2.1 } }, // フェアリーライトの下の絵(額あり)
  { id: 'pictureWindow', mount: 'wall', place: { wall: 'N', u: 1.0, y: 2.0 } }, // 窓際の、額なしの絵(星の絵)
  { id: 'windowShelf', mount: 'wall', place: { wall: 'N', u: -2.7, y: 1.55 } }, // 窓際の小さな棚と、その上の2つのオブジェ
  { id: 'frameLeftCat', mount: 'wall', place: { wall: 'W', u: 2.0, y: 2.0 } }, // 左の壁の額(猫)。仕様の一覧に無い
  { id: 'frameFrontMountain', mount: 'wall', place: { wall: 'S', u: -1.25, y: 2.0 } }, // 手前の壁の額(山)。仕様の一覧に無い
  { id: 'frameFrontSea', mount: 'wall', place: { wall: 'S', u: -0.55, y: 2.0 } }, // 手前の壁の額(海)。仕様の一覧に無い
  { id: 'frameFrontCat', mount: 'wall', place: { wall: 'S', u: 0.15, y: 2.05 } }, // 手前の壁の額(猫)。仕様の一覧に無い
  { id: 'viewB', kind: 'view' }, // 窓外の景色B(Dollhouseに、初めから入っている。置く物ではなく、窓の外の景色を、切り替える。まだ作っていない)
  { id: 'rugRound', place: { x: 0.1, z: 0.35, ry: 0 } }, // 机の下の、丸い敷物
  { id: 'floorLampR', place: { x: 3.5, z: 4.9, ry: 0 }, foot: { ox: 0, oz: 0, hw: 0.2, hd: 0.2 } }, // 右手前の、床置きのスタンド
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
/** 家具が p0 から p1 へ動いた時に、その家具に付いている点(世界の x,z。家具の明かり・敷物など)が、動く先。置き場所が同じなら、そのまま。 */
export function rigidMove(pt, p0, p1) {
  if (samePlace(p0, p1)) return { x: pt.x, z: pt.z };
  const [rx, rz] = rotY(pt.x - p0.x, pt.z - p0.z, p1.ry - p0.ry); return { x: p1.x + rx, z: p1.z + rz };
}

/** 家具のid → 定義(既定の置き場所つき)。 */
export const FURNITURE_BY_ID = Object.fromEntries(FURNITURE.map((f) => [f.id, f]));

// ---------------------------------------------------------------- 家具の入り方(source)
/**
 * どこから来る家具か。
 *   desk    デスク一式(初期から部屋にある。外せない)
 *   starter Dollhouse を、初めて開いた時に、設置済みの初期セット(壁の飾りなど)
 *   stock   初めから Dollhouse に入っているが、My Room には未設置(緑のソファ・本棚セット・カーペット・クッション・MIDIキーボード・ジャックオーランタン・窓外の景色B)
 *   collect main_game の地形から回収する物(回収したら、家具リストに入る。同じ物を何個回収しても、家具リストには1つ)
 *   legacy  v1.123 までの部屋にあったが、仕様の一覧に無い物(仕様が決まるまで、全部入りの部屋にだけ、ある)
 */
export const SOURCES = {
  desk: ['desk', 'chair'],
  starter: ['corkBoard', 'fairyLights', 'pictureFairy', 'pictureWindow', 'windowShelf'],
  stock: ['sofa', 'lampPumpkin', 'kb', 'floorRug', 'rugRound', 'tvCushion', 'shelfR', 'shelfF1', 'shelfF2', 'shelfL', 'viewB'],
  collect: ['sofa2', 'sideTable', 'synth', 'tvStand', 'console', 'vhsPile', 'kettle', 'cup', 'headset', 'mixer', 'mic', 'clock', 'plantCorner', 'floorLamp', 'floorLampR'],
  legacy: ['armchair', 'sideTableR', 'frameLeftCat', 'frameFrontMountain', 'frameFrontSea', 'frameFrontCat'],
};
for (const [src, ids] of Object.entries(SOURCES)) for (const id of ids) { if (FURNITURE_BY_ID[id]) FURNITURE_BY_ID[id].source = src; }
/** 入り方ごとの、家具のid(定義の順)。 */
export const idsBySource = (src) => FURNITURE.filter((f) => f.source === src).map((f) => f.id);
/** 置く物(景色などの、置かない物を除く)。 */
export const isPlaceable = (id) => !!FURNITURE_BY_ID[id] && FURNITURE_BY_ID[id].kind !== 'view';
export const isWallItem = (id) => !!FURNITURE_BY_ID[id] && FURNITURE_BY_ID[id].mount === 'wall';
/** 初期から部屋にある家具のid(外せない)。 */
export const CORE_IDS = FURNITURE.filter((f) => f.core).map((f) => f.id);

// ---------------------------------------------------------------- 壁
/** 壁の名前 → 壁に沿った位置 u の範囲(N・S は x、W・E は z)。 */
export const WALL_RANGE = { N: [ROOM.x0, ROOM.x1], S: [ROOM.x0, ROOM.x1], W: [ROOM.z0, ROOM.z1], E: [ROOM.z0, ROOM.z1] };
export const WALL_Y = [0.2, ROOM.h - 0.2]; // 壁の飾りの高さの範囲
/** 壁の飾りの、置き場所 { wall, u, y } を、壁の中に収める(壁は、いまは、既定の壁のまま。壁を替えるのは、まだ)。 */
export function clampWall(q, def) {
  const [u0, u1] = WALL_RANGE[def.wall];
  return { wall: def.wall, u: Math.max(u0, Math.min(u1, Number.isFinite(q && q.u) ? q.u : def.u)), y: Math.max(WALL_Y[0], Math.min(WALL_Y[1], Number.isFinite(q && q.y) ? q.y : def.y)) };
}

/**
 * 家具の置き場所を決めて、レイアウトを作る。
 * placements = { 家具のid: { x?, z?, ry? } または { u?, y? }(壁の飾り) }(書かなかった家具は、既定の場所)。
 * opts.only = 置いてある家具のid(配列・Set)。指定すると、それ以外の家具は、レイアウトに入らない(使う位置も、足あとも、無い)。省くと、全部。
 *   他の家具に付く物(attachedTo。机の上の小物・ゲーム機)は、その家具の動きについて行く。
 * 戻り値: { furniture[{id,place,foot,w?,spots}], byId, spots(名前→位置), shelves[{id,x,z,ry,w}], obstacles[{id,cx,cz,hw,hd,ry}] }
 */
export function makeLayout(placements = {}, opts = {}) {
  const furniture = [], spots = { hub: { ...HUB } }, shelves = [], obstacles = [], byId = {};
  const only = opts.only ? new Set(opts.only) : null;
  const placeOf = (f) => (f.place ? { ...f.place, ...(placements[f.id] || {}) } : null); // 置き場所(上書きがあれば、重ねる)
  for (const f of FURNITURE) {
    if (f.kind === 'view') continue; // 景色は、置く物ではない
    if (only && !only.has(f.id)) continue;
    const par = f.attachedTo ? FURNITURE_BY_ID[f.attachedTo] : null;
    const p0 = f.place, p1 = par ? { ...p0 } : placeOf(f); // 他の家具に付く物は、自分では、動かない
    const wall = f.mount === 'wall';
    const m0 = par ? par.place : p0, m1 = par ? placeOf(par) : p1; // 動きの元(付いている家具があれば、その家具の動き)
    const moved = !wall && m0 && m1 && !samePlace(m0, m1);
    const mySpots = {};
    for (const [name, sp] of Object.entries(f.spots || {})) { mySpots[name] = moved ? moveSpot(sp, m0, m1) : clone(sp); spots[name] = mySpots[name]; }
    const e = { id: f.id, place: p1, foot: f.foot || null, spots: mySpots };
    if (f.shelf) { e.shelfId = f.shelf.id; e.w = f.shelf.w; shelves.push({ id: f.shelf.id, x: p1.x, z: p1.z, ry: p1.ry, w: f.shelf.w }); }
    if (f.foot && !f.foot.low && !wall) { const [ox, oz] = rotY(f.foot.ox, f.foot.oz, p1.ry); obstacles.push({ id: f.id, cx: p1.x + ox, cz: p1.z + oz, hw: f.foot.hw, hd: f.foot.hd, ry: p1.ry }); }
    furniture.push(e); byId[f.id] = e;
  }
  return { furniture, byId, spots, shelves, obstacles };
}

export const DEFAULT_LAYOUT = makeLayout();
