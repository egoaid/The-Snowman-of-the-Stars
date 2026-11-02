// performer.js (v1.101) — 雪だるまの自律演奏のきまり。画面に依存しない(Nodeで試験できる)。
//   ・演奏するかどうかは、雪だるまの気まぐれ(しばらく間をあけて、ときどき)。プレイヤーが指示するものではない。
//   ・演奏するのは、ランダムな音ではなく、プレイヤーが以前に弾いた曲(音楽の記憶)。記憶のない場所では、弾かない。
//   ・場所に複数の曲があれば、ランダムに選ぶ。直前に弾いた曲は、できるだけ避ける。始めたら、基本は最後まで弾く。
//   ・雨: 小雨なら弾き続ける(環境音との共演)。通常の雨は、数秒〜最大10秒ほどで中断。強い雨は、もっと早く中断。
//         中断しても、曲の記憶は消さない。次に弾く時は、最初から。
export const PERFORM = {
  startChance: 0.22,           // 活動を選ぶたびの、演奏を始める確率(条件が揃っている時)
  cooldownSec: [240, 600],     // 弾き終わってから、次を考えるまで(現実の秒)
  interruptCooldownSec: [120, 240],
  rainOk: 0.3,                 // これ未満の雨(小雨まで)なら、演奏を始められる
  rainInterrupt: [3, 10],      // 通常の雨で、中断するまで(秒)
  stormInterrupt: [1, 3],      // 強い雨(これ以上の雨量)で、中断するまで(秒)
  stormRain: 0.8,
  minGapMs: 60,                // 音の長さの下限(ms)
};
const range = (rng, [a, b]) => a + rng() * (b - a);

export function createPerformer({ rng = Math.random } = {}) {
  let cooldownUntil = 0, lastPlace = null, lastSongId = null;
  return {
    /**
     * 演奏を始めるか決める。
     * ctx = { now, songsByPlace:{place:[song...]}, feasible:{place:boolean}, keyboard:'bag'|'chest'|null, hasBattery:boolean, rain:number, busy:boolean }
     * @returns {null | { place, song, fetch:boolean }}
     */
    plan(ctx) {
      if (ctx.busy || ctx.now < cooldownUntil || !ctx.keyboard || !ctx.hasBattery || ctx.rain >= PERFORM.rainOk) return null;
      let places = Object.keys(ctx.songsByPlace).filter((p) => (ctx.songsByPlace[p] || []).length > 0 && ctx.feasible[p]);
      if (!places.length) return null;
      if (rng() >= PERFORM.startChance) return null; // 気まぐれ: 今回は、弾かない
      if (places.length > 1 && lastPlace) places = places.filter((p) => p !== lastPlace) || places;
      const place = places[Math.floor(rng() * places.length)];
      let songs = ctx.songsByPlace[place];
      if (songs.length > 1 && lastSongId !== null) songs = songs.filter((s) => s.id !== lastSongId);
      const song = songs[Math.floor(rng() * songs.length)];
      lastPlace = place; lastSongId = song.id;
      return { place, song, fetch: ctx.keyboard === 'chest' };
    },
    finished(now) { cooldownUntil = now + range(rng, PERFORM.cooldownSec); },
    interrupted(now) { cooldownUntil = now + range(rng, PERFORM.interruptCooldownSec); },
    cooldownUntil: () => cooldownUntil,
    last: () => ({ place: lastPlace, songId: lastSongId }),
  };
}

/** 雨による中断。弱い雨(小雨まで)では、中断しない。通常の雨は数秒〜10秒、強い雨は1〜3秒で、中断する。 */
export function createRainWatcher({ rng = Math.random } = {}) {
  let wet = 0, limit = null;
  return {
    /** dt 秒ぶん進める。rain=いまの雨量(0〜1)。中断する時だけ true。 */
    update(dt, rain) {
      if (rain < PERFORM.rainOk) { wet = 0; limit = null; return false; }
      const storm = rain >= PERFORM.stormRain;
      if (limit === null) limit = range(rng, storm ? PERFORM.stormInterrupt : PERFORM.rainInterrupt);
      if (storm && limit > PERFORM.stormInterrupt[1]) limit = range(rng, PERFORM.stormInterrupt); // 強くなったら、短くやり直す
      wet += dt;
      return wet >= limit;
    },
    reset() { wet = 0; limit = null; },
  };
}

/** 記憶した曲を、時間にそって再生する(音の開始・終了を、時刻順に返す)。 */
export function createSongPlayer(song) {
  const ev = [];
  for (const n of song.notes) { ev.push({ at: n.t, type: 'on', note: n }); ev.push({ at: n.t + Math.max(n.d, PERFORM.minGapMs), type: 'off', note: n }); }
  ev.sort((a, b) => a.at - b.at || (a.type === 'off' ? -1 : 1)); // 同じ時刻なら、離すほうが先(押し直し)
  let i = 0, t = 0; const end = ev.length ? ev[ev.length - 1].at : 0;
  return {
    /** dtSec 秒進める。そのあいだに起きる、音の開始・終了を返す。 */
    advance(dtSec) { t += dtSec * 1000; const out = []; while (i < ev.length && ev[i].at <= t) out.push(ev[i++]); return out; },
    isDone: () => i >= ev.length,
    elapsedMs: () => t, durationMs: () => end,
    /** 途中でやめる時に、まだ押している音を返す。 */
    heldNotes() { const on = new Set(); for (let k = 0; k < i; k++) { const e = ev[k]; if (e.type === 'on') on.add(e.note); else on.delete(e.note); } return [...on]; },
  };
}
