// emote-brain.js (v1.73)
// 雪だるまの「座る・寝る」エモートの状態機械。画面(THREE)にも、シーンにも依存しない純粋なロジック。
// ヘッドレスで検証できる(verify_emote.mjs)。
//
// 流れ(必ず、座ってから寝る。起きる時も、座ってから立つ):
//
//   立つ → 座る → ぼーっと → あくび → 仰向けになる → 寝る(ときどき寝返り)
//        → (横向きなら仰向けへ戻る) → 上体を起こす → 座る → 立つ
//
// 呼ぶ側は毎フレーム update(dt, ctx) を呼び、getPose() の値を雪だるまの見た目へ渡す。
//   ctx.autoAllowed : 見守りモードの時 true(勝手に座る・寝るのを許す)
//   ctx.calm        : 拾い物・チェスト・ジャンプなど、別の動作の最中でない(座り始めてよい)
//   ctx.isNight     : 夜か(夜は寝やすく、少し長く寝る)
//   ctx.canLie      : 仰向けになれる場所か(後ろに水・木・岩などが無い)
//   ctx.interrupt   : 別の用事ができた(星に気づいた等)。座っていたり寝ていたら、起きる

export const EMOTE_CONFIG = {
  // 長さ(秒)
  sitDownSec: 1.3,
  standUpSec: 1.1,
  yawnSec: 2.7,
  lieDownSec: 2.1,
  sitUpSec: 1.9,
  rollSec: 1.5,
  // 立っている時間(見守りの「勝手に座る」の間隔)。長めにして、動きの無い時間が続きすぎないようにする。
  restIntervalDay: [200, 420],
  restIntervalNight: [140, 320],
  firstRestInterval: [50, 130], // 見守りを始めてから最初に座るまで
  // 座ったあと、ぼーっとしている時間
  sitIdleSleepPlan: [9, 20], // このあと寝る時
  sitIdleNoSleep: [6, 14], // 座るだけで終わる時
  sitIdleAfterWake: [3.5, 8], // 起きたあと(見守りでは、すぐ立つ)
  sitIdleManual: [25, 70], // Bキーなどで自分で座った時(放っておくと、あくび→寝ることもある)
  sitIdleManualSleep: [2.2, 3.6], // 「寝る」を選んだ時(座ってから、ちょっとだけぼーっとしてあくび)
  // 寝る確率(座った時に決める)
  sleepProbDay: 0.35, // 昼寝
  sleepProbNight: 0.6, // 夜は少し寝やすい
  sleepProbManual: 0.5, // 自分で座ったまま放っておいた時
  yawnOnlyProb: 0.3, // 寝ない時も、あくびだけすることがある
  // 寝ている時間(秒)。長く寝すぎない(画に動きが無くなるので)
  sleepDay: [22, 55],
  sleepNight: [40, 110],
  rollInterval: [11, 30], // 寝返りの間隔
};

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => { const c = clamp01(x); return c * c * (3 - 2 * c); };

