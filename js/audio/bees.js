/**
 * bees.js
 * 蜂の巣に近づくと聞こえる、小さな羽音(ブーン)。
 * 2026-09: 新規追加。「蜂に近づくと蜂が飛ぶ音が少し聞こえる」という
 * 要望に対応する。常時鳴らしっぱなしにし、scene3d.js側から毎フレーム
 * setProximity(0〜1)を呼んでもらって音量だけを上下させる、
 * シンプルな近接フェードの仕組み。
 *
 * 2026-09(改訂): 「自動カメラのお花畑シーンでブーンという大きめの
 * ノイズが出た」という報告への対応。原因は、この羽音がfire.js/river.js
 * などと違いHRTFパンナーを通さない方向感のないGainノードだったこと。
 * 花畑に一番近い木に蜂の巣があるため、花畑を映す自動カメラのショット
 * (flowers_only、花畑中心から半径1.8mを周回)がハードカットで切り替わった
 * 瞬間、たまたま巣までの距離も近接判定の範囲(3.5m以内)に入り、方向感の
 * ない音量だけが急に立ち上がって「ただ大きい」ように聞こえていた。
 * 対応として、他の音源と同じ SoundEngine.createSpatialPanner()
 * (HRTF)を経由させて方向感を持たせ、あわせて最大音量を抑え、
 * 音量変化の時定数も伸ばして急な立ち上がりを穏やかにした。
 */
(function () {
  'use strict';

  const SoundEngine = (window.SoundEngine = window.SoundEngine || {});

  const Bees = {
    _started: false,
    _output: null,
    _panner: null,
    _proximity: 0,

    ensureStarted() {
      if (this._started) return;
      const ctx = SoundEngine.getContext();
      if (!ctx) return;
      this._started = true;

      const output = ctx.createGain();
      output.gain.value = 0;
      this._output = output;

      // 他の音源(焚き火・川)と同じHRTF立体音響パンナーを経由させる。
      // 位置はscene3d.js側からsetListenerRelativePosition()で毎フレーム
      // 更新される(非persistent。蜂の巣自体は動かないが、リスナー
      // (カメラ)側が動くため、相対位置は毎フレーム変わる)。
      const panner = SoundEngine.createSpatialPanner(0, 0, 0, false);
      this._panner = panner;
      output.connect(panner);
      panner.connect(SoundEngine.getAmbientBus());

      // 羽音の基本トーン(低めのブーンという唸り)。複数の蜂が混ざっている
      // ように、わずかにデチューンした2つのオシレーターを重ねる。
      const osc1 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.value = 210;
      const osc2 = ctx.createOscillator();
      osc2.type = 'sawtooth';
      osc2.frequency.value = 236;

      const toneFilter = ctx.createBiquadFilter();
      toneFilter.type = 'bandpass';
      toneFilter.frequency.value = 350;
      toneFilter.Q.value = 0.9;

      const toneGain = ctx.createGain();
      toneGain.gain.value = 0.5;

      osc1.connect(toneFilter);
      osc2.connect(toneFilter);
      toneFilter.connect(toneGain);
      toneGain.connect(output);
      osc1.start();
      osc2.start();

      // 羽ばたきによる細かい音量の揺れ(LFO)
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 24;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.15;
      lfo.connect(lfoGain);
      lfoGain.connect(toneGain.gain);
      lfo.start();
    },

    /**
     * カメラ(リスナー)から見た蜂の巣の相対位置(前方=-Z、右=+X、上=+Y)。
     * fire.js/river.jsのsetListenerRelativePosition()と同じ考え方。
     */
    setListenerRelativePosition(x, y, z) {
      this.ensureStarted();
      if (!this._panner) return;
      SoundEngine.applySpatialPosition(this._panner, x, y, z);
    },

    /**
     * @param {number} proximity - 0(遠い/聞こえない)〜1(巣のすぐそば)
     */
    setProximity(proximity) {
      this.ensureStarted();
      if (!this._output) return;
      this._proximity = Math.max(0, Math.min(1, proximity));
      const ctx = SoundEngine.getContext();
      // 「少し聞こえる」程度にとどめ、他の環境音を邪魔しない音量にする。
      // 2026-09(改訂): 自動カメラのハードカットで距離が急に縮まっても
      // 急激な音量の跳ね上がりに感じにくいよう、最大値をやや下げ
      // (0.22→0.15)、時定数も伸ばした(0.25秒→0.5秒)。
      const targetGain = this._proximity * this._proximity * 0.15;
      this._output.gain.setTargetAtTime(targetGain, ctx.currentTime, 0.5);
    },
  };

  SoundEngine.Bees = Bees;
})();
