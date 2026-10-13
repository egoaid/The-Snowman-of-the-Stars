/**
 * wind.js
 * 風のシンセサイズ。
 * - ベース層: ピンクノイズをバンドパスフィルタに通し、LFOでカットオフ周波数と音量を
 *   ゆっくり揺らすことで「ヒューヒュー」という風の吹き寄せ(滑らかな帯域変化)を表現。
 *   → 雨の「上から降る粒」、川の「水のせせらぎ」とは違い、風はディスクリートな
 *     打撃音(トランジェント)を持たず、なめらかに強弱がうねる帯域ノイズであることが特徴。
 * - 木の葉レイヤー(オプション): 高域のノイズを細かくランダムに振幅変調し、
 *   「サワサワ」という葉擦れの質感を追加。風が強いほど活発になる。
 * intensityが高いほど、揺れが速く・音量が大きく・突風(gust)が発生しやすくなる。
 * ビジュアル側(木の揺れ)と連動できるよう、現在の風の強さを onGust コールバックで通知する。
 */
(function () {
  'use strict';
  const SoundEngine = (window.SoundEngine = window.SoundEngine || {});

  class Wind {
    constructor() {
      this.ctx = null;
      this.output = null;
      this.intensity = 0.3; // 0-1
      this.running = false;
      this.leavesEnabled = false;
      this.leavesAmount = 0.5;
      this.panWanderAmount = 0.5; // 0-1: 風の定位が動き回る幅
      this._currentPos = { x: 0, y: 0.4, z: -1.5 };
      this._gustTimer = null;
      this._leafTimer = null;
      this._panWanderTimer = null;
      this.onGust = null;
      this.currentGustStrength = 0;
    }

    start() {
      if (this.running) return;
      this.ctx = SoundEngine.getContext();
      const ctx = this.ctx;
      this.output = ctx.createGain();
      this.output.gain.value = 0;
      this.panner = SoundEngine.createSpatialPanner(
        this._currentPos.x, this._currentPos.y, this._currentPos.z,
        true, () => this._currentPos
      );
      this.output.connect(this.panner);
      this.panner.connect(SoundEngine.getAmbientBus());

      const noise = SoundEngine.createNoiseSource('pink', 6);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 500;
      filter.Q.value = 0.7;

      const highNoise = SoundEngine.createNoiseSource('white', 6);
      const hiFilter = ctx.createBiquadFilter();
      hiFilter.type = 'highpass';
      hiFilter.frequency.value = 2000;
      const hiGain = ctx.createGain();
      hiGain.gain.value = 0.05;

      // LFO: フィルタ周波数をゆっくり揺らす(風の吹き寄せ)
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.08;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 250;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      lfo.start();

      const lfo2 = ctx.createOscillator();
      lfo2.type = 'sine';
      lfo2.frequency.value = 0.35;
      const lfo2Gain = ctx.createGain();
      lfo2Gain.gain.value = 80;
      lfo2.connect(lfo2Gain);
      lfo2Gain.connect(filter.frequency);
      lfo2.start();

      noise.connect(filter);
      filter.connect(this.output);
      highNoise.connect(hiFilter);
      hiFilter.connect(hiGain);
      hiGain.connect(this.output);

      // --- 木の葉レイヤー ---
      const leafNoise = SoundEngine.createNoiseSource('white', 5);
      const leafFilter = ctx.createBiquadFilter();
      leafFilter.type = 'bandpass';
      leafFilter.frequency.value = 5500;
      leafFilter.Q.value = 0.8;
      const leafGain = ctx.createGain();
      leafGain.gain.value = 0; // leavesEnabledに応じて制御
      leafNoise.connect(leafFilter);
      leafFilter.connect(leafGain);
      leafGain.connect(this.output);
      leafNoise.start();

      noise.start();
      highNoise.start();

      this._nodes = {
        noise, filter, highNoise, hiFilter, hiGain, lfo, lfoGain, lfo2, lfo2Gain,
        leafNoise, leafFilter, leafGain,
      };
      this.running = true;
      this._scheduleGusts();
      this._scheduleLeafRustle();
      this._schedulePanWander();
      this.setIntensity(this.intensity);
    }

    stop() {
      if (!this.running) return;
      this.running = false;
      clearTimeout(this._gustTimer);
      clearTimeout(this._leafTimer);
      clearTimeout(this._panWanderTimer);
      const now = this.ctx.currentTime;
      this.output.gain.setTargetAtTime(0, now, 0.4);
      const n = this._nodes;
      setTimeout(() => {
        try {
          n.noise.stop();
          n.highNoise.stop();
          n.leafNoise.stop();
          n.lfo.stop();
          n.lfo2.stop();
          Object.values(n).forEach((node) => node.disconnect && node.disconnect());
          this.output.disconnect();
          SoundEngine.unregisterSpatialSource(this.panner);
          this.panner.disconnect();
        } catch (e) {}
      }, 600);
    }

    setPanWanderAmount(v) {
      this.panWanderAmount = Math.max(0, Math.min(1, v));
    }

    setLeavesAmount(v) {
      this.leavesAmount = Math.max(0, Math.min(1, v));
    }

    /**
     * 「静穏時(突風が鳴っていない間)の音量」を intensity から一意に決める式。
     * setIntensity() と _playGust() の両方がこの同じ式を参照することで、
     * 突風が鳴った後にこの静穏レベルへ正しく戻るようにする
     * (以前は _playGust 側が独自の、ずっと大きい式を使っていたため、
     *  一度突風が鳴ると音量がそのまま高いレベルに張り付いてしまっていた)。
     */
    _restingVolume() {
      return Math.pow(this.intensity, 2.0) * 0.6;
    }

    setIntensity(v) {
      this.intensity = Math.max(0, Math.min(1, v));
      if (!this.running) return;
      const now = this.ctx.currentTime;
      // 弱い風では帯域ノイズをほぼ無音にし、木の葉レイヤーだけが聞こえる状態に近づける
      const vol = this._restingVolume();
      this.output.gain.cancelScheduledValues(now);
      this.output.gain.setTargetAtTime(vol, now, 0.6);
      this._nodes.lfo.frequency.setTargetAtTime(0.05 + this.intensity * 0.3, now, 0.6);
      this._nodes.lfo2.frequency.setTargetAtTime(0.2 + this.intensity * 0.8, now, 0.6);
      this._nodes.lfoGain.gain.setTargetAtTime(200 + this.intensity * 500, now, 0.6);
      this._nodes.hiGain.gain.setTargetAtTime(Math.pow(this.intensity, 1.5) * 0.15, now, 0.6);
      this._nodes.filter.Q.setTargetAtTime(0.6 + this.intensity * 0.8, now, 0.6);
    }

    /**
     * 木の葉が擦れる音のオンオフ
     */
    setLeaves(enabled) {
      this.leavesEnabled = enabled;
      if (!this.running) return;
      if (!enabled) {
        this._nodes.leafGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
      }
    }

    _scheduleGusts() {
      if (!this.running) return;
      const gap = SoundEngine.randomRange(3, 10 - this.intensity * 6);
      this._gustTimer = setTimeout(() => {
        if (Math.random() < 0.3 + this.intensity * 0.6) {
          this._playGust();
        }
        this._scheduleGusts();
      }, gap * 1000);
    }

    _playGust() {
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const strength = SoundEngine.randomRange(0.3, 1) * (0.4 + this.intensity * 0.8);
      const clamped = Math.min(1, strength);
      const attack = SoundEngine.randomRange(0.5, 1.5);
      const release = SoundEngine.randomRange(1.5, 3.5);
      // 突風が収まった後は、setIntensity() と同じ静穏レベルに戻す
      // (独自の高い床値を持つ式を使うと、突風後に音量が高止まりしてしまう)
      const baseVol = this._restingVolume();
      const boosted = baseVol + clamped * (0.08 + this.intensity * 0.4);

      this.output.gain.cancelScheduledValues(now);
      this.output.gain.setValueAtTime(this.output.gain.value, now);
      this.output.gain.linearRampToValueAtTime(boosted, now + attack);
      this.output.gain.linearRampToValueAtTime(baseVol, now + attack + release);

      this.currentGustStrength = clamped;
      if (typeof this.onGust === 'function') {
        this.onGust(clamped, attack, release);
      }
    }

    /**
     * 葉擦れは「常時サワサワ」ではなく、細かいランダムな音量の揺れの連続で表現する。
     * setTargetAtTime で少しずつ違う目標値へ滑らかに動かし続けることで、
     * 一定間隔のノイズバーストよりも自然な「擦れ」の質感になる。
     */
    _scheduleLeafRustle() {
      if (!this.running) return;
      if (this.leavesEnabled) {
        const now = this.ctx.currentTime;
        // 弱い風でも葉ずれ自体は最低限聞こえるように、控えめな下限を確保する
        const base = (0.02 + this.intensity * 0.14) * (0.3 + this.leavesAmount * 1.4);
        const target = base * SoundEngine.randomRange(0.4, 1.3);
        this._nodes.leafGain.gain.setTargetAtTime(target, now, 0.08);
        this._nodes.leafFilter.frequency.setTargetAtTime(
          SoundEngine.randomRange(3500, 7000),
          now,
          0.12
        );
      }
      const gap = SoundEngine.randomRange(80, 220);
      this._leafTimer = setTimeout(() => this._scheduleLeafRustle(), gap);
    }

    /**
     * 風の音像が3D空間上をゆっくりランダムに動き回る様子を表現する。
     * リスナーを中心とした円周上の角度をランダムに選び、そこへゆっくり移動する。
     * 木々の間を風が通り抜けるような、決まった場所に留まらない定位感を作る。
     */
    _schedulePanWander() {
      if (!this.running) return;
      const angle = SoundEngine.randomRange(0, Math.PI * 2);
      const radius = SoundEngine.randomRange(1.2, 3.5) * (0.3 + this.panWanderAmount * 0.9);
      this._currentPos = {
        x: Math.sin(angle) * radius,
        y: SoundEngine.randomRange(0.1, 0.8),
        z: -Math.cos(angle) * radius,
      };
      SoundEngine.applySpatialPosition(this.panner, this._currentPos.x, this._currentPos.y, this._currentPos.z);
      const transitionTime = SoundEngine.randomRange(2, 6);
      this._panWanderTimer = setTimeout(
        () => this._schedulePanWander(),
        transitionTime * 1000
      );
    }
  }

  SoundEngine.Wind = Wind;
})();
