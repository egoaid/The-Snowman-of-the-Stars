// storm-events.js (v1.96)
// 雨宿り・落雷・感電のきまり。画面や three.js に依存しない(Nodeで試験できる)。
//   どれも「見守りモード」の時にだけ起きる出来事。
//   ・雨宿り: 雨が降りはじめた時、雪だるまが時々、大きな木の下へ行く(寝ていて起きて行くこともある)。シルクハットがあるので、雨の中の活動も続ける。
//   ・落雷: 雷雨 かつ 夜。条件が揃った夜に、約25%の確率で、その夜に1回だけ、一番大きな木へ落ちる。感電のあとは、ゲーム内で数日あける。
//   ・感電: 落ちた時に、その木の下にいた雪だるまだけが感電する。光る → 固まる → 倒れる → 起き上がる → 逃げる。
import { GAME_DAY_REAL_SEC } from './snow-melt.js';

export const STORM = {
  strikeProb: 0.25,            // 雷雨の夜1回あたりに、落雷が起きる確率
  strikeDelaySec: [8, 70],     // 条件が揃ってから、落ちるまで(秒)
  cooldownDays: 3,             // 感電したあと、落雷が起きなくなる日数(ゲーム内)
  rainMin: 0.35,               // これ以上の雨で、雨宿りを考える
  rainOff: 0.15,               // これ未満まで弱まったら、次の降りはじめとして数え直す
  shelterProbAwake: 0.55,      // 降りはじめに、雨宿りしに行く確率(起きている時)
  shelterProbAsleep: 0.5,      // 寝ている時に、雨に気づいて起きて雨宿りに行く確率
  shelterDelaySec: [6, 30],    // 降りはじめてから動き出すまで(秒)
  shelterStaySec: [20, 50],    // 木の下にいる時間の目安(秒)
  underFactor: 0.8,            // 樹冠の半径のこの割合より内側を「木の下」とする
  trunkRadius: 0.62,
};
const range = (rng, [a, b]) => a + rng() * (b - a);

/** (x,z) が、木の樹冠の下か。tree = { x, z, radius(樹冠の半径) } */
export function isUnderCanopy(x, z, tree, factor = STORM.underFactor) {
  return Math.hypot(x - tree.x, z - tree.z) < tree.radius * factor;
}
/** 木の下の、雨宿りする場所。いま居る側(from)の、幹の手前。幹にめり込まず、必ず樹冠の下に収まる。 */
export function shelterSpot(tree, from, rng = Math.random) {
  const dx = from.x - tree.x, dz = from.z - tree.z;
  const base = Math.atan2(dz, dx) + (rng() - 0.5) * 1.1;
  const maxD = Math.max(STORM.trunkRadius + 0.5, tree.radius * STORM.underFactor * 0.75);
  const d = Math.min(maxD, STORM.trunkRadius + 0.9 + rng() * 1.3);
  return { x: tree.x + Math.cos(base) * d, z: tree.z + Math.sin(base) * d };
}

/** 雨の降りはじめ(弱い→強い)を、1回ずつ知らせる。 */
export function createRainOnset({ on = STORM.rainMin, off = STORM.rainOff } = {}) {
  let raining = false;
  return { update(rain) { if (!raining && rain >= on) { raining = true; return true; } if (raining && rain < off) raining = false; return false; }, isRaining: () => raining };
}
/** 降りはじめに、雨宿りしに行くか。行くなら動き出すまでの秒数、行かないなら null。 */
export function rollShelter({ asleep = false, rng = Math.random } = {}) {
  const p = asleep ? STORM.shelterProbAsleep : STORM.shelterProbAwake;
  return rng() < p ? range(rng, STORM.shelterDelaySec) : null;
}
export const pickShelterStay = (rng = Math.random) => range(rng, STORM.shelterStaySec);

/**
 * 落雷の計画。雷雨かつ夜、かつ見守り中に条件が揃った夜ごとに1回だけくじを引く。
 * 当たりなら、数十秒のうちに1回落ちる(雷雨が先に止んだら、その夜はなし)。夜が明けると、次の夜のくじが引ける。
 */
