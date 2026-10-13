/**
 * rain.js
 * 雨音のシンセサイズ。
 *
 * 【シーン設定: 川辺の大木の下にテントを張ったキャンプ】
 * 雨粒は同じ「雨」でも、何に当たるかで質感も定位も変わる。このシーンでは
 * 主に4つの落下先を想定し、それぞれ固有の定位(3D位置)と共鳴特性を持たせている:
 *   - tent   : テントの天井(頭上すぐ近く)。張られた布(幕面)の共鳴で
 *              「ポツ、パツ」という張りのある音。
 *   - canopy : 頭上の大木の葉。葉に当たる柔らかい高めの音、輪郭がやや曖昧。
 *   - river  : 川の水面(やや離れた方向)。水面特有の柔らかい「ピチャ」。
 *   - ground : その他の地面・下草。低めで鈍い音。
 * 各drop生成時にこれらの重み付き確率でどこに落ちたかを決め、対応する
 * ゾーンのバス(固定3D位置のPannerNodeに接続済み)へ音を送る。
 *
 * 【雨粒の質感(粒の大きさ)】
 * 「粒が小さく感じる」という指摘を受け、以下を強化した:
 *   - 衝突(インパクト)のエネルギーを底上げ
 *   - 一定確率で「大粒」を混ぜる(低め・長め・大きめの共鳴)
 *   - モーダル共鳴のQ・リング時間を落下先ごとに調整し、量感を出す
 *
 * 【研究に基づく物理モデル】
 * 雨粒の音は「衝突」+「巻き込まれた気泡の振動(モーダル共鳴)」の2要素からなる
 * (ACM TOG "Physically-based statistical simulation of rain sound" 等)。
 * オシレーターのスイープではなく、ノイズインパルス→共鳴フィルタで構成している。
 *
 * 【樹冠の溜まり雫(canopy drip)】
 * 通常のcanopy落下音(細かい葉音)とは別に、木の葉に溜まった雨が時々
 * まとまって「ドボドボ」と落ちてくる、低めで量感のあるイベントを
 * 低頻度(ポアソン過程)で追加できる(setCanopyDrips/setCanopyDripAmount)。
 */
