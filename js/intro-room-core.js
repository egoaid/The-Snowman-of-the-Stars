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
const FACE_YAW = Math.atan2(-1.2 - 0.4, 0.82 - 0.35) + 0.05; // もとの録画用ワイプの部屋と同じ、椅子の向き(モニターのほうを向く)
export const SPOTS = {
  hub: { x: 0.0, z: 3.4 }, // 部屋の真ん中あたり。ここを経由すると、家具にぶつからない
  sofa: { seat: { x: -2.95, z: 2.5 }, seatY: 0.45, yaw: Math.PI / 2, front: { x: -2.0, z: 2.5 } }, // 左の壁ぎわ。+x(部屋の中)を向いて座る
  chair: { seat: { x: 0.4, z: 0.35 }, seatY: 0.42, yaw: FACE_YAW, side: { x: 0.71, z: 1.25 } }, // 机の椅子(stream-wipe.js と同じ位置)
  kb: { stand: { x: -0.25, z: 6.3 }, yaw: 0 }, // 手前の壁に縦に立てかけたMIDIキーボードの前(壁のほう=+zを向く)。腕が伸びすぎないよう、近くに立つ
  synth: { stand: { x: -0.95, z: 6.3 }, yaw: 0 }, // その横に立てかけた、大きなシンセの前
  lamp: { stand: { x: -2.75, z: 4.89 }, yaw: -Math.PI / 2, target: { x: -3.4, y: 1.5, z: 5.35 } }, // 低い本棚の上のランプ(ソファのとなり)。左肩が、ランプの正面に来る位置
  floor: { seat: { x: 0.2, z: 5.3 }, seatY: 0, yaw: Math.PI, front: { x: 0.2, z: 5.95 }, pickup: { x: 0.2, z: 5.35 }, synth: { x: 0.2, z: 4.62 } }, // 大きなシンセを床へ寝かせて、床に座って弾く場所(敷物の上)
  table: { stand: { x: -2.2, z: 3.49 }, yaw: -Math.PI / 2, target: { x: -2.8, y: 0.6, z: 3.95 } }, // ソファの横のサイドテーブル(左肩が、テーブルの正面)
  cupDesk: { stand: { x: 0.2, z: 1.97 }, yaw: Math.PI, target: { x: -0.26, y: 0.9, z: 1.24 } }, // 机の上のカップ
  headsetDesk: { stand: { x: -2.0, z: 1.97 }, yaw: Math.PI, target: { x: -1.55, y: 0.92, z: 1.25 } }, // 机の上のヘッドセット(右肩が、ヘッドセットの正面)
};
/** 本棚(stream-room.js の置き方と同じ)。front=前を向く向き(ry)。w=横幅。 */
export const SHELVES = [
  { id: 'R', x: 3.71, z: 1.6, ry: -Math.PI / 2, w: 3.6 }, // 右の壁の大きな本棚
  { id: 'F1', x: -2.75, z: 6.83, ry: Math.PI, w: 1.5 }, // 手前の壁(ドアの左)
  { id: 'F2', x: 3.0, z: 6.84, ry: Math.PI, w: 1.2 }, // 手前の壁(ドアの右)
  { id: 'L', x: -3.43, z: 4.7, ry: Math.PI / 2, w: 2.4 }, // 左の壁の低い本棚(ソファのとなり)
];
export const SHELF_STAND = 0.82; // 棚の中心から、立つ場所までの距離(胴体の半径0.5+棚の奥行きの半分。腕が、伸びすぎない近さ)
/** 本棚の前に立つ場所と、本棚のほうを向く向き。lateral=棚の横方向のずらし(-1〜1)。 */
export function shelfStand(shelf, lateral = 0) {
  const fx = Math.sin(shelf.ry), fz = Math.cos(shelf.ry); // 棚の前の向き(世界)
  const lx = Math.cos(shelf.ry), lz = -Math.sin(shelf.ry); // 棚の横の向き(局所のx)
  const off = Math.max(-1, Math.min(1, lateral)) * Math.max(0, shelf.w / 2 - 0.65);
  return { x: shelf.x + fx * SHELF_STAND + lx * off, z: shelf.z + fz * SHELF_STAND + lz * off, yaw: Math.atan2(-fx, -fz) };
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
 * いまの状態から、あとかたづけ(立つ・ものを元の場所へ戻す・ヘッドセットを外す)の手順を作る。
 * st = { x, z, seat: null|'sofa'|'chair'|'floor', carry: null|'book'|'kb'|'cup'|'synth'|'headset', headset: 'desk'|'head'|'hand', synthAt: 'wall'|'floor'|'hand', cupAt: 'desk'|'table'|'hand' }
 * opt.cupTo = 'desk' なら、持っているカップは、机へ(これからパソコンへ行く時)。ふだんは、サイドテーブルへ。
 * 戻り値 { steps, pos }(あとかたづけが終わった時の位置)
 */
export function tidy(st, opt = {}) {
  const steps = []; let pos = { x: st.x, z: st.z }; let carry = st.carry;
  const go = (to) => { const w = walk(pos, to); if (w) steps.push(w); pos = { x: to.x, z: to.z }; };
  const putCup = (to) => { const sp = to === 'desk' ? SPOTS.cupDesk : SPOTS.table; go(sp.stand); steps.push({ t: 'face', yaw: sp.yaw }, { t: 'reach', target: sp.target }, { t: 'place', what: 'cup', at: to }); carry = null; };
  const takeOffHeadset = () => { const sp = SPOTS.headsetDesk; go(sp.stand); steps.push({ t: 'face', yaw: sp.yaw }, { t: 'equip', on: false }, { t: 'place', what: 'headset', at: 'desk', target: sp.target }); };
  if (st.seat) {
    steps.push({ t: 'stand', seat: st.seat });
    pos = st.seat === 'sofa' ? { ...SPOTS.sofa.front } : st.seat === 'floor' ? { ...SPOTS.floor.front } : { ...SPOTS.chair.side };
    if (st.seat === 'sofa' && carry === 'book') { steps.push({ t: 'face', yaw: -Math.PI / 2 }, { t: 'place', what: 'book', at: 'sofa' }); carry = null; } // ソファのほう(-x)を向いて、本を置く // 読んでいた本は、ソファの上へ
    if (st.seat === 'chair' && st.headset === 'head') takeOffHeadset();
    if (st.seat === 'floor' && st.synthAt === 'floor') { // 床のシンセを持ち上げて、壁へ立てかけ直す
      go(SPOTS.floor.pickup); steps.push({ t: 'face', yaw: Math.PI }, { t: 'reach', target: { x: SPOTS.floor.synth.x, y: 0.2, z: SPOTS.floor.synth.z + 0.1 } }, { t: 'pick', what: 'synth', from: 'floor' }); carry = 'synth';
    }
  }
  if (carry === 'cup') putCup(opt.cupTo === 'desk' ? 'desk' : 'table');
  if (carry === 'synth') { go(SPOTS.synth.stand); steps.push({ t: 'face', yaw: SPOTS.synth.yaw }, { t: 'place', what: 'synth', at: 'wall' }); carry = null; }
  if (carry === 'kb') { go(SPOTS.kb.stand); steps.push({ t: 'face', yaw: SPOTS.kb.yaw }, { t: 'place', what: 'kb', at: 'wall' }); carry = null; }
  if (carry === 'book') { go(SPOTS.sofa.front); steps.push({ t: 'face', yaw: -Math.PI / 2 }, { t: 'place', what: 'book', at: 'sofa' }); carry = null; } // 立ったまま持っている(途中)。ソファの上へ置きに行く
  if (carry === 'headset') { const sp = SPOTS.headsetDesk; go(sp.stand); steps.push({ t: 'face', yaw: sp.yaw }, { t: 'place', what: 'headset', at: 'desk', target: sp.target }); carry = null; }
  if (!st.seat && st.headset === 'head') takeOffHeadset(); // 立ったまま着けている(途中)
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
    const td = tidy(st, { cupTo: 'desk' }); const steps = [...td.steps]; let pos = td.pos;
    const go = (to) => { const w = walk(pos, to); if (w) steps.push(w); pos = { x: to.x, z: to.z }; };
    if (st.cupAt === 'table' && st.carry !== 'cup') { // サイドテーブルのカップを、先に、机へ移す
      go(SPOTS.table.stand); steps.push({ t: 'face', yaw: SPOTS.table.yaw }, { t: 'reach', target: SPOTS.table.target }, { t: 'pick', what: 'cup', from: 'table' });
      go(SPOTS.cupDesk.stand); steps.push({ t: 'face', yaw: SPOTS.cupDesk.yaw }, { t: 'reach', target: SPOTS.cupDesk.target }, { t: 'place', what: 'cup', at: 'desk' });
    }
    if ((st.headset || 'desk') === 'desk') { // 机の上のヘッドセットを、頭にかけてから、座る
      const sp = SPOTS.headsetDesk; go(sp.stand); steps.push({ t: 'face', yaw: sp.yaw }, { t: 'reach', target: sp.target }, { t: 'pick', what: 'headset', from: 'desk' }, { t: 'equip', on: true });
    }
    go(SPOTS.chair.side);
    steps.push({ t: 'sit', seat: 'chair' }, { t: 'camera', view: 'monitor' }, { t: 'do', what: 'pc' });
    return steps;
  }
  if (action.type === 'cup') { // カップをクリック(または、読書中に飲みたくなる): カップを取って、ソファで飲む → サイドテーブルへ置く → (読書していたなら)本を取って再開
    if (st.carry === 'cup' && st.seat === 'sofa') return [];
    const resume = st.carry === 'book' && st.seat === 'sofa';
    const td = tidy(st); const steps = [...td.steps]; let pos = td.pos;
    const go = (to) => { const w = walk(pos, to); if (w) steps.push(w); pos = { x: to.x, z: to.z }; };
    const from = st.cupAt === 'table' ? 'table' : 'desk', sp = from === 'table' ? SPOTS.table : SPOTS.cupDesk;
    go(sp.stand); steps.push({ t: 'face', yaw: sp.yaw }, { t: 'reach', target: sp.target }, { t: 'pick', what: 'cup', from });
    go(SPOTS.sofa.front); steps.push({ t: 'sit', seat: 'sofa' }, { t: 'do', what: 'drink', dur: DRINK_TOTAL(3) });
    steps.push({ t: 'stand', seat: 'sofa' }); pos = { ...SPOTS.sofa.front }; go(SPOTS.table.stand);
    steps.push({ t: 'face', yaw: SPOTS.table.yaw }, { t: 'reach', target: SPOTS.table.target }, { t: 'place', what: 'cup', at: 'table' }); go(SPOTS.sofa.front); steps.push({ t: 'sit', seat: 'sofa' });
    if (resume) steps.push({ t: 'reach', target: { x: -2.95, y: 0.5, z: 2.1 } }, { t: 'pick', what: 'book', from: 'sofa', keep: true }, { t: 'do', what: 'read', dur: 40 + rand() * 40 });
    return steps;
  }
  if (action.type === 'lamp') { // ランプのスイッチを入れる(入っていれば、切る)。そのあと、ソファへ
    const td = tidy(st); const steps = [...td.steps]; let pos = td.pos;
    const w = walk(pos, SPOTS.lamp.stand); if (w) steps.push(w); pos = { ...SPOTS.lamp.stand };
    steps.push({ t: 'face', yaw: SPOTS.lamp.yaw }, { t: 'reach', target: SPOTS.lamp.target }, { t: 'toggle', what: 'lamp' });
    const w2 = walk(pos, SPOTS.sofa.front); if (w2) steps.push(w2); steps.push({ t: 'sit', seat: 'sofa' }); return steps;
  }
  if (action.type === 'synth') { // 大きなシンセ(14.2kg): 重そうに運んで、床へ寝かせ、床に座って弾く
    if (st.seat === 'floor' && st.synthAt === 'floor') return [];
    const td = tidy(st); const steps = [...td.steps]; let pos = td.pos;
    const w = walk(pos, SPOTS.synth.stand); if (w) steps.push(w); pos = { ...SPOTS.synth.stand };
    steps.push({ t: 'face', yaw: SPOTS.synth.yaw }, { t: 'reach', target: { x: -0.95, y: 0.6, z: 6.85 } }, { t: 'pick', what: 'synth', from: 'wall' });
    const w2 = walk(pos, SPOTS.floor.front); if (w2) steps.push({ ...w2, heavy: true });
    steps.push({ t: 'sit', seat: 'floor' }, { t: 'do', what: 'floorplay', dur: 80 + rand() * 60 }); return steps;
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
    const stand = shelfStand(shelf, rand() * 2 - 1);
    let steps = [], pos;
    if (st.carry === 'book') { // 読んでいる(持っている)本は、先に、この本棚へ戻す。そのあとで、別の本を取る
      pos = { x: st.x, z: st.z };
      if (st.seat) { steps.push({ t: 'stand', seat: st.seat }); pos = st.seat === 'sofa' ? { ...SPOTS.sofa.front } : { ...SPOTS.chair.side }; }
      const w0 = walk(pos, stand); if (w0) steps.push(w0); pos = { x: stand.x, z: stand.z };
      steps.push({ t: 'face', yaw: stand.yaw }, { t: 'place', what: 'book', at: 'shelf', shelf: shelf.id });
    } else {
      const td = tidy(st); steps = [...td.steps]; pos = td.pos;
      const w = walk(pos, stand); if (w) steps.push(w); pos = { x: stand.x, z: stand.z };
      steps.push({ t: 'face', yaw: stand.yaw });
    }
    steps.push({ t: 'reach' }, { t: 'pick', what: 'book', shelf: shelf.id });
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

// ---------------------------------------------------------------- 窓の外の街の、空と明かり(実時間)
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mixC = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
// 時刻(0〜24)ごとの空: top=天頂 mid=中ほど hor=地平線 bld=ビルの色 glass=窓ガラス night=夜の度合い(明かり・星)
const SKY_KEYS = [
  { h: 0, top: hex(0x070a1c), mid: hex(0x141b3f), hor: hex(0x2a2f5e), bld: hex(0x1d2142), glass: hex(0x232a52), night: 1 },
  { h: 5, top: hex(0x0c1230), mid: hex(0x2b2f63), hor: hex(0x5b4a7a), bld: hex(0x252a52), glass: hex(0x2c3460), night: 0.9 },
  { h: 6.2, top: hex(0x34508f), mid: hex(0xd68f8a), hor: hex(0xffc58a), bld: hex(0x4a4f78), glass: hex(0x7d8fb6), night: 0.35 },
  { h: 8, top: hex(0x5f9be0), mid: hex(0xa9d1f2), hor: hex(0xe3f1fa), bld: hex(0x8b97b5), glass: hex(0x9cc3e6), night: 0 },
  { h: 16, top: hex(0x5f9be0), mid: hex(0xa9d1f2), hor: hex(0xf2f1e4), bld: hex(0x8b97b5), glass: hex(0x9cc3e6), night: 0 },
  { h: 17.8, top: hex(0x3f5fa8), mid: hex(0xe39a6a), hor: hex(0xffc47a), bld: hex(0x55507a), glass: hex(0xc6a07a), night: 0.25 },
  { h: 19.2, top: hex(0x141a45), mid: hex(0x5a3f78), hor: hex(0xd0695a), bld: hex(0x2f2b58), glass: hex(0x3a3a68), night: 0.8 },
  { h: 20.5, top: hex(0x070a1c), mid: hex(0x141b3f), hor: hex(0x2a2f5e), bld: hex(0x1d2142), glass: hex(0x232a52), night: 1 },
  { h: 24, top: hex(0x070a1c), mid: hex(0x141b3f), hor: hex(0x2a2f5e), bld: hex(0x1d2142), glass: hex(0x232a52), night: 1 },
];
/** 実時刻(時, 0〜24 の小数)から、空と街の色・夜の度合いを返す(色は [r,g,b] の0〜255)。 */
export function skyState(hour) {
  const h = ((hour % 24) + 24) % 24; let i = 0; while (i < SKY_KEYS.length - 2 && h >= SKY_KEYS[i + 1].h) i++;
  const a = SKY_KEYS[i], b = SKY_KEYS[i + 1], k = clamp01((h - a.h) / (b.h - a.h || 1));
  const kk = smoothstep(k); const o = {};
  for (const key of ['top', 'mid', 'hor', 'bld', 'glass']) o[key] = mixC(a[key], b[key], kk);
  o.night = a.night + (b.night - a.night) * kk; return o;
}

// ---------------------------------------------------------------- 振り子時計(実時間)
/** 時計の針の角度(rad。12時の向きが0、時計まわりが正)。 */
export function clockAngles(date) {
  const h = date.getHours() % 12, m = date.getMinutes(), s = date.getSeconds() + date.getMilliseconds() / 1000;
  return { hour: ((h + m / 60) / 12) * Math.PI * 2, minute: ((m + s / 60) / 60) * Math.PI * 2, second: (s / 60) * Math.PI * 2 };
}
/** 振り子の振れ角(rad)。周期2秒。 */
export const pendulumAngle = (tSec, amp = 0.2) => amp * Math.sin((tSec / 2) * Math.PI * 2);

// ---------------------------------------------------------------- 飲む動き(ソファで)。カップを口へ → 傾けて飲む → 戻す、を数回
export const DRINK = { lift: 1.1, sip: 1.7, lower: 1.1, rest: 1.3, lead: 0.6 };
export const DRINK_CYCLE = DRINK.lift + DRINK.sip + DRINK.lower + DRINK.rest;
export const DRINK_TOTAL = (n = 3) => DRINK.lead + n * DRINK_CYCLE;
/** t(秒)での、カップの位置(0=手元・1=口もと)・傾き(0〜1)・のけぞり(0〜1)・口を開けるか。 */
export function drinkState(t) {
  if (t < DRINK.lead) return { pos: 0, tilt: 0, headBack: 0, mouth: false, cycle: 0 };
  const u = (t - DRINK.lead) % DRINK_CYCLE, cycle = Math.floor((t - DRINK.lead) / DRINK_CYCLE);
  if (u < DRINK.lift) { const k = smoothstep(u / DRINK.lift); return { pos: k, tilt: k, headBack: k, mouth: false, cycle }; }
  const us = u - DRINK.lift; if (us < DRINK.sip) return { pos: 1, tilt: 1 + 0.15 * Math.sin(us * 3), headBack: 1, mouth: us > 0.3 && us < 1.1, cycle };
  const ud = us - DRINK.sip; if (ud < DRINK.lower) { const k = smoothstep(ud / DRINK.lower); return { pos: 1 - k, tilt: 1 - k, headBack: 1 - k, mouth: false, cycle }; }
  return { pos: 0, tilt: 0, headBack: 0, mouth: false, cycle };
}
