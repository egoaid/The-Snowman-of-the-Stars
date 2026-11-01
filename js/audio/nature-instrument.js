/**
 * nature-instrument.js (v1.97)
 * 世界の自然物を、鍵盤で演奏する楽器。サンプル音源は使わず、Web Audio だけで作る。
 *   木=木琴 / 川=水滴 / 花=幻想的な音 / 虫=虫の声(音階) / 雪=澄んだベル / 星の灯り=鈴・チャイム / 石=打楽器
 * 使い方: NatureInstrument.noteOn(source, midi, velocity01) / noteOff(midi) / allOff()
 *   ・押している間だけ鳴る音(花・虫)と、鳴らしたら自然に消える音(それ以外)がある。
 *   ・同時に鳴らせる数は20。超えたら、いちばん古い音から止める。
 *   ・川の音は、サイン波ではなく「ノイズ+共鳴フィルタ」で作る(サイン波は電子音に聞こえるため。river.js と同じ考え方)。
 */
(function () {
  'use strict';
  const SoundEngine = (window.SoundEngine = window.SoundEngine || {});

  const MAX_VOICES = 20;
  // 自然物ごとに、鍵盤の音を何倍の高さで鳴らすか(その音色が気持ちよく聞こえる高さへ)
  const FREQ_MUL = { tree: 1, river: 4, flower: 2, insect: 4, snow: 2, star: 4, stone: 1 };
  const SUSTAINED = { flower: true, insect: true }; // 押している間、鳴り続ける
  const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  let ctx = null, bus = null, noiseBuf = null;
  const active = []; // { midi, source, endAt, release }

  function ensure() {
    if (bus) return true;
    if (!SoundEngine.getContext || !SoundEngine.getSfxBus) return false;
    ctx = SoundEngine.getContext();
    bus = ctx.createGain(); bus.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor(); // 和音を弾いても割れないように
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    bus.connect(comp); comp.connect(SoundEngine.getSfxBus());
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  // ---- 部品 ----
  function gainEnv(t, peak, attack, decay) { // ぽん、と鳴って、指数的に消える
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }
  function osc(type, f, t, end, dest, detune) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (detune) o.detune.value = detune;
    o.connect(dest); o.start(t); o.stop(end); return o;
  }
  function noiseSrc(t, dur, dest) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    s.connect(dest); s.start(t, Math.random() * 0.3); s.stop(t + dur); return s;
  }
  // 倍音をいくつか重ねて鳴らす(木琴・ベル・チャイム)
  function partialsHit(f, t, vel, parts, dur, peak, dest) {
    let end = t;
    for (const p of parts) {
      if (f * p.ratio > 14000) continue;
      const d = dur * p.decay; end = Math.max(end, t + d + 0.05);
      const g = gainEnv(t, peak * vel * p.amp, 0.002, d); g.connect(dest);
      osc('sine', f * p.ratio, t, t + d + 0.05, g);
    }
    return end;
  }

  // ---- 音色 ----
  const VOICES = {
    // 木: 木琴のような、柔らかくて短い音。低い音ほど、少し長く響く。
    tree(f, t, vel, out) {
      const dur = Math.max(0.28, Math.min(1.1, 0.9 * Math.sqrt(261 / f)));
      const end = partialsHit(f, t, vel, [{ ratio: 1, amp: 1, decay: 1 }, { ratio: 3.9, amp: 0.34, decay: 0.34 }, { ratio: 9.2, amp: 0.07, decay: 0.12 }], dur, 0.34, out);
      const click = ctx.createBiquadFilter(); click.type = 'bandpass'; click.frequency.value = Math.min(6000, f * 3); click.Q.value = 1.4;
      const cg = gainEnv(t, 0.1 * vel, 0.001, 0.025); click.connect(cg); cg.connect(out); noiseSrc(t, 0.05, click);
      return { endAt: end, release: null };
    },
    // 川: 水滴。ノイズを共鳴フィルタに通して、ぽちゃっと鳴らす。少しだけ音程が上がる(泡のように)。
    river(f, t, vel, out) {
      let end = t;
      for (const [mul, q, amp] of [[1, 90, 1], [2.02, 70, 0.45]]) {
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
        bp.frequency.setValueAtTime(f * mul * 0.88, t); bp.frequency.exponentialRampToValueAtTime(f * mul, t + 0.05);
        const g = gainEnv(t, 5.5 * vel * amp, 0.002, 0.34); bp.connect(g); g.connect(out); noiseSrc(t, 0.05, bp); end = Math.max(end, t + 0.4);
      }
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2400;
      const sg = gainEnv(t, 0.07 * vel, 0.001, 0.05); hp.connect(sg); sg.connect(out); noiseSrc(t, 0.06, hp); // 水が弾ける小さな音
      return { endAt: end, release: null };
    },
    // 花: 不思議で幻想的な音。ゆっくり立ち上がり、きらめきを重ねる。押している間、鳴り続ける。
    flower(f, t, vel, out) {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; lp.Q.value = 0.5; lp.connect(out);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2 * vel, t + 0.06); g.gain.exponentialRampToValueAtTime(0.12 * vel, t + 0.9); g.connect(lp);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 4.6; const lg = ctx.createGain(); lg.gain.value = 0.035 * vel; lfo.connect(lg); lg.connect(g.gain); lfo.start(t);
      const oscs = [osc('triangle', f, t, t + 30, g, -6), osc('triangle', f, t, t + 30, g, 6), osc('sine', f * 2, t, t + 30, g), osc('sine', f * 3.01, t, t + 30, g, 4)];
      const sp = ctx.createGain(); sp.gain.setValueAtTime(0.0001, t + 0.12); sp.gain.exponentialRampToValueAtTime(0.05 * vel, t + 0.3); sp.gain.exponentialRampToValueAtTime(0.0001, t + 1.6); sp.connect(out);
      oscs.push(osc('sine', f * 4, t + 0.12, t + 1.7, sp));
      return {
        endAt: t + 30,
        release(rt) { g.gain.cancelScheduledValues(rt); g.gain.setTargetAtTime(0.0001, rt, 0.35); for (const o of oscs) { try { o.stop(rt + 1.6); } catch (e) { /* 止まっていても大丈夫 */ } } try { lfo.stop(rt + 1.6); } catch (e) { /* 同上 */ } return rt + 1.7; },
      };
    },
    // 虫: 虫の声を音階にしたもの。細かく震える高い音(押している間、鳴り続ける)。
    insect(f, t, vel, out) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 5; bp.connect(out);
      const am = ctx.createGain(); am.gain.value = 0.55; am.connect(bp);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * vel, t + 0.025); g.connect(am);
      const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 24 + (f % 17); const lg = ctx.createGain(); lg.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain); lfo.start(t); // 細かい震え(虫の羽音のような)
      const o1 = osc('sawtooth', f, t, t + 30, g), o2 = osc('sawtooth', f * 1.004, t, t + 30, g);
      return {
        endAt: t + 30,
        release(rt) { g.gain.cancelScheduledValues(rt); g.gain.setTargetAtTime(0.0001, rt, 0.05); for (const o of [o1, o2, lfo]) { try { o.stop(rt + 0.4); } catch (e) { /* 同上 */ } } return rt + 0.45; },
      };
    },
    // 雪: 澄んだベルのような音。長く響く。
    snow(f, t, vel, out) {
      const end = partialsHit(f, t, vel, [{ ratio: 1, amp: 1, decay: 1 }, { ratio: 2.32, amp: 0.42, decay: 0.6 }, { ratio: 4.25, amp: 0.2, decay: 0.38 }, { ratio: 6.63, amp: 0.09, decay: 0.24 }], 2.6, 0.26, out);
      return { endAt: end, release: null };
    },
    // 星の灯り: 鈴・チャイム。きらきらと高く、こだまが少し遅れて返る。
    star(f, t, vel, out) {
      const parts = [{ ratio: 1, amp: 1, decay: 1 }, { ratio: 2.76, amp: 0.38, decay: 0.55 }, { ratio: 5.4, amp: 0.17, decay: 0.32 }, { ratio: 8.93, amp: 0.07, decay: 0.2 }];
      const e1 = partialsHit(f, t, vel, parts, 3.0, 0.2, out);
      const e2 = partialsHit(f, t + 0.19, vel, parts, 1.6, 0.06, out);
      return { endAt: Math.max(e1, e2), release: null };
    },
    // 石: 石を叩いた打楽器。カッという硬い音と、音程のある鈍い響き。
    stone(f, t, vel, out) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 7;
      const g = gainEnv(t, 1.3 * vel, 0.001, 0.12); bp.connect(g); g.connect(out); noiseSrc(t, 0.14, bp);
      const th = ctx.createOscillator(); th.type = 'sine'; th.frequency.setValueAtTime(f * 0.5, t); th.frequency.exponentialRampToValueAtTime(f * 0.2, t + 0.12);
      const tg = gainEnv(t, 0.4 * vel, 0.002, 0.16); th.connect(tg); tg.connect(out); th.start(t); th.stop(t + 0.22);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
      const cg = gainEnv(t, 0.2 * vel, 0.001, 0.02); hp.connect(cg); cg.connect(out); noiseSrc(t, 0.04, hp);
      return { endAt: t + 0.32, release: null };
    },
  };

  const NatureInstrument = {
    SOURCES: Object.keys(VOICES),
    volume: 0.9,
    setVolume(v) { this.volume = Math.max(0, Math.min(1.5, +v || 0)); if (bus) bus.gain.setTargetAtTime(this.volume, ctx.currentTime, 0.03); },
    /** 鍵盤を押した。source は 'tree' 'river' 'flower' 'insect' 'snow' 'star' 'stone'。 */
    noteOn(source, midi, velocity = 0.8) {
      if (!VOICES[source] || !ensure()) return false;
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      const now = ctx.currentTime + 0.004;
      this.noteOff(midi, true); // 同じ鍵盤の押し直し: 前の音は、ふわっと止める
      this._prune(now);
      while (active.length >= MAX_VOICES) this._stop(active.shift(), now);
      const vel = Math.max(0.15, Math.min(1, Math.pow(velocity, 1.2)));
      const v = VOICES[source](midiToFreq(midi) * FREQ_MUL[source], now, vel, bus);
      active.push({ midi, source, endAt: v.endAt, release: v.release });
      return true;
    },
    /** 鍵盤を離した。押している間だけ鳴る音(花・虫)が、止まる。 */
    noteOff(midi, retrigger) {
      if (!ctx) return;
      const now = ctx.currentTime + 0.004;
      for (let i = active.length - 1; i >= 0; i--) {
        const a = active[i];
        if (a.midi !== midi || !a.release) continue;
        this._stop(a, now); active.splice(i, 1);
      }
    },
    allOff() { if (!ctx) return; const now = ctx.currentTime + 0.004; for (const a of active.splice(0)) this._stop(a, now); },
    activeCount() { return active.length; },
    _stop(a, t) { if (a && a.release) { try { a.endAt = a.release(t); } catch (e) { /* もう止まっている */ } } },
    _prune(now) { for (let i = active.length - 1; i >= 0; i--) if (active[i].endAt < now) active.splice(i, 1); },
  };
  NatureInstrument.SUSTAINED = SUSTAINED;
  SoundEngine.NatureInstrument = NatureInstrument;
})();
