// room-state.js (v1.123) — 「部屋の状態(room_state)」: どの家具を持っていて(owned)、どれを部屋に置いていて(placed)、どこに置いたか。
//   画面にも three.js にも依存しない(Nodeで試験できる)。部屋(My Room)も、将来のドールハウスの編集画面も、この1つのデータだけを読み書きする
//   (2つの部屋が、別々の状態を持って、あとから、そろえる、ということはしない)。
//   ・owned: 地形から回収して、ドールハウスに登録した物(+初期から部屋にある物 core)。
//   ・placed: 部屋に置いた物と、その置き場所 { x, z, ry }。置いた物は、必ず owned。
//   ・初期から部屋にある物(core: デスク一式)は、いつも置いてあり、外せない。
//   ・置き場所を動かせない物(movable:false)は、既定の場所のまま。
//   ここから、置いてある物だけのレイアウト(room-layout.js の makeLayout)を作り、部屋は、そのレイアウトで組み立てる。
//   保存(セーブ)への組み込みは、ドールハウスの実装のとき(保存の範囲=ワールドごとか、共通か、を、そのとき決める)。ここでは、形(serialize/parse)だけ。
import { ROOM, FURNITURE, FURNITURE_BY_ID, CORE_IDS, makeLayout } from './room-layout.js';

export const ROOM_STATE_VERSION = 1;
const PI = Math.PI;
const MARGIN = 0; // 置き場所は、部屋の壁の中に収める(壁ぎわの家具=振り子時計・本棚などが、既定で壁にぴったり付くので、余白は、とらない)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrapAngle = (a) => { let r = a % (2 * PI); if (r > PI) r -= 2 * PI; if (r < -PI) r += 2 * PI; return r; };
const defaultPlace = (id) => ({ ...FURNITURE_BY_ID[id].place });
const known = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(FURNITURE_BY_ID, id);
const movable = (id) => known(id) && FURNITURE_BY_ID[id].movable !== false;

/** どんな入力も、正しい room_state にする(知らない家具は捨てる・数でない置き場所は既定へ・壁の外は内側へ・core は必ず置く)。 */
export function normalizeState(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const owned = new Set(CORE_IDS), placed = {};
  if (Array.isArray(src.owned)) for (const id of src.owned) if (known(id)) owned.add(id);
  const srcPlaced = src.placed && typeof src.placed === 'object' ? src.placed : {};
  for (const id of Object.keys(srcPlaced)) {
    if (!known(id)) continue;
    const q = srcPlaced[id], d = defaultPlace(id);
    if (!movable(id) || !q || !isNum(q.x) || !isNum(q.z)) placed[id] = d;
    else placed[id] = { x: clamp(q.x, ROOM.x0 + MARGIN, ROOM.x1 - MARGIN), z: clamp(q.z, ROOM.z0 + MARGIN, ROOM.z1 - MARGIN), ry: isNum(q.ry) ? wrapAngle(q.ry) : d.ry };
    owned.add(id);
  }
  for (const id of CORE_IDS) if (!placed[id]) placed[id] = defaultPlace(id);
  return { version: ROOM_STATE_VERSION, owned: FURNITURE.map((f) => f.id).filter((id) => owned.has(id)), placed };
}

/** 初期の部屋(デスク一式だけ。殺風景)。新しい世界は、ここから始まる。 */
export function presetMinimal() { return normalizeState({}); }
/** 全部入り(v1.122 までの部屋と同じ。全家具が、既定の場所にある)。試験・確認用。 */
export function presetAll() { const placed = {}; for (const f of FURNITURE) placed[f.id] = { ...f.place }; return normalizeState({ owned: Object.keys(placed), placed }); }
/** URL の ?roomset=min(または minimal / bare)で、初期の殺風景な部屋。それ以外は、全部入り。 */
export function resolveRoomSet(name) { const n = String(name == null ? '' : name).toLowerCase(); return n === 'min' || n === 'minimal' || n === 'bare' ? presetMinimal() : presetAll(); }

/** 回収した物を、持ち物(owned)へ登録する。 */
export function ownItem(state, id) { const s = normalizeState(state); if (!known(id)) return s; return normalizeState({ owned: [...s.owned, id], placed: s.placed }); }
/** 持っている物を、部屋に置く(pos を省くと、既定の場所)。持っていない物は、置けない(そのまま)。 */
export function placeItem(state, id, pos) {
  const s = normalizeState(state); if (!known(id) || !s.owned.includes(id)) return s;
  const d = defaultPlace(id), q = pos || {};
  return normalizeState({ owned: s.owned, placed: { ...s.placed, [id]: { x: isNum(q.x) ? q.x : d.x, z: isNum(q.z) ? q.z : d.z, ry: isNum(q.ry) ? q.ry : d.ry } } });
}
/** 部屋に置いた物を、外す(持ち物には、残る)。core は、外せない。 */
export function removeItem(state, id) {
  const s = normalizeState(state); if (!known(id) || CORE_IDS.includes(id)) return s;
  const placed = { ...s.placed }; delete placed[id]; return normalizeState({ owned: s.owned, placed });
}
/** 置いてある物のid。 */
export const placedIds = (state) => Object.keys(normalizeState(state).placed);

/** room_state → 置いてある物だけのレイアウト。 */
export function layoutFromState(state) { const s = normalizeState(state); return makeLayout(s.placed, { only: Object.keys(s.placed) }); }

/** 保存用の文字列。 */
export function serializeRoomState(state) { return JSON.stringify(normalizeState(state)); }
/** 文字列 → room_state。壊れていたら null(呼ぶ側で、初期の部屋にする)。知らない版の物も、できる範囲で読む。 */
export function parseRoomState(text) { try { const o = JSON.parse(text); return o && typeof o === 'object' ? normalizeState(o) : null; } catch (e) { return null; } }
