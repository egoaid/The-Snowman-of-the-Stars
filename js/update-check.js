// update-check.js (v1.57)
// サーバー上の version.json と、いま動いている版を比べて、新しい版があれば知らせる(控えめに)。
//   ・確認するのは、起動の少しあと / 画面に戻った時(前回から2分以上あいていれば) / 一定間隔(15分)。
//   ・サーバーの版が「新しい」時だけ知らせる(古い・同じなら何も出さない)。ネットワークが無ければ静かに何もしない。
// 版の比べ方: 1.57 / 1.57.1 / 1.56-H6 のような表記。数字の順に比べ、-H6のような後ろの数字は同じ版の中の細かい順番。

/** '1.56-H6' → [1,56,0,6]。読めなければ null。 */
export function parseVersion(v) {
  const m = /^\s*v?(\d+)\.(\d+)(?:\.(\d+))?(?:-[A-Za-z]+(\d+))?\s*$/.exec(String(v ?? ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0), Number(m[4] || 0)] : null;
}
/** a が b より新しければ正、同じなら0、古ければ負。どちらかが読めなければ NaN。 */
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return NaN;
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

export function createUpdateChecker({ currentVersion, url = 'version.json', fetchFn = globalThis.fetch && globalThis.fetch.bind(globalThis), onUpdate = () => {}, now = () => Date.now(), minGapMs = 120000 } = {}) {
  let last = -Infinity, notified = null, busy = false;
  async function check({ force = false } = {}) {
    if (!fetchFn || busy) return { checked: false };
    if (!force && now() - last < minGapMs) return { checked: false };
    busy = true; last = now();
    try {
      const sep = url.includes('?') ? '&' : '?';
      const res = await fetchFn(`${url}${sep}t=${now()}`, { cache: 'no-store' });
      if (!res || !res.ok) return { checked: true, error: true };
      const data = await res.json();
      const server = data && data.version;
      const c = compareVersions(server, currentVersion);
      if (Number.isFinite(c) && c > 0) {
        if (notified !== server) { notified = server; onUpdate(server); }
        return { checked: true, newer: true, server };
      }
      return { checked: true, newer: false, server };
    } catch (e) { return { checked: true, error: true }; }
    finally { busy = false; }
  }
  return { check, notifiedVersion: () => notified };
}
