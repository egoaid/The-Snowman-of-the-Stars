/**
 * thunder.js
 * 雷鳴のシンセサイズ(学術研究「Advances in Thunder Sound Synthesis」
 * (Fineberg, Walters, Reiss, AES 2022)の知見を反映して設計)。
 *
 * その論文で指摘されている「シンセっぽく聞こえる」原因と対策:
 *  - フィルターの共鳴(Q値)が高すぎると音程感が出てしまう
 *    → クラックのバンドパスは Q=6〜7 程度に抑える(論文もQ=10→7に下げて改善)
 *  - 単純な指数減衰の音量エンベロープは「完璧すぎて」不自然に聞こえる
 *    → ノイズ由来の不規則なエンベロープカーブ(setValueCurveAtTime)を使い、
 *      「ゴロゴロ」という自然なうねりを作る(論文の"Rumbler"サブモデルに相当)
 *  - オシレーターの正弦波ベースの重低音はどうしても「音程」を感じさせやすい
 *    → 重低音(Deepener相当)もオシレーターではなくノイズ+フィルタで構成する
 *  - 初撃(クラック)とロールの音量差が唐突
 *    → ダイナミクスコンプレッサーで自然になじませる(論文のPost Processingに相当)
 *
 * 構成: 1) マルチストライク(クラック) 2) ローラー(ゴロゴロのロール) 3) ディープナー(低域の量感)
 */
