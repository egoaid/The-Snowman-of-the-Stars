// battery.js (v1.99) — MIDIキーボードの電池のきまり。画面に依存しない(Nodeで試験できる)。
//   ・単3乾電池6本ぶん=1セット。弾いている時間で、連続約2時間(現実の時間)でなくなる。
//   ・ゲーム内の時間ではなく、現実の時間で数える。止まっている時(弾いていない時)は減らない。
//   ・電池を入れると、本体が全体的に光る。なくなると光らない。
//   ・少なくなる(残り15%以下)と、光が点滅し、音が小さく、歪んで、途切れる。
export const BATTERY_SECONDS = 2 * 60 * 60; // 7200秒(現実の時間)
export const LOW_FRACTION = 0.15;           // これ以下で「少ない」
export const PLAY_GRACE_SEC = 10;           // 最後の音から、この秒数までは「弾いている」と数える(曲の合間の休みを含む)

/**
 * 電池の状態。charge は 0〜1(1=満タン)。
 * state: 'none'(入っていない) | 'ok' | 'low'(少ない) | 'dead'(なくなった)
 */
export function createBattery({ seconds = BATTERY_SECONDS } = {}) {
  let inserted = false, charge = 0;
  const api = {
    /** 新しい電池(満タン)を入れる。 */
    insert() { inserted = true; charge = 1; },
    /** なくなった電池を取り出す(入っていなければ false)。 */
    eject() { if (!inserted) return false; inserted = false; charge = 0; return true; },
    /** dt 秒ぶん進める。playing=弾いている間だけ減る。なくなった瞬間に 'dead' を返す。 */
    tick(dt, playing) {
      if (!inserted || charge <= 0 || !playing) return null;
      const was = api.state();
      charge = Math.max(0, charge - dt / seconds);
      const now = api.state();
      return now !== was ? now : null; // 状態が変わった時だけ知らせる('low' / 'dead')
    },
    state() { return !inserted ? 'none' : charge <= 0 ? 'dead' : charge <= LOW_FRACTION ? 'low' : 'ok'; },
    fraction: () => charge,
    isInserted: () => inserted,
    serialize: () => ({ inserted, charge: Math.round(charge * 10000) / 10000 }),
    restore(s) { if (s && typeof s === 'object') { inserted = !!s.inserted; charge = Number.isFinite(s.charge) ? Math.max(0, Math.min(1, s.charge)) : 0; if (!inserted) charge = 0; } },
  };
  return api;
}

/**
 * 電池の残りに応じた、音の劣化。残りが LOW_FRACTION 以下で、だんだんひどくなる。
 * gain: 音量(1→0.3) / drive: 歪み(0〜1) / dropout: 音が途切れる確率(0〜0.5)
 */
export function degradation(charge, state) {
  if (state === 'dead' || state === 'none') return { gain: 0, drive: 1, dropout: 1 };
  if (state !== 'low') return { gain: 1, drive: 0, dropout: 0 };
  const k = 1 - Math.max(0, Math.min(1, charge / LOW_FRACTION)); // 0(少なくなりはじめ)〜1(ほぼなくなる)
  return { gain: 1 - 0.7 * k, drive: 0.25 + 0.75 * k, dropout: 0.1 + 0.4 * k };
}

/** 本体の光: level=光の強さ(0〜1)。少ない時は点滅する(time は秒)。 */
export function glowLevel(state, time) {
  if (state === 'ok') return 1;
  if (state === 'low') return (Math.sin(time * 9) > 0 || Math.sin(time * 23.7) > 0.85) ? 0.9 : 0.12; // 不規則にちらつく
  return 0;
}

/** 電池を入れる/外す時の、持ち物の出入りを決める。 */
export function planInsert({ batteryCount, state }) {
  if (state === 'ok' || state === 'low') return { action: 'already' };
  if (batteryCount < 1) return { action: 'need' };
  return { action: 'insert', ejectSpent: state === 'dead' };
}
