// video-recorder-core.js (v1.106) — 軽量な4K長時間録画のきまり。画面に依存しない(Nodeで試験できる)。
//   ・内部の描画は、480×270 のまま。出力のキャンバスへ、整数倍(4K=8倍・フルHD=4倍)の「最近傍」で拡大して、動画にする。
//     (480×270 のピクセル感を、そのまま、高解像度の動画にする。4Kで描画し直すわけではないので、軽い)
//   ・30fps。書き出しは、少しずつ(ファイルへ直接)。全フレームを、メモリに持たない。
export const SOURCE = { w: 480, h: 270 }; // 録画中の、内部の描画の大きさ(16:9。固定)
export const FPS = 30;
export const MODES = {
  '4k': { w: 3840, h: 2160, scale: 8 },
  fhd: { w: 1920, h: 1080, scale: 4 },
};
/** 出力の大きさ。内部の描画の、整数倍であること。 */
export function outputSize(mode) { const m = MODES[mode] || MODES['4k']; return { w: m.w, h: m.h, scale: m.scale }; }
/** 映像のビットレート(bps)。4K: ふつう20Mbps / 高め30Mbps、フルHD: 8 / 12Mbps。 */
export function bitrateFor(mode, quality) { const hi = quality === 'high'; return mode === 'fhd' ? (hi ? 12e6 : 8e6) : (hi ? 30e6 : 20e6); }
export const AUDIO_BPS = 192000;
/** 使える形式から、いちばん望ましいものを選ぶ(YouTube向け: MP4(H.264) → WebM(VP9) → WebM(VP8))。 */
export function pickMimeType(isSupported, mode = '4k') {
  const h264 = mode === 'fhd' ? 'avc1.640028' : 'avc1.640033'; // High profile: フルHD=Level 4.0 / 4K=Level 5.1
  const list = [`video/mp4;codecs=${h264},mp4a.40.2`, 'video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const t of list) { try { if (isSupported(t)) return { mimeType: t, ext: t.startsWith('video/mp4') ? 'mp4' : 'webm' }; } catch (e) { /* 次へ */ } }
  return null;
}
export function fileName(date, ext) {
  const p = (n) => String(n).padStart(2, '0');
  return `snowman-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.${ext}`;
}
export const estimateBytes = (sec, videoBps, audioBps = AUDIO_BPS) => Math.round((sec * (videoBps + audioBps)) / 8);
export function formatElapsed(sec) { const s = Math.max(0, Math.floor(sec)), p = (n) => String(n).padStart(2, '0'); return `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`; }
export function formatBytes(b) { return b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(0)} MB` : `${Math.max(0, Math.round(b / 1e3))} KB`; }

/** 録画の経過時間。一時停止していた間(別のタブを見ていた間など)は、数えない。動画の長さと合う。 */
export function createPauseClock() {
  let start = null, pausedAt = null, paused = 0;
  return {
    start(now) { start = now; pausedAt = null; paused = 0; },
    pause(now) { if (start !== null && pausedAt === null) pausedAt = now; },
    resume(now) { if (pausedAt !== null) { paused += now - pausedAt; pausedAt = null; } },
    /** 経過(秒)。一時停止中は、止まっていた時刻までで、止まる。 */
    elapsed(now) { if (start === null) return 0; const end = pausedAt !== null ? pausedAt : now; return Math.max(0, (end - start - paused) / 1000); },
    isPaused: () => pausedAt !== null,
  };
}

/** 30fps に間引く。描画の速さが、30より速くても、遅くても、動画の速さが、実際の時間と合う。 */
export function createFramePacer(fps = FPS) {
  const step = 1000 / fps; let next = null;
  return {
    /** now(ms)で、1コマ、取り込むか。 */
    shouldCapture(now) {
      if (next === null) { next = now + step; return true; }
      if (now + 1 < next) return false;
      next += step; if (now - next > step * 3) next = now + step; // 大きく遅れたら、追いつこうとせず、やり直す(コマが、ばらばらに重ならないように)
      return true;
    },
    reset() { next = null; },
  };
}

/**
 * 書き出しの順番を守る(MediaRecorder のかたまりが、次々に来ても、順番に、ファイルへ書く)。
 * writable: { write(blob), close() }。書き込みに失敗したら、onError を呼んで、以後は受け取らない。
 */
export function createChunkSink({ writable, onError = () => {} }) {
  let chain = Promise.resolve(), bytes = 0, failed = false, closed = false;
  return {
    push(blob) {
      if (failed || closed) return chain;
      chain = chain.then(async () => { if (failed) return; try { await writable.write(blob); bytes += blob.size; } catch (e) { failed = true; onError(e); } });
      return chain;
    },
    async close() { closed = true; await chain; if (!failed) { try { await writable.close(); } catch (e) { failed = true; onError(e); } } return bytes; },
    bytes: () => bytes, hasFailed: () => failed,
  };
}
/** ファイルに直接書けない時の、メモリに溜める版(長時間は、できない。上限を超えたら、知らせる)。 */
export function createMemorySink({ limitBytes = 1.5e9, onLimit = () => {} } = {}) {
  const chunks = []; let bytes = 0, limited = false;
  return {
    push(blob) { if (limited) return Promise.resolve(); chunks.push(blob); bytes += blob.size; if (bytes >= limitBytes) { limited = true; onLimit(bytes); } return Promise.resolve(); },
    async close() { return bytes; }, bytes: () => bytes, chunks: () => chunks, hasFailed: () => false,
  };
}

// ---- v1.107: ワイプ(画面の隅の小さな映像)。出力のキャンバスへ、毎コマ、描き足す。 ----
//   ワイプの描画の大きさは、16:9。出力が4Kなら4倍、フルHDなら2倍に、「最近傍」で拡大する(ピクセル感を保つ)。
//   大きさの割合(出力の幅に対して): 小=15% / 中=20% / 大=25%。ゲーム画面の1ピクセルの半分の細かさ(ワイプの中の部屋は、細かい物が多いため)。
export const WIPE_SIZES = { small: 144, medium: 192, large: 240 }; // ワイプの内部の描画の幅(px)
export const WIPE_CORNERS = ['br', 'bl', 'tr', 'tl']; // 右下・左下・右上・左上
/** ワイプの置き場所。mode=出力の種類、size=small|medium|large、corner=br|bl|tr|tl。 */
export function wipeLayout(mode, size = 'medium', corner = 'br') {
  const o = outputSize(mode), rw = WIPE_SIZES[size] || WIPE_SIZES.medium, rh = (rw * 9) / 16, k = o.w / 960; // k: 4K=4 / フルHD=2
  const w = rw * k, h = rh * k, margin = 20 * k, border = 2 * k; // 枠は、ワイプの2ピクセル分(外側の暗い線)+1ピクセル分(内側の明るい線)
  const c = WIPE_CORNERS.includes(corner) ? corner : 'br';
  const x = c === 'bl' || c === 'tl' ? margin : o.w - margin - w, y = c === 'tl' || c === 'tr' ? margin : o.h - margin - h;
  return { x, y, w, h, rw, rh, k, border, corner: c };
}
