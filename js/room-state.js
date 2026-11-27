// room-state.js (v1.124) — 「部屋の状態(room_state)」: どの家具を持っていて(owned)、どれを部屋に置いていて(placed)、どこに置いたか。
//   画面にも three.js にも依存しない(Nodeで試験できる)。部屋(My Room)も、将来のドールハウスの編集画面も、この1つのデータだけを読み書きする
//   (2つの部屋が、別々の状態を持って、あとから、そろえる、ということはしない)。
//   ・owned: 持っている物。初期から部屋にある物(デスク一式)と、Dollhouse に初めから入っている物(初期セット・初めから入っている未設置の物)と、
//     地形から回収して、家具リストに登録した物。同じ物を何個回収しても、1つ。
//   ・placed: 部屋に置いた物と、その置き場所。床の物は { x, z, ry }、壁の飾りは { wall, u, y }。置いた物は、必ず owned。
//     他の家具に付く物(ゲーム機=テレビ台の上・机の上の小物)は、付いている家具が置いてある時だけ、置ける。
//   ・props: 家具ごとの設定(カーペットの色・額の種類と色・コルクボードのメモなど)。単純な値だけ。
//   ・windowView: 窓の外の景色('A' = 東京ふうの街 / 'B' = 初めから入っている、もう1つの景色。まだ作っていない)。
//   ・初期から部屋にある物(core: デスク一式)は、いつも置いてあり、外せない。置き場所を動かせない物(movable:false)は、既定の場所のまま。
//   ここから、置いてある物だけのレイアウト(room-layout.js の makeLayout)を作り、部屋は、そのレイアウトで組み立てる。
//   3つの状態: ① Dollhouse を設置する前(presetMinimal: デスク一式だけ) ② Dollhouse を初めて開いた時(presetStarter: 壁の飾りなどの初期セットが現れ、
//   初期セットの未設置の物が、家具リストに入る) ③ 全部入り(presetAll: v1.123 までの部屋。試験・確認用)。
//   保存(セーブ)への組み込みは、ドールハウスの実装のとき(保存の範囲=ワールドごとか、共通か、を、そのとき決める)。ここでは、形(serialize/parse)だけ。
import { ROOM, FURNITURE, FURNITURE_BY_ID, CORE_IDS, makeLayout, idsBySource, isPlaceable, isWallItem, clampWall } from './room-layout.js';

export const ROOM_STATE_VERSION = 2;
const PI = Math.PI;
const MARGIN = 0; // 置き場所は、部屋の壁の中に収める(壁ぎわの家具=本棚などが、既定で壁にぴったり付くので、余白は、とらない)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrapAngle = (a) => { let r = a % (2 * PI); if (r > PI) r -= 2 * PI; if (r < -PI) r += 2 * PI; return r; };
const defaultPlace = (id) => ({ ...FURNITURE_BY_ID[id].place });
const known = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(FURNITURE_BY_ID, id);
const movable = (id) => known(id) && FURNITURE_BY_ID[id].movable !== false;
const ORDER = FURNITURE.map((f) => f.id);

const MAX_PROP_KEYS = 16, MAX_KEY = 40, MAX_STR = 2000;
/** 家具ごとの設定を、単純な値(文字・数・真偽)だけにする。キーは16個まで・文字は2000字まで。 */
export function sanitizeProps(p) {
  const out = {}; if (!p || typeof p !== 'object' || Array.isArray(p)) return out;
  let n = 0;
  for (const k of Object.keys(p)) {
    if (n >= MAX_PROP_KEYS) break; if (k.length === 0 || k.length > MAX_KEY) continue; const v = p[k];
    if (typeof v === 'string') out[k] = v.slice(0, MAX_STR); else if (isNum(v)) out[k] = v; else if (typeof v === 'boolean') out[k] = v; else continue;
    n++;
  }
  return out;
}

/** どんな入力も、正しい room_state にする(知らない家具は捨てる・数でない置き場所は既定へ・壁の外は内側へ・core は必ず置く・付く家具が無い物は外す)。 */
export function normalizeState(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const owned = new Set(CORE_IDS), placed = {};
  if (Array.isArray(src.owned)) for (const id of src.owned) if (known(id)) owned.add(id);
  const srcPlaced = src.placed && typeof src.placed === 'object' && !Array.isArray(src.placed) ? src.placed : {};
  for (const id of Object.keys(srcPlaced)) {
    if (!known(id) || !isPlaceable(id)) continue;
    const q = srcPlaced[id], d = defaultPlace(id);
    if (isWallItem(id)) placed[id] = clampWall(q, d);
    else if (!movable(id) || !q || !isNum(q.x) || !isNum(q.z)) placed[id] = d;
    else placed[id] = { x: clamp(q.x, ROOM.x0 + MARGIN, ROOM.x1 - MARGIN), z: clamp(q.z, ROOM.z0 + MARGIN, ROOM.z1 - MARGIN), ry: isNum(q.ry) ? wrapAngle(q.ry) : d.ry };
    owned.add(id);
  }
  for (const id of CORE_IDS) if (!placed[id]) placed[id] = defaultPlace(id);
  for (const id of Object.keys(placed)) { const par = FURNITURE_BY_ID[id].attachedTo; if (par && !placed[par]) delete placed[id]; } // 付く家具が、置いてなければ、置けない(持ち物には、残る)
  const props = {}; const srcProps = src.props && typeof src.props === 'object' && !Array.isArray(src.props) ? src.props : {};
  for (const id of Object.keys(srcProps)) if (known(id) && owned.has(id)) { const sp = sanitizeProps(srcProps[id]); if (Object.keys(sp).length) props[id] = sp; }
  const ownedList = ORDER.filter((id) => owned.has(id));
  const windowView = src.windowView === 'B' && owned.has('viewB') ? 'B' : 'A';
  return { version: ROOM_STATE_VERSION, owned: ownedList, placed, props, windowView };
}

