// intro-room-core.js (v1.113) — 起動の「部屋の演出」のきまり。画面にも three.js にも依存しない(Nodeで試験できる)。
//   ・アプリは、部屋(全画面)から始まる。雪だるまはソファでくつろいでいる。部屋のものをクリックすると、雪だるまが動く。
//   ・パソコンのモニターをクリック → 椅子に座り、ブラウザを開いてゲームのサイトへ → 部屋の映像が、イージングで小さくなって右下のワイプになる。
//   ・ワイプをクリックすると、部屋が全画面に戻る。
//   このファイルは「数式・状態の遷移・行動の計画(歩く道すじ、座る、本を取る…)」だけを持つ。

export const ROOM = { x0: -3.6, x1: 3.9, z0: -2.3, z1: 7.0, h: 3.3 }; // stream-room.js と同じ広さ(m)

// ---------------------------------------------------------------- イージング・矩形
export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const lerp = (a, b, k) => a + (b - a) * k;
/** ゆっくり動き出し、ゆっくり止まる(全画面↔ワイプの動きに使う)。 */
export const easeInOutCubic = (t) => { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);
export const smoothstep = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
/** 角度の差を -π〜π にして返す(いちばん近い回り方)。 */
export function angleDiff(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }
export const lerpAngle = (a, b, k) => a + angleDiff(a, b) * k;

export const FULL_MS = 950; // 全画面↔ワイプの動きの長さ(ミリ秒)

/** ワイプの置き場所(16:9)。ふつうは右下、タッチ操作の端末は(右下にボタンがあるので)右上。 */
export function wipeRect(vw, vh, { coarse = false } = {}) {
  const margin = Math.max(8, Math.min(18, Math.round(Math.min(vw, vh) * 0.02)));
  let w = Math.max(168, Math.min(460, Math.round(vw * (coarse ? 0.3 : 0.25))));
  w = Math.min(w, Math.round(vw * 0.5), Math.round((vh * 0.4) * 16 / 9));
  w = Math.max(96, w);
  const h = Math.round((w * 9) / 16);
  return { x: vw - w - margin, y: coarse ? margin : vh - h - margin, w, h };
}
export const fullRect = (vw, vh) => ({ x: 0, y: 0, w: vw, h: vh });
export const lerpRect = (a, b, k) => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), w: lerp(a.w, b.w, k), h: lerp(a.h, b.h, k) });

/**
 * 表示の状態: 'room'(全画面の部屋)/ 'toWipe'(縮んでいく)/ 'wipe'(右下の小さな窓)/ 'toRoom'(広がっていく)。
 * progress() は「ワイプらしさ」0(全画面)〜1(ワイプ)を、イージングをかけて返す。
 */
export function createModeMachine({ start = 'room', duration = FULL_MS } = {}) {
  let mode = start === 'wipe' ? 'wipe' : 'room', t = mode === 'wipe' ? 1 : 0; // t: 0=全画面 … 1=ワイプ(線形)
  const dur = Math.max(100, duration) / 1000;
  return {
    get mode() { return mode; },
    /** 全画面の部屋 → ワイプ。すでにワイプか縮んでいる最中なら、何もしない。 */
    toWipe() { if (mode === 'room' || mode === 'toRoom') mode = 'toWipe'; return mode; },
    /** ワイプ → 全画面の部屋。 */
    toRoom() { if (mode === 'wipe' || mode === 'toWipe') mode = 'toRoom'; return mode; },
    /** すぐ切り替える(動きなし)。 */
    jump(m) { if (m === 'wipe') { mode = 'wipe'; t = 1; } else { mode = 'room'; t = 0; } },
    update(dt) {
      if (mode === 'toWipe') { t = Math.min(1, t + dt / dur); if (t >= 1) mode = 'wipe'; }
      else if (mode === 'toRoom') { t = Math.max(0, t - dt / dur); if (t <= 0) mode = 'room'; }
      return mode;
    },
    linear: () => t,
    progress: () => easeInOutCubic(t),
    /** 部屋が全画面のあいだ(動いている最中も含む)は、ゲームの操作を止める。 */
    isBlocking: () => mode !== 'wipe',
    isMoving: () => mode === 'toWipe' || mode === 'toRoom',
  };
}

