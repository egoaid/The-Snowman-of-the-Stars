/**
 * nature-instrument.js (v1.97)
 * 世界の自然物を、鍵盤で演奏する楽器。サンプル音源は使わず、Web Audio だけで作る。
 *   木=木琴 / 川=水滴 / 花=幻想的な音 / 虫=虫の声(音階) / 雪=澄んだベル / 星の灯り=鈴・チャイム / 石=打楽器
 * 使い方: NatureInstrument.noteOn(source, midi, velocity01) / noteOff(midi) / allOff()
 *   ・押している間だけ鳴る音(花・虫)と、鳴らしたら自然に消える音(それ以外)がある。
 *   ・同時に鳴らせる数は20。超えたら、いちばん古い音から止める。
 *   ・川は「石が落ちたポチャン」、石は「石の棒を叩いたゴーン」。どちらも、残響(リバーブ)が気持ちよく響く(自然物ごとに、残響の量が違う)。
 *   ・水の音は、サイン波だけにしない(電子音に聞こえるため)。ノイズ+共鳴フィルタに、ごく弱い低い響きを足す。
 */
(function () {
  'use strict';
  const SoundEngine = (window.SoundEngine = window.SoundEngine || {});

  const MAX_VOICES = 20;
  // 自然物ごとに、鍵盤の音を何倍の高さで鳴らすか(その音色が気持ちよく聞こえる高さへ)
  const FREQ_MUL = { tree: 1, river: 2, flower: 2, insect: 4, snow: 2, star: 4, stone: 1 };
  // 自然物ごとの、残響(リバーブ)の量。川は「ポチャン」の余韻、石は「ゴーン」の長い響きを、しっかり出す。
  const REVERB_SEND = { tree: 0.12, river: 0.5, flower: 0.3, insect: 0.06, snow: 0.25, star: 0.3, stone: 0.8 };
  const SUSTAINED = { flower: true, insect: true }; // 押している間、鳴り続ける
  const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  let ctx = null, bus = null, noiseBuf = null, reverbIn = null, shaper = null, gate = null, stutterTimer = null, remoteIn = null, remoteLp = null, remotePan = null, remoteReverbIn = null, remoteDefault = false, wetNode = null, wet2Node = null, remoteCut = 1, envWet = 1;
  let condDirty = false; // 音声の準備ができる前に決まった条件を、準備ができたあとで反映する
  const cond = { gain: 1, drive: 0, dropout: 0 }; // 電池の状態による劣化(music/battery.js の degradation)。gain 0 = 電池切れで、鳴らない
  const active = []; // { midi, source, endAt, release }

  function ensure() {
    if (bus) return true;
    if (!SoundEngine.getContext || !SoundEngine.getSfxBus) return false;
    ctx = SoundEngine.getContext();
    bus = ctx.createGain(); bus.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor(); // 和音を弾いても割れないように
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    shaper = ctx.createWaveShaper(); gate = ctx.createGain(); // 電池が少ない時: 歪み(shaper)と、音の途切れ(gate)
    bus.connect(shaper); shaper.connect(gate); gate.connect(comp); comp.connect(SoundEngine.getSfxBus());
    // 残響: 約2.4秒で消える、少し暗い響き(石の洞窟や、水辺の空間のような)。ノイズが指数的に減衰する波形を、その場で作る。
    const len = Math.floor(ctx.sampleRate * 2.6), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch); let y = 0;
      for (let i = 0; i < len; i++) { y += ((Math.random() * 2 - 1) - y) * 0.32; d[i] = y * Math.exp(-i / (ctx.sampleRate * 0.5)) * (i < 200 ? i / 200 : 1); }
    }
    // 雪だるまが、世界のどこかで弾く音: 距離で小さく・こもり、HRTFで方向がわかる(近くで弾くプレイヤー自身の音は、この道を通らない)
    remoteIn = ctx.createGain(); remoteLp = ctx.createBiquadFilter(); remoteLp.type = 'lowpass'; remoteLp.frequency.value = 14000; remoteLp.Q.value = 0.4;
    remotePan = ctx.createPanner(); remotePan.panningModel = 'HRTF'; remotePan.distanceModel = 'inverse'; remotePan.refDistance = 2; remotePan.rolloffFactor = 1.4; remotePan.maxDistance = 300; // 距離で、音量が、ほぼ距離に反比例して小さくなる(遠いほど、はっきり小さい)
    remoteIn.connect(remoteLp); remoteLp.connect(remotePan); remotePan.connect(bus);
    reverbIn = ctx.createGain(); const conv = ctx.createConvolver(); conv.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.9 * envWet; wetNode = wet;
    reverbIn.connect(conv); conv.connect(wet); wet.connect(bus);
    // 遠くの演奏の残響も、距離の道(音量・こもり・方向)を通す。残響だけが、遠くでも大きく聞こえないように
    remoteReverbIn = ctx.createGain(); const conv2 = ctx.createConvolver(); conv2.buffer = ir; const wet2 = ctx.createGain(); wet2.gain.value = 0.9 * envWet; wet2Node = wet2;
    remoteReverbIn.connect(conv2); conv2.connect(wet2); wet2.connect(remoteIn);
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
    // 川: 川の流れの音に、音階をつけた音。さらさらと流れる水を、鍵盤の高さで鳴らし、少しエコーさせる。
    //     (「ポチャン」を、鍵盤で鳴らすのではなく、流れそのものを奏でる。水の流れらしい、ゆるやかな揺れ付き)
    river(f, t, vel, out) {
      const dur = 0.95;
      const ripple = ctx.createGain(); ripple.gain.value = 0.7; // 流れのうねり(ゆるやかな揺れ)
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 5.2 + (f % 3); const lg = ctx.createGain(); lg.gain.value = 0.3; lfo.connect(lg); lg.connect(ripple.gain); lfo.start(t); lfo.stop(t + dur + 0.2);
      const env = gainEnv(t, 5.4 * vel, 0.045, dur); env.connect(ripple);
      const sig = ctx.createGain(); ripple.connect(sig);
      for (const [mul, q, amp] of [[1, 15, 1], [2.01, 11, 0.5], [3.02, 9, 0.22]]) { // 音階: 流れのノイズを、音の高さ(と倍音)の共鳴に通す
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * mul; bp.Q.value = q;
        const g = ctx.createGain(); g.gain.value = amp; bp.connect(g); g.connect(env); noiseSrc(t, dur + 0.1, bp);
      }
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800; // 水のさらさらした粒
      const sg = gainEnv(t, 0.1 * vel, 0.05, dur * 0.8); hp.connect(sg); sg.connect(sig); noiseSrc(t, dur, hp);
      sig.connect(out);
      const dly = ctx.createDelay(1.0), fb = ctx.createGain(), dlp = ctx.createBiquadFilter(); // エコー: 少し遅れて、やわらかく返る
      dly.delayTime.value = 0.27; fb.gain.value = 0.4; dlp.type = 'lowpass'; dlp.frequency.value = 2600;
      const echoSend = ctx.createGain(); echoSend.gain.value = 0.55; sig.connect(echoSend); echoSend.connect(dly); dly.connect(dlp); dlp.connect(out); dlp.connect(fb); fb.connect(dly);
      if (typeof setTimeout === 'function') setTimeout(() => { try { fb.disconnect(); dly.disconnect(); dlp.disconnect(); } catch (e) { /* 片づけ済み */ } }, (dur + 2.6) * 1000);
      return { endAt: t + dur + 2.0, release: null };
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
    // 雪: 音階のある、そりの鈴(Sleigh bells)。小さな金属の鈴が、いくつも触れ合って、シャラシャラと鳴る。音の高さは、鍵盤のとおり。
    snow(f, t, vel, out) {
      const base = f * 2, parts = [{ ratio: 1, amp: 1, decay: 1 }, { ratio: 2.71, amp: 0.55, decay: 0.7 }, { ratio: 4.52, amp: 0.34, decay: 0.5 }, { ratio: 6.4, amp: 0.2, decay: 0.36 }];
      let end = t;
      const N = 7; // 鈴の数
      for (let i = 0; i < N; i++) {
        const at = t + Math.random() * 0.07 + i * 0.006, fi = base * (1 + (Math.random() - 0.5) * 0.014); // 少しずつ違う高さ: 触れ合う、きらめき
        end = Math.max(end, partialsHit(fi, at, vel * (0.55 + Math.random() * 0.45), parts, 0.55 + Math.random() * 0.3, 0.2 / Math.sqrt(N / 3), out));
      }
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5200; // 鈴が触れ合う、細かい金属音
      const sg = gainEnv(t, 0.12 * vel, 0.002, 0.11); hp.connect(sg); sg.connect(out); noiseSrc(t, 0.14, hp);
      return { endAt: end + 0.05, release: null };
    },
    // 星の灯り: 鈴・チャイム。きらきらと高く、こだまが少し遅れて返る。
    star(f, t, vel, out) {
      const parts = [{ ratio: 1, amp: 1, decay: 1 }, { ratio: 2.76, amp: 0.38, decay: 0.55 }, { ratio: 5.4, amp: 0.17, decay: 0.32 }, { ratio: 8.93, amp: 0.07, decay: 0.2 }];
      const e1 = partialsHit(f, t, vel, parts, 3.0, 0.2, out);
      const e2 = partialsHit(f, t + 0.19, vel, parts, 1.6, 0.06, out);
      return { endAt: Math.max(e1, e2), release: null };
    },
    // 石: 石の棒を叩いた「ゴーン」。硬く叩く音のあと、重い響きが、残響の中で長く伸びる。
    //   わずかにずれた2本の基音がうなり(ゴーン…ゴーン…)を作り、石の棒らしい、割り切れない倍音が重なる。
    stone(f, t, vel, out) {
      const parts = [{ ratio: 1, amp: 1, decay: 1 }, { ratio: 1.004, amp: 0.8, decay: 0.95 }, { ratio: 2.76, amp: 0.42, decay: 0.5 }, { ratio: 5.4, amp: 0.16, decay: 0.26 }, { ratio: 8.93, amp: 0.06, decay: 0.14 }];
      const end = partialsHit(f, t, vel, parts, 2.8, 0.3, out);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = Math.min(5000, f * 2.6); bp.Q.value = 5;
      const g = gainEnv(t, 1.1 * vel, 0.001, 0.1); bp.connect(g); g.connect(out); noiseSrc(t, 0.12, bp); // 叩いた「コッ」
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3500;
      const cg = gainEnv(t, 0.14 * vel, 0.001, 0.02); hp.connect(cg); cg.connect(out); noiseSrc(t, 0.04, hp);
      return { endAt: end, release: null };
    },
  };

  const NatureInstrument = {
    SOURCES: Object.keys(VOICES),
    volume: 0.9,
    /**
     * v1.99: 電池の状態による劣化。gain=音量の倍率(0なら鳴らない) / drive=歪み(0〜1) / dropout=音が途切れる確率(0〜1)。
     * 電池が少ない時は、小さく・歪んで・ぷつぷつ途切れる。なくなったら、鳴らない。
     */
    setCondition(c) {
      cond.gain = Math.max(0, +c.gain || 0); cond.drive = Math.max(0, Math.min(1, +c.drive || 0)); cond.dropout = Math.max(0, Math.min(1, +c.dropout || 0));
      if (!ensure()) { condDirty = true; return; }
      condDirty = false;
      bus.gain.setTargetAtTime(this.volume * cond.gain, ctx.currentTime, 0.03);
      if (cond.drive < 0.02) shaper.curve = null; else { // 歪みの量が変わったら、カーブを作り直す(ソフトクリップ)
        const k = 4 + cond.drive * 60, n = 512, curve = new Float32Array(n);
        for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
        shaper.curve = curve;
      }
      if (cond.dropout > 0 && cond.gain > 0 && !stutterTimer && typeof setInterval === 'function') { // ときどき、一瞬、音が切れる
        stutterTimer = setInterval(() => {
          if (!(cond.dropout > 0 && cond.gain > 0)) { clearInterval(stutterTimer); stutterTimer = null; gate.gain.setValueAtTime(1, ctx.currentTime); return; }
          if (Math.random() < cond.dropout * 0.6) { const t = ctx.currentTime; gate.gain.setValueAtTime(0.0, t); gate.gain.setValueAtTime(1, t + 0.035 + Math.random() * 0.1); }
        }, 110);
      } else if (!(cond.dropout > 0) && stutterTimer) { clearInterval(stutterTimer); stutterTimer = null; gate.gain.setValueAtTime(1, ctx.currentTime); }
    },
    getCondition: () => ({ ...cond }),
    /** v1.105: 遠くの演奏が、丘・木の向こうにある時の遮蔽(0〜1)。少し小さく・こもらせる(完全には消さない)。 */
    setRemoteOcclusion(amount) {
      const a = Math.max(0, Math.min(1, +amount || 0)); remoteCut = 1 - 0.75 * a;
      if (!ensure()) return; remoteIn.gain.setTargetAtTime(1 - 0.45 * a, ctx.currentTime, 0.25);
    },
    /** v1.105: 聞き手のいる環境(森・川辺・雪原)に合わせた、残響の量の倍率(0.2〜1.5)。 */
    setEnvironment(e) {
      envWet = Math.max(0.2, Math.min(1.5, +(e && e.wetMul) || 1));
      if (!ensure()) return; const t = ctx.currentTime; wetNode.gain.setTargetAtTime(0.9 * envWet, t, 1.0); wet2Node.gain.setTargetAtTime(0.9 * envWet, t, 1.0);
    },
    /** true: 演奏の音を、いつも、位置のある音(setRemotePosition の場所から聞こえる)として鳴らす。 */
    setRemoteDefault(v) { remoteDefault = !!v; },
    /** 雪だるまの演奏の位置(聞き手から見た相対位置 x,y,z)。距離が遠いほど、高い音がこもる(空気の吸収)。 */
    setRemotePosition(rel) {
      if (!ensure() || !rel) return;
      const d = Math.hypot(rel.x, rel.y, rel.z), t = ctx.currentTime;
      if (remotePan.positionX) { remotePan.positionX.setTargetAtTime(rel.x, t, 0.05); remotePan.positionY.setTargetAtTime(rel.y, t, 0.05); remotePan.positionZ.setTargetAtTime(rel.z, t, 0.05); }
      else if (remotePan.setPosition) remotePan.setPosition(rel.x, rel.y, rel.z);
      remoteLp.frequency.setTargetAtTime(Math.max(1500, 20000 / (1 + d / 12)) * remoteCut, t, 0.1); // 遠いほど、高い音が弱まる(空気の吸収)
    },
    setVolume(v) { this.volume = Math.max(0, Math.min(1.5, +v || 0)); if (bus) bus.gain.setTargetAtTime(this.volume * cond.gain, ctx.currentTime, 0.03); },
    /** 鍵盤を押した。source は 'tree' 'river' 'flower' 'insect' 'snow' 'star' 'stone'。 */
    noteOn(source, midi, velocity = 0.8, opts = null) {
      if (!VOICES[source] || !ensure()) return false;
      if (condDirty) this.setCondition({ ...cond });
      if (cond.gain <= 0) return false; // 電池がない・なくなった: 鳴らない
      if (cond.dropout > 0 && Math.random() < cond.dropout * 0.35) return false; // 電池が少ない: ときどき、鍵盤を押しても鳴らない
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      const now = ctx.currentTime + 0.004;
      this.noteOff(midi, true); // 同じ鍵盤の押し直し: 前の音は、ふわっと止める
      this._prune(now);
      while (active.length >= MAX_VOICES) this._stop(active.shift(), now);
      const vel = Math.max(0.15, Math.min(1, Math.pow(velocity, 1.2)));
      const remote = opts ? !!opts.remote : remoteDefault;
      const mix = ctx.createGain(); mix.connect(remote ? remoteIn : bus); // この音の出口: そのまま(ドライ)と、残響へ送る分
      const send = ctx.createGain(); send.gain.value = REVERB_SEND[source] || 0; mix.connect(send); send.connect(remote ? remoteReverbIn : reverbIn);
      const v = VOICES[source](midiToFreq(midi) * FREQ_MUL[source], now, vel, mix);
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