(function () {
  'use strict';
  const SoundEngine = (window.SoundEngine = window.SoundEngine || {});

  const MIN_DROP_RATE = 0.15;
  const MAX_DROP_RATE = 260;

  // 落下先ごとの共鳴特性(モーダル共鳴の周波数帯・Q・リング時間)
  const IMPACT_MATERIALS = {
    tent: { freqMin: 320, freqMax: 850, q: [7, 13], ringMs: [18, 42], impactMul: 1.3, tone: 'taut' },
    canopy: { freqMin: 1800, freqMax: 4000, q: [6, 13], ringMs: [14, 32], impactMul: 0.9, tone: 'soft' },
    river: { freqMin: 500, freqMax: 1300, q: [4, 8], ringMs: [30, 60], impactMul: 0.6, tone: 'water' },
    ground: { freqMin: 350, freqMax: 950, q: [3, 7], ringMs: [20, 45], impactMul: 1.0, tone: 'dull' },
  };

  class Rain {
    constructor() {
      this.ctx = null;
      this.ambientBus = null;
      this.intensity = 0.4;
      this.running = false;
      this.surfaceDropsEnabled = false;
      this.surfaceDropAmount = 0.5;
      this.attackDropsEnabled = false;
      this.attackDropAmount = 0.5;
      this.canopyDripsEnabled = false;
      this.canopyDripAmount = 0.5;
      this._dropTimer = null;
      this._surfaceTimer = null;
      this._attackTimer = null;
      this._canopyDripTimer = null;
      this._nodes = {};
      this._zones = {};
    }

    start() {
      if (this.running) return;
      this.ctx = SoundEngine.getContext();

      this.ambientBus = this.ctx.createGain();
      this.ambientBus.gain.value = 0;
      this.ambientBus.connect(SoundEngine.getAmbientBus());

      // --- シーンに合わせた落下先ゾーン(3D定位 + 重み) ---
      // テント=頭上すぐ近く、樹冠=頭上やや離れて広がる、川面=川の方向、
      // 地面=周囲一帯。重みは「テントの下でキャンプしている」状況を想定し
      // テント・樹冠への落下が多めになるようにしている。
      const zoneDefs = [
        { key: 'tent', pos: { x: 0, y: 1.7, z: -0.3 }, weight: 0.4, material: IMPACT_MATERIALS.tent },
        { key: 'canopy', pos: { x: 0.9, y: 4.5, z: -1.0 }, weight: 0.32, material: IMPACT_MATERIALS.canopy },
        { key: 'river', pos: { x: 0.6, y: 0.6, z: -3.8 }, weight: 0.16, material: IMPACT_MATERIALS.river },
        { key: 'ground', pos: { x: -1.6, y: 1.0, z: 1.3 }, weight: 0.12, material: IMPACT_MATERIALS.ground },
      ];
      this._zones = {};
      zoneDefs.forEach((z) => {
        const bus = this.ctx.createGain();
        bus.gain.value = 1;
        const panner = SoundEngine.createSpatialPanner(z.pos.x, z.pos.y, z.pos.z, true, () => z.pos);
        bus.connect(panner);
        panner.connect(SoundEngine.getAmbientBus());
        this._zones[z.key] = { bus, panner, weight: z.weight, material: z.material };
      });

      const noise = SoundEngine.createNoiseSource('white', 4);
      const bandpass = this.ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.value = 6000;
      bandpass.Q.value = 0.6;

      const highshelf = this.ctx.createBiquadFilter();
      highshelf.type = 'highshelf';
      highshelf.frequency.value = 5000;
      highshelf.gain.value = 4;

      const baseGain = this.ctx.createGain();
      baseGain.gain.value = 0.3;

      noise.connect(bandpass);
      bandpass.connect(highshelf);
      highshelf.connect(baseGain);
      baseGain.connect(this.ambientBus);
      noise.start();

      this._nodes = { noise, bandpass, highshelf, baseGain };
      this.running = true;

      this._scheduleDrops();
      this._scheduleSurfaceDrops();
      this._scheduleAttackDrops();
      this._scheduleCanopyDrips();
      this.setIntensity(this.intensity);
    }

    stop() {
      if (!this.running) return;
      this.running = false;
      clearTimeout(this._dropTimer);
      clearTimeout(this._surfaceTimer);
      clearTimeout(this._attackTimer);
      clearTimeout(this._canopyDripTimer);
      const now = this.ctx.currentTime;
      this.ambientBus.gain.setTargetAtTime(0, now, 0.3);
      Object.values(this._zones).forEach((z) => z.bus.gain.setTargetAtTime(0, now, 0.3));
      const nodes = this._nodes;
      setTimeout(() => {
        try {
          nodes.noise.stop();
          nodes.noise.disconnect();
          nodes.bandpass.disconnect();
          nodes.highshelf.disconnect();
          nodes.baseGain.disconnect();
          this.ambientBus.disconnect();
          Object.values(this._zones).forEach((z) => {
            SoundEngine.unregisterSpatialSource(z.panner);
            z.bus.disconnect(); z.panner.disconnect();
          });
        } catch (e) {}
      }, 500);
    }

    _pickZone() {
      const zones = Object.values(this._zones);
      const total = zones.reduce((s, z) => s + z.weight, 0);
      let r = Math.random() * total;
      for (const z of zones) {
        if (r < z.weight) return z;
        r -= z.weight;
      }
      return zones[0];
    }

    setIntensity(v) {
      this.intensity = Math.max(0, Math.min(1, v));
      if (!this.running) return;
      const now = this.ctx.currentTime;
      // 「サーッ」という滑らかな面音(wash)は控えめにし、個々の粒(グレイン)の
      // 存在感を相対的に際立たせて「粒子の粗さ」を感じられるようにする
      const vol = Math.pow(this.intensity, 1.8) * 0.42;
      this.ambientBus.gain.setTargetAtTime(vol, now, 0.4);
      const freq = 7500 - this.intensity * 3500;
      this._nodes.bandpass.frequency.setTargetAtTime(freq, now, 0.4);
      this._nodes.bandpass.Q.setTargetAtTime(0.5 + this.intensity * 0.7, now, 0.4);
    }

    setSurfaceDrops(enabled) { this.surfaceDropsEnabled = enabled; }
    setSurfaceDropAmount(v) { this.surfaceDropAmount = Math.max(0, Math.min(1, v)); }
    setAttackDrops(enabled) { this.attackDropsEnabled = enabled; }
    setAttackDropAmount(v) { this.attackDropAmount = Math.max(0, Math.min(1, v)); }
    setCanopyDrips(enabled) { this.canopyDripsEnabled = enabled; }
    setCanopyDripAmount(v) { this.canopyDripAmount = Math.max(0, Math.min(1, v)); }

    _scheduleDrops() {
      if (!this.running) return;
      const rate = SoundEngine.expInterp(MIN_DROP_RATE, MAX_DROP_RATE, this.intensity);
      const gapSec = SoundEngine.poissonGapSeconds(rate);
      this._playDrop(this.intensity, rate);
      this._dropTimer = setTimeout(() => this._scheduleDrops(), gapSec * 1000);
    }

    /**
     * 基本ドロップ: 「衝突」+「モーダル共鳴」。落下先ゾーンをシーンの重みに従って
     * 選び、約22%の確率で「大粒」(低め・長め・大きめ)を混ぜて量感を出す。
     */
    _playDrop(intensity, rate) {
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const rateFactor = SoundEngine.clamp(1.3 - rate / MAX_DROP_RATE, 0.55, 1.3);
      const zone = this._pickZone();
      const bus = zone.bus;
      const mat = zone.material;

      const isBigDrop = Math.random() < 0.22 + intensity * 0.1;
      const sizeMul = isBigDrop ? SoundEngine.randomRange(1.5, 2.2) : SoundEngine.randomRange(0.85, 1.15);
      const pitchMul = isBigDrop ? SoundEngine.randomRange(0.55, 0.75) : 1;

      // 1) 衝突(インパクト)
      const impactDur = SoundEngine.randomRange(0.003, 0.007) * (isBigDrop ? 1.4 : 1);
      const impactBuf = SoundEngine.createNoiseBurstBuffer(impactDur);
      const impactSrc = ctx.createBufferSource();
      impactSrc.buffer = impactBuf;
      const impactGain = ctx.createGain();
      impactGain.gain.value = SoundEngine.randomRange(0.07, 0.14) * rateFactor * mat.impactMul * sizeMul;
      impactSrc.connect(impactGain);
      impactGain.connect(bus);
      impactSrc.start(now);
      impactSrc.stop(now + impactDur + 0.01);

      // 2) モーダル共鳴(気泡振動/膜振動の近似)
      const ringDur = (SoundEngine.randomRange(mat.ringMs[0], mat.ringMs[1]) / 1000) * (isBigDrop ? 1.5 : 1);
      const resonBuf = SoundEngine.createNoiseBurstBuffer(SoundEngine.randomRange(0.002, 0.005));
      const resonSrc = ctx.createBufferSource();
      resonSrc.buffer = resonBuf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = SoundEngine.randomRange(mat.freqMin, mat.freqMax) * (1 - intensity * 0.1) * pitchMul;
      filter.Q.value = SoundEngine.randomRange(mat.q[0], mat.q[1]);
      const g = ctx.createGain();
      const peak = SoundEngine.randomRange(0.13, 0.26) * rateFactor * sizeMul;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(peak, now + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0007, now + ringDur);

      resonSrc.connect(filter);
      filter.connect(g);
      g.connect(bus);
      resonSrc.start(now);
      resonSrc.stop(now + ringDur + 0.02);

      // 大粒の場合、低いサブの「ドスッ」という重みを少し足す
      let subOsc = null, subGain = null;
      if (isBigDrop) {
        subOsc = ctx.createBufferSource();
        subOsc.buffer = SoundEngine.createNoiseBurstBuffer(SoundEngine.randomRange(0.01, 0.02));
        const subFilter = ctx.createBiquadFilter();
        subFilter.type = 'lowpass';
        subFilter.frequency.value = SoundEngine.randomRange(180, 320);
        subGain = ctx.createGain();
        subGain.gain.setValueAtTime(0, now);
        subGain.gain.linearRampToValueAtTime(SoundEngine.randomRange(0.05, 0.1) * rateFactor, now + 0.004);
        subGain.gain.exponentialRampToValueAtTime(0.001, now + ringDur * 0.8);
        subOsc.connect(subFilter);
        subFilter.connect(subGain);
        subGain.connect(bus);
        subOsc.start(now);
        subOsc.stop(now + ringDur + 0.02);
      }

      resonSrc.onended = () => {
        try {
          impactSrc.disconnect(); impactGain.disconnect();
          resonSrc.disconnect(); filter.disconnect(); g.disconnect();
          if (subOsc) { subOsc.disconnect(); subGain.disconnect(); }
        } catch (e) {}
      };
    }

    _scheduleSurfaceDrops() {
      if (!this.running) return;
      const amt = this.surfaceDropAmount;
      const rate = SoundEngine.expInterp(0.3, 12, amt);
      const gapSec = SoundEngine.poissonGapSeconds(rate);
      if (this.surfaceDropsEnabled) this._playSurfaceDrop(amt);
      this._surfaceTimer = setTimeout(() => this._scheduleSurfaceDrops(), gapSec * 1000);
    }

    /**
     * 表面インパクト音(ポコン/泡っぽい)。川面や水たまりを想定し、
     * riverゾーン寄りに定位しやすくしている(存在すれば)。
     */
    _playSurfaceDrop(amt) {
      const ctx = this.ctx;
      const now = ctx.currentTime;
      // river寄りの水面インパクトとして扱う(river zoneが無ければランダム)
      const bus = (this._zones.river && Math.random() < 0.6 ? this._zones.river : this._pickZone()).bus;

      const clickBuf = SoundEngine.createNoiseBurstBuffer(0.004);
      const clickSrc = ctx.createBufferSource();
      clickSrc.buffer = clickBuf;
      const clickFilter = ctx.createBiquadFilter();
      clickFilter.type = 'highpass';
      clickFilter.frequency.value = 1200;
      const clickGain = ctx.createGain();
      clickGain.gain.value = SoundEngine.randomRange(0.06, 0.12) * (0.6 + amt * 0.7);
      clickSrc.connect(clickFilter);
      clickFilter.connect(clickGain);
      clickGain.connect(bus);
      clickSrc.start(now);
      clickSrc.stop(now + 0.02);

      const ringDur = SoundEngine.randomRange(0.06, 0.13);
      const f0 = SoundEngine.randomRange(400, 1300);
      const impulseBuf = SoundEngine.createNoiseBurstBuffer(0.004);
      const impulse = ctx.createBufferSource();
      impulse.buffer = impulseBuf;
      const mainFilter = ctx.createBiquadFilter();
      mainFilter.type = 'bandpass';
      mainFilter.frequency.value = f0;
      mainFilter.Q.value = SoundEngine.randomRange(9, 16);
      const mainGain = ctx.createGain();
      const peak = SoundEngine.randomRange(0.09, 0.18) * (0.6 + amt * 0.7);
      mainGain.gain.setValueAtTime(0, now);
      mainGain.gain.linearRampToValueAtTime(peak, now + 0.003);
      mainGain.gain.exponentialRampToValueAtTime(0.001, now + ringDur);

      const subFilter = ctx.createBiquadFilter();
      subFilter.type = 'bandpass';
      subFilter.frequency.value = f0 * SoundEngine.randomRange(1.5, 2.1);
      subFilter.Q.value = SoundEngine.randomRange(5, 9);
      const subGain = ctx.createGain();
      const subRingDur = ringDur * 0.6;
      subGain.gain.setValueAtTime(0, now);
      subGain.gain.linearRampToValueAtTime(peak * 0.35, now + 0.002);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + subRingDur);

      impulse.connect(mainFilter);
      impulse.connect(subFilter);
      mainFilter.connect(mainGain);
      subFilter.connect(subGain);
      mainGain.connect(bus);
      subGain.connect(bus);
      impulse.start(now);
      impulse.stop(now + ringDur + 0.02);

      impulse.onended = () => {
        try {
          clickSrc.disconnect(); clickFilter.disconnect(); clickGain.disconnect();
          impulse.disconnect(); mainFilter.disconnect(); mainGain.disconnect();
          subFilter.disconnect(); subGain.disconnect();
        } catch (e) {}
      };
    }

    _scheduleAttackDrops() {
      if (!this.running) return;
      const amt = this.attackDropAmount;
      const rate = SoundEngine.expInterp(0.3, 10, amt);
      const gapSec = SoundEngine.poissonGapSeconds(rate);
      if (this.attackDropsEnabled) this._playAttackDrop(amt);
      this._attackTimer = setTimeout(() => this._scheduleAttackDrops(), gapSec * 1000);
    }

    /**
     * アタックドロップ(コツン/硬質): テントのポール・木の枝など、硬い物に
     * 当たったような、より鋭く硬質な質感。
     */
    _playAttackDrop(amt) {
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const bus = (this._zones.tent && Math.random() < 0.5 ? this._zones.tent : this._pickZone()).bus;

      const clickBuf = SoundEngine.createNoiseBurstBuffer(0.002);
      const clickSrc = ctx.createBufferSource();
      clickSrc.buffer = clickBuf;
      const clickFilter = ctx.createBiquadFilter();
      clickFilter.type = 'highpass';
      clickFilter.frequency.value = 3000;
      const clickGain = ctx.createGain();
      clickGain.gain.value = SoundEngine.randomRange(0.16, 0.26) * (0.55 + amt * 0.7);
      clickSrc.connect(clickFilter);
      clickFilter.connect(clickGain);
      clickGain.connect(bus);
      clickSrc.start(now);
      clickSrc.stop(now + 0.01);

      const ringDur = SoundEngine.randomRange(0.02, 0.045);
      const impulseBuf = SoundEngine.createNoiseBurstBuffer(0.002);
      const impulse = ctx.createBufferSource();
      impulse.buffer = impulseBuf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = SoundEngine.randomRange(1800, 4200);
      filter.Q.value = SoundEngine.randomRange(14, 24);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(SoundEngine.randomRange(0.12, 0.24) * (0.55 + amt * 0.7), now + 0.002);
      g.gain.exponentialRampToValueAtTime(0.001, now + ringDur);
      impulse.connect(filter);
      filter.connect(g);
      g.connect(bus);
      impulse.start(now);
      impulse.stop(now + ringDur + 0.02);

      impulse.onended = () => {
        try {
          clickSrc.disconnect(); clickFilter.disconnect(); clickGain.disconnect();
          impulse.disconnect(); filter.disconnect(); g.disconnect();
        } catch (e) {}
      };
    }

    _scheduleCanopyDrips() {
      if (!this.running) return;
      const amt = this.canopyDripAmount;
      // 「木の下に溜まった雨が、時々ドボッと大粒で落ちてくる」を想定した、
      // 比較的まばらな間隔(基本ドロップやアタックドロップよりずっと遅い)
      const rate = SoundEngine.expInterp(0.12, 1.4, amt);
      const gapSec = SoundEngine.poissonGapSeconds(rate);
      if (this.canopyDripsEnabled) this._playCanopyDrip(amt);
      this._canopyDripTimer = setTimeout(() => this._scheduleCanopyDrips(), gapSec * 1000);
    }

    /**
     * 樹冠に溜まった雨粒が、通常の葉音より大きなかたまりになって落ちる音。
     * 「ドボッ」という低めの水音を2段(わずかにずらして)重ね、量感のある
     * 「ドボドボ」という質感にする。canopyゾーンのやや近く・低めに定位する。
     */
    _playCanopyDrip(amt) {
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const bus = (this._zones.canopy || this._pickZone()).bus;

      const playThud = (t0, sizeMul) => {
        const ringDur = SoundEngine.randomRange(0.09, 0.16) * sizeMul;
        const f0 = SoundEngine.randomRange(220, 420) / sizeMul;

        const impulseBuf = SoundEngine.createNoiseBurstBuffer(0.006);
        const impulse = ctx.createBufferSource();
        impulse.buffer = impulseBuf;
        const mainFilter = ctx.createBiquadFilter();
        mainFilter.type = 'bandpass';
        mainFilter.frequency.value = f0;
        mainFilter.Q.value = SoundEngine.randomRange(4, 7);
        const mainGain = ctx.createGain();
        const peak = SoundEngine.randomRange(0.16, 0.26) * (0.6 + amt * 0.7) * sizeMul;
        mainGain.gain.setValueAtTime(0, t0);
        mainGain.gain.linearRampToValueAtTime(peak, t0 + 0.006);
        mainGain.gain.exponentialRampToValueAtTime(0.001, t0 + ringDur);

        const lowFilter = ctx.createBiquadFilter();
        lowFilter.type = 'lowpass';
        lowFilter.frequency.value = SoundEngine.randomRange(140, 260);
        const lowGain = ctx.createGain();
        lowGain.gain.setValueAtTime(0, t0);
        lowGain.gain.linearRampToValueAtTime(peak * 0.55, t0 + 0.01);
        lowGain.gain.exponentialRampToValueAtTime(0.001, t0 + ringDur * 0.85);

        impulse.connect(mainFilter);
        impulse.connect(lowFilter);
        mainFilter.connect(mainGain);
        lowFilter.connect(lowGain);
        mainGain.connect(bus);
        lowGain.connect(bus);
        impulse.start(t0);
        impulse.stop(t0 + ringDur + 0.02);
        impulse.onended = () => {
          try {
            impulse.disconnect(); mainFilter.disconnect(); mainGain.disconnect();
            lowFilter.disconnect(); lowGain.disconnect();
          } catch (e) {}
        };
      };

      // 「ドボ」+ 少し遅れて「ドボ」の2段。2発目は少し小さめにして自然な減衰感を出す
      playThud(now, SoundEngine.randomRange(0.9, 1.3));
      const gap = SoundEngine.randomRange(0.07, 0.15);
      setTimeout(() => { if (this.running) playThud(ctx.currentTime, SoundEngine.randomRange(0.6, 0.9)); }, gap * 1000);
    }
  }

  SoundEngine.Rain = Rain;
})();