// ---------------------------------------------------------------- 部屋の中の、場所(m)
const FACE_YAW = Math.atan2(-1.2 - 0.4, 0.82 - 0.35) + 0.05; // stream-wipe.js の椅子の向き(モニターのほうを向く)
export const SPOTS = {
  hub: { x: 0.0, z: 3.4 }, // 部屋の真ん中あたり。ここを経由すると、家具にぶつからない
  sofa: { seat: { x: -2.95, z: 2.5 }, seatY: 0.45, yaw: Math.PI / 2, front: { x: -2.0, z: 2.5 } }, // 左の壁ぎわ。+x(部屋の中)を向いて座る
  chair: { seat: { x: 0.4, z: 0.35 }, seatY: 0.42, yaw: FACE_YAW, side: { x: 0.71, z: 1.25 } }, // 机の椅子(stream-wipe.js と同じ位置)
  kb: { stand: { x: -0.25, z: 5.95 }, yaw: 0 }, // 手前の壁に立てかけたMIDIキーボードの前(壁のほう=+zを向く)
};
/** 本棚(stream-room.js の置き方と同じ)。front=前を向く向き(ry)。w=横幅。 */
export const SHELVES = [
  { id: 'R', x: 3.71, z: 1.6, ry: -Math.PI / 2, w: 3.6 }, // 右の壁の大きな本棚
  { id: 'F1', x: -2.75, z: 6.83, ry: Math.PI, w: 1.5 }, // 手前の壁(ドアの左)
  { id: 'F2', x: 3.0, z: 6.84, ry: Math.PI, w: 1.2 }, // 手前の壁(ドアの右)
  { id: 'L', x: -3.43, z: 4.7, ry: Math.PI / 2, w: 2.4 }, // 左の壁の低い本棚(ソファのとなり)
];
/** 本棚の前に立つ場所と、本棚のほうを向く向き。lateral=棚の横方向のずらし(-1〜1)。 */
export function shelfStand(shelf, lateral = 0) {
  const fx = Math.sin(shelf.ry), fz = Math.cos(shelf.ry); // 棚の前の向き(世界)
  const lx = Math.cos(shelf.ry), lz = -Math.sin(shelf.ry); // 棚の横の向き(局所のx)
  const off = Math.max(-1, Math.min(1, lateral)) * Math.max(0, shelf.w / 2 - 0.65);
  return { x: shelf.x + fx * 0.9 + lx * off, z: shelf.z + fz * 0.9 + lz * off, yaw: Math.atan2(-fx, -fz) };
}

// ---------------------------------------------------------------- 行動の計画
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const same = (a, b) => dist(a, b) < 0.05;
/** from → to の道すじ(途中の経由点つき)。近ければ、そのまま。 */
export function route(from, to) {
  const pts = [];
  const direct = dist(from, to) < 1.6;
  if (!direct) { if (dist(from, SPOTS.hub) > 0.4 && dist(to, SPOTS.hub) > 0.4) pts.push({ ...SPOTS.hub }); }
  pts.push({ x: to.x, z: to.z });
  return pts;
}
const walk = (from, to) => (same(from, to) ? null : { t: 'walk', path: route(from, to) });

/**
 * いまの状態から、あとかたづけ(立つ・ものを元の場所へ戻す)の手順を作る。
 * st = { x, z, seat: null|'sofa'|'chair', carry: null|'book'|'kb' }
 * 戻り値 { steps, pos }(あとかたづけが終わった時の位置)
 */
export function tidy(st) {
  const steps = []; let pos = { x: st.x, z: st.z }, seat = st.seat, carry = st.carry;
  if (seat) {
    steps.push({ t: 'stand', seat });
    pos = seat === 'sofa' ? { ...SPOTS.sofa.front } : { ...SPOTS.chair.side };
    if (carry === 'book') { steps.push({ t: 'place', what: 'book', at: 'sofa' }); carry = null; } // 読んでいた本は、ソファの上へ
    seat = null;
  }
  if (carry === 'kb') {
    const s = walk(pos, SPOTS.kb.stand); if (s) steps.push(s); pos = { ...SPOTS.kb.stand };
    steps.push({ t: 'face', yaw: SPOTS.kb.yaw }, { t: 'place', what: 'kb', at: 'wall' }); carry = null;
  }
  if (carry === 'book') { // 立ったまま持っている(途中)。ソファの上へ置きに行く
    const s = walk(pos, SPOTS.sofa.front); if (s) steps.push(s); pos = { ...SPOTS.sofa.front };
    steps.push({ t: 'place', what: 'book', at: 'sofa' }); carry = null;
  }
  return { steps, pos };
}

