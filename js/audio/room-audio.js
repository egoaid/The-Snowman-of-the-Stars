// room-audio.js (v1.116) — 雪だるまの部屋の音。ゲーム本編と、同じ AudioContext・同じバス(環境音バス・効果音バス)につなぐ。
//   ・環境音: 部屋の空気 / 窓の外の街(昼は賑やか、夜は静か)/ 風 / パソコンのファンの低い音 / ときどき、遠くを通る車・まれに遠くのサイレン /
//            窓の外を電車が通る間の、ゴーッという音とガタンゴトン(目に見える電車と、同じ時刻・同じ向き)。振り子時計は、音を出さない。
//   ・効果音: 足音(床の木)・座る・立つ・ページをめくる・カップ・飲む・ランプのスイッチ・ヘッドセット・キーを打つ・マウス・重いものを置く音。すべて、その場で合成(サンプル不使用)。
//   ・演奏: ピアノ(piano-synth.js)と、4オペレーターFMのシンセブラス(fm4op.js)の、自動メロディ(room-melody.js)。音は、AudioContext の時計で、先読みして正確にスケジュール。
//   ・距離: 音源とカメラの位置から、左右の振り分け・音量・高音の減り方を決める(本編の聴き手=AudioListener には触らない)。
//   ・部屋が全画面の間は通常の音量。ワイプの間は、小さく絞る(ゲームの音が主役)。
import { renderPiano } from './piano-synth.js';
import { renderFm4 } from './fm4op.js';
import { createMelody } from '../music/room-melody.js';

const MODE_GAIN = { room: 1, toRoom: 1, toWipe: 0.22, wipe: 0.22 };
const LOOK = 0.35; // 先読み(秒)
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const WINDOW_POS = { x: -0.95, y: 1.75, z: -2.4 }, DESK_POS = { x: -1.2, y: 1.0, z: 0.8 };

/** 音が出せない(音声エンジンが無い)時の、何もしない版。演奏は、時計だけ進めて、音符の通知(手の動き用)は、出す。 */
function makeStub() {
  const api = {
    enabled: false, unlock() {}, setMode() {}, setNight() {}, update() {}, sfx() {}, train() {}, dispose() {},
    startPlayer({ kind = 'piano', seed = 1 } = {}) {
      const gen = createMelody({ kind, seed }); let t = -0.6, phrase = gen.next(), off = 0, idx = 0, stopped = false;
      return { kind, silent: true, update(dt) { if (stopped) return []; t += dt; const fired = []; while (phrase && idx < phrase.notes.length && off + phrase.notes[idx].t <= t) fired.push(phrase.notes[idx++]); if (phrase && idx >= phrase.notes.length && t >= off + phrase.length) { off += phrase.length; phrase = gen.next(); idx = 0; } return fired; }, stop() { stopped = true; }, get stopped() { return stopped; } };
    },
  };
  return api;
}

