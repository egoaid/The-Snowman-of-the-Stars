// intro-layer.js (v1.117) — 起動の「部屋の演出」を、画面に重ねる層。そして、ゲーム中の「ワイプ」そのもの。
//   ・部屋(visual3d/intro-room.js)のキャンバスを入れる枠(#introRoom)を、画面に固定する。
//   ・全画面 ⇄ ワイプ は、枠の位置・大きさ・枠線・円への角丸を、イージング(easeInOutCubic)で動かすだけ。中の絵(canvas)は、cover で、ゆがめずに切り取って見せる。
//   ・ワイプの形・縦横比・場所・大きさ・枠・左右反転は、設定(録画のワイプ設定と、同じもの)どおり。画角(部屋全体・モニター・顔・自分で決めた画角)も同じ。
//   ・部屋が全画面のあいだ(動いている最中も)は、ゲームへ、キー・クリック・ホイールを渡さず、ポインタロックも外す。ワイプのあいだは、ワイプへのクリックだけを受ける。
//   ・ゲーム画面(160×90の縮小コピー)を、部屋のモニターへ映す。
//   ・録画: 録画には、ここの映像(getRecordFrame: 部屋のキャンバスと、全画面⇄ワイプの進み具合 p)を、画面と同じ位置・形で、ゲーム画面に重ねて入れる。
//     だから、縮む途中・ワイプをクリックして部屋が全画面に戻る場面も、録画される。録画中は、ワイプが画面で隠れていても、部屋は動かして描く。
import { createModeMachine, fullRect, lerpRect, FULL_MS } from './intro-room-core.js';
import { wipeLayoutFor, normalizeWipe } from './video-recorder-core.js';

const KEY = 'snowman.introRoom'; // '0' なら、起動の部屋の演出を、出さない
const BUF_H = 270; // 描画の高さ(ピクセル)。ゲーム本編(480×270)と同じ粗さ
const NOOP = Object.freeze({
  enabled: false, mode: () => 'off', isBlocking: () => false, toWipe() {}, toRoom() {}, skip() {}, captureGame() {}, dispose() {},
  setWipeStyle() {}, setWipeView() {}, getWipeCameraView: () => null, setRecording() {}, getRecordFrame: () => null, getRoomCanvas: () => null, refreshTexts() {},
  isEnabledSetting: () => readSetting(), setEnabledSetting: (v) => writeSetting(v),
});
function readSetting() { try { return localStorage.getItem(KEY) !== '0'; } catch (e) { return true; } }
function writeSetting(v) { try { if (v) localStorage.removeItem(KEY); else localStorage.setItem(KEY, '0'); } catch (e) { /* 保存できない環境では、保存しない */ } }

/**
 * opts = { labels: () => ({ book, keyboard, monitor, cup, lamp, lampOff, synth, sofa, snowman, wipe, skip, guide }), title, titleEn, createRoom(必須), onMode(mode) }
 * 戻り値: { enabled, mode(), isBlocking(), toWipe(), toRoom(), skip(), captureGame(canvas), dispose(), isEnabledSetting(), setEnabledSetting(bool),
 *          setWipeStyle(設定), setWipeView(画角), getWipeCameraView(), setRecording(bool), getRecordFrame(), getRoomCanvas() }
 */