/**
 * クリックされたものに応じた、一連の手順。
 * action = { type: 'book', shelf: 'R'|'F1'|'F2'|'L' } | { type: 'keyboard' } | { type: 'monitor' } | { type: 'sofa' }
 * st = { x, z, seat, carry, launched }。手順の種類:
 *   walk{path} / face{yaw} / sit{seat} / stand{seat} / reach / pick{what} / place{what,at} / camera{view} / do{what,dur} / emit{event}
 */
export function planAction(action, st, rand = Math.random) {
  if (!action) return [];
  if (action.type === 'monitor') {
    if (st.seat === 'chair') return [{ t: 'camera', view: 'monitor' }, { t: 'do', what: 'pc' }];
    const td = tidy(st); const steps = [...td.steps]; const w = walk(td.pos, SPOTS.chair.side); if (w) steps.push(w);
    steps.push({ t: 'sit', seat: 'chair' }, { t: 'camera', view: 'monitor' }, { t: 'do', what: 'pc' });
    return steps;
  }
  if (action.type === 'keyboard') {
    if (st.carry === 'kb' && st.seat === 'sofa') return []; // もう弾いている
    const td = tidy(st); const steps = [...td.steps]; let pos = td.pos;
    const w = walk(pos, SPOTS.kb.stand); if (w) steps.push(w); pos = { ...SPOTS.kb.stand };
    steps.push({ t: 'face', yaw: SPOTS.kb.yaw }, { t: 'reach' }, { t: 'pick', what: 'kb' });
    const w2 = walk(pos, SPOTS.sofa.front); if (w2) steps.push(w2);
    steps.push({ t: 'sit', seat: 'sofa' }, { t: 'do', what: 'play', dur: 90 + rand() * 60 });
    return steps;
  }
  if (action.type === 'sofa') { // ソファをクリック: 座ってくつろぐ
    if (st.seat === 'sofa') return [];
    const td = tidy(st); const steps = [...td.steps]; const w = walk(td.pos, SPOTS.sofa.front); if (w) steps.push(w);
    steps.push({ t: 'sit', seat: 'sofa' }); return steps;
  }
  if (action.type === 'book') {
    const shelf = SHELVES.find((s) => s.id === action.shelf) || SHELVES[0];
    const td = tidy(st); const steps = [...td.steps]; let pos = td.pos;
    const stand = shelfStand(shelf, rand() * 2 - 1);
    const w = walk(pos, stand); if (w) steps.push(w); pos = { x: stand.x, z: stand.z };
    steps.push({ t: 'face', yaw: stand.yaw }, { t: 'reach' }, { t: 'pick', what: 'book', shelf: shelf.id });
    const w2 = walk(pos, SPOTS.sofa.front); if (w2) steps.push(w2);
    steps.push({ t: 'sit', seat: 'sofa' }, { t: 'do', what: 'read', dur: 70 + rand() * 50 });
    return steps;
  }
  return [];
}

/** 道すじの長さ(m)。 */
export function pathLength(from, path) {
  let len = 0, p = from; for (const q of path) { len += dist(p, q); p = q; } return len;
}

// ---------------------------------------------------------------- パソコンの画面の流れ(ブラウザを開く → URLを打つ → 読み込む → ページが出る)
export const PC = { open: 0.9, type: 1.7, enter: 0.4, load: 1.0, page: 0.9, hold: 0.6, back: 1.4 };
/** 最初の起動(fresh): ブラウザを開いてゲームのサイトへ。2回目以降(戻ってきた時): すぐ、ゲームの画面に切り替える短い流れ。 */
export function pcTotal(fresh) { return fresh ? PC.open + PC.type + PC.enter + PC.load + PC.page + PC.hold : PC.back; }
export function pcSequence(t, fresh) {
  if (!fresh) return { stage: 'game', open: 1, typed: 1, enter: 0, load: 1, page: 1, done: t >= PC.back };
  let u = t;
  const open = clamp01(u / PC.open); u -= PC.open;
  const typed = clamp01(u / PC.type); u -= PC.type;
  const enter = u >= 0 && u < PC.enter ? 1 : 0; u -= PC.enter;
  const load = clamp01(u / PC.load); u -= PC.load;
  const page = clamp01(u / PC.page); u -= PC.page;
  const done = u >= PC.hold;
  const stage = page > 0 ? 'page' : load > 0 ? 'load' : typed > 0 ? 'type' : 'open';
  return { stage, open, typed, enter, load, page, done };
}
