/**
 * sfx.js (v1.56-H3)
 * 世界の中で起きる出来事の効果音。サンプル音源は使わず、全てWeb Audioで作る(既存の方針)。
 *   ・チェストの開閉(きしむふた / 閉じるときのコトッ)
 *   ・アイテムを地面に置く音・拾う音(星はきらめき、缶はカラン、かぼちゃはポコ…)
 *   ・丸太の衝突音: 相手(地面/丸太/岩/木の幹/テント/チェスト)と、衝突の強さ、丸太の大きさで音が変わる
 *   ・丸太が川に落ちる音(ドボン+しぶき+小さな泡)
 * 全て「効果音バス」(SoundEngine.getSfxBus)へつなぐ。設定画面の「効果音の音量」はこのバスの音量。
 * 位置(rel = リスナーから見た相対位置 {x:右, y:上, z:前=-Z})があればHRTFで定位し、無ければ中央。
 *
 * 丸太の大きさ → 音: 体積から「大きさ」size=∛(π r² L) を出し、
 *   共鳴周波数 f0 = 260 / size^0.8 (小枝≒1.2kHz、中くらいの丸太≒340Hz、大木≒140Hz)
 *   響きの長さ  = 0.10 + 0.4*size 秒 (大きいほど低く長い)
 * 衝突の強さ(衝突方向の速さ m/s) → 音量と明るさ(強いほど大きく、明るく、硬く)。
 * 地面(雪・土)は音を吸うので、短く鈍いドスッ。木同士は硬いコーン(共鳴の響きが長い)。
 */
