// admin.js (v1.57)
// 管理者だけがデバッグ表示を見られる、シンプルな仕組み。
//   ・公開版では、[data-admin-only] の付いた要素(FPS表示・紅葉デバッグ・イベント・手動の地形生成など)を、画面から取り除く。
//   ・URLに ?admin=1 を付けて開くと、パスフレーズを聞く。合えば、この端末のブラウザに「管理者」を記録して、デバッグ表示が使える。
//   ・?admin=0 で、この端末の管理者を解除する。
//   ・パスフレーズ本人は持たず、ハッシュ(config.js の adminHash)と比べるだけ。強い秘匿ではない(静的サイトなので回避できる)。
// DOM・ブラウザに依存しない部分(ハッシュ・記録)は、Nodeで試験できる。

export const ADMIN_STORAGE_KEY = 'snowman.admin.v1';
export const ADMIN_SALT = 'snowman-admin-v1:';

/** SHA-256(16進)。crypto.subtle が使えない環境(古い・http)では null。 */
export async function sha256Hex(text, cryptoObj = globalThis.crypto) {
  if (!cryptoObj || !cryptoObj.subtle) return null;
  const buf = await cryptoObj.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function hashPassphrase(pass, cryptoObj) { return sha256Hex(ADMIN_SALT + String(pass ?? ''), cryptoObj); }

/** この端末が管理者として記録されているか。記録された値が、正しいハッシュと一致している時だけ true。 */
export function isAdmin(storage, adminHash) {
  try { return !!adminHash && storage.getItem(ADMIN_STORAGE_KEY) === adminHash; } catch (e) { return false; }
}
/** パスフレーズを確かめて、合えば記録する。 */
export async function tryEnableAdmin(pass, storage, adminHash, cryptoObj) {
  const h = await hashPassphrase(pass, cryptoObj);
  if (!h || !adminHash || h !== adminHash) return false;
  try { storage.setItem(ADMIN_STORAGE_KEY, adminHash); return true; } catch (e) { return false; }
}
export function disableAdmin(storage) { try { storage.removeItem(ADMIN_STORAGE_KEY); } catch (e) { /* 何もしない */ } }

/** 管理者でなければ、[data-admin-only] の要素を取り除く(CSSで隠すだけでなく、DOMから無くす)。管理者なら小さな目印を出す。 */
export function applyAdminGate(doc, admin) {
  const nodes = [...doc.querySelectorAll('[data-admin-only]')];
  if (!admin) { for (const n of nodes) n.remove(); return nodes.length; }
  const badge = doc.createElement('div');
  badge.id = 'adminBadge'; badge.textContent = '管理者'; badge.title = '管理者モード(解除: ?admin=0)';
  doc.body.appendChild(badge);
  return 0;
}

/**
 * URLの ?admin=1 / ?admin=0 を処理する。処理したら true(ページを再読み込みするので、呼び出し側はその後を続けない)。
 * ask: パスフレーズを聞く関数(prompt相当)。reload: パラメータを外したURLへ移る関数。
 */
export async function handleAdminUrl({ search, storage, adminHash, ask, reload, cryptoObj }) {
  const params = new URLSearchParams(search);
  if (!params.has('admin')) return false;
  const v = params.get('admin');
  params.delete('admin');
  if (v === '0') { disableAdmin(storage); reload(params.toString()); return true; }
  if (v === '1') {
    const pass = ask('管理者のパスフレーズを入力してください');
    if (pass != null && pass !== '') {
      const ok = await tryEnableAdmin(pass, storage, adminHash, cryptoObj);
      if (!ok) ask.alert && ask.alert('パスフレーズが違います。');
    }
    reload(params.toString());
    return true;
  }
  return false;
}
