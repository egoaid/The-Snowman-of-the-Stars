// memory.js (v1.100) — 音楽の記憶(Musical Memory)。画面に依存しない(Nodeで試験できる)。
//   プレイヤーの演奏を、録音ではなく「音符の情報」として覚える。外部ファイルへは書き出さない。世界の中に残る思い出。
//   ・最後の音から5秒以上、次の音が入らなかったら、そこまでを1曲とする。自動で保存する(保存の操作はいらない)。
//   ・曲は、演奏を始めた時の自然音源(=場所)に結びつく。演奏中に動いても、曲の場所は変わらない。
//   ・場所ごとの容量は、曲数ではなく、音符の総数で決める(初期: 1か所10,000音符)。和音は、構成する音符を1つずつ数える。
//   ・あふれたら、古い曲から、1曲まるごと消す(曲の一部を切り取って残さない)。1曲だけで上限を超える曲は保存しない。
//   ・音楽の記憶は、雪だるまが、その場所で思い出して演奏するために使う(1-D)。
import { SOURCES } from './notes.js';

export const MEMORY = { capacity: 10000, gapSec: 5, minNotes: 3, maxSongNotes: 5000 };

// ---------- 保存形式(小さく) ----------
// 1音 = 8文字(36進数): 前の音からの間隔(2) + 長さ(2) + 音の高さ(2) + 強さ(1) + 音源(1)。時間は10ms単位。長さは12.9秒までに丸める。
const U = 10, T_MAX = 36 * 36 - 1;
const b36 = (v, w) => Math.max(0, Math.min(36 ** w - 1, Math.round(v))).toString(36).padStart(w, '0');
export function encodeNotes(notes) {
  let out = '', prev = 0;
  for (const n of notes) {
    const si = Math.max(0, SOURCES.indexOf(n.s));
    out += b36(Math.min(T_MAX, (n.t - prev) / U), 2) + b36(Math.min(T_MAX, n.d / U), 2) + b36(n.n, 2) + b36(n.v * 35, 1) + b36(si, 1);
    prev = n.t;
  }
  return out;
}
export function decodeNotes(str) {
  const notes = []; let t = 0;
  if (typeof str !== 'string' || str.length % 8 !== 0 || /[^0-9a-z]/.test(str)) return null;
  for (let i = 0; i < str.length; i += 8) {
    const dt = parseInt(str.slice(i, i + 2), 36) * U, d = parseInt(str.slice(i + 2, i + 4), 36) * U, m = parseInt(str.slice(i + 4, i + 6), 36), v = parseInt(str.slice(i + 6, i + 7), 36) / 35, si = parseInt(str.slice(i + 7, i + 8), 36);
    if (m > 127 || v > 1 || si >= SOURCES.length) return null;
    t += dt; notes.push({ n: m, v: Math.round(v * 100) / 100, t, d, s: SOURCES[si] });
  }
  return notes;
}