export function createStrikePlanner({ rng = Math.random, prob = STORM.strikeProb, cooldownSec = STORM.cooldownDays * GAME_DAY_REAL_SEC } = {}) {
  let rolled = false, dueAt = null, cooldownUntil = 0;
  return {
    /** @returns {boolean} true の瞬間に、1回落とす */
    update({ now, storm, night, watching }) {
      if (!night) { rolled = false; dueAt = null; return false; } // 夜が明けたら、次の夜へ
      if (!storm || !watching) { dueAt = null; return false; }    // 雷雨が止む・見守りでなくなったら、予定は消す
      if (!rolled && now >= cooldownUntil) {
        rolled = true;
        if (rng() < prob) dueAt = now + range(rng, STORM.strikeDelaySec);
      }
      if (dueAt !== null && now >= dueAt) { dueAt = null; return true; }
      return false;
    },
    /** 雪だるまが感電した。しばらく落雷を休む。 */
    notifyShock(now) { cooldownUntil = now + cooldownSec; },
    state: () => ({ rolled, dueAt, cooldownUntil }),
  };
}

// ---------- 感電の動き(経過秒 → 見た目の値) ----------
export const SHOCK = { zap: 0.9, frozen: 1.0, fall: 0.6, down: 2.4, rise: 1.0, flee: 5.0 };
const T = SHOCK;
const T_FROZEN = T.zap, T_FALL = T_FROZEN + T.frozen, T_DOWN = T_FALL + T.fall, T_RISE = T_DOWN + T.down, T_FLEE = T_RISE + T.rise, T_DONE = T_FLEE + T.flee;
export const SHOCK_TOTAL = T_DONE;
const smooth = (u) => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
export function shockPhase(age) {
  if (age < T_FROZEN) return 'zap';
  if (age < T_FALL) return 'frozen';
  if (age < T_DOWN) return 'fall';
  if (age < T_RISE) return 'down';
  if (age < T_FLEE) return 'rise';
  if (age < T_DONE) return 'flee';
  return 'done';
}
/**
 * glow: 体の光(0〜1) / jitter: ビリビリの震え(0〜1) / stiff: 固まり具合(0〜1) / startled: びっくりした顔(0〜1) /
 * lie: 倒れ具合(0=立つ 1=仰向け) / walkable: 歩いて(逃げて)よいか
 */
export function shockPose(age) {
  const ph = shockPhase(age);
  const pose = { phase: ph, glow: 0, jitter: 0, stiff: 0, startled: 0, lie: 0, leg: 0, arms: 0, walkable: false, fleeSpeedMul: 0 };
  if (ph === 'zap') {
    pose.glow = 0.6 + 0.4 * Math.abs(Math.sin(age * 30)); pose.jitter = 1; pose.stiff = smooth(age / 0.25); pose.startled = smooth(age / 0.3);
    pose.leg = smooth(age / 0.35); pose.arms = smooth(age / 0.25); // 片足を上げて、腕を前へ上げる(びっくりの定番ポーズ)
  } else if (ph === 'frozen') {
    const u = (age - T_FROZEN) / T.frozen;
    pose.glow = 0.35 * (1 - u) + 0.1; pose.jitter = 0.25 * (1 - u); pose.stiff = 1; pose.startled = 1;
    pose.leg = 0.88 + 0.12 * Math.sin((age - T_FROZEN) * 9); pose.arms = 1; // 片足立ちで、ぐらぐら固まる
  } else if (ph === 'fall') {
    const u = smooth((age - T_FALL) / T.fall);
    pose.lie = u; pose.stiff = 1 - u * 0.6; pose.startled = 1 - u * 0.4; pose.glow = 0.1 * (1 - u);
    pose.leg = Math.max(0, 1 - u * 4); pose.arms = 1 - u; // バランスを崩して、足を下ろしながら倒れる
  } else if (ph === 'down') {
    pose.lie = 1; pose.startled = 0.35 * (1 - (age - T_DOWN) / T.down); pose.jitter = 0.05 * Math.max(0, 1 - (age - T_DOWN) / 1.0);
  } else if (ph === 'rise') {
    pose.lie = 1 - smooth((age - T_RISE) / T.rise);
  } else if (ph === 'flee') {
    pose.walkable = true; pose.fleeSpeedMul = 1.8 * (1 - smooth((age - T_FLEE - T.flee * 0.7) / (T.flee * 0.3)) * 0.4);
  }
  return pose;
}
