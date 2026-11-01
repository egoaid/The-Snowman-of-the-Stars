// notes.js (v1.97)  — 音楽(演奏の土台 1-A)の、画面に依存しないきまり。Nodeで試験できる。
//   ・音の高さ(MIDIノート番号)と周波数・PCキーボードの鍵盤配置・MIDIメッセージの読み取り
//   ・演奏する自然物(7種類)と、近くにある自然物からの自動選択
//   構想: 世界そのものが楽器。キーボードは音を作る装置ではなく、世界の音を奏でる入力装置(Music-and-3D-Audio-Concept.md)。

/** 演奏できる自然物。木=木琴 / 川=水滴 / 花=幻想的な音 / 虫=虫の声 / 雪=澄んだベル / 星の灯り=鈴・チャイム / 石=打楽器 */
export const SOURCES = ['tree', 'river', 'flower', 'insect', 'snow', 'star', 'stone'];
export const SOURCE_ICON = { tree: '🌳', river: '💧', flower: '🌸', insect: '🦗', snow: '❄️', star: '⭐', stone: '🪨' };

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (m) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
export const isBlackKey = (m) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);

// ---------- PCキーボード(2段のピアノ配置) ----------
// 下の段 Z S X D C V G B H N J M , = C3〜C4 / 上の段 Q 2 W 3 E R 5 T 6 Y 7 U I = C4〜C5。(黒鍵は S D G H J と 2 3 5 6 7)
const LOWER = { KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12 };
const UPPER = { KeyQ: 0, Digit2: 1, KeyW: 2, Digit3: 3, KeyE: 4, KeyR: 5, Digit5: 6, KeyT: 7, Digit6: 8, KeyY: 9, Digit7: 10, KeyU: 11, KeyI: 12 };
export const KEY_BASE_LOWER = 48, KEY_BASE_UPPER = 60;
export const OCTAVE_MIN = -2, OCTAVE_MAX = 2;
/** キーのコード → MIDIノート番号(鍵盤でなければ null)。octaveShift は -2〜+2。 */
export function keyToMidi(code, octaveShift = 0) {
  const sh = Math.max(OCTAVE_MIN, Math.min(OCTAVE_MAX, octaveShift | 0)) * 12;
  let m = null;
  if (code in LOWER) m = KEY_BASE_LOWER + LOWER[code]; else if (code in UPPER) m = KEY_BASE_UPPER + UPPER[code];
  if (m === null) return null;
  m += sh;
  return m >= 0 && m <= 127 ? m : null;
}
export const isNoteKey = (code) => code in LOWER || code in UPPER;

// ---------- MIDI ----------
/** MIDIの3バイト → { type:'on'|'off'|'sustain'|'other', note, velocity(0〜1), channel }。note-on でベロシティ0は note-off。 */
export function parseMidiMessage(data) {
  if (!data || data.length < 1) return { type: 'other' };
  const status = data[0] & 0xf0, channel = data[0] & 0x0f;
  const d1 = data.length > 1 ? data[1] & 0x7f : 0, d2 = data.length > 2 ? data[2] & 0x7f : 0;
  if (status === 0x90) return d2 > 0 ? { type: 'on', note: d1, velocity: d2 / 127, channel } : { type: 'off', note: d1, velocity: 0, channel };
  if (status === 0x80) return { type: 'off', note: d1, velocity: d2 / 127, channel };
  if (status === 0xb0 && d1 === 64) return { type: 'sustain', value: d2 >= 64, channel };
  return { type: 'other' };
}

// ---------- 近くの自然物から、演奏する音を自動で決める ----------
export const NEAR = { river: 6, star: 4, stone: 2.5, tree: 4 }; // この距離(m)より近いと、その自然物の音になる
/**
 * ctx = { riverDist, torchDist, rockDist, treeDist(幹までの距離), onFlowers, snowDepth, winter } (距離は m。なければ Infinity)
 * いちばん「近さの割合」が小さい自然物を選ぶ。どれも遠ければ、雪のある時期は雪、それ以外は虫。
 */
export function pickNatureSource(ctx) {
  const c = ctx || {};
  const cand = [
    ['river', (c.riverDist ?? Infinity) / NEAR.river],
    ['star', (c.torchDist ?? Infinity) / NEAR.star],
    ['stone', (c.rockDist ?? Infinity) / NEAR.stone],
    ['tree', (c.treeDist ?? Infinity) / NEAR.tree],
    ['flower', c.onFlowers ? 0.5 : Infinity],
  ];
  let best = null, bs = 1;
  for (const [id, s] of cand) if (s < bs) { bs = s; best = id; }
  if (best) return best;
  return (c.snowDepth ?? 0) > 0.3 || c.winter ? 'snow' : 'insect';
}