export function createMusicMemory({ capacity = MEMORY.capacity, gapSec = MEMORY.gapSec, minNotes = MEMORY.minNotes, maxSongNotes = MEMORY.maxSongNotes } = {}) {
  const places = Object.fromEntries(SOURCES.map((s) => [s, []])); // 場所(=自然音源)ごとの、古い順の曲
  let cur = null, nextId = 1;
  const held = new Map(); // 押している音: midi → 音符(まだ長さが決まっていない)
  let lastEvent = -1e9;

  const total = (place) => places[place].reduce((a, s) => a + s.notes.length, 0);

  function finalize(now) {
    if (!cur) return null;
    for (const [m, note] of held) { note.d = Math.max(0, (now - cur.start) * 1000 - note.t); held.delete(m); } // 押したままの音は、ここで終える
    const song = cur; cur = null;
    if (song.notes.length < minNotes || song.notes.length > capacity) return null; // 短すぎる・1曲で上限を超える曲は、残さない
    const list = places[song.place]; let evicted = 0;
    while (total(song.place) + song.notes.length > capacity && list.length) { list.shift(); evicted++; } // 古い曲から、1曲まるごと
    song.notes.sort((a, b) => a.t - b.t);
    delete song.start;
    list.push(song);
    return { song, evicted };
  }

  return {
    /** 音を鳴らした(鳴らなかった音は渡さない)。source=いま使っている自然音源、pos=その時の場所。 */
    noteOn(now, midi, velocity, source, pos = {}) {
      if (!places[source]) return;
      if (cur && cur.notes.length >= maxSongNotes) finalize(now); // 長すぎる曲は、ここで区切って、続きを次の曲にする
      if (held.has(midi)) { const n = held.get(midi); n.d = Math.max(0, (now - cur.start) * 1000 - n.t); held.delete(midi); } // 押し直し
      if (!cur) cur = { id: nextId++, place: source, x: +(+pos.x || 0).toFixed(1), z: +(+pos.z || 0).toFixed(1), start: now, notes: [] }; // 曲の場所は、最初の音で決まる
      const note = { n: midi, v: Math.round(Math.max(0, Math.min(1, velocity)) * 100) / 100, t: Math.round((now - cur.start) * 1000), d: 0, s: source };
      cur.notes.push(note); held.set(midi, note); lastEvent = now;
    },
    noteOff(now, midi) {
      const n = held.get(midi); if (!n || !cur) return;
      n.d = Math.max(0, Math.round((now - cur.start) * 1000) - n.t); held.delete(midi); lastEvent = now;
    },
    /** 毎フレーム呼ぶ。最後の音から gapSec 秒たったら、1曲として保存して、結果を返す(まだなら null)。 */
    tick(now) { return cur && held.size === 0 && now - lastEvent >= gapSec ? finalize(now) : null; },
    flush(now) { return finalize(now); },
    songs: (place) => (places[place] ? places[place].slice() : []),
    noteCount: (place) => (places[place] ? total(place) : 0),
    songCount: (place) => (places[place] ? places[place].length : 0),
    isRecording: () => !!cur,
    serialize() {
      const out = { v: 1, next: nextId, places: {} };
      for (const s of SOURCES) out.places[s] = places[s].map((q) => ({ id: q.id, x: q.x, z: q.z, notes: encodeNotes(q.notes) }));
      if (cur && cur.notes.length) { // 弾いている途中の曲も、残す(読み込んだ時に、1曲として終える)
        const snap = cur.notes.map((n) => ({ ...n, d: held.has(n.n) && held.get(n.n) === n ? Math.max(0, (lastEvent - cur.start) * 1000 - n.t) : n.d }));
        out.pending = { place: cur.place, x: cur.x, z: cur.z, notes: encodeNotes(snap) };
      }
      return out;
    },
    restore(data) {
      if (!data || typeof data !== 'object' || data.v !== 1) return false;
      for (const s of SOURCES) places[s] = [];
      held.clear(); cur = null;
      if (Number.isFinite(data.next)) nextId = Math.max(1, Math.floor(data.next));
      for (const s of SOURCES) for (const q of Array.isArray(data.places && data.places[s]) ? data.places[s] : []) {
        const notes = decodeNotes(q && q.notes); if (!notes || notes.length < minNotes) continue;
        places[s].push({ id: Number.isFinite(q.id) ? q.id : nextId++, place: s, x: +q.x || 0, z: +q.z || 0, notes });
        while (total(s) > capacity && places[s].length) places[s].shift(); // 壊れたデータ・上限が減った場合も、古い曲から
      }
      const p = data.pending;
      if (p && places[p.place]) { const notes = decodeNotes(p.notes); if (notes && notes.length >= minNotes && notes.length <= capacity) { const list = places[p.place]; while (total(p.place) + notes.length > capacity && list.length) list.shift(); list.push({ id: nextId++, place: p.place, x: +p.x || 0, z: +p.z || 0, notes }); } }
      return true;
    },
  };
}
