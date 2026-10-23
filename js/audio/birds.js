/**
 * birds.js
 * 鳥の囀りのシンセサイズ(サンプル音源不使用)。
 * OscillatorNodeの周波数を短時間で変化させる「エンベロープ」を組み合わせて
 * 種類ごとに異なる鳴き方(ピッチ変化パターン)を作る。
 * 季節によって活動する種類が変わり、種類ごとに個別オン/オフ・名前取得が可能。
 *
 * 【表情・質感のバリエーション強化】
 * 各種類に複数のフレーズパターン(さえずり・地鳴き・警戒声的なものなど)を
 * 用意し、毎回ランダムに選ぶ。個体差(音量・距離感)も加えている。
 */
(function () {
  'use strict';
  const SoundEngine = (window.SoundEngine = window.SoundEngine || {});

  function individualVariance() {
    return SoundEngine.randomRange(0.55, 1.15);
  }

  // 2026-09: 「連続して鳴き続けているように聞こえる」という指摘を受けて、
  // 鳴き終わってから次に鳴くまでの間隔を全体的に伸ばす倍率。
  // (各speciesのplay()が返す秒数、および同時に鳴く声の数の両方で調整する)
  const CALL_GAP_MULTIPLIER = 3.2;

  function chirpTone(ctx, output, {
    startFreq, endFreq, dur, wave = 'sine', peak = 0.18, mid = null, midT = 0.5,
  }) {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(startFreq, now);
    if (mid !== null) {
      osc.frequency.linearRampToValueAtTime(mid, now + dur * midT);
    }
    osc.frequency.linearRampToValueAtTime(endFreq, now + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(g);
    g.connect(output);
    osc.start(now);
    osc.stop(now + dur + 0.05);
    osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (e) {} };
  }

  const SPECIES = {
    sparrow: {
      seasons: ['spring', 'summer', 'autumn', 'winter'],
      times: ['morning', 'day'], // スズメは日中(特に朝)に活発
      play(ctx, output) {
        const iv = individualVariance();
        const pattern = SoundEngine.randomChoice(['chirp', 'chatter', 'single']);
        if (pattern === 'single') {
          chirpTone(ctx, output, {
            startFreq: SoundEngine.randomRange(2500, 3000), endFreq: SoundEngine.randomRange(2000, 2500),
            dur: 0.11, peak: 0.15 * iv,
          });
        } else if (pattern === 'chatter') {
          const reps = 5 + Math.floor(Math.random() * 4);
          for (let i = 0; i < reps; i++) {
            setTimeout(() => {
              chirpTone(ctx, output, {
                startFreq: SoundEngine.randomRange(2400, 3200), endFreq: SoundEngine.randomRange(2000, 2800),
                dur: 0.06, peak: 0.13 * iv,
              });
            }, i * SoundEngine.randomRange(60, 100));
          }
        } else {
          const reps = 2 + Math.floor(Math.random() * 2);
          for (let i = 0; i < reps; i++) {
            setTimeout(() => {
              chirpTone(ctx, output, {
                startFreq: SoundEngine.randomRange(2600, 3000), endFreq: SoundEngine.randomRange(2200, 2600),
                dur: 0.09, peak: 0.16 * iv,
              });
            }, i * 140);
          }
        }
        return SoundEngine.randomRange(1.5, 4) * SoundEngine.randomRange(0.8, 1.3);
      },
    },

    uguisu: {
      seasons: ['spring'],
      times: ['morning', 'day'], // ウグイスは主に日中(早朝によく鳴く)
      play(ctx, output) {
        const iv = individualVariance();
        const pattern = SoundEngine.randomChoice(['full', 'short', 'practice']);
        if (pattern === 'practice') {
          // 「ホーホケ」で終わる、まだ上手く鳴けない若鳥風の不完全な鳴き方
          chirpTone(ctx, output, { startFreq: 900, endFreq: 1400, dur: 0.3, peak: 0.18 * iv });
          setTimeout(() => {
            chirpTone(ctx, output, { startFreq: 1300, endFreq: 2200, dur: 0.1, peak: 0.18 * iv });
          }, 340);
        } else if (pattern === 'short') {
          chirpTone(ctx, output, { startFreq: 950, endFreq: 1600, dur: 0.28, peak: 0.2 * iv });
          setTimeout(() => {
            chirpTone(ctx, output, { startFreq: 1500, endFreq: 900, dur: 0.14, peak: 0.18 * iv });
          }, 320);
        } else {
          chirpTone(ctx, output, { startFreq: 900, endFreq: 1500, dur: 0.35, peak: 0.2 * iv });
          setTimeout(() => {
            chirpTone(ctx, output, { startFreq: 1400, endFreq: 2600, dur: 0.12, mid: 900, midT: 0.4, peak: 0.22 * iv });
          }, 380);
          setTimeout(() => {
            chirpTone(ctx, output, { startFreq: 2600, endFreq: 1200, dur: 0.18, peak: 0.2 * iv });
          }, 520);
        }
        return SoundEngine.randomRange(3, 7) * SoundEngine.randomRange(0.8, 1.3);
      },
    },

    swallow: {
      seasons: ['spring', 'summer'],
      times: ['morning', 'day'], // ツバメは昼行性
      play(ctx, output) {
        const iv = individualVariance();
        const pattern = SoundEngine.randomChoice(['twitter', 'quick']);
        if (pattern === 'quick') {
          const reps = 2 + Math.floor(Math.random() * 2);
          for (let i = 0; i < reps; i++) {
            setTimeout(() => {
              chirpTone(ctx, output, {
                startFreq: SoundEngine.randomRange(3500, 4500), endFreq: SoundEngine.randomRange(3000, 3800),
                dur: 0.04, peak: 0.1 * iv,
              });
            }, i * 120);
          }
        } else {
          const reps = 4 + Math.floor(Math.random() * 4);
          for (let i = 0; i < reps; i++) {
            setTimeout(() => {
              chirpTone(ctx, output, {
                startFreq: SoundEngine.randomRange(3200, 4200), endFreq: SoundEngine.randomRange(2800, 3600),
                dur: 0.05, peak: 0.12 * iv,
              });
            }, i * 90);
          }
        }
        return SoundEngine.randomRange(2, 5) * SoundEngine.randomRange(0.8, 1.3);
      },
    },

    shrike: {
      seasons: ['autumn'],
      times: ['day', 'evening'], // モズは日中〜夕方によく鳴く
      play(ctx, output) {
        const iv = individualVariance();
        const pattern = SoundEngine.randomChoice(['keen', 'harsh']);
        const reps = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < reps; i++) {
          setTimeout(() => {
            chirpTone(ctx, output, {
              startFreq: pattern === 'harsh' ? SoundEngine.randomRange(1700, 2000) : SoundEngine.randomRange(2000, 2400),
              endFreq: pattern === 'harsh' ? SoundEngine.randomRange(1200, 1500) : SoundEngine.randomRange(1500, 1900),
              dur: pattern === 'harsh' ? 0.2 : 0.15,
              wave: 'sawtooth',
              peak: 0.1 * iv,
            });
          }, i * 220);
        }
        return SoundEngine.randomRange(2, 5) * SoundEngine.randomRange(0.8, 1.3);
      },
    },

    owl: {
      seasons: ['winter', 'autumn'],
      times: ['night'], // フクロウは夜行性(夜にだけ鳴く)
      play(ctx, output) {
        const iv = individualVariance();
        const pattern = SoundEngine.randomChoice(['pair', 'single', 'triple']);
        if (pattern === 'single') {
          chirpTone(ctx, output, { startFreq: 500, endFreq: 400, dur: 0.55, peak: 0.22 * iv });
        } else if (pattern === 'triple') {
          chirpTone(ctx, output, { startFreq: 500, endFreq: 420, dur: 0.4, peak: 0.2 * iv });
          setTimeout(() => chirpTone(ctx, output, { startFreq: 480, endFreq: 400, dur: 0.35, peak: 0.19 * iv }), 550);
          setTimeout(() => chirpTone(ctx, output, { startFreq: 460, endFreq: 370, dur: 0.5, peak: 0.21 * iv }), 1050);
        } else {
          chirpTone(ctx, output, { startFreq: 500, endFreq: 420, dur: 0.5, peak: 0.22 * iv });
          setTimeout(() => {
            chirpTone(ctx, output, { startFreq: 480, endFreq: 380, dur: 0.6, peak: 0.2 * iv });
          }, 700);
        }
        return SoundEngine.randomRange(6, 14) * SoundEngine.randomRange(0.8, 1.3);
      },
    },

    tit: {
      seasons: ['winter', 'spring'],
      times: ['morning', 'day'], // シジュウカラは昼行性
      play(ctx, output) {
        const iv = individualVariance();
        const pattern = SoundEngine.randomChoice(['song', 'call']);
        if (pattern === 'call') {
          const reps = 2;
          for (let i = 0; i < reps; i++) {
            setTimeout(() => {
              chirpTone(ctx, output, { startFreq: 3200, endFreq: 2900, dur: 0.08, peak: 0.12 * iv });
            }, i * 180);
          }
        } else {
          const reps = 3 + Math.floor(Math.random() * 2);
          for (let i = 0; i < reps; i++) {
            setTimeout(() => {
              chirpTone(ctx, output, {
                startFreq: 3500, endFreq: 3000, mid: 3800, midT: 0.5, dur: 0.12, peak: 0.14 * iv,
              });
            }, i * 260);
          }
        }
        return SoundEngine.randomRange(4, 9) * SoundEngine.randomRange(0.8, 1.3);
      },
    },
  };
  // v1.72: 種の名前は、言語に合わせて辞書(species.<key>)から引く(このファイルは module ではないので、i18n.js が window.snowmanT に置いた翻訳の関数を使う)
  for (const [key, def] of Object.entries(SPECIES)) Object.defineProperty(def, 'label', { get: () => (window.snowmanT || ((k) => k))(`species.${key}`), enumerable: true, configurable: true });

  // 2026-09: 鳥の音量が全体的に大きいという指摘を受けて引き下げ。
  // (以前は0.75倍。setDensity()側にはこの係数が抜けていたため、
  //  密度スライダーを動かすと音量が戻ってしまうバグも同時に直す)
  const AMBIENCE_GAIN_MUL = 0.45;

  class Birds {
    constructor() {
      this.ctx = null;
      this.output = null;
      this.running = false;
      this.season = 'spring';
      this.timeOfDay = 'day'; // 'morning'|'day'|'evening'|'night'。時間帯によって鳴く種類を切り替える(フクロウは夜だけ、等)
      this.density = 0.5;
      this.spread = 0.7;
      this.enabledSpecies = new Set();
      this._voiceTimers = {};
    }

    setSpread(v) {
      this.spread = Math.max(0, Math.min(1, v));
    }

    _basePanFor(key) {
      let hash = 0;
      for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 1000;
      return ((hash / 1000) * 2 - 1) * 0.75;
    }

    _createVoicePanner(key) {
      // 3Dゲーム内ではプレイヤーの向きを追従させず、「森がある奥の方角」に
      // 定位を固定した控えめなアンビエンスとして鳴らす(個々の鳥の位置ではない)。
      const base = this._basePanFor(key);
      const azimuth = Math.PI + base * 0.6 + SoundEngine.randomRange(-0.3, 0.3) * this.spread;
      const distance = SoundEngine.randomRange(3.5, 7);
      const x = Math.sin(azimuth) * distance;
      const z = -Math.cos(azimuth) * distance;
      const y = SoundEngine.randomRange(0.5, 2.5);
      const panner = SoundEngine.createSpatialPanner(x, y, z, false);
      panner.connect(this.output);
      setTimeout(() => { try { panner.disconnect(); } catch (e) {} }, 10000);
      return panner;
    }

    start() {
      if (this.running) return;
      this.ctx = SoundEngine.getContext();
      this.output = this.ctx.createGain();
      this.output.gain.value = (0.3 + this.density * 0.7) * AMBIENCE_GAIN_MUL;
      this.output.connect(SoundEngine.getAmbientBus());
      this.running = true;
      this._applySeasonDefaults();
      this._restartAllVoices();
    }

    stop() {
      this.running = false;
      this._clearAllTimers();
      if (this.output) {
        try { this.output.disconnect(); } catch (e) {}
      }
    }

    setSeason(season) {
      this.season = season;
      this._applySeasonDefaults();
      if (this.running) this._restartAllVoices();
    }

    // 時間帯(朝/昼/夕/夜)に応じて、その時間帯に鳴く種類だけが有効になる
    // ようにする(例: フクロウは夜だけ、スズメ・シジュウカラは日中だけ)。
    setTimeOfDay(tod) {
      if (this.timeOfDay === tod) return;
      this.timeOfDay = tod;
      this._applySeasonDefaults();
      if (this.running) this._restartAllVoices();
    }

    setDensity(v) {
      this.density = Math.max(0, Math.min(1, v));
      if (this.output) {
        this.output.gain.setTargetAtTime((0.3 + this.density * 0.7) * AMBIENCE_GAIN_MUL, this.ctx.currentTime, 0.5);
      }
      if (this.running) this._restartAllVoices();
    }

    getAvailableSpecies() {
      return Object.entries(SPECIES)
        .filter(([, def]) => def.seasons.includes(this.season))
        .map(([key, def]) => ({ key, label: def.label, enabled: this.enabledSpecies.has(key) }));
    }

    setSpeciesEnabled(key, enabled) {
      if (!SPECIES[key]) return;
      if (enabled) {
        this.enabledSpecies.add(key);
        if (this.running) this._startVoiceGroup(key);
      } else {
        this.enabledSpecies.delete(key);
        this._clearTimersFor(key);
      }
    }

    _applySeasonDefaults() {
      // 季節に合っていて、かつ現在の時間帯に鳴く種類だけを自動的に有効にする
      // (例: フクロウは夜だけ、スズメ・シジュウカラは日中だけ)
      const keys = Object.keys(SPECIES).filter((k) => {
        const def = SPECIES[k];
        return def.seasons.includes(this.season) && def.times.includes(this.timeOfDay);
      });
      this.enabledSpecies = new Set(keys);
    }

    _clearTimersFor(key) {
      const timers = this._voiceTimers[key];
      if (timers) timers.forEach((t) => clearTimeout(t));
      this._voiceTimers[key] = [];
    }

    _clearAllTimers() {
      Object.keys(this._voiceTimers).forEach((k) => this._clearTimersFor(k));
    }

    _restartAllVoices() {
      this._clearAllTimers();
      if (!this.running) return;
      this.enabledSpecies.forEach((key) => this._startVoiceGroup(key));
    }

    _startVoiceGroup(key) {
      const def = SPECIES[key];
      if (!def) return;
      this._clearTimersFor(key);
      this._voiceTimers[key] = [];
      // 2026-09: 同時に鳴く声の数が多いほど「連続して鳴いている」ように
      // 聞こえてしまうため、同時発声数を減らして時々鳴く程度に留める。
      const voices = 1 + Math.floor(this.density * 1);
      for (let i = 0; i < voices; i++) {
        const initialDelay = SoundEngine.randomRange(0, 4);
        const timer = setTimeout(() => this._loopVoice(key, def), initialDelay * 1000);
        this._voiceTimers[key].push(timer);
      }
    }

    _loopVoice(key, def) {
      if (!this.running || !this.enabledSpecies.has(key)) return;
      const panner = this._createVoicePanner(key);
      const nextGap = (def.play(this.ctx, panner) / (0.3 + this.density * 1.2)) * CALL_GAP_MULTIPLIER;
      const timer = setTimeout(() => this._loopVoice(key, def), Math.max(3, nextGap) * 1000);
      if (!this._voiceTimers[key]) this._voiceTimers[key] = [];
      this._voiceTimers[key].push(timer);
    }

    playOnce(key) {
      const def = SPECIES[key];
      if (!def) return;
      if (!this.ctx) this.ctx = SoundEngine.getContext();
      if (!this.output) {
        this.output = this.ctx.createGain();
        this.output.gain.value = (0.3 + this.density * 0.7) * AMBIENCE_GAIN_MUL;
        this.output.connect(SoundEngine.getAmbientBus());
      }
      const panner = this._createVoicePanner(key);
      def.play(this.ctx, panner);
    }
  }

  Birds.SPECIES = SPECIES;
  SoundEngine.Birds = Birds;
})();
