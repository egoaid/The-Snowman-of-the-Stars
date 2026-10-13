/**
 * footsteps.js
 * 雪だるまの足音。地面の種類(草/川の中/雪)によって音色を変える。
 * 2026-09: 新規追加。歩行アニメーションの一歩ごとにscene3d.js側から
 * SoundEngine.Footsteps.step(surface) を呼んでもらう、イベント駆動方式。
 * 常時鳴らし続けるループ音ではないため、他のsynthesizerモジュールのような
 * scheduleループは持たない。
 *
 * 2026-09(改訂): 「足音が変、もっと可愛い音を、音量は小さめに」という
 * フィードバックを受けて全面的に音色を作り直した。
 * 単なるフィルターノイズのバースト(耳障りな「バチッ」という音になりがち)
 * ではなく、
 *   - 柔らかくローパスした短いノイズの「ポフッ」という質感
 *   - ほんの少しピッチが下がる小さな「ポヨン」というサイン波のブリップ
 * を軽く重ねることで、雪だるまらしい可愛らしい足音にしている。
 * 全体の出力も控えめな音量に抑えている。
 *
 * 対応するsurface: 'grass'(草原・地面, デフォルト) / 'water'(川の中) /
 * 'snow'(雪原。季節システム実装後、冬季に使用予定のスタブ)。
 */
(function () {
  'use strict';

  const SoundEngine = (window.SoundEngine = window.SoundEngine || {});

  /**
   * 柔らかいローパスノイズの「ポフッ」を1回再生する。
   */
  function playSoftPuff(ctx, output, { duration, cutoff, gain }) {
    const buffer = SoundEngine.createNoiseBurstBuffer(duration);
    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    filter.Q.value = 0.4; // 共鳴を強くしすぎない(耳障りな「ピー」を避ける)

    const g = ctx.createGain();
    g.gain.value = gain;

    src.connect(filter);
    filter.connect(g);
    g.connect(output);

    src.start();
    src.stop(ctx.currentTime + duration + 0.05);
    src.onended = () => { src.disconnect(); filter.disconnect(); g.disconnect(); };
  }

  /**
   * 可愛らしい小さな「ポヨン」ブリップ(サイン波、少しピッチが下がる)を1回再生する。
   */
  function playCuteBlip(ctx, output, { startFreq, endFreq, duration, gain }) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), ctx.currentTime + duration);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), ctx.currentTime + duration * 0.18);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    osc.connect(g);
    g.connect(output);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
    osc.onended = () => { osc.disconnect(); g.disconnect(); };
  }

  const Footsteps = {
    _output: null,
    _lastStepTime: 0,

    /** 初回のstep()呼び出し時に一度だけ出力ゲインを用意する。 */
    ensureOutput() {
      if (this._output) return this._output;
      const ctx = SoundEngine.getContext();
      const g = ctx.createGain();
      // 2026-09: 以前(0.9)は他の環境音に対して大きすぎたため、控えめな音量に変更。
      g.gain.value = 0.38;
      g.connect(SoundEngine.getSfxBus());
      this._output = g;
      return this._output;
    },

    /**
     * 一歩分の足音を鳴らす。
     * @param {'grass'|'water'|'snow'} surface
     * @param {number} [intensity] - 0〜1程度。歩行速度などで音量にメリハリをつけたい場合に使う。
     */
    step(surface, intensity = 1, opts = {}) {
      const ctx = SoundEngine.getContext();
      if (!ctx) return;
      // 極端に短い間隔での連打(アニメーションのフレーム誤差など)を防ぐ簡易ガード
      const now = ctx.currentTime;
      if (now - this._lastStepTime < 0.15) return;
      this._lastStepTime = now;

      const output = this.ensureOutput();
      const v = SoundEngine.randomRange(0.85, 1.15) * Math.max(0.3, Math.min(1, intensity));

      if (surface === 'wood') {
        // v1.56-H3: 丸太の上を歩く: 雪の「ポフッ」ではなく、硬めの木の「コッ」。
        // 丸太が大きい(太く長い)ほど低く響き、小枝は高く軽い。opts.size = 丸太の大きさ(m、体積の立方根)
        const size = Math.max(0.08, Math.min(2.6, opts.size || 0.5));
        const f = Math.max(150, Math.min(950, 330 / Math.pow(size, 0.6))) * SoundEngine.randomRange(0.97, 1.03);
        const ringDecay = 0.05 + size * 0.07;
        const t0 = ctx.currentTime;
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(f * 1.15, t0);
        o.frequency.exponentialRampToValueAtTime(f, t0 + 0.03);
        const og = ctx.createGain();
        og.gain.setValueAtTime(0.0001, t0);
        og.gain.linearRampToValueAtTime(0.11 * v, t0 + 0.004);
        og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.004 + ringDecay);
        o.connect(og); og.connect(output);
        o.start(t0); o.stop(t0 + ringDecay + 0.05);
        o.onended = () => { o.disconnect(); og.disconnect(); };
        // 足が当たる瞬間の、小さな高い「コツ」(帯域ノイズ)
        const nb = SoundEngine.createNoiseBurstBuffer(0.025);
        const ns = ctx.createBufferSource(); ns.buffer = nb;
        const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = Math.min(3200, f * 4); nf.Q.value = 1.1;
        const ng = ctx.createGain(); ng.gain.value = 0.05 * v;
        ns.connect(nf); nf.connect(ng); ng.connect(output);
        ns.start(); ns.stop(t0 + 0.06);
        ns.onended = () => { ns.disconnect(); nf.disconnect(); ng.disconnect(); };
        // 丸太の上の雪が、ほんの少し鳴る
        playSoftPuff(ctx, output, { duration: 0.05, cutoff: 900, gain: 0.02 * v });
      } else if (surface === 'water') {
        // 川の中を歩く: 小さな「ピチャ」というブリップ+ごく軽い水しぶきノイズ
        playCuteBlip(ctx, output, {
          startFreq: SoundEngine.randomRange(700, 900), endFreq: SoundEngine.randomRange(260, 340),
          duration: 0.12, gain: 0.09 * v,
        });
        playSoftPuff(ctx, output, { duration: 0.14, cutoff: SoundEngine.randomRange(1200, 1800), gain: 0.05 * v });
      } else if (surface === 'snow') {
        // 雪の上: 少し高めで軽い「キュッ」というブリップ
        // (季節システム実装後、冬季に地面が雪になったら使用する想定のスタブ)
        playCuteBlip(ctx, output, {
          startFreq: SoundEngine.randomRange(900, 1100), endFreq: SoundEngine.randomRange(500, 650),
          duration: 0.08, gain: 0.07 * v,
        });
        playSoftPuff(ctx, output, { duration: 0.06, cutoff: SoundEngine.randomRange(2200, 3000), gain: 0.03 * v });
      } else {
        // 草・地面の上(デフォルト): 柔らかい「ポフッ」+可愛い「ポヨン」ブリップ
        playSoftPuff(ctx, output, { duration: 0.09, cutoff: SoundEngine.randomRange(500, 750), gain: 0.07 * v });
        playCuteBlip(ctx, output, {
          startFreq: SoundEngine.randomRange(420, 520), endFreq: SoundEngine.randomRange(220, 280),
          duration: 0.10, gain: 0.055 * v,
        });
      }
    },
  };

  SoundEngine.Footsteps = Footsteps;
})();
