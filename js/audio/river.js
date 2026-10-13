/**
 * river.js
 * 川の流れる音のシンセサイズ。
 *
 * 【今回の改良: バイノーラル立体空間 + 軽量な距離表現】
 * - 定位には単純な左右パン(StereoPannerNode)ではなく、Web Audio の
 *   PannerNode(panningModel: 'HRTF')を使用。HRTF(頭部伝達関数)により、
 *   左右だけでなく前後・距離感を含む本物の立体音響(バイノーラル)を実現する。
 *   各レイヤー(Far/Mid/Near/泡/岩)に固定の3D位置を割り当て、
 *   「近くの水音は正面下から、遠い水音は背後遠くから」という配置にしている。
 * - リバーブ(残響)はConvolverNodeが重いため、川全体で1つだけ共有し、
 *   各レイヤーからの「センド量(送り量)」を変えることで距離による響きの
 *   違いを表現する(ゲームオーディオの一般的な軽量手法)。
 *   遠いレイヤーほどセンド量を多く(響きが豊か)、近いレイヤーほど
 *   センド量を少なく(ドライで直接的)している。
 * - 低域の「集団的なmass」レイヤーは、指示により削除した。
 */
(function () {
  'use strict';
  const SoundEngine = (window.SoundEngine = window.SoundEngine || {});

  function minnaertFreq(radiusMeters) {
    return 3.26 / radiusMeters;
  }

  class River {
    constructor() {
      this.ctx = null;
      this.output = null; // 現状は互換用に保持(直接は未使用)
      this.running = false;
      this.pan = 0;         // シーン全体の左右オフセット(-1〜1)
      this.stereoWidth = 0.85;
      this._relPos = { x: 0, y: 0, z: 0 }; // 3Dゲーム側から渡される、実座標ベースのリスナー相対位置(最寄りの川岸点)

      this.noiseFloorAmount = 0.15;
      this.reverbAmount = 0.5; // 共有リバーブの全体量(各レイヤーのセンドに掛かる)

      this.farVolume = 0.35;
      this.farRateMs = 5;
      this.midVolume = 0.3;
      this.midRateMs = 16;
      this.nearVolume = 0.32;
      this.nearRateMs = 30;

      this.bubbleVolume = 0.5;
      this.bubbleRate = 0.5;
      this.splashAmount = 0.5;

      this._sizeRef = 0.4;
      this._timers = [];
      this.weatherVolume = 1; // 天候による全体音量の倍率(晴れ時は少し弱める、等)
    }

    start() {
      if (this.running) return;
      this.ctx = SoundEngine.getContext();
      const ctx = this.ctx;

      // --- 共有リバーブ(川全体で1つだけ。処理負荷を抑えるため) ---
      this._reverb = ctx.createConvolver();
      this._reverb.buffer = this._createImpulse(2.0, 2.6);
      this._reverbOutGain = ctx.createGain();
      this._reverbOutGain.gain.value = this.reverbAmount;
      this._reverb.connect(this._reverbOutGain);
      this._reverbOutGain.connect(SoundEngine.getAmbientBus());

      // --- 各レイヤーを3D空間上に配置(バイノーラル) ---
      // (baseX, baseY, baseZ, reverbSend, predelaySec)
      this._layers = {
        far:    this._createSpatialLayer(0.3, 0.15, -4.2, 0.6, 0.05),
        mid:    this._createSpatialLayer(0.9, 0.05, -2.0, 0.35, 0.02),
        near:   this._createSpatialLayer(-0.7, -0.15, -0.7, 0.15, 0),
        bubble: this._createSpatialLayer(0.4, -0.25, -0.4, 0.08, 0),
        splash: this._createSpatialLayer(-1.0, 0.0, -1.4, 0.28, 0.03),
      };

      // --- ノイズフロア(方向を持たない、周囲を満たす背景ノイズ) ---
      const noiseFloor = SoundEngine.createNoiseSource('pink', 6);
      const noiseFloorFilter = ctx.createBiquadFilter();
      noiseFloorFilter.type = 'bandpass';
      noiseFloorFilter.frequency.value = 2200;
      noiseFloorFilter.Q.value = 0.5;
      const noiseFloorGain = ctx.createGain();
      noiseFloorGain.gain.value = this.noiseFloorAmount * 0.2;
      noiseFloor.connect(noiseFloorFilter);
      noiseFloorFilter.connect(noiseFloorGain);
      noiseFloorGain.connect(SoundEngine.getAmbientBus());
      noiseFloor.start();

      this._nodes = { noiseFloor, noiseFloorFilter, noiseFloorGain };

      this.running = true;
      Object.values(this._layers).forEach((l) => { l.bus.gain.value = this.weatherVolume; });
      this._applyPanAndWidth();
      this._scheduleLayerPing('far');
      this._scheduleLayerPing('mid');
      this._scheduleLayerPing('near');
      this._scheduleBubbleEvents();
      this._scheduleSplashes();
    }

    stop() {
      if (!this.running) return;
      this.running = false;
      this._timers.forEach((t) => clearTimeout(t));
      this._timers = [];
      const now = this.ctx.currentTime;
      Object.values(this._layers).forEach((l) => l.bus.gain.setTargetAtTime(0, now, 0.4));
      this._nodes.noiseFloorGain.gain.setTargetAtTime(0, now, 0.4);
      setTimeout(() => {
        try {
          this._nodes.noiseFloor.stop();
          Object.values(this._nodes).forEach((n) => n.disconnect && n.disconnect());
          Object.values(this._layers).forEach((l) => {
            SoundEngine.unregisterSpatialSource(l.panner);
            l.bus.disconnect(); l.panner.disconnect(); l.reverbSend.disconnect();
            if (l.predelay) l.predelay.disconnect();
          });
          this._reverb.disconnect();
          this._reverbOutGain.disconnect();
        } catch (e) {}
      }, 900);
    }

    /**
     * レイヤー1つ分の空間ノードを作成する。
     * bus(音源が接続される場所) → panner(HRTFで3D定位) → マスター
     *                             → reverbSend(センド量) → 共有リバーブ
     */
    _createSpatialLayer(baseX, baseY, baseZ, reverbSend, predelaySec) {
      const ctx = this.ctx;
      const bus = ctx.createGain();
      bus.gain.value = 1;

      const layer = { bus, baseX, baseY, baseZ };
      const panner = SoundEngine.createSpatialPanner(
        baseX, baseY, baseZ, true,
        () => ({
          x: layer.baseX * this.stereoWidth + this.pan * 1.5 + this._relPos.x,
          y: layer.baseY + this._relPos.y,
          z: layer.baseZ + this._relPos.z,
        })
      );

      let predelay = null;
      let sendSource = bus;
      if (predelaySec > 0) {
        predelay = ctx.createDelay(0.2);
        predelay.delayTime.value = predelaySec;
        bus.connect(predelay);
        sendSource = predelay;
      }

      const sendGain = ctx.createGain();
      sendGain.gain.value = reverbSend;

      bus.connect(panner);
      panner.connect(SoundEngine.getAmbientBus());
      sendSource.connect(sendGain);
      sendGain.connect(this._reverb);

      layer.panner = panner;
      layer.reverbSend = sendGain;
      layer.predelay = predelay;
      return layer;
    }

    _applyPanAndWidth() {
      if (!this.running) return;
      Object.values(this._layers).forEach((l) => {
        SoundEngine.applySpatialPosition(
          l.panner,
          l.baseX * this.stereoWidth + this.pan * 1.5 + this._relPos.x,
          l.baseY + this._relPos.y,
          l.baseZ + this._relPos.z
        );
      });
    }

    setPan(v) {
      this.pan = SoundEngine.clamp(v, -1, 1);
      this._applyPanAndWidth();
    }

    /**
     * 3Dゲーム側から、プレイヤー(リスナー)から見た「川の最寄り岸辺」の実座標(メートル単位)を渡す。
     * x: 右が正, y: 上が正, z: 手前が正・奥(前方)が負。
     * 各レイヤーの近距離/中距離/遠距離オフセット(baseX/Y/Z)はこの位置からの
     * わずかなズレとして加算されるので、質感(層構造)を保ったまま実距離に追従する。
     */
    setListenerRelativePosition(x, y, z) {
      this._relPos.x = x;
      this._relPos.y = y;
      this._relPos.z = z;
      this._applyPanAndWidth();
    }

    setStereoWidth(v) {
      this.stereoWidth = Math.max(0, Math.min(1.4, v));
      this._applyPanAndWidth();
    }

    setSize(v) {
      const s = Math.max(0, Math.min(1, v));
      this._sizeRef = s;
      this.setFarVolume(0.25 + s * 0.35);
      this.setFarRate(7 - s * 3);
      this.setMidVolume(0.22 + s * 0.25);
      this.setMidRate(22 - s * 10);
      this.setNearVolume(0.22 + s * 0.22);
      this.setNearRate(38 - s * 16);
      this.setBubbleRate(0.3 + s * 0.6);
      this.setSplashAmount(0.3 + s * 0.5);
    }

    /**
     * 天候による川全体の音量倍率。各レイヤーの相対バランス(far/mid/near/bubble/splash)は
     * そのままに、全体としての大きさだけをまとめて上下させる。
     * (例: 晴れの時は少し控えめに、雨・嵐の時は基準どおりにする)
     */
    setWeatherVolume(v) {
      this.weatherVolume = Math.max(0, Math.min(1.5, v));
      if (!this.running) return;
      const now = this.ctx.currentTime;
      Object.values(this._layers).forEach((l) => {
        l.bus.gain.setTargetAtTime(this.weatherVolume, now, 0.8);
      });
    }

    setNoiseFloor(v) {
      this.noiseFloorAmount = Math.max(0, Math.min(1, v));
      if (this._nodes) this._nodes.noiseFloorGain.gain.setTargetAtTime(this.noiseFloorAmount * 0.2, this.ctx.currentTime, 0.3);
    }

    /**
     * 共有リバーブの全体量。各レイヤーのセンド量(距離による違い)はそのままに、
     * 全体としての響きの豊かさをまとめて調整する。
     */
    setReverbAmount(v) {
      this.reverbAmount = Math.max(0, Math.min(1, v));
      if (this._reverbOutGain) this._reverbOutGain.gain.setTargetAtTime(this.reverbAmount, this.ctx.currentTime, 0.3);
    }

    setFarVolume(v) { this.farVolume = Math.max(0, Math.min(1, v)); }
    setFarRate(ms) { this.farRateMs = Math.max(1, ms); }
    setMidVolume(v) { this.midVolume = Math.max(0, Math.min(1, v)); }
    setMidRate(ms) { this.midRateMs = Math.max(1, ms); }
    setNearVolume(v) { this.nearVolume = Math.max(0, Math.min(1, v)); }
    setNearRate(ms) { this.nearRateMs = Math.max(1, ms); }

    setBubbleVolume(v) { this.bubbleVolume = Math.max(0, Math.min(1, v)); }
    setBubbleRate(v) { this.bubbleRate = Math.max(0, Math.min(1, v)); }
    setSplashAmount(v) { this.splashAmount = Math.max(0, Math.min(1, v)); }

    _createImpulse(duration, decay) {
      const c = this.ctx;
      const length = c.sampleRate * duration;
      const impulse = c.createBuffer(2, length, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const data = impulse.getChannelData(ch);
        for (let i = 0; i < length; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
        }
      }
      return impulse;
    }

    _scheduleLayerPing(layer) {
      if (!this.running) return;
      this._playLayerPing(layer);
      const rateMs = layer === 'far' ? this.farRateMs : layer === 'mid' ? this.midRateMs : this.nearRateMs;
      const interval = rateMs * SoundEngine.randomRange(0.3, 2.2);
      const t = setTimeout(() => this._scheduleLayerPing(layer), interval);
      this._timers.push(t);
    }

    _playLayerPing(layer) {
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const config = {
        far: { freqMin: 600, freqMax: 3200, wave: 'sine', dur: [0.006, 0.014], sweep: 1.0, vol: this.farVolume, peakMin: 0.05, peakMax: 0.11 },
        mid: { freqMin: 400, freqMax: 2000, wave: 'sine', dur: [0.02, 0.045], sweep: 0.75, vol: this.midVolume, peakMin: 0.07, peakMax: 0.14 },
        near: { freqMin: 900, freqMax: 6500, wave: 'triangle', dur: [0.006, 0.02], sweep: 0.3, vol: this.nearVolume, peakMin: 0.08, peakMax: 0.17 },
      }[layer];

      const dur = SoundEngine.randomRange(config.dur[0], config.dur[1]);
      const startFreq = SoundEngine.randomRange(config.freqMin, config.freqMax);
      const osc = ctx.createOscillator();
      osc.type = config.wave;
      osc.frequency.setValueAtTime(startFreq, now);
      if (config.sweep < 1) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(60, startFreq * config.sweep), now + dur);
      }

      const g = ctx.createGain();
      const peak = SoundEngine.randomRange(config.peakMin, config.peakMax) * config.vol;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(peak, now + Math.min(0.003, dur * 0.2));
      g.gain.exponentialRampToValueAtTime(0.0005, now + dur);

      osc.connect(g);
      g.connect(this._layers[layer].bus);
      osc.start(now);
      osc.stop(now + dur + 0.03);
      osc.onended = () => {
        try { osc.disconnect(); g.disconnect(); } catch (e) {}
      };
    }

    _sampleBubbleRadius(size) {
      const minR = 0.0008;
      const maxR = 0.004 + size * 0.017;
      const u = Math.random();
      return minR + (maxR - minR) * Math.pow(u, 2.3);
    }

    _scheduleBubbleEvents() {
      if (!this.running) return;
      const eventsPerSec = 6 + this.bubbleRate * 22;
      const gapSec = SoundEngine.randomRange(0.6, 1.4) / eventsPerSec;
      this._playBubbleEvent();
      const t = setTimeout(() => this._scheduleBubbleEvents(), gapSec * 1000);
      this._timers.push(t);
    }

    _playBubbleEvent() {
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const size = this._sizeRef;
      const radius = this._sampleBubbleRadius(size);
      let f0 = minnaertFreq(radius);
      f0 = SoundEngine.clamp(f0, 180, 4200);

      const sizeFactor = SoundEngine.clamp((radius - 0.0008) / 0.02, 0, 1);
      const amp = SoundEngine.randomRange(0.04, 0.08) * (0.5 + sizeFactor * 0.9) * this.bubbleVolume;
      const ringDur = SoundEngine.randomRange(0.04, 0.075) + (1 - Math.min(f0 / 3000, 1)) * 0.05;

      const impulseBuf = SoundEngine.createNoiseBurstBuffer(SoundEngine.randomRange(0.003, 0.006));
      const impulse = ctx.createBufferSource();
      impulse.buffer = impulseBuf;

      const mainFilter = ctx.createBiquadFilter();
      mainFilter.type = 'bandpass';
      mainFilter.frequency.value = f0;
      mainFilter.Q.value = SoundEngine.randomRange(14, 26);
      const mainGain = ctx.createGain();
      mainGain.gain.setValueAtTime(0, now);
      mainGain.gain.linearRampToValueAtTime(amp, now + 0.003);
      mainGain.gain.exponentialRampToValueAtTime(0.001, now + ringDur);

      const subFilter = ctx.createBiquadFilter();
      subFilter.type = 'bandpass';
      subFilter.frequency.value = f0 * SoundEngine.randomRange(1.4, 2.2);
      subFilter.Q.value = SoundEngine.randomRange(6, 12);
      const subGain = ctx.createGain();
      const subRingDur = ringDur * SoundEngine.randomRange(0.5, 0.8);
      subGain.gain.setValueAtTime(0, now);
      subGain.gain.linearRampToValueAtTime(amp * SoundEngine.randomRange(0.2, 0.4), now + 0.002);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + subRingDur);

      const bus = this._layers.bubble.bus;
      impulse.connect(mainFilter);
      impulse.connect(subFilter);
      mainFilter.connect(mainGain);
      subFilter.connect(subGain);
      mainGain.connect(bus);
      subGain.connect(bus);

      impulse.start(now);
      impulse.stop(now + Math.max(ringDur, subRingDur) + 0.03);
      impulse.onended = () => {
        try {
          impulse.disconnect();
          mainFilter.disconnect(); mainGain.disconnect();
          subFilter.disconnect(); subGain.disconnect();
        } catch (e) {}
      };

      const burstProb = 0.22 + size * 0.25;
      if (Math.random() < burstProb) {
        const t = setTimeout(() => { if (this.running) this._playBubbleBurst(size); }, ringDur * 1000 * SoundEngine.randomRange(0.3, 0.8));
        this._timers.push(t);
      }
    }

    _playBubbleBurst(size) {
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const dur = SoundEngine.randomRange(0.015, 0.035);
      const buf = SoundEngine.createNoiseBurstBuffer(dur);
      const src = ctx.createBufferSource();
      src.buffer = buf;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = SoundEngine.randomRange(2500, 6000) * (1 - size * 0.25);
      filter.Q.value = SoundEngine.randomRange(2, 4);

      const g = ctx.createGain();
      const peak = SoundEngine.randomRange(0.015, 0.035) * this.bubbleVolume;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(peak, now + 0.002);
      g.gain.exponentialRampToValueAtTime(0.001, now + dur);

      src.connect(filter);
      filter.connect(g);
      g.connect(this._layers.bubble.bus);
      src.start(now);
      src.stop(now + dur + 0.02);
      src.onended = () => {
        try { src.disconnect(); filter.disconnect(); g.disconnect(); } catch (e) {}
      };
    }

    _scheduleSplashes() {
      if (!this.running) return;
      const size = this._sizeRef;
      const gap = SoundEngine.randomRange(1.2, 2.8) - size * 0.5;
      if (Math.random() < 0.35 + this.splashAmount * 0.5) {
        this._playSplash(size);
      }
      const t = setTimeout(() => this._scheduleSplashes(), gap * 1000);
      this._timers.push(t);
    }

    _playSplash(size) {
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const dur = SoundEngine.randomRange(0.1, 0.22);
      const buf = SoundEngine.createNoiseBurstBuffer(dur);
      const src = ctx.createBufferSource();
      src.buffer = buf;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      const freq = SoundEngine.randomRange(500, 1400) * (1 - size * 0.35);
      filter.Q.value = SoundEngine.randomRange(2, 4);
      filter.frequency.setValueAtTime(freq, now);
      filter.frequency.exponentialRampToValueAtTime(freq * 0.7, now + dur);

      const g = ctx.createGain();
      const peak = SoundEngine.randomRange(0.06, 0.13) * (0.6 + size * 0.5) * this.splashAmount;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(peak, now + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, now + dur);

      src.connect(filter);
      filter.connect(g);
      g.connect(this._layers.splash.bus);
      src.start(now);
      src.stop(now + dur + 0.05);
      src.onended = () => {
        try { src.disconnect(); filter.disconnect(); g.disconnect(); } catch (e) {}
      };
    }
  }

  SoundEngine.River = River;
})();