const stateOf = (ownedIds, placedIds) => { const placed = {}; for (const id of placedIds) placed[id] = defaultPlace(id); return normalizeState({ owned: ownedIds, placed }); };
/** ① Dollhouse を設置する前の部屋(デスク一式だけ。殺風景)。新しい世界は、ここから始まる。 */
export function presetMinimal() { return normalizeState({}); }
export const presetBeforeDollhouse = presetMinimal;
/** ② Dollhouse を、初めて開いた時: 設置済みの初期セット(壁の飾りなど)が現れ、初めから入っている未設置の物(緑のソファ・本棚セット・カーペット・クッション・MIDIキーボード・ジャックオーランタン・景色B)が、家具リストに入る。 */
export function presetStarter() { const starter = idsBySource('starter'); return stateOf([...CORE_IDS, ...starter, ...idsBySource('stock')], [...CORE_IDS, ...starter]); }
/** ③ 全部入り(v1.123 までの部屋と同じ。全家具が、既定の場所にある)。試験・確認用。 */
export function presetAll() { const placeable = ORDER.filter(isPlaceable); return stateOf(ORDER, placeable); }
/** URL の ?roomset=min(minimal / bare)で、設置前の殺風景な部屋、?roomset=starter で、初期セットが入った部屋。それ以外は、全部入り。 */
export function resolveRoomSet(name) { const n = String(name == null ? '' : name).toLowerCase(); return n === 'min' || n === 'minimal' || n === 'bare' ? presetMinimal() : n === 'starter' ? presetStarter() : presetAll(); }

/** 回収した物を、持ち物(家具リスト)へ登録する。同じ物は、何個でも、1つ。 */
export function ownItem(state, id) { const s = normalizeState(state); if (!known(id)) return s; return normalizeState({ ...s, owned: [...s.owned, id] }); }
/** 持っている物を、部屋に置く(pos を省くと、既定の場所。壁の飾りは { u, y })。持っていない物・置かない物(景色)は、置けない(そのまま)。 */
export function placeItem(state, id, pos) {
  const s = normalizeState(state); if (!known(id) || !isPlaceable(id) || !s.owned.includes(id)) return s;
  const d = defaultPlace(id), q = pos || {};
  const place = isWallItem(id) ? { wall: d.wall, u: isNum(q.u) ? q.u : d.u, y: isNum(q.y) ? q.y : d.y } : { x: isNum(q.x) ? q.x : d.x, z: isNum(q.z) ? q.z : d.z, ry: isNum(q.ry) ? q.ry : d.ry };
  return normalizeState({ ...s, placed: { ...s.placed, [id]: place } });
}
/** 部屋に置いた物を、外す(持ち物には、残る)。core は、外せない。その家具に付いている物(テレビ台のゲーム機など)も、外れる。 */
export function removeItem(state, id) {
  const s = normalizeState(state); if (!known(id) || CORE_IDS.includes(id)) return s;
  const placed = { ...s.placed }; delete placed[id]; return normalizeState({ ...s, placed });
}
/** 家具ごとの設定(色・額の種類・メモなど)を、まるごと入れ替える。持っていない家具には、付けられない。 */
export function setProps(state, id, props) { const s = normalizeState(state); if (!known(id) || !s.owned.includes(id)) return s; return normalizeState({ ...s, props: { ...s.props, [id]: props } }); }
/** 窓の外の景色を選ぶ('B' は、持っている時だけ)。 */
export function setWindowView(state, view) { return normalizeState({ ...normalizeState(state), windowView: view }); }
/** 置いてある物のid。 */
export const placedIds = (state) => Object.keys(normalizeState(state).placed);

/** room_state → 置いてある物だけのレイアウト。 */
export function layoutFromState(state) {
  const s = normalizeState(state);
  const layout = makeLayout(s.placed, { only: Object.keys(s.placed) });
  layout.windowView = s.windowView; layout.props = s.props; // 部屋が、景色や家具の設定を読む
  return layout;
}

/** 保存用の文字列。 */
export function serializeRoomState(state) { return JSON.stringify(normalizeState(state)); }
/** 文字列 → room_state。壊れていたら null(呼ぶ側で、初期の部屋にする)。知らない版の物も、できる範囲で読む(v1 の物も読める)。 */
export function parseRoomState(text) { try { const o = JSON.parse(text); return o && typeof o === 'object' ? normalizeState(o) : null; } catch (e) { return null; } }
