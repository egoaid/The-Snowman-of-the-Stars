// room-melody.js (v1.116) — 部屋で雪だるまが弾く、簡単なメロディの自動生成(純粋な計算。Nodeで試験できる)。
//   piano: ピアノ。やさしい曲(右手のメロディ + 左手のアルペジオ。I–vi–IV–V の進行。8小節ごとに、ゆるやかに終わる)。
//   brass: シンセブラス。力強いリフ(ペンタトニック + 小節ごとの和音のスタブ)。
// 同じ seed なら、同じメロディ。ずっと弾き続けられるように、next() で、つぎの8小節を返す。
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const MAJOR = [0, 2, 4, 5, 7, 9, 11], MINOR_PENTA = [0, 3, 5, 7, 10];
const deg = (root, scale, idx) => root + 12 * Math.floor(idx / scale.length) + scale[((idx % scale.length) + scale.length) % scale.length];

export const MELODY_KINDS = {
  piano: { bpm: 76, beats: 4, bars: 8, roots: [60, 65, 67, 62], prog: [[0, 'M'], [9, 'm'], [5, 'M'], [7, 'M'], [0, 'M'], [9, 'm'], [7, 'M'], [0, 'M']], scale: MAJOR },
  brass: { bpm: 108, beats: 4, bars: 8, roots: [50, 55, 52], prog: [[0, 'm'], [0, 'm'], [8, 'M'], [10, 'M'], [0, 'm'], [0, 'm'], [10, 'M'], [0, 'm']], scale: MINOR_PENTA },
};
const PIANO_RHYTHMS = [[1, 1, 1, 1], [1.5, 0.5, 1, 1], [1, 0.5, 0.5, 1, 1], [2, 1, 1], [0.5, 0.5, 1, 2], [1, 1, 2], [0.5, 0.5, 0.5, 0.5, 1, 1]];
const BRASS_RHYTHMS = [[0.5, 0.5, 1, 0.5, 0.5, 1], [1, 0.5, 0.5, 1, 1], [0.75, 0.75, 0.5, 1, 1], [1.5, 0.5, 2], [0.5, 0.5, 0.5, 0.5, 1, 1]];

/** 調に合う音かどうか(試験用)。root から見た、半音の集合。 */
export function pitchClassesOf(kind, root) {
  const set = new Set(); const K = MELODY_KINDS[kind];
  if (kind === 'piano') for (const s of MAJOR) set.add((root + s) % 12);
  else { for (const s of MINOR_PENTA) set.add((root + s) % 12); for (const [off, q] of K.prog) { const r = (root + off) % 12; set.add(r); set.add((r + (q === 'm' ? 3 : 4)) % 12); set.add((r + 7) % 12); } }
  return set;
}

/** メロディの生成器。next() → { notes: [{t, dur, midi, vel, hand}], length, root }(t・dur は秒)。 */
export function createMelody({ kind = 'piano', seed = 1 } = {}) {
  const K = MELODY_KINDS[kind] || MELODY_KINDS.piano; let phraseNo = 0;
  const r = rng(seed * 2654435761 + 17), root = K.roots[Math.floor(r() * K.roots.length)];
  const beat = 60 / K.bpm; let pos = kind === 'piano' ? 4 : 5; // 音階の中の位置(中ほど)
  return {
    kind, root, bpm: K.bpm, barSec: beat * K.beats,
    next() {
      const notes = []; const R = rng(seed * 1013904223 + phraseNo * 97 + 3); phraseNo++;
      for (let bar = 0; bar < K.bars; bar++) {
        const [off, q] = K.prog[bar], cr = root + off, third = q === 'm' ? 3 : 4, t0 = bar * K.beats * beat, last = bar === K.bars - 1;
        const rhythm = last ? (kind === 'piano' ? [2, 2] : [1, 3]) : (kind === 'piano' ? PIANO_RHYTHMS : BRASS_RHYTHMS)[Math.floor(R() * (kind === 'piano' ? PIANO_RHYTHMS.length : BRASS_RHYTHMS.length))];
        let tb = 0;
        rhythm.forEach((len, i) => {
          if (last && i === rhythm.length - 1) pos = kind === 'piano' ? 7 : 5; // 終わりは、主音(オクターブ上)で止まる
          else if (i === 0 && !last) { // 小節の頭は、和音に近い音へ
            const cand = []; for (let k = pos - 2; k <= pos + 2; k++) { const m = deg(root, K.scale, k); if (kind === 'piano' ? [0, third, 7].includes(((m - cr) % 12 + 12) % 12) : true) cand.push(k); } if (cand.length) pos = cand[Math.floor(R() * cand.length)];
          } else { const step = R() < 0.78 ? (R() < 0.5 ? 1 : -1) * (R() < 0.8 ? 1 : 2) : (R() < 0.5 ? 3 : -3); pos += step; }
          const lo = kind === 'piano' ? 1 : 2, hi = kind === 'piano' ? 11 : 9; if (pos < lo) pos = lo + 1; if (pos > hi) pos = hi - 1;
          const midi = deg(root, K.scale, pos), accent = i === 0 ? 0.1 : 0;
          const vel = kind === 'piano' ? 0.5 + R() * 0.18 + accent : 0.72 + R() * 0.2 + accent;
          notes.push({ t: t0 + tb * beat, dur: len * beat * (kind === 'piano' ? 0.95 : 0.88), midi, vel: Math.min(1, vel), hand: 'R' });
          tb += len;
        });
        if (kind === 'piano') { // 左手: 8分音符のアルペジオ(根音・5度・オクターブ・3度…)
          const pat = [0, 7, 12, third + 12, 7, 12, third + 12, 7];
          pat.forEach((iv, i) => notes.push({ t: t0 + i * 0.5 * beat, dur: (i === 0 ? 1.4 : 0.9) * 0.5 * beat * (i === 0 ? 2 : 1), midi: cr - 12 + iv, vel: 0.3 + (i === 0 ? 0.1 : 0) + R() * 0.05, hand: 'L' }));
        } else { // 和音のスタブ(小節の1拍目と、2拍目の裏): 根音・5度・オクターブ
          for (const at of last ? [0] : [0, 1.5]) for (const iv of [0, 7, 12]) notes.push({ t: t0 + at * beat, dur: 0.3 * beat, midi: cr + iv, vel: 0.8 + R() * 0.1, hand: 'S' });
        }
      }
      notes.sort((a, b) => a.t - b.t || a.midi - b.midi);
      return { notes, length: K.bars * K.beats * beat, root };
    },
  };
}