export function createRoomAudio({ SE, rand = Math.random } = {}) {
  SE = SE || (typeof window !== 'undefined' ? window.SoundEngine : null);
  if (!SE || !SE.getContext || !SE.getAmbientBus || !SE.getSfxBus) return makeStub();
  let ctx = null, ambMode = null, sfxMode = null, ambOut = null, sfxOut = null, revIn = null, noiseBuf = null, unlocked = false, mode = 'room', night = 1;
  const cam = { x: 0, y: 1.6, z: 5, yaw: 0 }; const players = new Set(); let beds = null; let evT = { car: 8 + rand() * 10, siren: 120 + rand() * 120, gust: 4 };
  const train = { on: false, x: 0, node: null, clackT: 0 };

  function ensure() {
    if (ctx) return true; try { ctx = SE.getContext(); } catch (e) { ctx = null; return false; } if (!ctx) return false;
    ambMode = ctx.createGain(); ambMode.gain.value = MODE_GAIN[mode]; ambMode.connect(SE.getAmbientBus());
    sfxMode = ctx.createGain(); sfxMode.gain.value = MODE_GAIN[mode]; sfxMode.connect(SE.getSfxBus());
    ambOut = ctx.createGain(); ambOut.gain.value = 0; ambOut.connect(ambMode);
    sfxOut = ctx.createGain(); sfxOut.gain.value = 1; sfxOut.connect(sfxMode);
    // 短い部屋の響き(楽器の音に、すこし足す)
    const len = Math.floor(ctx.sampleRate * 1.1), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); let z = 0; for (let i = 0; i < len; i++) { z += ((rand() * 2 - 1) - z) * 0.4; d[i] = z * Math.exp(-i / (ctx.sampleRate * 0.22)) * (i < 120 ? i / 120 : 1); } }
    const conv = ctx.createConvolver(); conv.buffer = ir; revIn = ctx.createGain(); revIn.gain.value = 0.2; revIn.connect(conv); conv.connect(sfxOut);
    const nl = ctx.sampleRate * 2, nb = ctx.createBuffer(1, nl, ctx.sampleRate), nd = nb.getChannelData(0); for (let i = 0; i < nl; i++) nd[i] = rand() * 2 - 1; noiseBuf = nb;
    return true;
  }
  /** 音源とカメラの位置から、左右(pan)・音量・高音の減り方を決める。 */
  function spatial(pos) {
    if (!pos) return { pan: 0, gain: 1, lp: 18000 };
    const dx = pos.x - cam.x, dy = (pos.y ?? cam.y) - cam.y, dz = pos.z - cam.z, d = Math.hypot(dx, dy, dz) || 0.001;
    const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw); // カメラの右(世界)
    const pan = clampN(((dx * rx + dz * rz) / d) * 0.85 * Math.min(1, d / 1.2), -0.85, 0.85);
    return { pan, gain: 1 / (1 + 0.28 * d), lp: Math.max(2500, 18000 / (1 + d * 0.25)) };
  }
  function chain(pos, out) { // 1回きりの音のための、ローパス → 音量 → 左右
    const sp = spatial(pos), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = sp.lp; const g = ctx.createGain(); g.gain.value = sp.gain;
    const pn = ctx.createStereoPanner ? ctx.createStereoPanner() : null; if (pn) pn.pan.value = sp.pan; lp.connect(g); if (pn) { g.connect(pn); pn.connect(out); } else g.connect(out); return lp;
  }
  function burst({ pos, dur = 0.1, type = 'bandpass', f = 1000, q = 1, gain = 0.1, attack = 0.003, f2 = null, hp = 0, out = sfxOut }) {
    const t = ctx.currentTime, src = ctx.createBufferSource(); src.buffer = noiseBuf; const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.setValueAtTime(f, t); if (f2) flt.frequency.linearRampToValueAtTime(f2, t + dur); flt.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt); let tail = flt; if (hp) { const h = ctx.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = hp; flt.connect(h); tail = h; } tail.connect(g); g.connect(chain(pos, out)); src.start(t, rand() * 1.5); src.stop(t + dur + 0.05);
  }
  function tone({ pos, f = 440, f2 = null, dur = 0.2, gain = 0.1, type = 'sine', attack = 0.003, out = sfxOut }) {
    const t = ctx.currentTime, o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(chain(pos, out)); o.start(t); o.stop(t + dur + 0.05);
  }
  const SFX = {
    step: (p, d) => { const h = d && d.heavy, v = 0.9 + rand() * 0.2; burst({ pos: p, dur: h ? 0.16 : 0.07, f: (h ? 130 : 190) * v, q: 0.9, gain: h ? 0.42 : 0.2 }); tone({ pos: p, f: (h ? 75 : 105) * v, f2: h ? 42 : 62, dur: h ? 0.2 : 0.09, gain: h ? 0.4 : 0.16 }); },
    sit: (p) => { burst({ pos: p, type: 'lowpass', f: 420, dur: 0.38, gain: 0.2, attack: 0.04 }); tone({ pos: p, f: 90, f2: 50, dur: 0.25, gain: 0.18 }); },
    stand: (p) => burst({ pos: p, f: 900, q: 0.6, dur: 0.3, gain: 0.08, attack: 0.05 }),
    page: (p) => burst({ pos: p, f: 2600, f2: 4800, q: 0.8, hp: 1400, dur: 0.24, gain: 0.1, attack: 0.03 }),
    clink: (p) => { tone({ pos: p, f: 2800, dur: 0.28, gain: 0.07 }); tone({ pos: p, f: 4190, dur: 0.18, gain: 0.04 }); burst({ pos: p, f: 3200, dur: 0.02, gain: 0.05 }); },
    sip: (p) => { tone({ pos: p, f: 190, f2: 110, dur: 0.13, gain: 0.07 }); burst({ pos: p, type: 'lowpass', f: 600, dur: 0.12, gain: 0.05 }); },
    lamp: (p, d) => { burst({ pos: p, f: 2200, dur: 0.015, gain: 0.25, hp: 800 }); tone({ pos: p, f: 150, f2: 90, dur: 0.07, gain: 0.2 }); if (d && d.on) tone({ pos: p, f: 300, f2: 520, dur: 0.22, gain: 0.025, attack: 0.05 }); },
    headset: (p) => { burst({ pos: p, f: 2500, dur: 0.05, gain: 0.1 }); tone({ pos: p, f: 820, f2: 600, dur: 0.07, gain: 0.04 }); },
    thud: (p, d) => { const h = !d || d.heavy !== false; tone({ pos: p, f: h ? 58 : 110, f2: h ? 36 : 70, dur: h ? 0.38 : 0.16, gain: h ? 0.5 : 0.2 }); burst({ pos: p, type: 'lowpass', f: h ? 220 : 400, dur: h ? 0.22 : 0.1, gain: h ? 0.25 : 0.1 }); },
    key: (p) => burst({ pos: p, f: 2600 + rand() * 900, q: 1.2, dur: 0.02, gain: 0.05 }),
    mouse: (p) => { burst({ pos: p, f: 2200, q: 1.5, dur: 0.018, gain: 0.07 }); setTimeout(() => { try { burst({ pos: p, f: 1700, q: 1.5, dur: 0.014, gain: 0.04 }); } catch (e) { /* もう、止まっている */ } }, 70); },
  };
  function sfx(name, pos, data) { if (!unlocked || !ctx || !SFX[name]) return; try { SFX[name](pos, data); } catch (e) { /* 音の失敗は、動きに影響させない */ } }

  // ---- 環境音 ----
  function loopNoise() { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(ctx.currentTime, rand() * 1.5); return s; }
  function bed(type, f, q, gain, pos) { // 常に鳴っている、音源(位置を持つ時は、毎コマ、カメラとの関係で、左右・音量が変わる)
    const s = loopNoise(), flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q; const g = ctx.createGain(); g.gain.value = gain; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 18000;
    const sp = ctx.createGain(); sp.gain.value = 1; const pn = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    s.connect(flt); flt.connect(g); g.connect(lp); lp.connect(sp); if (pn) { sp.connect(pn); pn.connect(ambOut); } else sp.connect(ambOut); return { g, lp, sp, pn, pos, base: gain, flt };
  }
  function startBeds() {
    beds = { tone: bed('lowpass', 170, 0.5, 0.05, null), hiss: bed('bandpass', 1300, 0.3, 0.007, null), city: bed('bandpass', 320, 0.6, 0.03, WINDOW_POS), wind: bed('bandpass', 520, 0.4, 0.0, WINDOW_POS), fan: bed('lowpass', 260, 0.7, 0.02, DESK_POS) };
    const hum = ctx.createOscillator(); hum.type = 'sine'; hum.frequency.value = 62; const hg = ctx.createGain(); hg.gain.value = 0.012; hum.connect(hg); hg.connect(beds.fan.sp); hum.start(); beds.hum = hum;
    ambOut.gain.setTargetAtTime(1, ctx.currentTime, 1.6); applyNight();
  }
  function applyNight() { if (!beds) return; const t = ctx.currentTime; beds.city.base = 0.02 + 0.02 * (1 - night); beds.city.g.gain.setTargetAtTime(beds.city.base, t, 2); }
  function updateBed(b) { if (!b.pos) return; const sp = spatial(b.pos); b.sp.gain.value = sp.gain * 1.6; if (b.pn) b.pn.pan.value = sp.pan; b.lp.frequency.value = sp.lp; }
  function ambience(dt) {
    if (!beds) return; for (const k of ['city', 'wind', 'fan']) updateBed(beds[k]);
    evT.gust -= dt; if (evT.gust <= 0) { evT.gust = 5 + rand() * 11; beds.wind.g.gain.setTargetAtTime(0.012 + rand() * 0.03, ctx.currentTime, 1.4); beds.wind.flt.frequency.setTargetAtTime(380 + rand() * 500, ctx.currentTime, 1.2); }
    evT.car -= dt; if (evT.car <= 0) { evT.car = 18 + rand() * 24; const lr = rand() < 0.5; burst({ pos: { x: WINDOW_POS.x + (lr ? -6 : 6), y: 1, z: -14 }, f: 260, f2: 860, q: 1.2, dur: 4.5, gain: 0.05 * (0.4 + 0.6 * (1 - night)), attack: 1.8, out: ambOut }); }
    evT.siren -= dt; if (evT.siren <= 0) { evT.siren = 150 + rand() * 200; for (let i = 0; i < 6; i++) setTimeout(() => { try { tone({ pos: { x: -8, y: 1, z: -30 }, f: i % 2 ? 870 : 650, dur: 0.62, gain: 0.008, attack: 0.08, out: ambOut }); } catch (e) { /* 止まっている */ } }, i * 640); }
  }
  /** 電車(目に見えるものと同じ): on=走っているか / x=電車の位置(世界のx)。ゴーッという音は、電車の位置に追従し、ガタンゴトンは、車両の長さ/速さの間隔で。 */
  function trainUpdate(on, x, dt) {
    if (!beds) return;
    if (on && !train.node) { const b = bed('lowpass', 240, 0.7, 0.0, { x, y: 1, z: -16 }); b.g.gain.setTargetAtTime(0.09, ctx.currentTime, 0.8); train.node = b; train.clackT = 0; }
    if (train.node) { train.node.pos = { x, y: 1, z: -16 }; updateBed(train.node); if (!on) { train.node.g.gain.setTargetAtTime(0, ctx.currentTime, 0.6); const n = train.node; train.node = null; setTimeout(() => { try { n.sp.disconnect(); } catch (e) { /* 済 */ } }, 3000); } else { train.clackT -= dt; if (train.clackT <= 0) { train.clackT = 3.6 / 9.5; burst({ pos: { x, y: 1, z: -16 }, f: 900, q: 1.1, dur: 0.07, gain: 0.05, hp: 400, out: ambOut }); } } }
  }

  // ---- 演奏(ピアノ・シンセブラス)----
  const bufCache = new Map();
  function bucket(kind, n) { const vq = kind === 'brass' ? 4 : 8, dq = kind === 'brass' ? 0.25 : 0.125; return { vb: Math.round(n.vel * vq) / vq, db: Math.max(dq, Math.round(n.dur / dq) * dq) }; } // 似た音は、同じ計算を使い回す(計算の回数を減らす)
  const keyOf = (kind, n) => { const b = bucket(kind, n); return `${kind}|${n.midi}|${b.vb}|${b.db}`; };
  function noteBuffer(kind, n) { return bufCache.get(keyOf(kind, n)) || null; }
  function renderNote(kind, n) {
    const key = keyOf(kind, n); if (bufCache.has(key)) return; const { vb, db } = bucket(kind, n);
    const data = kind === 'piano' ? renderPiano({ midi: n.midi, vel: vb, dur: db, sr: ctx.sampleRate, seed: n.midi }) : renderFm4({ midi: n.midi, vel: vb, dur: db, sr: ctx.sampleRate });
    const buf = ctx.createBuffer(1, data.length, ctx.sampleRate); if (buf.copyToChannel) buf.copyToChannel(data, 0); else buf.getChannelData(0).set(data); bufCache.set(key, buf);
    if (bufCache.size > 160) bufCache.delete(bufCache.keys().next().value);
  }
  function startPlayer({ kind = 'piano', seed = 1, getPos = null } = {}) {
    if (!ensure()) return makeStub().startPlayer({ kind, seed });
    const gen = createMelody({ kind, seed }), LOUD = kind === 'piano' ? 0.9 : 0.5;
    const out = ctx.createGain(); out.gain.value = LOUD; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 18000; const dist = ctx.createGain(); const pn = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    out.connect(lp); lp.connect(dist); if (pn) { dist.connect(pn); pn.connect(sfxOut); pn.connect(revIn); } else { dist.connect(sfxOut); dist.connect(revIn); }
    const P = { kind, queue: [], phrases: [], stopped: false, simT: -0.8, base: null, scheduledIdx: 0, fired: 0, offset: 0, cur: null, nextPhrase: null, rendering: false };
    P.cur = gen.next(); P.nextPhrase = null; enqueue(P.cur, 0);
    function enqueue(phrase) { for (const n of phrase.notes) P.queue.push(n); if (!P.rendering) { P.rendering = true; setTimeout(pump, 0); } }
    function pump() { if (P.stopped) { P.rendering = false; return; } const n = P.queue.shift(); if (!n) { P.rendering = false; return; } try { renderNote(kind, n); } catch (e) { /* この音だけ、鳴らさない */ } setTimeout(pump, 0); }
    const state = { phrase: P.cur, off: 0, idx: 0, sched: 0, nextGen: false };
    const phraseList = [{ phrase: P.cur, off: 0, idx: 0, sched: 0 }];
    function playTime() { return ctx.state === 'running' && P.base !== null ? ctx.currentTime - P.base : P.simT; }
    return {
      kind, silent: false, buffers: bufCache,
      update(dt) {
        if (P.stopped) return [];
        if (ctx.state === 'running') { if (P.base === null) P.base = ctx.currentTime - P.simT; else if (Math.abs(ctx.currentTime - P.base - P.simT) > 0.4 && P.simT > 0) { /* 時計が、大きくずれたら、合わせ直す */ P.base = ctx.currentTime - P.simT; } }
        P.simT += dt; const now = playTime(), fired = [];
        const sp = getPos ? spatial(getPos()) : { pan: 0, gain: 1, lp: 18000 }; dist.gain.value = sp.gain * 1.5; if (pn) pn.pan.value = sp.pan; lp.frequency.value = sp.lp;
        for (const e of phraseList) {
          while (e.idx < e.phrase.notes.length && e.off + e.phrase.notes[e.idx].t <= now) { fired.push(e.phrase.notes[e.idx]); e.idx++; }
          while (e.sched < e.phrase.notes.length) { // 先読みして、AudioContext の時計で、正確に予約
            const n = e.phrase.notes[e.sched], at = e.off + n.t; if (at - now > LOOK) break; e.sched++;
            const buf = noteBuffer(kind, n); if (!buf || at < now - 0.2) continue; // まだ計算中・遅れすぎた音は、とばす
            const s = ctx.createBufferSource(); s.buffer = buf; s.connect(out); const when = ctx.state === 'running' && P.base !== null ? Math.max(ctx.currentTime, P.base + at) : ctx.currentTime; s.start(when); P.startedAt = (P.startedAt || []); if (P.startedAt.length < 400) P.startedAt.push({ when, at, midi: n.midi });
          }
        }
        const last = phraseList[phraseList.length - 1];
        if (!P.nextPhrase && now > last.off + last.phrase.length * 0.25) { P.nextPhrase = gen.next(); enqueue(P.nextPhrase); } // つぎの8小節を、先に計算しておく
        if (P.nextPhrase && now >= last.off + last.phrase.length - 4) { phraseList.push({ phrase: P.nextPhrase, off: last.off + last.phrase.length, idx: 0, sched: 0 }); P.nextPhrase = null; }
        while (phraseList.length > 2 && phraseList[0].idx >= phraseList[0].phrase.notes.length && phraseList[0].sched >= phraseList[0].phrase.notes.length) phraseList.shift();
        P.fired += fired.length; return fired;
      },
      stop() { if (P.stopped) return; P.stopped = true; players.delete(this); try { out.gain.setTargetAtTime(0, ctx.currentTime, 0.07); setTimeout(() => { try { out.disconnect(); } catch (e) { /* 済 */ } }, 1500); } catch (e) { /* 済 */ } },
      get stopped() { return P.stopped; }, _P: P,
    };
  }

  const api = {
    enabled: true,
    /** 最初のクリックなどの後に呼ぶ(ブラウザが、音を出す許可を出す)。環境音が、ゆっくり入ってくる。 */
    unlock() { if (unlocked) return; if (!ensure()) return; unlocked = true; try { const p = SE.resume && SE.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ゲーム側が、あとで再開する */ } startBeds(); },
    setMode(m) { mode = m; if (!ctx) return; const v = MODE_GAIN[m] ?? 1, t = ctx.currentTime; ambMode.gain.setTargetAtTime(v, t, 0.35); sfxMode.gain.setTargetAtTime(v, t, 0.35); },
    setNight(k) { night = clampN(+k || 0, 0, 1); applyNight(); },
    /** 毎コマ: カメラの位置と向き(yaw)・電車の様子。 */
    update(dt, camPose, trainOn = false, trainX = 0) {
      if (camPose) { cam.x = camPose.x; cam.y = camPose.y; cam.z = camPose.z; cam.yaw = camPose.yaw; }
      if (!unlocked) return; ambience(dt); trainUpdate(trainOn, trainX, dt);
    },
    sfx, startPlayer(o) { const p = startPlayer(o); if (!p.silent) players.add(p); return p; },
    dispose() { for (const p of [...players]) p.stop(); try { if (beds) { for (const b of Object.values(beds)) { if (b && b.stop) b.stop(); } ambOut.disconnect(); } } catch (e) { /* 済 */ } },
    _debug: { get ctx() { return ctx; }, get beds() { return beds; }, SFX, spatial, cam, get unlocked() { return unlocked; } },
  };
  return api;
}
