/**
 * fire.js
 * 焚き火の音のシンセサイズ。
 *
 * 「唸り(ロー、低域の風のような持続音)」と「パチパチ(クラックル)」は
 * 独立したパラメータとして分離している(roar と crackle)。
 * 以前は1つの intensity で両方を制御していたため、パチパチを強めると
 * 唸りまで大きくなってしまう問題があった。
 *
 * - roar: ブラウンノイズをローパスした低い持続音(0=消えかけ 〜 1=盛んな火)
 * - crackle: 薪がはぜる音の頻度・激しさ(0=静か 〜 1=よくはぜる)
 *
 * クラックル音は以下の3要素で構成し、よりリアルな質感を狙う:
 *   1) アタック・クリック(接触/破裂の瞬間、ごく短い広帯域ノイズ)
 *   2) 共鳴スナップ(高Qバンドパスで木材が弾ける「パチッ」という短い響き)
 *   3) まれに発生する「大きい爆ぜ」(上記2つに低めの衝撃成分を追加した二重ポップ)
 */
(function () {
  'use strict';
  const SoundEngine = (window.SoundEngine = window.SoundEngine || {});

  class Fire {
    constructor() {
      this.ctx = null;
      this.output = null;
      this.roar = 0.5;     // 唸り(持続音)の強さ 0-1
      this.crackle = 0.5;  // パチパチ音の強さ 0-1
      this.running = false;
      this.pan = 0;
      this._basePos = { x: 0, y: -0.4, z: -1.3 }; // 地面近く、正面
      this._relPos = { x: 0, y: 0, z: 0 }; // 3Dゲーム側から渡される、実座標ベースのリスナー相対位置
      this._crackleTimer = null;
    }

    start() {
      if (this.running) return;
      this.ctx = SoundEngine.getContext();
      const ctx = this.ctx;
      this.output = ctx.createGain();
      this.output.gain.value = 1;
      this.panner = SoundEngine.createSpatialPanner(
        this._basePos.x, this._basePos.y, this._basePos.z,
        true, () => ({
          x: this._basePos.x + this._relPos.x,
          y: this._basePos.y + this._relPos.y,
          z: this._basePos.z + this._relPos.z,
        })
      );
      this.output.connect(this.panner);
      this.panner.connect(SoundEngine.getAmbientBus());

      // --- 唸り(ロー)レイヤー ---
      const roarNoise = SoundEngine.createNoiseSource('brown', 5);
      const roarFilter = ctx.createBiquadFilter();
      roarFilter.type = 'lowpass';
      roarFilter.frequency.value = 400;
      const roarGain = ctx.createGain();
      roarGain.gain.value = 0;

      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.5;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.05;
      lfo.connect(lfoGain);
      lfoGain.connect(roarGain.gain);
      lfo.start();

      roarNoise.connect(roarFilter);
      roarFilter.connect(roarGain);
      roarGain.connect(this.output);
      roarNoise.start();

      // --- パチパチ(クラックル)用の出力バス(唸りとは別ゲイン) ---
      const crackleBus = ctx.createGain();
      crackleBus.gain.value = 1;
      crackleBus.connect(this.output);

      this._nodes = { roarNoise, roarFilter, roarGain, lfo, lfoGain, crackleBus };
      this.running = true;
      this._scheduleCrackles();
      this.setRoar(this.roar);
      this.setCrackle(this.crackle);
    }

    stop() {
      if (!this.running) return;
      this.running = false;
      clearTimeout(this._crackleTimer);
      const now = this.ctx.currentTime;
      this.output.gain.setTargetAtTime(0, now, 0.3);
      const n = this._nodes;
      setTimeout(() => {
        try {
          n.roarNoise.stop();
          n.lfo.stop();
          Object.values(n).forEach((node) => node.disconnect && node.disconnect());
          this.output.disconnect();
          SoundEngine.unregisterSpatialSource(this.panner);
          this.panner.disconnect();
        } catch (e) {}
      }, 500);
    }

    setPan(v) {
      this.pan = SoundEngine.clamp(v, -1, 1);
      this._basePos.x = this.pan * 1.5;
      this._applyPosition();
    }

    /**
     * 3Dゲーム側から、プレイヤー(リスナー)から見た焚き火の実座標(メートル単位)を渡す。
     * x: 右が正, y: 上が正, z: 手前(プレイヤー側)が正・奥(前方)が負。
     * PannerNodeの距離減衰(distanceModel: inverse)がそのまま効くので、
     * 近づけば大きく、遠ざかれば小さくなる。
     */
    setListenerRelativePosition(x, y, z) {
      this._relPos.x = x;
      this._relPos.y = y;
      this._relPos.z = z;
      this._applyPosition();
    }

    _applyPosition() {
      if (!this.panner) return;
      SoundEngine.applySpatialPosition(
        this.panner,
        this._basePos.x + this._relPos.x,
        this._basePos.y + this._relPos.y,
        this._basePos.z + this._relPos.z
      );
    }

    /**
     * @param {number} v 唸り(持続音)の強さ 0-1
     */
    setRoar(v) {
      this.roar = Math.max(0, Math.min(1, v));
      if (!this.running) return;
      const now = this.ctx.currentTime;
      const vol = 0.02 + this.roar * 0.16;
      this._nodes.roarGain.gain.setTargetAtTime(vol, now, 0.5);
      this._nodes.roarFilter.frequency.setTargetAtTime(220 + this.roar * 300, now, 0.5);
    }

    /**
     * @param {number} v パチパチ音の強さ(頻度・音量)0-1。roarとは独立。
     */
    setCrackle(v) {
      this.crackle = Math.max(0, Math.min(1, v));
    }

    // 旧APIとの互換用(全体の勢い=roarとして扱う)
    setIntensity(v) {
      this.setRoar(v);
    }

    _scheduleCrackles() {
      if (!this.running) return;
      const c = this.crackle;
      const gap = SoundEngine.randomRange(0.08, 0.6) / (0.15 + c * 1.6);
      if (c > 0.01 && Math.random() < 0.35 + c * 0.55) {
        this._playCrackle(c);
      }
      this._crackleTimer = setTimeout(() => this._scheduleCrackles(), gap * 1000);
    }

    _playCrackle(c) {
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const isBigPop = Math.random() < 0.1 + c * 0.15;

      // 1) アタック・クリック
      const clickDur = isBigPop ? SoundEngine.randomRange(0.008, 0.02) : SoundEngine.randomRange(0.002, 0.008);
      const clickBuf = SoundEngine.createNoiseBurstBuffer(clickDur);
      const clickSrc = ctx.createBufferSource();
      clickSrc.buffer = clickBuf;
      const clickFilter = ctx.createBiquadFilter();
      clickFilter.type = 'highpass';
      clickFilter.frequency.value = isBigPop ? 900 : 2500;
      const clickGain = ctx.createGain();
      clickGain.gain.value = (isBigPop ? SoundEngine.randomRange(0.15, 0.3) : SoundEngine.randomRange(0.04, 0.1)) * (0.4 + c * 1.0);
      clickSrc.connect(clickFilter);
      clickFilter.connect(clickGain);
      clickGain.connect(this._nodes.crackleBus);
      clickSrc.start(now);

      // 2) 共鳴スナップ(木が弾ける響き)
      const ringBuf = SoundEngine.createNoiseBurstBuffer(SoundEngine.randomRange(0.02, 0.05));
      const ringSrc = ctx.createBufferSource();
      ringSrc.buffer = ringBuf;
      const ringFilter = ctx.createBiquadFilter();
      ringFilter.type = 'bandpass';
      ringFilter.frequency.value = SoundEngine.randomRange(1200, 4500);
      ringFilter.Q.value = SoundEngine.randomRange(8, 18);
      const ringGain = ctx.createGain();
      const ringPeak = (isBigPop ? SoundEngine.randomRange(0.12, 0.22) : SoundEngine.randomRange(0.03, 0.09)) * (0.4 + c * 1.0);
      ringGain.gain.setValueAtTime(0, now);
      ringGain.gain.linearRampToValueAtTime(ringPeak, now + 0.003);
      ringGain.gain.exponentialRampToValueAtTime(0.001, now + SoundEngine.randomRange(0.04, 0.09));
      ringSrc.connect(ringFilter);
      ringFilter.connect(ringGain);
      ringGain.connect(this._nodes.crackleBus);
      ringSrc.start(now);

      // 3) 大きい爆ぜの場合、低めの衝撃成分を追加(二重ポップ)
      if (isBigPop) {
        const thumpOsc = ctx.createOscillator();
        thumpOsc.type = 'sine';
        thumpOsc.frequency.setValueAtTime(SoundEngine.randomRange(140, 220), now);
        thumpOsc.frequency.exponentialRampToValueAtTime(70, now + 0.06);
        const thumpGain = ctx.createGain();
        thumpGain.gain.setValueAtTime(0, now);
        thumpGain.gain.linearRampToValueAtTime(SoundEngine.randomRange(0.1, 0.18) * (0.5 + c), now + 0.004);
        thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
        thumpOsc.connect(thumpGain);
        thumpGain.connect(this._nodes.crackleBus);
        thumpOsc.start(now);
        thumpOsc.stop(now + 0.1);
        thumpOsc.onended = () => { try { thumpOsc.disconnect(); thumpGain.disconnect(); } catch (e) {} };

        // 少し遅れて2発目の小さいスナップ(はぜて破片が跳ねる感じ)
        const delay = SoundEngine.randomRange(0.03, 0.08);
        setTimeout(() => { if (this.running) this._playCrackle(c * 0.5); }, delay * 1000);
      }

      const cleanup = () => {
        try {
          clickSrc.disconnect(); clickFilter.disconnect(); clickGain.disconnect();
          ringSrc.disconnect(); ringFilter.disconnect(); ringGain.disconnect();
        } catch (e) {}
      };
      clickSrc.onended = cleanup;
    }
  }

  SoundEngine.Fire = Fire;
})();
