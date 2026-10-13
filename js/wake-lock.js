// wake-lock.js (v1.57)
// スマホなどで、アプリを使っている間に画面が自動で暗くなる/スリープするのを防ぐ(Screen Wake Lock API)。
//   ・対応していないブラウザでは、何も起きない(エラーも出さない)。
//   ・別のタブやアプリに移ると、ブラウザが自動で解除する。戻ってきたら、かけ直す。
//   ・省電力モード等で拒否された時は、次に画面をさわった時に、もう一度だけ試す。それでも駄目なら、さわるたびには試さない。
//   ・HTTPS(またはlocalhost)が必要。GitHub Pagesは満たす。
// nav・doc を引数で受け取るので、Nodeで試験できる。

export function createWakeLock({ nav = globalThis.navigator, doc = globalThis.document, onChange = () => {} } = {}) {
  const supported = !!(nav && nav.wakeLock && typeof nav.wakeLock.request === 'function');
  let enabled = false, sentinel = null, pending = false, retryOnTouch = false, retried = false;

  async function acquire() {
    if (!supported || !enabled || sentinel || pending) return false;
    if (doc && doc.visibilityState && doc.visibilityState !== 'visible') return false; // 見えていない間は取れない
    pending = true;
    try {
      const s = await nav.wakeLock.request('screen');
      if (!enabled) { try { await s.release(); } catch (e) { /* 既に解除 */ } return false; }
      sentinel = s; retried = false; retryOnTouch = false;
      s.addEventListener && s.addEventListener('release', () => { if (sentinel === s) { sentinel = null; onChange(false); } });
      onChange(true);
      return true;
    } catch (e) {
      // 省電力モード・権限なし(NotAllowedError)など。次に画面をさわった時に、もう一度だけ試す(それでも駄目なら、さわるたびには試さない)
      if (!retried) retryOnTouch = true;
      return false;
    } finally { pending = false; }
  }
  function onVisible() { if (doc.visibilityState === 'visible' && enabled && !sentinel) acquire(); }
  function onTouch() { if (retryOnTouch) { retryOnTouch = false; retried = true; acquire(); } }
  if (supported && doc && doc.addEventListener) {
    doc.addEventListener('visibilitychange', onVisible);
    doc.addEventListener('pointerdown', onTouch, { passive: true });
  }
  return {
    supported,
    async enable() { enabled = true; retried = false; return acquire(); },
    async disable() { enabled = false; retryOnTouch = false; const s = sentinel; sentinel = null; if (s) { try { await s.release(); } catch (e) { /* 既に解除 */ } onChange(false); } },
    isEnabled: () => enabled,
    isActive: () => !!sentinel,
  };
}
