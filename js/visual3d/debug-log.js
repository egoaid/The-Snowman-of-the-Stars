// debug-log.js (v1.69)
// 動作確認用のデバッグログ。出来事(かけらを貼った・くっついた・浮いた・月の石を拾った 等)を、時刻つきで記録して、
// その時点の状態(スナップショット)といっしょに、JSONファイルとして書き出せる。
// 書き出したファイルを、そのまま渡してもらえれば、何が起きていたかを後から追える。
//
// - 記録は新しい方から最大 max 件(古いものは捨てる)。メモリは小さい。
// - ブラウザのエラー(error / unhandledrejection)も、自動で記録する。
// - ゲームの動作には影響しない(読むだけ。ログの失敗は握りつぶす)。

export function createDebugLog({ max = 600, version = '' } = {}) {
  const hasWindow = typeof window !== 'undefined';
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const t0 = now();
  const events = [];
  const errors = [];
  let seq = 0;
  let snapshotFn = null;

  function log(kind, data) {
    try {
      const e = { n: ++seq, t: +((now() - t0) / 1000).toFixed(2), kind };
      if (data !== undefined) e.data = data;
      events.push(e);
      if (events.length > max) events.shift();
      return e;
    } catch (err) { return null; }
  }

  if (hasWindow) {
    window.addEventListener('error', (ev) => {
      const e = { message: String(ev.message || ''), source: String(ev.filename || '').split('/').slice(-2).join('/'), line: ev.lineno, col: ev.colno };
      errors.push(e); if (errors.length > 50) errors.shift();
      log('error', e);
    });
    window.addEventListener('unhandledrejection', (ev) => {
      const e = { message: String((ev.reason && (ev.reason.stack || ev.reason.message)) || ev.reason || '').slice(0, 600) };
      errors.push(e); if (errors.length > 50) errors.shift();
      log('unhandledrejection', e);
    });
  }

  /** 書き出す時に呼ばれて、その時点の状態を返す関数を登録する。 */
  function setSnapshot(fn) { snapshotFn = fn; }

  function toObject() {
    let snapshot = null;
    try { snapshot = snapshotFn ? snapshotFn() : null; } catch (err) { snapshot = { snapshotError: String(err && err.message || err) }; }
    return {
      app: 'The Snowman of the Stars',
      version,
      exportedAt: new Date().toISOString(),
      uptimeSec: +((now() - t0) / 1000).toFixed(1),
      userAgent: hasWindow ? navigator.userAgent : '',
      viewport: hasWindow ? { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio } : null,
      eventCount: events.length,
      errors,
      snapshot,
      events,
    };
  }

  /** JSONファイルとしてダウンロードする。ファイル名を返す。 */
  function download() {
    const obj = toObject();
    const ts = obj.exportedAt.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const name = `snowman-debug-v${version}-${ts}.json`;
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return name;
  }

  return { log, setSnapshot, toObject, download, size: () => events.length };
}