export function createEmoteBrain({ rng = Math.random, config = {} } = {}) {
  const C = { ...EMOTE_CONFIG, ...config };
  const range = (r) => r[0] + rng() * (r[1] - r[0]);

  // 状態: stand | sitting-down | sit | yawn | lying-down | sleep | roll | waking-roll | sitting-up | standing-up
  const s = {
    state: 'stand',
    t: 0, // 今の状態に入ってからの秒
    dur: 0, // 今の状態の長さ(動きのある状態だけ)
    origin: 'auto', // 'auto'(見守りの勝手な休憩) | 'manual'(自分で選んだ)
    sleepPlan: false, // 座ったあと、あくび→寝る まで進むか
    yawnOnly: false, // 寝ないが、あくびだけする
    idleLeft: 0, // ぼーっと座っている残り時間
    sleepLeft: 0, // 寝ている残り時間
    rollLeft: 0, // 次の寝返りまで
    wantStand: false, // 立ちたい(いまの動きが終わったら、順に立つ)
    nextRestIn: range(C.firstRestInterval),
    rollTarget: 0, // 寝返りの向き先(-1,0,1)
    rollFrom: 0,
    breathPhase: 0,
    lastSlept: false,
  };
  // 見た目の値(なめらかに動く)
  const pose = { sit: 0, lie: 0, roll: 0, yawn: 0, eyesClosed: 0, drowsy: 0, breath: 0 };
  let seg = null; // 今の動きの 始点→終点

  function enter(state, dur = 0, to = null) {
    s.state = state; s.t = 0; s.dur = dur;
    seg = to ? { from: { ...pose }, to: { ...to } } : null;
  }
  function stepSeg(dt, easeFn = smooth) {
    if (!seg) return true;
    s.t += dt;
    const k = easeFn(s.dur > 0 ? s.t / s.dur : 1);
    for (const key of Object.keys(seg.to)) pose[key] = lerp(seg.from[key], seg.to[key], k);
    return s.t >= s.dur;
  }

  function startSitDown(origin, { sleep = false, manualSleepNow = false } = {}) {
    s.origin = origin;
    s.wantStand = false;
    s.sleepPlan = sleep;
    s.yawnOnly = false;
    enter('sitting-down', C.sitDownSec, { sit: 1, breath: 0.35 });
    s.idleLeft = manualSleepNow ? range(C.sitIdleManualSleep)
      : origin === 'manual' ? range(C.sitIdleManual)
        : sleep ? range(C.sitIdleSleepPlan) : range(C.sitIdleNoSleep);
  }
  function startStandUp() { s.wantStand = false; enter('standing-up', C.standUpSec, { sit: 0, breath: 0, drowsy: 0, eyesClosed: 0 }); }
  function startYawn() { enter('yawn', C.yawnSec, null); }
  function startLieDown() { enter('lying-down', C.lieDownSec, { lie: 1, sit: 1, breath: 0.5 }); }
  function startSleep(isNight) {
    enter('sleep', 0, null);
    s.sleepLeft = range(isNight ? C.sleepNight : C.sleepDay);
    s.rollLeft = range(C.rollInterval);
    s.lastSlept = true;
  }
  function startRoll(to) { s.rollFrom = pose.roll; s.rollTarget = to; enter('roll', C.rollSec, { roll: to }); }
  function startWake() {
    if (Math.abs(pose.roll) > 0.02) { s.rollTarget = 0; enter('waking-roll', C.rollSec * 0.9, { roll: 0, eyesClosed: 0.5 }); }
    else enter('sitting-up', C.sitUpSec, { lie: 0, eyesClosed: 0, drowsy: 0.5, breath: 0.35 });
  }
  function afterWakeSit() {
    enter('sit', 0, null);
    s.sleepPlan = false; s.yawnOnly = false;
    s.idleLeft = s.origin === 'manual' ? range(C.sitIdleManual) : range(C.sitIdleAfterWake);
    pose.drowsy = 0.35;
  }

  /** 手動(Bキーのホイール・画面のボタン)。'sit' | 'sleep' | 'stand' */
  function request(kind) {
    if (kind === 'stand') {
      if (s.state === 'stand') return;
      s.wantStand = true;
      // 座っているだけなら、すぐ立ち始める。寝ていたら、起きて座ってから立つ(update が順に進める)
      if (s.state === 'sit') startStandUp();
      else if (s.state === 'sleep' || s.state === 'roll') startWake();
      return;
    }
    if (kind === 'sit') {
      if (s.state === 'stand' || s.state === 'standing-up') startSitDown('manual');
      else { s.origin = 'manual'; s.wantStand = false; }
      return;
    }
    if (kind === 'sleep') {
      if (s.state === 'stand' || s.state === 'standing-up') startSitDown('manual', { sleep: true, manualSleepNow: true });
      else if (s.state === 'sit') { s.origin = 'manual'; s.sleepPlan = true; s.wantStand = false; s.idleLeft = Math.min(s.idleLeft, range(C.sitIdleManualSleep)); }
      else { s.origin = 'manual'; s.sleepPlan = true; s.wantStand = false; }
    }
  }

  function update(dt, ctx = {}) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    s.breathPhase += dt;
    const night = !!ctx.isNight;
    const canLie = ctx.canLie !== false;

    // 別の用事ができた / 見守りでなくなった(自動の休憩だけ): 起きる
    if (s.state !== 'stand' && s.origin === 'auto' && (ctx.interrupt || ctx.autoAllowed === false)) {
      if (!s.wantStand) { s.wantStand = true; if (s.state === 'sit') startStandUp(); else if (s.state === 'sleep' || s.state === 'roll') startWake(); }
    }
    if (s.state !== 'stand' && s.state !== 'standing-up' && ctx.interrupt && s.origin === 'manual') { /* 自分で座った時は、勝手に起こさない */ }

    switch (s.state) {
      case 'stand': {
        pose.sit = lerp(pose.sit, 0, Math.min(1, dt * 8)); pose.lie = 0; pose.roll = 0; pose.breath = lerp(pose.breath, 0, Math.min(1, dt * 4));
        pose.yawn = 0; pose.eyesClosed = lerp(pose.eyesClosed, 0, Math.min(1, dt * 8)); pose.drowsy = lerp(pose.drowsy, 0, Math.min(1, dt * 6));
        if (ctx.autoAllowed && ctx.calm !== false && !ctx.interrupt) {
          s.nextRestIn -= dt;
          if (s.nextRestIn <= 0) {
            const p = night ? C.sleepProbNight : C.sleepProbDay;
            startSitDown('auto', { sleep: rng() < p });
          }
        }
        break;
      }
      case 'sitting-down': {
        if (stepSeg(dt)) { enter('sit', 0, null); if (s.wantStand) startStandUp(); }
        break;
      }
      case 'sit': {
        // ぼーっと(ときどき、とろんとする)
        pose.drowsy = lerp(pose.drowsy, s.sleepPlan ? Math.min(0.8, 0.25 + (1 - s.idleLeft / 14) * 0.6) : 0.2, Math.min(1, dt * 1.2));
        pose.breath = lerp(pose.breath, 0.35, Math.min(1, dt * 2));
        s.idleLeft -= dt;
        if (s.wantStand) { startStandUp(); break; }
        if (s.idleLeft <= 0) {
          if (s.sleepPlan) { startYawn(); break; }
          if (!s.yawnOnly && s.origin === 'auto' && rng() < C.yawnOnlyProb) { s.yawnOnly = true; startYawn(); break; }
          if (s.origin === 'auto') { startStandUp(); break; }
          // 手動で座ったまま放っておいた: ときどき、あくび→寝る
          if (rng() < C.sleepProbManual) { s.sleepPlan = true; startYawn(); }
          else s.idleLeft = range(C.sitIdleManual);
        }
        break;
      }
      case 'yawn': {
        s.t += dt;
        const k = clamp01(s.t / C.yawnSec);
        // 口を大きく開けて、頭を少し上げ、目を細める(ふわっと開いて、ゆっくり閉じる)
        pose.yawn = Math.sin(Math.min(1, k * 1.05) * Math.PI) ** 0.8;
        pose.drowsy = lerp(pose.drowsy, 0.9, Math.min(1, dt * 3));
        if (s.t >= C.yawnSec) {
          pose.yawn = 0;
          if (s.wantStand) { enter('sit', 0, null); startStandUp(); break; }
          if (s.sleepPlan && canLie) startLieDown();
          else { s.sleepPlan = false; enter('sit', 0, null); s.idleLeft = range(C.sitIdleAfterWake); }
        }
        break;
      }
      case 'lying-down': {
        pose.drowsy = lerp(pose.drowsy, 1, Math.min(1, dt * 2.5));
        pose.eyesClosed = lerp(pose.eyesClosed, s.t > C.lieDownSec * 0.45 ? 1 : 0.4, Math.min(1, dt * 3));
        if (stepSeg(dt)) { pose.eyesClosed = 1; startSleep(night); if (s.wantStand) startWake(); }
        break;
      }
      case 'sleep': {
        pose.eyesClosed = lerp(pose.eyesClosed, 1, Math.min(1, dt * 4));
        pose.breath = lerp(pose.breath, 1, Math.min(1, dt * 2));
        s.sleepLeft -= dt;
        s.rollLeft -= dt;
        if (s.wantStand || s.sleepLeft <= 0) { startWake(); break; }
        if (s.rollLeft <= 0) {
          // 寝返り: 仰向け→横向き、横向き→仰向け
          const to = Math.abs(pose.roll) < 0.3 ? (rng() < 0.5 ? -1 : 1) : 0;
          startRoll(to);
        }
        break;
      }
      case 'roll': {
        pose.eyesClosed = 1;
        if (stepSeg(dt)) { s.rollLeft = range(C.rollInterval); enter('sleep', 0, null); if (s.wantStand) startWake(); }
        break;
      }
      case 'waking-roll': {
        if (stepSeg(dt)) { pose.roll = 0; enter('sitting-up', C.sitUpSec, null); seg = { from: { ...pose }, to: { lie: 0, eyesClosed: 0, drowsy: 0.5, breath: 0.35 } }; }
        break;
      }
      case 'sitting-up': {
        if (stepSeg(dt)) {
          pose.lie = 0;
          afterWakeSit();
          if (s.wantStand || s.origin === 'auto') { /* 見守りでは、座ってしばらくしてから立つ(idleLeft) */ }
          if (s.wantStand) startStandUp();
        }
        break;
      }
      case 'standing-up': {
        if (stepSeg(dt)) {
          enter('stand', 0, null);
          pose.sit = 0; pose.lie = 0; pose.roll = 0; pose.yawn = 0;
          s.wantStand = false;
          const wasAuto = s.origin === 'auto';
          s.nextRestIn = range(night ? C.restIntervalNight : C.restIntervalDay);
          if (!wasAuto) s.nextRestIn = Math.max(s.nextRestIn, 90); // 自分で座って立った直後に、勝手に座らない
          s.lastSlept = false;
        }
        break;
      }
      default: break;
    }
  }

  return {
    update,
    request,
    get state() { return s.state; },
    isBusy: () => s.state !== 'stand',
    /** 見守りで、そろそろ座りたい(立っていて、休憩の時間が来ている)。場所を確かめる合図に使う。 */
    wantsAutoRest: () => s.state === 'stand' && s.nextRestIn <= 0,
    /** 見守りモードに入った時: 自分で座っていた場合も、見守りの休憩として、ほどなく終えて立つようにする。 */
    adoptAuto() {
      if (s.state === 'stand') return;
      s.origin = 'auto';
      if (s.state === 'sit') s.idleLeft = Math.min(s.idleLeft, range(C.sitIdleAfterWake));
    },
    /** 座っている/寝ている(立っていない)。移動を止める目安。 */
    isDown: () => s.state !== 'stand',
    /** 起き上がる・立ち上がる途中か(この間も歩けない) */
    isTransitioning: () => ['sitting-down', 'lying-down', 'roll', 'waking-roll', 'sitting-up', 'standing-up', 'yawn'].includes(s.state),
    isSleeping: () => s.state === 'sleep' || s.state === 'roll',
    /** 仰向けになろうとしている/寝ている(後ろに場所が要る) */
    needsLieSpace: () => s.sleepPlan || ['lying-down', 'sleep', 'roll', 'waking-roll', 'sitting-up'].includes(s.state),
    getPose() {
      return { ...pose, state: s.state, sleeping: s.state === 'sleep' || s.state === 'roll', breathPhase: s.breathPhase, origin: s.origin };
    },
    /** 検証用 */
    _s: s,
    config: C,
  };
}
