/**
 * ui-sounds.js
 * 画面上の操作そのものに対する、小さな効果音(v1.41)。ワールドの中の音源では
 * ないので、位置は持たない(HRTFのPannerNodeを使わず、直接マスターへつなぐ)。
 * 今のところホットバーの選択切り替え音のみ。
 */
(function () {
  'use strict';

  const SoundEngine = (window.SoundEngine = window.SoundEngine || {});

  const UiSounds = {
    _started: false,
    _output: null,

    ensureStarted() {
      if (this._started) return true;
      const ctx = SoundEngine.getContext();
      if (!ctx) return false;
      this._started = true;
      const output = ctx.createGain();
      output.gain.value = 0.5; // v1.41: 「控えめな音量」の指定どおり、ここで一段絞っておく
      output.connect(SoundEngine.getSfxBus());
      this._output = output;
      return true;
    },

    /** ホットバーの選択が切り替わった時の、小さくかわいい音。 */
    playHotbarSelect() {
      if (!this.ensureStarted()) return;
      const ctx = SoundEngine.getContext();
      const now = ctx.currentTime + 0.005;
      // 2音を少しずらして重ねる、軽いガラスのようなクリック音。
      [[1568, 0, 0.16, 0.16], [2637, 0.02, 0.1, 0.22]].forEach(([freq, delay, gain, decay]) => {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        const g = ctx.createGain();
        const t0 = now + delay;
        const t1 = t0 + decay;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(gain, t0 + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t1);
        osc.connect(g);
        g.connect(this._output);
        osc.start(t0);
        osc.stop(t1 + 0.05);
      });
    },
  };

  SoundEngine.UiSounds = UiSounds;
})();
