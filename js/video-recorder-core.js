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

// ---- v1.107/v1.108: ワイプ(画面の隅の小さな映像)。出力のキャンバスへ、毎コマ、描き足す。 ----
//   ワイプの内部の描画は、整数のピクセル数。出力が4Kなら4倍、フルHDなら2倍に、「最近傍」で拡大する(ピクセル感を保つ)。
//   形: 四角(rect)か、円(circle)。四角は、縦横比を選べる。円は、ピクセルで、ぎざぎざに切り抜く(ぼかさない)。
//   大きさ: 長いほうの辺(円は直径)が、出力の幅の何%か(10〜40)。 枠: 表示/非表示・幅(ワイプのピクセル数で1〜8)・色。
export const WIPE_ASPECTS = { '16:9': [16, 9], '4:3': [4, 3], '1:1': [1, 1], '3:4': [3, 4], '9:16': [9, 16] };
export const WIPE_CORNERS = ['br', 'bl', 'tr', 'tl']; // 右下・左下・右上・左上
export const WIPE_SIZE_MIN = 10, WIPE_SIZE_MAX = 40, WIPE_SIZE_DEFAULT = 20; // 出力の幅に対する%
export const WIPE_BORDER_MAX = 8, WIPE_BORDER_DEFAULT = 2; // 枠の幅(ワイプのピクセル数)
export const WIPE_BORDER_COLOR_DEFAULT = '#f3efe6';
// 画角(v1.109): 固定カメラ3つ(room=部屋全体・monitor=モニターを見ている雪だるま・face=顔のアップ)・custom=自分で決めた画角・auto=3つを時々カットで切り替え。
//   標準は「1つの画角に固定」。パン・徐々にズームは、しない。
export const WIPE_CAMS = ['room', 'monitor', 'face', 'custom', 'auto'];
export const WIPE_CAM_INTERVAL_MIN = 5, WIPE_CAM_INTERVAL_MAX = 60, WIPE_CAM_INTERVAL_DEFAULT = 15; // 自動で切り替える間隔(秒)の目安(実際は、±30%ばらつく)
export const WIPE_CUSTOM_DEFAULT = { px: 0.05, py: 1.6, pz: 3.7, tx: -0.35, ty: 1.5, tz: 0.55, fov: 36 }; // 「モニターを見ている雪だるま」と同じ
const CUSTOM_RANGE = { px: [-3.3, 3.5], py: [0.3, 3.6], pz: [-2, 6.5], tx: [-3.3, 3.5], ty: [0.2, 3.2], tz: [-2, 4], fov: [12, 70] };
/** 設定(画面からの入力・保存された値)を、安全な値にそろえる。知らない値は、既定へ。 */
export function normalizeWipe(o) {
  o = o || {};
  const num = (v, lo, hi, d) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  const shape = o.shape === 'circle' ? 'circle' : 'rect';
  return {
    shape,
    aspect: shape === 'circle' ? '1:1' : (WIPE_ASPECTS[o.aspect] ? o.aspect : '16:9'),
    corner: WIPE_CORNERS.includes(o.corner) ? o.corner : 'br',
    size: num(o.size, WIPE_SIZE_MIN, WIPE_SIZE_MAX, WIPE_SIZE_DEFAULT),
    frame: o.frame === undefined ? true : !!o.frame,
    borderWidth: num(o.borderWidth, 1, WIPE_BORDER_MAX, WIPE_BORDER_DEFAULT),
    borderColor: typeof o.borderColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.borderColor) ? o.borderColor.toLowerCase() : WIPE_BORDER_COLOR_DEFAULT,
    cam: WIPE_CAMS.includes(o.cam) ? o.cam : 'room', // 既定は、これまでと同じ「部屋全体」
    camInterval: num(o.camInterval, WIPE_CAM_INTERVAL_MIN, WIPE_CAM_INTERVAL_MAX, WIPE_CAM_INTERVAL_DEFAULT),
    camCustom: Object.fromEntries(Object.entries(CUSTOM_RANGE).map(([k, [lo, hi]]) => { const v = Number(o.camCustom && o.camCustom[k]); return [k, Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : WIPE_CUSTOM_DEFAULT[k]]; })),
  };
}
/** ワイプの置き場所と大きさ。mode=出力の種類、opts=設定(normalizeWipe にかける)。 */
export function wipeLayout(mode, opts) {
  const c = normalizeWipe(opts), o = outputSize(mode), k = o.w / 960; // k: 4K=4 / フルHD=2(ワイプの1ピクセルが、出力の何ピクセルか)
  const [aw, ah] = WIPE_ASPECTS[c.aspect], longer = Math.max(16, Math.round((o.w * c.size) / 100 / k));
  let rw, rh;
  if (aw >= ah) { rw = longer; rh = Math.max(1, Math.round((rw * ah) / aw)); } else { rh = longer; rw = Math.max(1, Math.round((rh * aw) / ah)); }
  if (c.shape === 'circle') rh = rw; // 円は、正方形の中
  const b = c.frame ? c.borderWidth : 0, w = rw * k, h = rh * k, margin = 20 * k; // 余白は、枠の最大(8)より大きい
  const x = c.corner === 'bl' || c.corner === 'tl' ? margin : o.w - margin - w, y = c.corner === 'tl' || c.corner === 'tr' ? margin : o.h - margin - h;
  return { x, y, w, h, rw, rh, k, b, shape: c.shape, aspect: c.aspect, corner: c.corner, color: c.borderColor };
}
/** ワイプの内側のピクセル(x,y: 0始まり)か。四角は、すべて内側。円は、中心からの距離で決める(ぼかさない)。 */
export function wipeInside(shape, rw, rh, x, y) {
  if (shape !== 'circle') return x >= 0 && y >= 0 && x < rw && y < rh;
  const dx = x + 0.5 - rw / 2, dy = y + 0.5 - rh / 2, r = rw / 2;
  return dx * dx + dy * dy <= r * r;
}
/** 枠のピクセルか。(x,y)は、枠を含めた外側の座標(0始まり。幅 rw+2b・高さ rh+2b)。内側のワイプの外で、幅 b の帯の中。 */
export function wipeFramePixel(shape, rw, rh, b, x, y) {
  if (b <= 0) return false;
  if (shape !== 'circle') { const ix = x - b, iy = y - b; return !(ix >= 0 && iy >= 0 && ix < rw && iy < rh) && x >= 0 && y >= 0 && x < rw + 2 * b && y < rh + 2 * b; }
  const dx = x + 0.5 - (rw + 2 * b) / 2, dy = y + 0.5 - (rh + 2 * b) / 2, r = rw / 2;
  return dx * dx + dy * dy <= (r + b) * (r + b) && dx * dx + dy * dy > r * r;
}
