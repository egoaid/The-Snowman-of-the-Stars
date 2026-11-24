// video-recorder.js (v1.106) — 軽量な4K長時間録画(画面と、MediaRecorder を使う部分)。きまりは video-recorder-core.js。
//   内部の描画(480×270)を、整数倍の最近傍で拡大して、出力のキャンバスに描き、映像+音(マスター出力)を、MediaRecorder で、少しずつ書き出す。
//   ファイルへは、File System Access API(Chrome・Edge)で、直接書く(数時間でも、メモリを使わない)。使えないブラウザでは、メモリに溜める(短時間だけ)。
import { SOURCE, FPS, outputSize, bitrateFor, AUDIO_BPS, pickMimeType, fileName, estimateBytes, createFramePacer, createChunkSink, createMemorySink, createPauseClock, wipeLayout, normalizeWipe, wipeComposite } from './video-recorder-core.js';

// getRoomFrame(v1.117): 部屋の映像を返す関数。戻り値: { canvas, p }(p = 0: 部屋が全画面 〜 1: 右下などのワイプ。イージング後の値)。
//   画面に出ている「部屋 ⇄ ワイプ」と同じものを、ゲーム画面の上に重ねて録画する(縮む途中・ワイプをクリックして部屋が全画面に戻る場面も、含めて)。
export function createVideoRecorder({ getSourceCanvas, getRoomFrame = null, onState = () => {}, nowMs = () => performance.now() } = {}) {
  let wipeOn = false, wipeLayoutNow = null;
  let pauseClock = createPauseClock(), pausedByHidden = false;
  let rec = null, out = null, octx = null, pacer = createFramePacer(FPS), sink = null, startedAt = 0, info = null, audioDest = null, masterRef = null, fsMode = false, failedMsg = '';
  const SE = () => (typeof window !== 'undefined' ? window.SoundEngine : null);
  const supported = () => typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';

  // 別のタブ・隠れたウィンドウでは、ブラウザが、描画を止める(これは、止められない)。
  //   以前は、そのあいだ、同じ絵のまま、録画が続いていた(フリーズした映像)。いまは、自動で一時停止して、戻ったら、続きから録画する(隠れていた間は、録画されない)。
  function onVisibility() {
    if (!rec) return;
    if (document.hidden) {
      if (rec.state === 'recording') { try { rec.pause(); } catch (e) { return; } pauseClock.pause(nowMs()); pausedByHidden = true; onState('paused'); }
    } else if (pausedByHidden) {
      pausedByHidden = false; pacer.reset(); try { rec.resume(); } catch (e) { return; } pauseClock.resume(nowMs()); onState('resumed', info);
    }
  }
  function disposeWipe() { wipeOn = false; wipeLayoutNow = null; }
  /** 角丸の四角(r が、短い辺の半分以上なら、円・だ円)の、パスを作る。 */
  function pathRR(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2)); c.beginPath();
    if (r <= 0.01) { c.rect(x, y, w, h); return; }
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function cleanupAudio() { try { if (masterRef && audioDest) masterRef.disconnect(audioDest); } catch (e) { /* もう外れている */ } audioDest = null; masterRef = null; }

  async function start({ mode = '4k', quality = 'normal', wipe: wipeOpt = null } = {}) {
    if (rec) return false;
    if (!supported()) { onState('unsupported'); return false; }
    const src = getSourceCanvas && getSourceCanvas();
    if (!src) return false;
    const size = outputSize(mode), pick = pickMimeType((t) => MediaRecorder.isTypeSupported(t), mode);
    if (!pick) { onState('unsupported'); return false; }
    // 保存先(ボタンを押した、その場で選ぶ必要がある)
    let writable = null; fsMode = false; failedMsg = '';
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: fileName(new Date(), pick.ext), types: [{ description: 'Video', accept: { [pick.mimeType.split(';')[0]]: ['.' + pick.ext] } }] });
        writable = await handle.createWritable(); fsMode = true;
      } catch (e) { if (e && e.name === 'AbortError') { onState('cancelled'); return false; } /* 使えない: メモリへ */ }
    }
    sink = fsMode ? createChunkSink({ writable, onError: (e) => { failedMsg = String(e && e.message || e); stop(true); onState('error', failedMsg); } }) : createMemorySink({ onLimit: () => { onState('limit'); stop(); } });
    out = document.createElement('canvas'); out.width = size.w; out.height = size.h;
    octx = out.getContext('2d', { alpha: false }); octx.imageSmoothingEnabled = false; // 最近傍(ぼかさない)
    // ワイプ(任意): 作れなければ、ワイプなしで、録画を続ける(録画そのものは、止めない)
    wipeOn = false; wipeLayoutNow = null;
    if (wipeOpt && wipeOpt.enabled && getRoomFrame) { try { wipeLayoutNow = wipeLayout(mode, wipeOpt); wipeOn = true; } catch (e) { disposeWipe(); onState('wipe-failed'); } }
    const stream = out.captureStream(FPS);
    // 音: マスターの出力を、そのまま録る
    try {
      const se = SE(), ctx = se && se.getContext && se.getContext(), master = se && se.getMasterGain && se.getMasterGain();
      if (ctx && master && ctx.createMediaStreamDestination) { audioDest = ctx.createMediaStreamDestination(); master.connect(audioDest); masterRef = master; for (const t of audioDest.stream.getAudioTracks()) stream.addTrack(t); }
    } catch (e) { /* 音なしで録る */ }
    try { rec = new MediaRecorder(stream, { mimeType: pick.mimeType, videoBitsPerSecond: bitrateFor(mode, quality), audioBitsPerSecond: AUDIO_BPS }); }
    catch (e) { cleanupAudio(); disposeWipe(); onState('unsupported'); return false; }
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size && sink) sink.push(ev.data); };
    rec.onstop = () => { /* 後始末は stop() */ };
    info = { mode, quality, size, pick, videoBps: bitrateFor(mode, quality), fsMode, wipe: wipeOn };
    pacer.reset(); startedAt = nowMs(); pauseClock.start(startedAt); pausedByHidden = false;
    document.addEventListener('visibilitychange', onVisibility);
    rec.start(2000); // 2秒ごとに、書き出す
    onState('recording', info);
    return true;
  }

  /** 毎フレーム、描画のあとに呼ぶ。30fps に間引いて、出力のキャンバスへ、拡大して描く。 */
  function captureFrame() {
    if (!rec || rec.state !== 'recording') return;
    const src = getSourceCanvas && getSourceCanvas(); if (!src) return;
    if (!pacer.shouldCapture(nowMs())) return;
    if (src.width !== SOURCE.w || src.height !== SOURCE.h) return; // 16:9(480×270)に固定されている間だけ、取り込む(ゆがめない)
    octx.drawImage(src, 0, 0, out.width, out.height);
    if (wipeOn) drawRoom();
  }
  /** 部屋の映像を、ゲーム画面の上に重ねる。全画面(p=0)なら、フレーム全体に。縮む途中・ワイプ(p=1)は、枠・円・左右反転も、画面と同じに。 */
  function drawRoom() {
    let saved = false;
    try {
      const rf = getRoomFrame(); if (!rf || !rf.canvas || !(rf.canvas.width > 0)) return;
      const L = wipeLayoutNow, C = wipeComposite(L, rf.p, rf.canvas.width, rf.canvas.height, L.flip);
      octx.save(); saved = true; octx.imageSmoothingEnabled = false; // 部屋の粗いピクセルを、そのまま拡大(最近傍)
      if (C.border > 0.4) { pathRR(octx, C.dx - C.border, C.dy - C.border, C.dw + 2 * C.border, C.dh + 2 * C.border, C.radius + C.border); octx.fillStyle = C.color; octx.fill(); } // 枠(外側)
      if (!C.full) { pathRR(octx, C.dx, C.dy, C.dw, C.dh, C.radius); octx.clip(); }
      if (C.flip) { octx.translate(C.dx + C.dw, C.dy); octx.scale(-1, 1); octx.drawImage(rf.canvas, C.sx, C.sy, C.sw, C.sh, 0, 0, C.dw, C.dh); }
      else octx.drawImage(rf.canvas, C.sx, C.sy, C.sw, C.sh, C.dx, C.dy, C.dw, C.dh);
    } catch (e) { disposeWipe(); onState('wipe-failed'); }
    finally { if (saved) octx.restore(); } // 失敗しても、切り抜きの設定が、残らないように
  }

  async function stop(silent) {
    if (!rec) return null;
    const r = rec; rec = null; document.removeEventListener('visibilitychange', onVisibility);
    await new Promise((resolve) => { r.onstop = resolve; try { r.stop(); } catch (e) { resolve(); } });
    cleanupAudio(); disposeWipe();
    let bytes = 0, saved = false;
    try {
      bytes = await sink.close();
      if (!fsMode && !sink.hasFailed() && bytes > 0) { // メモリに溜めた分を、ダウンロードとして渡す
        const blob = new Blob(sink.chunks(), { type: info.pick.mimeType.split(';')[0] }), a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = fileName(new Date(), info.pick.ext); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); saved = true;
      } else saved = fsMode && !sink.hasFailed();
    } catch (e) { failedMsg = String(e && e.message || e); }
    const seconds = pauseClock.elapsed(nowMs()); // 一時停止していた間は、数えない
    out = null; octx = null; sink = null;
    if (!silent) onState('stopped', { bytes, seconds, saved, fsMode });
    return { bytes, seconds, saved };
  }

  return {
    start, stop, captureFrame, supported,
    isRecording: () => !!rec,
    stats() { const sec = rec ? pauseClock.elapsed(nowMs()) : 0; return { seconds: sec, bytes: sink ? Math.max(sink.bytes(), 0) : 0, estimate: info ? estimateBytes(sec, info.videoBps) : 0, fsMode, info }; },
  };
}
