/**
 * insects.js
 * 虫の鳴き声のシンセサイズ(サンプル音源不使用)。
 * 複数の「種類」をそれぞれ独立したパルス/トレモロ音源として定義し、
 * 季節(spring/summer/autumn/winter)に応じて活動する種類が変わる。
 * 種類ごとに個別にオン/オフでき、名前(label)も取得できる。
 *
 * 【表情・質感のバリエーション強化】
 * 各種類に複数の「鳴き方パターン」(phrase variant)を用意し、毎回ランダムに
 * 選ぶことで、単調な繰り返しにならないようにしている。また個体ごとの
 * 音量・距離感にも揺らぎを持たせ、「同じ種類でも近くの個体・遠くの個体が
 * 混ざって聞こえる」自然さを出している。
 */
(function () {
  'use strict';
  const SoundEngine = (window.SoundEngine = window.SoundEngine || {});

  function individualVariance() {
    // 個体差(近い/遠い、元気な個体/控えめな個体)を音量に反映
    return SoundEngine.randomRange(0.55, 1.15);
  }

  // 2026-09: 「連続して鳴き続けているように聞こえる」という指摘を受けて、
  // 鳴き終わってから次に鳴くまでの間隔を全体的に伸ばす倍率。
  const CALL_GAP_MULTIPLIER = 3.2;

  const SPECIES = {
    cricket: {
      seasons: ['summer', 'autumn'],
      times: ['evening', 'night'], // コオロギは夕方〜夜に鳴く
      play(ctx, output, density) {
        const now = ctx.currentTime;
        const iv = individualVariance();
        const pattern = SoundEngine.randomChoice(['steady', 'fast', 'sparse']);
        const baseFreq = SoundEngine.randomRange(3700, 4700);

        const playPulse = (t, freq, peak) => {
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = freq;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(peak, t + 0.008);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
          osc.connect(g);
          g.connect(output);
          osc.start(t);
          osc.stop(t + 0.07);
          osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (e) {} };
        };

        if (pattern === 'fast') {
          // 早口でリズミカルな連続パルス(元気な個体)
          const pulses = 4 + Math.floor(Math.random() * 3);
          for (let i = 0; i < pulses; i++) playPulse(now + i * 0.06, baseFreq + SoundEngine.randomRange(-30, 30), 0.2 * iv);
        } else if (pattern === 'sparse') {
          // まばらな単発鳴き(控えめな個体)
          const pulses = 1 + Math.floor(Math.random() * 2);
          for (let i = 0; i < pulses; i++) playPulse(now + i * 0.13, baseFreq + SoundEngine.randomRange(-50, 50), 0.15 * iv);
        } else {
          // 標準的な「リッ、リッ、リッ」
          const pulses = 2 + Math.floor(Math.random() * 3);
          for (let i = 0; i < pulses; i++) playPulse(now + i * 0.09, baseFreq + SoundEngine.randomRange(-40, 40), 0.18 * iv);
        }
        return SoundEngine.randomRange(0.6, 2.4) / (0.3 + density * 1.2) * SoundEngine.randomRange(0.8, 1.3);
      },
    },

    katydid: {
      seasons: ['summer'],
      times: ['day', 'evening'], // キリギリスは日中〜夕方に鳴くことが多い
      play(ctx, output, density) {
        const now = ctx.currentTime;
        const iv = individualVariance();
        const pattern = SoundEngine.randomChoice(['long', 'click', 'burstSet', 'stutter']);

        const playBuzz = (t, dur, riseAmount, peakMul) => {
          const buf = SoundEngine.createNoiseBurstBuffer(dur);
          const src = ctx.createBufferSource();
          src.buffer = buf;
          const filter = ctx.createBiquadFilter();
          filter.type = 'bandpass';
          const startFreq = SoundEngine.randomRange(2500, 3300);
          filter.frequency.setValueAtTime(startFreq, t);
          if (riseAmount) {
            filter.frequency.setValueAtTime(startFreq, t + dur * 0.4);
            filter.frequency.linearRampToValueAtTime(startFreq * (1 + riseAmount), t + dur * 0.7);
          }
          filter.Q.value = SoundEngine.randomRange(4, 7);

          const tremolo = ctx.createOscillator();
          tremolo.type = 'square';
          tremolo.frequency.value = SoundEngine.randomRange(36, 58);
          const tremGain = ctx.createGain();
          tremGain.gain.value = 0.08;
          const g = ctx.createGain();
          g.gain.value = 0;
          tremolo.connect(tremGain);
          tremGain.connect(g.gain);

          const peak = 0.16 * iv * (peakMul || 1);
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(peak, t + Math.min(0.03, dur * 0.15));
          g.gain.setValueAtTime(peak, t + dur - Math.min(0.03, dur * 0.15));
          g.gain.linearRampToValueAtTime(0, t + dur);

          src.connect(filter);
          filter.connect(g);
          g.connect(output);
          src.start(t);
          tremolo.start(t);
          src.stop(t + dur + 0.02);
          tremolo.stop(t + dur + 0.02);
          src.onended = () => {
            try { src.disconnect(); filter.disconnect(); tremolo.disconnect(); tremGain.disconnect(); g.disconnect(); } catch (e) {}
          };
        };

        if (pattern === 'click') {
          playBuzz(now, SoundEngine.randomRange(0.05, 0.12), 0);
        } else if (pattern === 'burstSet') {
          const reps = 2 + Math.floor(Math.random() * 2);
          for (let i = 0; i < reps; i++) playBuzz(now + i * SoundEngine.randomRange(0.15, 0.3), SoundEngine.randomRange(0.08, 0.15), 0);
        } else if (pattern === 'stutter') {
          // 短く途切れながら続く、少し不安定な鳴き方
          const reps = 4 + Math.floor(Math.random() * 4);
          for (let i = 0; i < reps; i++) playBuzz(now + i * SoundEngine.randomRange(0.05, 0.11), SoundEngine.randomRange(0.03, 0.06), 0, 0.8);
        } else {
          playBuzz(now, SoundEngine.randomRange(0.4, 0.8), SoundEngine.randomRange(0.05, 0.15));
        }
        return SoundEngine.randomRange(0.8, 2.5) / (0.3 + density * 1.2) * SoundEngine.randomRange(0.8, 1.3);
      },
    },

    cicada: {
      seasons: ['summer'],
      times: ['morning', 'day'], // セミは日中(種によっては早朝)に鳴く
      play(ctx, output, density) {
        const now = ctx.currentTime;
        const iv = individualVariance();
        const pattern = SoundEngine.randomChoice(['long', 'crescendo', 'short']);
        const baseFreq = SoundEngine.randomRange(1700, 2500);
        const dur = pattern === 'short' ? SoundEngine.randomRange(0.8, 1.8)
          : pattern === 'crescendo' ? SoundEngine.randomRange(3.5, 6)
          : SoundEngine.randomRange(2.5, 5);

        const oscGain = ctx.createGain();
        oscGain.gain.value = 1;
        const oscFreqs = [baseFreq, baseFreq * 1.5, baseFreq * 2.03];
        const oscs = oscFreqs.map((f, i) => {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          const og = ctx.createGain();
          og.gain.value = i === 0 ? 1 : 0.35 / (i + 1);
          o.connect(og);
          og.connect(oscGain);
          return { o, og };
        });

        const noiseSrc = SoundEngine.createNoiseSource('white', 4);
        const noiseFilter = ctx.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.value = baseFreq * 1.2;
        noiseFilter.Q.value = 1.5;
        const noiseGain = ctx.createGain();
        noiseGain.gain.value = 0.5;
        noiseSrc.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(oscGain);

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = baseFreq + 200;
        filter.Q.value = 1.5;

        const tremolo = ctx.createOscillator();
        tremolo.type = 'sine';
        tremolo.frequency.value = SoundEngine.randomRange(14, 22);
        const tremGain = ctx.createGain();
        tremGain.gain.value = 0.07;
        const g = ctx.createGain();
        g.gain.value = 0;
        tremolo.connect(tremGain);
        tremGain.connect(g.gain);

        const peak = 0.1 * iv;
        if (pattern === 'crescendo') {
          // ゆっくり盛り上がってから減衰(より生物的な抑揚)
          g.gain.setValueAtTime(0, now);
          g.gain.linearRampToValueAtTime(peak * 0.4, now + dur * 0.25);
          g.gain.linearRampToValueAtTime(peak, now + dur * 0.6);
          g.gain.setValueAtTime(peak, now + dur * 0.75);
          g.gain.linearRampToValueAtTime(0, now + dur);
        } else {
          g.gain.setValueAtTime(0, now);
          g.gain.linearRampToValueAtTime(peak, now + dur * 0.3);
          g.gain.setValueAtTime(peak, now + dur * 0.6);
          g.gain.linearRampToValueAtTime(0, now + dur);
        }

        oscGain.connect(filter);
        filter.connect(g);
        g.connect(output);

        oscs.forEach(({ o }) => o.start(now));
        noiseSrc.start(now);
        tremolo.start(now);
        oscs.forEach(({ o }) => o.stop(now + dur + 0.1));
        noiseSrc.stop(now + dur + 0.1);
        tremolo.stop(now + dur + 0.1);

        tremolo.onended = () => {
          try {
            oscs.forEach(({ o, og }) => { o.disconnect(); og.disconnect(); });
            noiseSrc.disconnect(); noiseFilter.disconnect(); noiseGain.disconnect();
            oscGain.disconnect(); filter.disconnect(); tremolo.disconnect(); tremGain.disconnect(); g.disconnect();
          } catch (e) {}
        };
        return SoundEngine.randomRange(1, 4) / (0.3 + density * 1.2) * SoundEngine.randomRange(0.8, 1.3);
      },
    },

    suzumushi: {
      seasons: ['autumn'],
      times: ['evening', 'night'], // スズムシは夜(鈴虫)の代表格
      play(ctx, output, density) {
        const now = ctx.currentTime;
        const iv = individualVariance();
        const pattern = SoundEngine.randomChoice(['long', 'short', 'accelerating']);
        const baseFreq = SoundEngine.randomRange(2150, 2550);

        const playPulse = (t, freq, peak) => {
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = freq;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(peak, t + 0.01);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
          osc.connect(g);
          g.connect(output);
          osc.start(t);
          osc.stop(t + 0.1);
          osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (e) {} };
        };

        const peak = 0.15 * iv;
        if (pattern === 'short') {
          const reps = 2 + Math.floor(Math.random() * 2);
          for (let i = 0; i < reps; i++) playPulse(now + i * 0.11, baseFreq, peak);
        } else if (pattern === 'accelerating') {
          // だんだん速くなる「リーンリンリンリン」
          const reps = 5 + Math.floor(Math.random() * 3);
          let t = now;
          let gap = 0.16;
          for (let i = 0; i < reps; i++) {
            playPulse(t, baseFreq + SoundEngine.randomRange(-15, 15), peak);
            gap *= 0.85;
            t += gap;
          }
        } else {
          const reps = 4 + Math.floor(Math.random() * 4);
          for (let i = 0; i < reps; i++) playPulse(now + i * 0.11, baseFreq, peak);
        }
        return SoundEngine.randomRange(1.2, 3) / (0.3 + density * 1.2) * SoundEngine.randomRange(0.8, 1.3);
      },
    },

    matsumushi: {
      seasons: ['autumn'],
      times: ['evening', 'night'], // マツムシもスズムシ同様、夜の代表格
      play(ctx, output, density) {
        const now = ctx.currentTime;
        const iv = individualVariance();
        const pattern = SoundEngine.randomChoice(['classic', 'extended']);
        const baseFreq = SoundEngine.randomRange(1650, 2050);
        const peak = 0.13 * iv;

        const playPulse = (t, freq) => {
          const osc = ctx.createOscillator();
          osc.type = 'triangle';
          osc.frequency.value = freq;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(peak, t + 0.01);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
          osc.connect(g);
          g.connect(output);
          osc.start(t);
          osc.stop(t + 0.09);
          osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (e) {} };
        };

        const pattern1 = [0, 0.08, 0.16, 0.30, 0.38];
        const pattern2 = [0, 0.08, 0.16, 0.24, 0.38, 0.46];
        const seq = pattern === 'extended' ? pattern2 : pattern1;
        seq.forEach((offset, i) => playPulse(now + offset, baseFreq + (i % 2 === 0 ? 0 : 200)));
        return SoundEngine.randomRange(1.5, 3.5) / (0.3 + density * 1.2) * SoundEngine.randomRange(0.8, 1.3);
      },
    },
  };
  // v1.72: 種の名前は、言語に合わせて辞書(species.<key>)から引く(このファイルは module ではないので、i18n.js が window.snowmanT に置いた翻訳の関数を使う)
  for (const [key, def] of Object.entries(SPECIES)) Object.defineProperty(def, 'label', { get: () => (window.snowmanT || ((k) => k))(`species.${key}`), enumerable: true, configurable: true });

  // 2026-09: 虫の音量が全体的に大きいという指摘を受けて引き下げ。
  // (以前は0.75倍。setDensity()側にはこの係数が抜けていたため、
  //  密度スライダーを動かすと音量が戻ってしまうバグも同時に直す)
  const AMBIENCE_GAIN_MUL = 0.45;

  class Insects {
    constructor() {
      this.ctx = null;
      this.output = null;
      this.running = false;
      this.season = 'summer';
      this.timeOfDay = 'day'; // 'morning'|'day'|'evening'|'night'。時間帯によって鳴く種類を切り替える
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
      return ((hash / 1000) * 2 - 1) * 0.7;
    }

    _createVoicePanner(key) {
      // 3Dゲーム内ではプレイヤーの向きを追従させず、「森がある奥の方角」に
      // 定位を固定した控えめなアンビエンスとして鳴らす(個々の虫の位置ではない)。
      const base = this._basePanFor(key);
      const azimuth = Math.PI + base * 0.6 + SoundEngine.randomRange(-0.3, 0.3) * this.spread;
      const distance = SoundEngine.randomRange(3, 6);
      const x = Math.sin(azimuth) * distance;
      const z = -Math.cos(azimuth) * distance;
      const y = SoundEngine.randomRange(-0.3, 0.3);
      const panner = SoundEngine.createSpatialPanner(x, y, z, false);
      panner.connect(this.output);
      setTimeout(() => { try { panner.disconnect(); } catch (e) {} }, 8000);
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
    // ようにする(例: セミは昼だけ、スズムシ・マツムシは夜だけ)。
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
      // (例: 夏の夜ならコオロギ・キリギリスは鳴くが、セミは鳴かない)
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
        const initialDelay = SoundEngine.randomRange(0, 2);
        const timer = setTimeout(() => this._loopVoice(key, def), initialDelay * 1000);
        this._voiceTimers[key].push(timer);
      }
    }

    _loopVoice(key, def) {
      if (!this.running || !this.enabledSpecies.has(key)) return;
      const panner = this._createVoicePanner(key);
      const nextGap = def.play(this.ctx, panner, this.density) * CALL_GAP_MULTIPLIER;
      const timer = setTimeout(() => this._loopVoice(key, def), Math.max(2.5, nextGap) * 1000);
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
      def.play(this.ctx, panner, this.density);
    }
  }

  Insects.SPECIES = SPECIES;
  SoundEngine.Insects = Insects;
})();