export function createIntroLayer(opts = {}) {
  let params; try { params = new URLSearchParams(location.search); } catch (e) { params = new URLSearchParams(''); }
  if (params.get('room') === '0' || !readSetting() || typeof document === 'undefined') return NOOP;
  let skipStart = false; try { skipStart = sessionStorage.getItem('snowman.skipStart') === '1'; } catch (e) { /* 既定どおり */ } // ワールドを選んで読み込み直した直後は、部屋を、とばす
  const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const labels = () => { try { return (opts.labels && opts.labels()) || {}; } catch (e) { return {}; } };

  const box = document.createElement('div'); box.id = 'introRoom'; box.setAttribute('role', 'group');
  const hint = document.createElement('div'); hint.className = 'intro-hint'; hint.hidden = true;
  const guide = document.createElement('div'); guide.className = 'intro-guide';
  const skipBtn = document.createElement('button'); skipBtn.type = 'button'; skipBtn.className = 'intro-skip';
  let room;
  const startAtWipe = skipStart;
  try {
    room = opts.createRoom({
      labels, title: opts.title, titleEn: opts.titleEn, startAtPc: startAtWipe, launched: startAtWipe,
      onLaunch: () => { machine.toWipe(); },
      onHover: (text, x, y) => { if (!text) { hint.hidden = true; return; } hint.textContent = text; hint.hidden = false; hint.style.left = Math.min(x + 14, innerWidth - 150) + 'px'; hint.style.top = (y + 18) + 'px'; },
    });
  } catch (e) { console.warn('[intro-room] 部屋を作れなかったので、とばします', e); return NOOP; } // WebGLが足りない等。ゲームには、影響しない
  const machine = createModeMachine({ start: startAtWipe ? 'wipe' : 'room', duration: FULL_MS });
  box.appendChild(room.canvas); box.appendChild(guide); box.appendChild(hint); box.appendChild(skipBtn); document.body.appendChild(box);
  room.canvas.style.imageRendering = 'pixelated'; box.style.boxSizing = 'content-box';

  let raf = 0, last = performance.now(), lastRender = 0, vw = 0, vh = 0, lastMode = '', guideTimer = 0, disposed = false, recording = false;
  const born = performance.now();
  let wipeStyle = normalizeWipe({}); // 設定(形・縦横比・場所・大きさ・枠・左右反転・ワイプを出すか)
  const gameBuf = document.createElement('canvas'); gameBuf.width = 160; gameBuf.height = 90; const gctx = gameBuf.getContext('2d'); let gameAt = -1e9, haveFrame = false;

  function refreshTexts() { const L = labels(); skipBtn.textContent = L.skip || 'Skip'; guide.textContent = L.guide || ''; if (machine.mode === 'wipe') box.title = L.wipe || ''; }
  function fitBuffer() { // 画面の縦横比に合わせた、低解像度の描画サイズ
    vw = document.documentElement.clientWidth || innerWidth; vh = document.documentElement.clientHeight || innerHeight;
    const aspect = Math.max(0.55, Math.min(2.4, vw / Math.max(1, vh)));
    room.setSize(Math.round(BUF_H * aspect), BUF_H);
  }
  function exitLocks() { try { if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock(); } catch (e) { /* なくても、よい */ } try { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); } catch (e) { /* なくても、よい */ } }
  function applyMode() {
    const m = machine.mode;
    if (m !== lastMode) {
      const was = lastMode; lastMode = m;
      const blocking = machine.isBlocking();
      room.setInteractive(m === 'room');
      if (room.setAudioMode) room.setAudioMode(m); // 部屋の音: 全画面は通常、ワイプは小さく
      if (m === 'toWipe' && room.enterWipe) room.enterWipe(); // カメラが、ワイプの画角へ動く
      if (m === 'toRoom' && room.leaveWipe) room.leaveWipe(); // カメラが、自由に見まわしていた画角へ戻る
      box.classList.toggle('is-wipe', m === 'wipe'); box.classList.toggle('is-room', m === 'room');
      document.body.classList.toggle('intro-room-open', blocking);
      if (m === 'room' || m === 'toRoom') { exitLocks(); }
      if (m === 'room') { clearTimeout(guideTimer); guide.classList.add('show'); guideTimer = setTimeout(() => guide.classList.remove('show'), 9000); }
      else guide.classList.remove('show');
      hint.hidden = true; box.title = m === 'wipe' ? (labels().wipe || '') : '';
      if (opts.onMode) { try { opts.onMode(m, was); } catch (e) { /* 画面の側の失敗は、部屋に、影響させない */ } }
    }
  }
  /** 画面の中での、ワイプの配置(設定どおり。タッチ端末は、右下のボタンを避けて、右下の指定を右上へ)。 */
  function wipeLayoutNow() { const st = wipeStyle; return wipeLayoutFor(vw, vh, { ...st, corner: coarse && st.corner === 'br' ? 'tr' : st.corner }); }
  function layout() {
    const Lw = wipeLayoutNow(), p = machine.progress(), r = lerpRect(fullRect(vw, vh), { x: Lw.x, y: Lw.y, w: Lw.w, h: Lw.h }, p);
    let bw = Lw.b > 0 ? Lw.b * Lw.k * p : 0; if (bw < 0.4) bw = 0; // 枠は、ワイプの外側(中身の大きさは、変えない)
    const rad = wipeStyle.shape === 'circle' ? (p * Math.min(r.w, r.h)) / 2 : 0;
    const s = box.style; s.left = (r.x - bw).toFixed(1) + 'px'; s.top = (r.y - bw).toFixed(1) + 'px'; s.width = r.w.toFixed(1) + 'px'; s.height = r.h.toFixed(1) + 'px';
    s.borderWidth = bw.toFixed(2) + 'px'; s.borderColor = Lw.color; s.borderRadius = (rad + bw).toFixed(1) + 'px'; s.boxShadow = 'none';
    s.zIndex = machine.mode === 'wipe' ? '61' : '80'; // ワイプは、起動画面(60)より上、ほかの画面(設定など)の上
    room.canvas.style.transform = wipeStyle.flip && p > 0.5 ? 'scaleX(-1)' : ''; // 左右反転は、ワイプの時だけ
  }
  function tick(now) {
    raf = requestAnimationFrame(tick); if (disposed) return;
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
    machine.update(dt); applyMode(); layout();
    const hide = machine.mode === 'wipe' && !wipeStyle.show; // ワイプを出さない設定
    box.style.display = hide ? 'none' : '';
    if (hide && !recording) return; // 画面にも録画にも出ない間は、動かさない・描かない
    room.update(dt);
    const every = machine.mode === 'wipe' && !recording ? 66 : 33; // ワイプは15fps程度。全画面と、録画中は、30fps程度
    if (now - lastRender >= every - 1) { lastRender = now; try { room.render(); } catch (e) { console.warn('[intro-room] 描画に失敗', e); } }
  }
  function onResize() { fitBuffer(); layout(); }
  window.addEventListener('resize', onResize); document.addEventListener('fullscreenchange', () => setTimeout(onResize, 100));

  // ---- ゲームへ渡さない(部屋が全画面のあいだ)・ワイプのクリック ----
  const stop = (e) => { e.stopPropagation(); };
  for (const ev of ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'dblclick', 'wheel', 'touchstart', 'touchmove', 'touchend', 'contextmenu']) box.addEventListener(ev, stop, { passive: false });
  box.addEventListener('click', (e) => { e.stopPropagation(); if (machine.mode === 'wipe') machine.toRoom(); });
  skipBtn.addEventListener('click', (e) => { e.stopPropagation(); api.skip(); });
  const isTyping = (e) => { const t = e.target; return !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)); };
  const passKey = (e) => e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key || '') || (e.key || '').toLowerCase() === 'f'; // フルスクリーン(F)・ブラウザの操作は、そのまま
  function onKey(e, down) {
    if (!machine.isBlocking() || isTyping(e)) return;
    if (passKey(e)) return;
    room.keyEvent(e, down); e.stopImmediatePropagation(); if (/^(Arrow|\s)/.test(e.key || '') || e.key === ' ') e.preventDefault();
  }
  window.addEventListener('keydown', (e) => onKey(e, true), true); window.addEventListener('keyup', (e) => onKey(e, false), true);
  window.addEventListener('blur', () => room.clearKeys());

  const api = {
    enabled: true,
    mode: () => machine.mode,
    isBlocking: () => machine.isBlocking(),
    toWipe() { machine.toWipe(); },
    toRoom() { machine.toRoom(); },
    /** 部屋の演出をとばして、すぐ、ゲームへ(雪だるまは、パソコンの前でゲームを遊ぶ状態になって、部屋はワイプへ縮む)。 */
    skip() { if (machine.mode !== 'room') return; if (!room.isLaunched()) room.startAtPc(); machine.toWipe(); },
    /** ワイプの見た目の設定(normalizeWipe の結果): 形・縦横比・場所・大きさ・枠・左右反転・画面に出すか。 */
    setWipeStyle(o) { wipeStyle = normalizeWipe(o); if (vw) layout(); },
    /** ワイプの画角(pos・target・fov)。ワイプの間は、すぐ、そちらへ動く。起動の直後は、動きなしで。 */
    setWipeView(v, instant) { if (room.setWipeCamera) room.setWipeCamera(v, instant || performance.now() - born < 2000); },
    getWipeCameraView() { return room.getWipeCameraView ? room.getWipeCameraView() : null; },
    /** 録画中は、ワイプが画面で隠れていても、部屋を動かして描き、ワイプも30fpsで描く。 */
    setRecording(v) { recording = !!v; },
    /** 録画へ渡す部屋の映像: { canvas, p } (p = 0 部屋が全画面 〜 1 ワイプ。イージング後)。 */
    getRecordFrame() { return disposed ? null : { canvas: room.canvas, p: machine.progress(), mode: machine.mode }; },
    getRoomCanvas() { return room.canvas; },
    /** ゲームの描画の直後に呼ぶ。ゲーム画面を、160×90 に縮めて、部屋のモニターへ渡す(0.1秒に1回)。 */
    captureGame(c) {
      if (disposed) return;
      const now = performance.now(); if (now - gameAt < 100) return; gameAt = now;
      try { gctx.drawImage(c, 0, 0, 160, 90); if (!haveFrame) { haveFrame = true; room.setGameFrame(gameBuf); } } catch (e) { /* 取れなければ、前のまま */ }
    },
    refreshTexts,
    isEnabledSetting: readSetting, setEnabledSetting: writeSetting,
    dispose() { disposed = true; cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); try { room.dispose(); } catch (e) { /* もう、捨てられている */ } box.remove(); document.body.classList.remove('intro-room-open'); },
    room, // 試験用
  };
  fitBuffer(); refreshTexts(); applyMode(); layout();
  if (startAtWipe && room.enterWipe) room.enterWipe(true);
  raf = requestAnimationFrame(tick);
  return api;
}
