import { createEmoteBrain } from './js/visual3d/emote-brain.js';
let seed = 12345; const rng = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('NG', m); } else console.log('ok', m); };

// 1) 手動「寝る」: stand → sitting-down → sit → yawn → lying-down → sleep(必ず座ってから)
{
  const b = createEmoteBrain({ rng });
  const seq = []; const note = () => { if (seq[seq.length - 1] !== b.state) seq.push(b.state); };
  b.request('sleep'); note();
  for (let i = 0; i < 60 * 30; i++) { b.update(1 / 60, { isNight: true, canLie: true }); note(); if (b.state === 'sleep') break; }
  console.log(seq.join(' > '));
  ok(seq.join(',') === 'sitting-down,sit,yawn,lying-down,sleep', '寝る: 座る→ぼーっと→あくび→仰向け→睡眠の順');
  // 寝返りが起きる
  let rolled = false;
  for (let i = 0; i < 60 * 120; i++) { b.update(1 / 60, { isNight: true }); if (b.state === 'roll') rolled = true; if (b.state !== 'sleep' && b.state !== 'roll') break; }
  ok(rolled, '寝ている間に寝返りが起きる');
  // 目を覚ます: 起きる時は、仰向け(または横から仰向け)→上体を起こす→座る
  const seq2 = []; const note2 = () => { if (seq2[seq2.length - 1] !== b.state) seq2.push(b.state); };
  note2();
  for (let i = 0; i < 60 * 40 && b.state !== 'sit'; i++) { b.update(1 / 60, { isNight: true }); note2(); }
  console.log(seq2.join(' > '));
  ok(seq2.includes('sitting-up') && !seq2.includes('standing-up'), '起きる時は、上体を起こして座る体勢になる(いきなり立たない)');
  b.request('stand');
  const seq3 = [];
  for (let i = 0; i < 60 * 5; i++) { b.update(1 / 60, {}); if (seq3[seq3.length - 1] !== b.state) seq3.push(b.state); }
  ok(seq3.join(',') === 'standing-up,stand', '座った状態から立つ');
}
// 2) 寝ている最中に「立つ」: 起きる→座る→立つ。いきなり立たない
{
  const b = createEmoteBrain({ rng });
  b.request('sleep');
  for (let i = 0; i < 60 * 40 && b.state !== 'sleep'; i++) b.update(1 / 60, { canLie: true });
  const seq = [];
  b.request('stand');
  for (let i = 0; i < 60 * 15; i++) { b.update(1 / 60, {}); if (seq[seq.length - 1] !== b.state) seq.push(b.state); if (b.state === 'stand') break; }
  console.log(seq.join(' > '));
  const iSit = seq.indexOf('sitting-up'), iStand = seq.indexOf('standing-up');
  ok(iSit >= 0 && iStand > iSit && seq[seq.length - 1] === 'stand', '寝ている時に立つ: 上体を起こす→立つ');
}
// 3) 仰向けになれない場所: あくびのあと寝ずに座ったまま
{
  const b = createEmoteBrain({ rng });
  b.request('sleep');
  let lied = false;
  for (let i = 0; i < 60 * 40; i++) { b.update(1 / 60, { canLie: false }); if (b.state === 'lying-down' || b.state === 'sleep') lied = true; }
  ok(!lied, '場所が無い時は、寝ない');
}
// 4) 見守り: 勝手に座り、座るだけ/昼寝/夜寝がある。寝すぎない(立っている時間のほうが長い)
{
  const b = createEmoteBrain({ rng });
  let standT = 0, downT = 0, sleepT = 0, sessions = 0, sleeps = 0, prev = 'stand', night = false;
  const total = 60 * 3600 * 2; // 2時間ぶん(1/60秒刻み、実時間120分)
  for (let i = 0; i < total; i++) {
    night = Math.floor(i / (60 * 600)) % 2 === 1; // 10分ごとに昼夜
    b.update(1 / 60, { autoAllowed: true, calm: true, isNight: night, canLie: true });
    if (b.state === 'stand') standT++; else downT++;
    if (b.isSleeping()) sleepT++;
    if (prev === 'stand' && b.state !== 'stand') sessions++;
    if (prev !== 'sleep' && b.state === 'sleep') sleeps++;
    prev = b.state;
  }
  const mins = (n) => (n / 60 / 60).toFixed(1);
  console.log(`2時間: 立つ${mins(standT)}分 / 座る・寝る${mins(downT)}分 / うち睡眠${mins(sleepT)}分 / 休憩${sessions}回 / 睡眠${sleeps}回`);
  ok(sessions >= 12 && sessions <= 60, '2時間に、休憩が適度な回数(12〜60回)');
  ok(sleeps >= 2, '睡眠が起きる');
  ok(sleepT / total >= 0.15 && sleepT / total < 0.35, '寝ている時間は約2割強(15〜35%)。以前より増えたが、寝すぎない');
  ok(downT / total >= 0.25 && downT / total < 0.5, '座る・寝る時間は3割強(25〜50%)');
}
// 5) 見守りでなくなったら(自動の休憩は)起きる。手動の休憩は勝手に起こさない
{
  const b = createEmoteBrain({ rng });
  b.request('sleep'); // manual
  for (let i = 0; i < 60 * 40 && b.state !== 'sleep'; i++) b.update(1 / 60, { canLie: true });
  b.update(1 / 60, { autoAllowed: false });
  ok(b.state === 'sleep', '手動で寝た時は、モードが変わっても起こさない');
  const c = createEmoteBrain({ rng, config: { firstRestInterval: [0.1, 0.1], sleepProbDay: 1 } });
  for (let i = 0; i < 60 * 3; i++) c.update(1 / 60, { autoAllowed: true, calm: true, canLie: true });
  ok(c.state !== 'stand', '見守りで、勝手に座り始める');
  c.update(1 / 60, { autoAllowed: false });
  for (let i = 0; i < 60 * 30; i++) c.update(1 / 60, { autoAllowed: false });
  ok(c.state === 'stand', '見守りでなくなったら、自動の休憩は立って終える');
}
// 6) pose の値が範囲内
{
  const b = createEmoteBrain({ rng });
  b.request('sleep'); let bad = false;
  for (let i = 0; i < 60 * 300; i++) { b.update(1 / 60, { canLie: true, isNight: true }); const p = b.getPose(); for (const k of ['sit','lie','yawn','eyesClosed','drowsy','breath']) if (p[k] < -0.001 || p[k] > 1.001 || !Number.isFinite(p[k])) bad = true; if (Math.abs(p.roll) > 1.001) bad = true; }
  ok(!bad, 'pose の値が範囲内(NaN なし)');
}
console.log(fails ? `\n失敗 ${fails}` : '\nすべて成功');
process.exit(fails ? 1 : 0);
