// video-recorder.js (v1.106) — 軽量な4K長時間録画(画面と、MediaRecorder を使う部分)。きまりは video-recorder-core.js。
//   内部の描画(480×270)を、整数倍の最近傍で拡大して、出力のキャンバスに描き、映像+音(マスター出力)を、MediaRecorder で、少しずつ書き出す。
//   ファイルへは、File System Access API(Chrome・Edge)で、直接書く(数時間でも、メモリを使わない)。使えないブラウザでは、メモリに溜める(短時間だけ)。
import { SOURCE, FPS, outputSize, bitrateFor, AUDIO_BPS, pickMimeType, fileName, estimateBytes, createFramePacer, createChunkSink, createMemorySink, createPauseClock, wipeLayout, wipeInside, wipeFramePixel } from './video-recorder-core.js';

// createWipe: ワイプの映像を作る関数(省略可)。返すもの: { canvas, setSize(w,h), renderFrame(源のキャンバス, 経過秒), dispose() }。
export function createVideoRecorder({ getSourceCanvas, createWipe = null, onState = () => {}, nowMs = () => performance.now() } = {}) {
  let wipe = null, wipeLayoutNow = null, lastWipeMs = 0, wipeFrameCv = null, wipeMaskCv = null, wipeTmpCv = null, wipeTmpCtx = null;
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
      pausedByHidden = false; pacer.reset(); lastWipeMs = 0; try { rec.resume(); } catch (e) { return; } pauseClock.resume(nowMs()); onState('resumed', info);
    }
  }
  function disposeWipe() { if (wipe) { try { wipe.dispose(); } catch (e) { /* もう、捨てられている */ } } wipe = null; wipeLayoutNow = null; wipeFrameCv = wipeMaskCv = wipeTmpCv = wipeTmpCtx = null; }
  /** 枠(帯)と、円の切り抜き(マスク)を、ワイプのピクセルの大きさで、いちど作る。毎コマは、拡大して描くだけ。 */
  function buildWipeShapes(L) {
    const hex = L.color, rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    wipeFrameCv = wipeMaskCv = wipeTmpCv = wipeTmpCtx = null;
    if (L.b > 0) {
      const W = L.rw + 2 * L.b, H = L.rh + 2 * L.b, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const cx = cv.getContext('2d'), im = cx.createImageData(W, H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (wipeFramePixel(L.shape, L.rw, L.rh, L.b, x, y)) { const o = (y * W + x) * 4; im.data[o] = rgb[0]; im.data[o + 1] = rgb[1]; im.data[o + 2] = rgb[2]; im.data[o + 3] = 255; }
      cx.putImageData(im, 0, 0); wipeFrameCv = cv;
    }
    if (L.shape === 'circle') {
      const cv = document.createElement('canvas'); cv.width = L.rw; cv.height = L.rh;
      const cx = cv.getContext('2d'), im = cx.createImageData(L.rw, L.rh);
      for (let y = 0; y < L.rh; y++) for (let x = 0; x < L.rw; x++) if (wipeInside('circle', L.rw, L.rh, x, y)) im.data[(y * L.rw + x) * 4 + 3] = 255;
      cx.putImageData(im, 0, 0); wipeMaskCv = cv;
      wipeTmpCv = document.createElement('canvas'); wipeTmpCv.width = L.rw; wipeTmpCv.height = L.rh; wipeTmpCtx = wipeTmpCv.getContext('2d');
    }
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
    wipe = null; wipeLayoutNow = null; lastWipeMs = 0;
    if (wipeOpt && wipeOpt.enabled && createWipe) {
      try { wipeLayoutNow = wipeLayout(mode, wipeOpt); buildWipeShapes(wipeLayoutNow); wipe = createWipe(); wipe.setSize(wipeLayoutNow.rw, wipeLayoutNow.rh); }
      catch (e) { disposeWipe(); onState('wipe-failed'); }
    }
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
    info = { mode, quality, size, pick, videoBps: bitrateFor(mode, quality), fsMode, wipe: !!wipe };
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
    if (wipe) drawWipe(src);
  }

  /** ワイプを、出力の隅へ描き足す(小さな部屋を、最近傍で整数倍に拡大。枠つき)。失敗したら、ワイプだけやめて、録画は続ける。 */
  function drawWipe(src) {
    try {
      const now = nowMs(), dt = lastWipeMs ? Math.min(0.1, (now - lastWipeMs) / 1000) : 1 / FPS; lastWipeMs = now;
      wipe.renderFrame(src, dt);
      const L = wipeLayoutNow, k = L.k;
      if (wipeFrameCv) octx.drawImage(wipeFrameCv, 0, 0, wipeFrameCv.width, wipeFrameCv.height, L.x - L.b * k, L.y - L.b * k, (L.rw + 2 * L.b) * k, (L.rh + 2 * L.b) * k); // 枠(最近傍で整数倍)
      if (wipeMaskCv) { // 円: ワイプのピクセルの段階で、ぎざぎざに切り抜く(ぼかさない)
        wipeTmpCtx.globalCompositeOperation = 'copy'; wipeTmpCtx.drawImage(wipe.canvas, 0, 0, L.rw, L.rh);
        wipeTmpCtx.globalCompositeOperation = 'destination-in'; wipeTmpCtx.drawImage(wipeMaskCv, 0, 0); wipeTmpCtx.globalCompositeOperation = 'source-over';
        octx.drawImage(wipeTmpCv, 0, 0, L.rw, L.rh, L.x, L.y, L.w, L.h);
      } else octx.drawImage(wipe.canvas, 0, 0, L.rw, L.rh, L.x, L.y, L.w, L.h);
    } catch (e) { disposeWipe(); onState('wipe-failed'); }
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