(function () {
  'use strict';
  const SoundEngine = (window.SoundEngine = window.SoundEngine || {});

  class Thunder {
    constructor() {
      this.ctx = null;
      this.output = null;
      this.compressor = null;
      this.running = false;
      this.autoIntensity = 0;
      this.spread = 0.7; // 0-1: 雷が鳴る方向のランダムな広がり(定位)
      this._autoTimer = null;
    }

    start() {
      if (this.running) return;
      this.ctx = SoundEngine.getContext();
      this.output = this.ctx.createGain();
      this.output.gain.value = 0.9;

      // クラックとロールの音量差を自然になじませるコンプレッサー
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -20;
      this.compressor.knee.value = 20;
      this.compressor.ratio.value = 12;
      this.compressor.attack.value = 0;
      this.compressor.release.value = 0.5;

      this.output.connect(this.compressor);
      this.compressor.connect(SoundEngine.getAmbientBus());
      this.running = true;
      this._scheduleAuto();
    }

    stop() {
      this.running = false;
      clearTimeout(this._autoTimer);
      if (this.output) {
        try { this.output.disconnect(); this.compressor.disconnect(); } catch (e) {}
      }
    }

    setAutoIntensity(v) {
      this.autoIntensity = Math.max(0, Math.min(1, v));
    }

    setSpread(v) {
      this.spread = Math.max(0, Math.min(1, v));
    }

    _scheduleAuto() {
      if (!this.running) return;
      const baseGapSec = 40 - this.autoIntensity * 34;
      const gap = SoundEngine.randomRange(baseGapSec * 0.5, baseGapSec * 1.5);
      this._autoTimer = setTimeout(() => {
        if (this.autoIntensity > 0.05 && Math.random() < this.autoIntensity) {
          this.strike(SoundEngine.randomRange(0.3, 1) * this.autoIntensity + 0.1);
        }
        this._scheduleAuto();
      }, gap * 1000);
    }

    /**
     * @param {number} power 0.05=遠雷(小さく丸い)〜1=近くに落ちた雷(大きく重い)。省略時ランダム
     */
    strike(power) {
      if (!this.ctx) this.ctx = SoundEngine.getContext();
      const p = power === undefined ? Math.random() : Math.max(0.05, Math.min(1, power));
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const isClose = p > 0.55;

      const strikeAngle = SoundEngine.randomRange(0, Math.PI * 2) * this.spread + (Math.random() < 0.5 ? 0 : Math.PI);
      const strikeDistance = SoundEngine.randomRange(8, 20) - p * 8; // 近い雷ほど距離が近い
      const x = Math.sin(strikeAngle) * strikeDistance * this.spread;
      const z = -Math.cos(strikeAngle) * strikeDistance;
      const y = SoundEngine.randomRange(3, 9); // 雷は上空から
      const panner = SoundEngine.createSpatialPanner(x, y, z, false);
      panner.connect(this.output);

      // 1) マルチストライク(1〜3回のクラック。実際の雷は6割以上が1〜2回の"clap"で構成される)
      const strikeCount = 1 + (Math.random() < (isClose ? 0.7 : 0.3) ? 1 : 0) + (Math.random() < 0.15 ? 1 : 0);
      for (let i = 0; i < strikeCount; i++) {
        this._playCrack(now + i * SoundEngine.randomRange(0.03, 0.09), p, panner, isClose);
      }

      // 2) ローラー: ノイズ由来の有機的なエンベロープでゴロゴロと転がる余韻を作る
      const rollDur = 1.8 + p * 4.5;
      this._playRoller(now + 0.05, rollDur, p, panner);

      // 3) ディープナー: 低域の量感(オシレーターではなくノイズベース)
      this._playDeepener(now, rollDur * 0.8, p, panner);

      setTimeout(() => { try { panner.disconnect(); } catch (e) {} }, (rollDur + 3) * 1000);
    }

    /**
     * クラック: バンドパスノイズ、Qを高くしすぎない(共鳴による音程感を避ける)。
     * 周波数は開始時ランダムに決め、鳴っている間に半分程度まで下降させる。
     */
    _playCrack(startTime, power, panner, isClose) {
      const ctx = this.ctx;
      const dur = isClose ? SoundEngine.randomRange(0.1, 0.2) : SoundEngine.randomRange(0.05, 0.1);
      const buf = SoundEngine.createNoiseBurstBuffer(dur);
      const src = ctx.createBufferSource();
      src.buffer = buf;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      const startFreq = SoundEngine.randomRange(100, 1300) * (isClose ? 0.6 : 1.0);
      bp.frequency.setValueAtTime(startFreq, startTime);
      bp.frequency.exponentialRampToValueAtTime(Math.max(60, startFreq * 0.5), startTime + dur);
      bp.Q.value = 6; // 高すぎない共鳴(論文推奨値)

      const g = ctx.createGain();
      g.gain.value = power * (isClose ? 0.6 : 0.25);

      src.connect(bp);
      bp.connect(g);
      g.connect(panner);
      src.start(startTime);
      src.stop(startTime + dur + 0.02);
      src.onended = () => {
        try { src.disconnect(); bp.disconnect(); g.disconnect(); } catch (e) {}
      };
    }

    /**
     * ローラー: ブラウンノイズ+ローパスの継続音を、ノイズ由来の不規則な
     * エンベロープカーブ(setValueCurveAtTime)で音量変調することで、
     * 「ゴロゴロ」という自然な転がり感を生み出す。単一の滑らかな指数減衰よりも
     * ずっと有機的で、シンセ的な印象を避けられる。
     */
    _playRoller(startTime, dur, power, panner) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = SoundEngine.createBrownNoiseBuffer(6);
      src.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.7; // 共鳴を持たせない
      const startFreq = 250 + power * 250;
      filter.frequency.setValueAtTime(startFreq, startTime);
      filter.frequency.exponentialRampToValueAtTime(Math.max(70, startFreq * 0.35), startTime + dur);

      const g = ctx.createGain();
      const peak = (0.35 + power * 0.35);
      const curve = SoundEngine.createEnvelopeCurve(dur, 30, 0.8, 1.2);
      const scaledCurve = new Float32Array(curve.length);
      for (let i = 0; i < curve.length; i++) scaledCurve[i] = curve[i] * peak;
      g.gain.setValueAtTime(0.0001, startTime);
      g.gain.setValueCurveAtTime(scaledCurve, startTime, dur);

      src.connect(filter);
      filter.connect(g);
      g.connect(panner);
      src.start(startTime);
      src.stop(startTime + dur + 0.2);
      src.onended = () => {
        try { src.disconnect(); filter.disconnect(); g.disconnect(); } catch (e) {}
      };
    }

    /**
     * ディープナー: 低域の量感を足す層。正弦波オシレーターは使わず、
     * ノイズを狭いバンドパス(50〜90Hz付近)に通すことで、音程感のない
     * 「重さ」だけを追加する。ローラーよりもゆっくり短く減衰させる。
     */
    _playDeepener(startTime, dur, power, panner) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = SoundEngine.createBrownNoiseBuffer(4);
      src.loop = true;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = SoundEngine.randomRange(45, 85);
      bp.Q.value = 2.2; // 音程を感じさせない程度の緩やかな共鳴

      const g = ctx.createGain();
      const peak = 0.25 + power * 0.35;
      g.gain.setValueAtTime(0, startTime);
      g.gain.linearRampToValueAtTime(peak, startTime + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, startTime + dur);

      src.connect(bp);
      bp.connect(g);
      g.connect(panner);
      src.start(startTime);
      src.stop(startTime + dur + 0.1);
      src.onended = () => {
        try { src.disconnect(); bp.disconnect(); g.disconnect(); } catch (e) {}
      };
    }
  }

  SoundEngine.Thunder = Thunder;
})();
