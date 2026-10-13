/**
 * gather-sounds.js
 * ものを拾った時の、控えめで乾いた音(v1.41)。星の鈴の音とは違う、木の枝らしい
 * 軽いノイズ+短い減衰を使う。星と同じく、拾った場所を世界の中の音源として
 * HRTFのPannerNode(SoundEngine.createSpatialPanner)で鳴らす。
 */
(function () {
  'use strict';

  const SoundEngine = (window.SoundEngine = window.SoundEngine || {});

  const GatherSounds = {
    _started: false,
    _output: null,
    _panner: null,

    ensureStarted() {
      if (this._started) return true;
      const ctx = SoundEngine.getContext();
      if (!ctx) return false;
      this._started = true;
      const output = ctx.createGain();
      output.gain.value = 0.55;
      const panner = SoundEngine.createSpatialPanner(0, 0, 0, false);
      output.connect(panner);
      panner.connect(SoundEngine.getSfxBus());
      this._output = output;
      this._panner = panner;
      return true;
    },

    /** リスナーから見た相対位置(前方=-Z、右=+X、上=+Y)。 */
    setListenerRelativePosition(x, y, z) {
      if (!this.ensureStarted()) return;
      SoundEngine.applySpatialPosition(this._panner, x, y, z);
    },

    /** 枝を拾った時の、短く乾いた音。 */
    playPickupBranch() {
      if (!this.ensureStarted()) return;
      const ctx = SoundEngine.getContext();
      const now = ctx.currentTime + 0.01;
      // 短いノイズバースト(枝が擦れる/触れる質感)
      const bufSize = Math.floor(ctx.sampleRate * 0.05);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.value = 1800;
      noiseFilter.Q.value = 0.7;
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.5, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(this._output);
      noise.start(now);
      // 低い木質っぽいコツンという一音
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.09);
      const oGain = ctx.createGain();
      oGain.gain.setValueAtTime(0.001, now);
      oGain.gain.linearRampToValueAtTime(0.4, now + 0.008);
      oGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
      osc.connect(oGain);
      oGain.connect(this._output);
      osc.start(now);
      osc.stop(now + 0.2);
    },
  };

  SoundEngine.GatherSounds = GatherSounds;
})();