(function () {
  'use strict';

  const SoundEngine = (window.SoundEngine = window.SoundEngine || {});

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (a, b) => a + Math.random() * (b - a);

  /** 丸太の「大きさ」(m)。体積の立方根。 */
  function logSize(length, radius) {
    const L = Number.isFinite(length) ? length : 2;
    const r = Number.isFinite(radius) ? radius : 0.15;
    return clamp(Math.cbrt(Math.PI * r * r * L), 0.08, 2.6);
  }
  /** 丸太の共鳴周波数(Hz)。大きいほど低い。 */
  function logResonance(size) { return clamp(260 / Math.pow(size, 0.8), 70, 1200); }
  /** 衝突の強さ(0〜1)。0.3m/s未満は鳴らさない(転がり続ける細かい接触を拾わない)。 */
  function impactStrength(speed) { return speed < 0.3 ? 0 : Math.pow(clamp((speed - 0.2) / 6.5, 0, 1), 0.7); }

  let noiseBuffer = null;
  function getNoise(ctx) {
    if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
    const n = Math.floor(ctx.sampleRate * 1.5);
    noiseBuffer = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  }

  // ---- 部品: 全て t(開始時刻)から鳴り、decay 秒で消える ----
  /** 減衰するフィルタ付きノイズ。 */
  function noiseHit(ctx, out, t, { type = 'lowpass', freq = 800, freqEnd = null, q = 0.7, gain = 0.3, decay = 0.1, attack = 0.002 }) {
    const src = ctx.createBufferSource();
    src.buffer = getNoise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd && freqEnd !== freq) f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + attack + decay); // フィルタが時間とともに開く/閉じる(水の質感)
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, Math.random() * 1.0, decay + attack + 0.05);
  }
  /** 減衰する音(サイン/三角)。周波数は f0 から f1 へ滑らかに動かせる。 */
  function tone(ctx, out, t, { type = 'sine', f0 = 300, f1 = null, gain = 0.2, decay = 0.15, attack = 0.003 }) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + attack + decay + 0.05);
  }
  /** 共鳴の響き: いくつかの固有振動(周波数比, 音量比, 減衰比)を重ねる。木のコーン・缶のカランなど。 */
  function modes(ctx, out, t, f0, list, gain, decay) {
    for (const [ratio, amp, dk] of list) {
      const f = f0 * ratio * rnd(0.985, 1.015);
      if (f > 9000) continue;
      tone(ctx, out, t, { type: 'sine', f0: f, gain: gain * amp, decay: Math.max(0.03, decay * dk), attack: 0.002 });
    }
  }

  const MAX_VOICES = 14;
  let activeVoices = 0;

  const Sfx = {
    _started: false,
    _lastKindTime: {},

    ensureStarted() {
      if (this._started) return true;
      const ctx = SoundEngine.getContext();
      if (!ctx) return false;
      this._started = true;
      return true;
    },

    /**
     * 1つの音(複数の部品の重なり)を、位置つきで鳴らす。
     * @param {{x:number,y:number,z:number}|null} rel リスナー相対(右, 上, 前=-Z)。nullなら中央
     * @param {number} life 余韻を含む長さ(秒)。後片付けの時刻に使う
     * @param {(ctx:AudioContext, out:AudioNode, t:number)=>void} build
     * @param {number} level 全体の音量(控えめが基本)
     */
    _voice(rel, life, build, level = 1) {
      if (!this.ensureStarted()) return;
      if (activeVoices >= MAX_VOICES) return;
      const ctx = SoundEngine.getContext();
      const t = ctx.currentTime + 0.005;
      const out = ctx.createGain();
      out.gain.value = level;
      let tail = out;
      let panner = null;
      if (rel && Number.isFinite(rel.x) && Number.isFinite(rel.z)) {
        panner = SoundEngine.createSpatialPanner(rel.x, rel.y || 0, rel.z, false);
        out.connect(panner);
        tail = panner;
      }
      tail.connect(SoundEngine.getSfxBus());
      activeVoices++;
      try { build(ctx, out, t); } catch (e) { console.warn('[sfx]', e); }
      setTimeout(() => {
        activeVoices = Math.max(0, activeVoices - 1);
        try { out.disconnect(); if (panner) panner.disconnect(); } catch (e) { /* 既に外れている */ }
      }, (life + 0.3) * 1000);
    },

    /** 同じ種類の音の連打(転がり中の細かい接触など)を抑える。 */
    _throttle(kind, minGap) {
      const ctx = SoundEngine.getContext();
      if (!ctx) return true;
      const last = this._lastKindTime[kind] || -10;
      if (ctx.currentTime - last < minGap) return true;
      this._lastKindTime[kind] = ctx.currentTime;
      return false;
    },

    // ================================================================
    // チェスト
    // ================================================================
    /** 蓋の「きしみ」: 鋸波を、細かく揺れるバンドパスで通す(ぎい…と引っかかりながら動く質感)。 */
    _creak(ctx, out, t, { dur, from, to, gain }) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + dur * 0.15);
      g.gain.setValueAtTime(gain, t + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      // 引っかかりながら動く: 周波数を、短い間隔でランダムに揺らす
      const steps = Math.max(6, Math.floor(dur / 0.035));
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const f = (from + (to - from) * u) * rnd(0.9, 1.1);
        osc.frequency.setValueAtTime(f, t + u * dur);
        bp.frequency.setValueAtTime(f * rnd(2.2, 3.4), t + u * dur);
      }
      osc.connect(bp); bp.connect(g); g.connect(out);
      osc.start(t); osc.stop(t + dur + 0.05);
      noiseHit(ctx, out, t, { type: 'bandpass', freq: 900, q: 1.5, gain: gain * 0.5, decay: dur, attack: dur * 0.2 }); // 蝶番がこすれる息づかい
    },
    chestOpen(rel = null) {
      this._voice(rel, 0.9, (ctx, out, t) => {
        this._creak(ctx, out, t, { dur: 0.5, from: 190, to: 330, gain: 0.05 });
        // 開ききって止まる、小さなコトッ
        tone(ctx, out, t + 0.5, { type: 'sine', f0: 300, f1: 210, gain: 0.16, decay: 0.12 });
        noiseHit(ctx, out, t + 0.5, { type: 'lowpass', freq: 900, gain: 0.12, decay: 0.06 });
      }, 0.9);
    },
    chestClose(rel = null) {
      this._voice(rel, 0.9, (ctx, out, t) => {
        this._creak(ctx, out, t, { dur: 0.32, from: 330, to: 230, gain: 0.04 });
        const tt = t + 0.32; // 閉まる: 木の箱のドスッ+留め金の小さなカチ
        tone(ctx, out, tt, { type: 'sine', f0: 135, f1: 70, gain: 0.34, decay: 0.2 });
        noiseHit(ctx, out, tt, { type: 'lowpass', freq: 600, gain: 0.22, decay: 0.09 });
        modes(ctx, out, tt, 240, [[1, 1, 1], [2.3, 0.5, 0.6]], 0.13, 0.16);
        noiseHit(ctx, out, tt + 0.03, { type: 'bandpass', freq: 2600, q: 3, gain: 0.1, decay: 0.02 });
      }, 0.9);
    },

    // ================================================================
    // アイテムを置く・拾う
    // ================================================================
    _material(itemId) {
      switch (itemId) {
        case 'star': case 'star_shard': case 'star_torch': return 'star';
        case 'empty_can': return 'tin';
        case 'jack_o_lantern': return 'pumpkin';
        case 'twig': case 'log': case 'wood': case 'colored_pencils': case 'chest': case 'crafting_table': case 'campfire': return 'wood';
        case 'cassette_tape': case 'small_toy': return 'plastic';
        case 'stone': case 'coal': case 'iron': case 'diamond': return 'stone';
        default: return 'soft';
      }
    },
    /** 地面(雪)にそっと置く音: ポスッ + 素材ごとの小さな音。 */
    itemPlace(itemId, rel = null) {
      const mat = this._material(itemId);
      this._voice(rel, 0.8, (ctx, out, t) => {
        noiseHit(ctx, out, t, { type: 'lowpass', freq: rnd(600, 800), gain: 0.2, decay: 0.09 }); // 雪の「ポス」
        tone(ctx, out, t, { type: 'sine', f0: rnd(200, 230), f1: 125, gain: 0.17, decay: 0.1 });
        if (mat === 'star') {
          tone(ctx, out, t + 0.02, { f0: 2093, gain: 0.05, decay: 0.55 });
          tone(ctx, out, t + 0.07, { f0: 3136, gain: 0.035, decay: 0.4 });
        } else if (mat === 'tin') {
          modes(ctx, out, t, 1150, [[1, 1, 1], [1.62, 0.7, 0.8], [2.7, 0.4, 0.5]], 0.07, 0.22);
        } else if (mat === 'pumpkin') {
          tone(ctx, out, t, { f0: 270, f1: 170, gain: 0.2, decay: 0.12 });
        } else if (mat === 'wood') {
          modes(ctx, out, t, 520, [[1, 1, 1], [2.4, 0.4, 0.5]], 0.11, 0.09);
        } else if (mat === 'plastic') {
          noiseHit(ctx, out, t, { type: 'bandpass', freq: 3000, q: 2, gain: 0.07, decay: 0.02 });
          tone(ctx, out, t, { f0: 1400, gain: 0.05, decay: 0.06 });
        } else if (mat === 'stone') {
          noiseHit(ctx, out, t, { type: 'bandpass', freq: 2400, q: 2, gain: 0.08, decay: 0.03 });
          modes(ctx, out, t, 800, [[1, 1, 1], [1.6, 0.5, 0.6]], 0.06, 0.08);
        }
      }, 0.85);
    },
    /** 拾う音: 軽く上がる「ぴょこ」+ 衣擦れのような短いノイズ + 素材の小さな響き。 */
    itemPickup(itemId, rel = null) {
      const mat = this._material(itemId);
      this._voice(rel, 0.8, (ctx, out, t) => {
        tone(ctx, out, t, { type: 'sine', f0: 560, f1: 900, gain: 0.15, decay: 0.09 });
        noiseHit(ctx, out, t, { type: 'bandpass', freq: 2200, q: 0.8, gain: 0.09, decay: 0.05 });
        if (mat === 'star') {
          tone(ctx, out, t + 0.03, { f0: 1568, gain: 0.06, decay: 0.45 });
          tone(ctx, out, t + 0.08, { f0: 2349, gain: 0.05, decay: 0.4 });
        } else if (mat === 'tin') {
          modes(ctx, out, t + 0.01, 1300, [[1, 1, 1], [1.62, 0.6, 0.7]], 0.05, 0.15);
        } else if (mat === 'wood') {
          tone(ctx, out, t, { type: 'triangle', f0: 420, f1: 300, gain: 0.08, decay: 0.07 });
        } else if (mat === 'pumpkin') {
          tone(ctx, out, t, { f0: 330, f1: 230, gain: 0.1, decay: 0.09 });
        }
      }, 0.85);
    },

    // ================================================================
    // 丸太
    // ================================================================
    /**
     * 丸太がぶつかった音。
     * @param {{surface:'ground'|'log'|'rock'|'tree'|'tent'|'chest', speed:number, length:number, radius:number, otherLength?:number, otherRadius?:number}} p
     */
    logImpact(p, rel = null) {
      const s = impactStrength(p.speed);
      if (s <= 0) return;
      if (this._throttle('impact-' + p.surface, 0.06)) return;
      const size = logSize(p.length, p.radius);
      const f0 = logResonance(size);
      const dur = clamp(0.10 + 0.4 * size, 0.1, 1.0);
      const surface = p.surface || 'ground';
      this._voice(rel, dur + 0.5, (ctx, out, t) => {
        const G = 0.5 * s;
        if (surface === 'log') {
          // 木と木: 硬いコーン。コツ(高い click) + 共鳴の響き(大きいほど低く長い)。
          // 相手の丸太も鳴るので、相手が分かるときは相手の大きさの響きも重ねる。
          noiseHit(ctx, out, t, { type: 'bandpass', freq: 1500 + 1700 * s, q: 1.2, gain: G * 0.55, decay: 0.03 });
          modes(ctx, out, t, f0, [[1, 0.65, 1], [2.76, 0.32, 0.6], [5.4, 0.16, 0.35]], G, dur);
          tone(ctx, out, t, { type: 'sine', f0: Math.max(50, f0 * 0.5), f1: Math.max(40, f0 * 0.38), gain: G * 0.5, decay: 0.08 + 0.1 * size });
          if (Number.isFinite(p.otherLength)) {
            const f1 = logResonance(logSize(p.otherLength, p.otherRadius));
            modes(ctx, out, t, f1, [[1, 0.5, 0.9], [2.76, 0.22, 0.5]], G * 0.8, clamp(0.1 + 0.4 * logSize(p.otherLength, p.otherRadius), 0.1, 1.0));
          }
        } else if (surface === 'rock') {
          // 木と石: 乾いたカツ。非整数倍の硬い響き
          noiseHit(ctx, out, t, { type: 'bandpass', freq: 2400 + 1500 * s, q: 2, gain: G * 0.6, decay: 0.035 });
          modes(ctx, out, t, f0 * 1.5, [[1, 0.5, 1], [1.59, 0.4, 0.7], [3.1, 0.25, 0.4]], G * 0.9, dur * 0.7);
          tone(ctx, out, t, { f0: Math.max(55, f0 * 0.5), f1: 45, gain: G * 0.4, decay: 0.07 + 0.08 * size });
        } else if (surface === 'tree') {
          // 立ち木の幹: 太い低いドン。幹が少し響く
          noiseHit(ctx, out, t, { type: 'lowpass', freq: 700 + 500 * s, gain: G * 0.6, decay: 0.07 });
          tone(ctx, out, t, { f0: 150, f1: 75, gain: G * 0.8, decay: 0.2 + 0.1 * size });
          modes(ctx, out, t, Math.max(110, f0 * 0.6), [[1, 0.4, 1], [2.3, 0.2, 0.5]], G * 0.6, dur * 0.8);
        } else if (surface === 'tent') {
          // 布: ふわっと吸われるボフッ
          noiseHit(ctx, out, t, { type: 'lowpass', freq: 380 + 200 * s, gain: G * 0.8, decay: 0.16 });
          tone(ctx, out, t, { f0: 95, f1: 60, gain: G * 0.45, decay: 0.16 });
        } else if (surface === 'chest') {
          // 木の箱: 中が空洞のコン
          noiseHit(ctx, out, t, { type: 'bandpass', freq: 1200, q: 1, gain: G * 0.4, decay: 0.03 });
          modes(ctx, out, t, 190, [[1, 1, 1], [2.05, 0.5, 0.6], [3.4, 0.25, 0.4]], G * 0.8, 0.25);
        } else {
          // 地面(雪・土): 音を吸われて、短く鈍い「ドスッ」。大きいほど低く、少し長い。強いほど明るい。
          noiseHit(ctx, out, t, { type: 'lowpass', freq: clamp(260 + 900 * s - 140 * size, 180, 1100), gain: G * 0.9, decay: 0.09 + 0.1 * size });
          tone(ctx, out, t, { f0: Math.max(48, f0 * 0.45), f1: Math.max(36, f0 * 0.3), gain: G * 0.75, decay: 0.12 + 0.18 * size });
          tone(ctx, out, t, { f0: f0, gain: G * 0.14, decay: 0.04 + 0.06 * size }); // 木の弱いコツ(雪に吸われて小さい)
        }
      }, 1.0);
    },

    /** 編集モードで丸太をそっと置いた音(落下の衝突が小さすぎて鳴らない時の補い)。 */
    logPlace(p, rel = null) {
      this.logImpact({ surface: p.surface || 'ground', speed: 1.3, length: p.length, radius: p.radius }, rel);
    },

    /**
     * 丸太が川に落ちた音(ボチャン)。サイン波は使わない(電子音に聞こえるため)。全てノイズを、
     * 時間とともに動くフィルタで成形して作る。水の着水は、次の4つが重なる:
     *   1. 水面を叩く「ベチャッ」: 帯域の広いノイズが一瞬(30〜60ms)
     *   2. 空気をはらんだ空洞の「ボッ」: 低い共鳴(ノイズで共鳴フィルタを叩く)。周波数が少し下がりながら鳴る。大きい丸太ほど低く長い
     *   3. 水柱が崩れて戻る「ザバァ」: 少し遅れて膨らむ低めのノイズ。フィルタは明るい→暗いへ閉じる
     *   4. 巻き込まれた泡の「ぽこぽこ」: 小さな共鳴ノイズが、上がり調子に鳴る(川の泡音と同じ作り)
     * 毎回、ばらつきを入れて、同じ音が続かないようにする。
     */
    logSplash(p, rel = null) {
      const s = Math.max(0.2, impactStrength(Math.max(p.speed, 0.8)));
      if (this._throttle('splash', 0.12)) return;
      const size = logSize(p.length, p.radius);
      const mass = clamp(size / 1.2, 0.1, 1); // 大きいほど、水を大きく押しのけて、低く深い音になる
      this._voice(rel, 1.8, (ctx, out, t) => {
        const G = 0.6 * s;
        // 1. 水面を叩く
        noiseHit(ctx, out, t, { type: 'bandpass', freq: rnd(1400, 2200), freqEnd: 700, q: 0.5, gain: G * 0.9, decay: 0.045 + 0.03 * mass, attack: 0.001 });
        noiseHit(ctx, out, t, { type: 'highpass', freq: 2500, q: 0.4, gain: G * 0.3, decay: 0.06, attack: 0.001 });
        // 2. 空洞の「ボッ」(低い共鳴を、ノイズで叩く)。周波数は少し下がる
        const fc = clamp(240 / Math.pow(size, 0.45), 85, 330) * rnd(0.92, 1.08);
        noiseHit(ctx, out, t + 0.004, { type: 'bandpass', freq: fc * 1.6, freqEnd: fc, q: 7, gain: G * (1.1 + 0.9 * mass), decay: 0.16 + 0.3 * mass, attack: 0.004 });
        noiseHit(ctx, out, t + 0.004, { type: 'lowpass', freq: 170, freqEnd: 90, q: 1.2, gain: G * (0.7 + 0.7 * mass), decay: 0.2 + 0.3 * mass, attack: 0.005 }); // 体に響く低域(ノイズ。サイン波ではない)
        // 3. 水柱が崩れる「ザバァ」: 少し遅れて膨らみ、フィルタが閉じていく
        const tw = t + rnd(0.07, 0.12);
        noiseHit(ctx, out, tw, { type: 'lowpass', freq: 2200 + 800 * s, freqEnd: 420, q: 0.6, gain: G * (0.5 + 0.45 * mass), decay: 0.35 + 0.65 * size, attack: 0.09 });
        noiseHit(ctx, out, tw + 0.05, { type: 'bandpass', freq: 900, freqEnd: 400, q: 0.8, gain: G * 0.35, decay: 0.3 + 0.4 * size, attack: 0.1 });
        // 4. 泡のぽこぽこ: 大きい泡ほど低く、遅れて鳴る。共鳴ノイズなので、水っぽい
        const n = Math.min(9, 3 + Math.floor(size * 3 + s * 4));
        for (let i = 0; i < n; i++) {
          const tb = t + 0.05 + Math.pow(Math.random(), 1.4) * (0.35 + 0.5 * size);
          const f = rnd(380, 1500) * (1.25 - 0.45 * mass) * rnd(0.85, 1.15);
          noiseHit(ctx, out, tb, { type: 'bandpass', freq: f, freqEnd: f * rnd(1.25, 1.6), q: rnd(14, 26), gain: G * rnd(0.18, 0.5), decay: rnd(0.04, 0.11), attack: 0.002 });
        }
      }, 1.0);
    },
  };

  Sfx.logSize = logSize;
  Sfx.logResonance = logResonance;
  Sfx.impactStrength = impactStrength;
  SoundEngine.Sfx = Sfx;
})();
