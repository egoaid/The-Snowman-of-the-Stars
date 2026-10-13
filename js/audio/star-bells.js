/**
 * star-bells.js
 * 落ちてくる星の音(v1.38)。「小さな鈴が落ちたような、かわいいキラキラした音」。
 *
 * - 落下中: 空から着地点へ向かって、細く高い鈴の音が降りてくる(だんだん間隔が詰まる)
 * - 着地: 小さな鈴が転がるような短い音
 * - 地上にある間: ときどき、ひとつだけ余韻のある鈴(着地点を探す手がかり)
 * - 回収: 明るい2音+きらめき
 *
 * 鈴は正弦波の部分音(非整数倍音)を重ねた減衰音で、ノイズは使わない。
 * すべて他の音源(焚き火・川・蜂)と同じHRTFのPannerNode(SoundEngine.createSpatialPanner)
 * を通すので、星の方向・距離が聞こえる。位置は scene3d.js が毎フレーム
 * setListenerRelativePosition() で「リスナーから見た相対位置」として渡す。
 * PannerNodeは1つだけを使い回す(音のたびにノードを増やさない)。
 *
 * 距離での減衰は共有のパンナー設定(inverse, rolloff 0.3)に任せつつ、遠くの
 * 着地音でも方向が分かるよう、距離に応じて出力を少し持ち上げる。
 */
(function () {
  'use strict';

  const SoundEngine = (window.SoundEngine = window.SoundEngine || {});

  // ペンタトニック(ド・レ・ミ・ソ・ラ)。高い音域の鈴。
  const HIGH = [2093, 2349, 2637, 3136, 3520];
  const MID = [1046, 1175, 1319, 1568, 1760];
  // 鈴らしい非整数倍音と、それぞれの強さ・減衰の速さ
  const PARTIALS = [
    { ratio: 1.0, amp: 1.0, decay: 1.0 },
    { ratio: 2.32, amp: 0.42, decay: 0.6 },
    { ratio: 4.25, amp: 0.2, decay: 0.38 },
    { ratio: 6.63, amp: 0.09, decay: 0.24 },
  ];

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const StarBells = {
    _started: false,
    _output: null,
    _panner: null,

    ensureStarted() {
      if (this._started) return true;
      const ctx = SoundEngine.getContext();
      if (!ctx) return false;
      this._started = true;
      const output = ctx.createGain();
      output.gain.value = 1;
      const panner = SoundEngine.createSpatialPanner(0, 0, 0, false);
      output.connect(panner);
      panner.connect(SoundEngine.getSfxBus());
      this._output = output;
      this._panner = panner;
      return true;
    },

    /** リスナーから見た星の相対位置(前方=-Z、右=+X、上=+Y)。 */
    setListenerRelativePosition(x, y, z) {
      if (!this.ensureStarted()) return;
      SoundEngine.applySpatialPosition(this._panner, x, y, z);
      const dist = Math.hypot(x, y, z);
      const boost = Math.min(3.5, 1 + dist * 0.035);
      const ctx = SoundEngine.getContext();
      this._output.gain.setTargetAtTime(boost, ctx.currentTime, 0.2);
    },

    /** 鈴を1つ鳴らす。 */
    _bell(when, freq, gain, decaySec) {
      const ctx = SoundEngine.getContext();
      for (const p of PARTIALS) {
        const f = freq * p.ratio * (1 + (Math.random() - 0.5) * 0.004);
        if (f > 16000) continue;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = f;
        const g = ctx.createGain();
        const peak = gain * p.amp;
        const end = when + Math.max(0.15, decaySec * p.decay);
        g.gain.setValueAtTime(0.0001, when);
        g.gain.linearRampToValueAtTime(peak, when + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, end);
        osc.connect(g);
        g.connect(this._output);
        osc.start(when);
        osc.stop(end + 0.05);
      }
    },

    /** 落下中: 高い鈴が降りてくる。durationSecは落下の長さ。 */
    playFall(durationSec) {
      if (!this.ensureStarted()) return;
      const ctx = SoundEngine.getContext();
      const now = ctx.currentTime + 0.02;
      const n = 12;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        const t = now + durationSec * Math.pow(u, 0.75) * 0.96; // 後ろへいくほど間隔が詰まる
        const idx = Math.max(0, HIGH.length - 1 - Math.floor(u * (HIGH.length - 1)));
        const f = HIGH[idx] * (Math.random() < 0.3 ? 0.5 : 1); // 上から下へ、ときどき1オクターブ下
        this._bell(t, f, 0.05 + 0.09 * u, 0.7);
      }
    },

    /** 着地: 小さな鈴が転がるような短い音。 */
    playLand() {
      if (!this.ensureStarted()) return;
      const ctx = SoundEngine.getContext();
      const now = ctx.currentTime + 0.01;
      this._bell(now, MID[3], 0.34, 1.4);
      const rolls = [[0.07, 0.26], [0.15, 0.2], [0.27, 0.15], [0.43, 0.1], [0.66, 0.07]];
      for (const [dt, g] of rolls) {
        this._bell(now + dt, pick(Math.random() < 0.5 ? HIGH : MID), g, 0.9);
      }
    },

    /** 地上の余韻: ひとつだけの鈴+小さなこだま。 */
    playRing() {
      if (!this.ensureStarted()) return;
      const ctx = SoundEngine.getContext();
      const now = ctx.currentTime + 0.01;
      const f = pick(MID.concat(HIGH.slice(0, 3)));
      this._bell(now, f, 0.2, 1.8);
      this._bell(now + 0.28, f, 0.07, 1.2);
    },

    /** 回収: 明るい2音とかすかなきらめき。 */
    playCollect() {
      if (!this.ensureStarted()) return;
      const ctx = SoundEngine.getContext();
      const now = ctx.currentTime + 0.01;
      this._bell(now, MID[2], 0.26, 1.1);
      this._bell(now + 0.11, MID[4], 0.26, 1.4);
      this._bell(now + 0.24, HIGH[4], 0.1, 1.0);
    },
  };

  SoundEngine.StarBells = StarBells;
})();
