// app-update.js (v1.58)
// 「キャッシュを削除して再読み込み」: 古い版が残ってしまった時に、新しい版へ確実に切り替える。
//   1. 今の世界を保存する(saveNow)
//   2. Service Worker の登録を解除する
//   3. このアプリのキャッシュ(snowman- で始まる物だけ)を削除する
//      ※ 同じドメインに別のアプリがあっても巻き込まないよう、名前が snowman- の物だけを消す。
//   4. ブラウザ自身のHTTPキャッシュも、アプリのファイルを取り直して新しくする
//      (GitHub Pagesは数分間キャッシュさせるので、再読み込みだけでは古いJSが使われることがある)
//   5. 再読み込みする
// ワールドの保存データ(IndexedDB・localStorage)には触れない。消えるのはキャッシュだけ。

/** service-worker.js の中身(文字列)から、PRECACHE のファイル一覧を取り出す。読めなければ空。 */
export function parsePrecacheList(swSource) {
  const m = /const\s+PRECACHE\s*=\s*\[([\s\S]*?)\]\s*;/.exec(String(swSource || ''));
  if (!m) return [];
  const out = [];
  const re = /"([^"\\]+)"/g;
  let x;
  while ((x = re.exec(m[1]))) out.push(x[1]);
  return out;
}

/**
 * キャッシュを削除して再読み込みする。依存(fetch・caches・serviceWorker・reload)は引数で差し替えられる(検証用)。
 * 戻り値: { unregistered, cachesDeleted, refreshed, failed } (reload の直前の集計)
 */
export async function clearCachesAndReload({
  saveNow = () => {},
  onStatus = () => {},
  fetchFn = globalThis.fetch && globalThis.fetch.bind(globalThis),
  cachesApi = globalThis.caches,
  swContainer = (typeof navigator !== 'undefined' && navigator.serviceWorker) || null,
  reload = () => location.reload(),
  cachePrefix = 'snowman-',
  concurrency = 8,
} = {}) {
  const result = { unregistered: 0, cachesDeleted: 0, refreshed: 0, failed: 0 };
  try { saveNow(); } catch (e) { /* 保存に失敗しても、更新は続ける */ }
  onStatus('更新を準備しています…');

  // 先に、取り直すファイルの一覧を得る(Service Workerを消すと、一覧の入口が変わる前に取っておく)
  let list = [];
  if (fetchFn) {
    try {
      const res = await fetchFn('service-worker.js', { cache: 'reload' });
      if (res && res.ok) list = parsePrecacheList(await res.text());
    } catch (e) { /* オフライン・開発環境などでは、一覧なしで進む */ }
  }

  // Service Workerの登録解除
  try {
    if (swContainer && swContainer.getRegistrations) {
      const regs = await swContainer.getRegistrations();
      for (const r of regs) { try { if (await r.unregister()) result.unregistered++; } catch (e) { /* 続ける */ } }
    }
  } catch (e) { /* 続ける */ }

  // このアプリのキャッシュだけを削除
  onStatus('キャッシュを削除しています…');
  try {
    if (cachesApi && cachesApi.keys) {
      for (const key of await cachesApi.keys()) {
        if (String(key).startsWith(cachePrefix)) { try { if (await cachesApi.delete(key)) result.cachesDeleted++; } catch (e) { /* 続ける */ } }
      }
    }
  } catch (e) { /* 続ける */ }

  // ブラウザのHTTPキャッシュを新しくする(cache: 'reload' = キャッシュを使わず取り直し、結果で上書き)
  if (fetchFn && list.length) {
    const queue = list.slice();
    let done = 0;
    const worker = async () => {
      while (queue.length) {
        const url = queue.shift();
        try {
          const r = await fetchFn(url, { cache: 'reload' });
          if (r && r.ok) result.refreshed++; else result.failed++;
        } catch (e) { result.failed++; }
        done++;
        if (done % 6 === 0 || done === list.length) onStatus(`最新のファイルを取得しています… (${done}/${list.length})`);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  }

  onStatus('再読み込みします…');
  reload();
  return result;
}
