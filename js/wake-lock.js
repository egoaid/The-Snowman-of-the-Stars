// wake-lock.js (v1.59)
// スマホなどで、遊んでいる間に画面が自動で暗くなる/スリープするのを防ぐ。
//   1. Screen Wake Lock API が使えれば、それを使う(別のタブ・アプリに移ると、ブラウザが自動で解除する。戻ったらかけ直す)。
//   2. 使えない/断られた場合(古いiPhone、ホーム画面に追加したアプリ、省電力モードなど)は、
//      画面に隠した無音の極小動画をくり返し再生して、「動画を見ている」状態にして画面を消さない(NoSleepと同じ方法)。
//   ・どちらも、画面にさわった時(ユーザー操作)に始める。ブラウザは、操作なしの再生や取得を断ることがあるため。
//   ・HTTPS(またはlocalhost)が必要。GitHub Pagesは満たす。
// nav・doc を引数で受け取るので、Nodeで試験できる。

const VIDEO_MP4 = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAM4bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAmJ0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAABAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAHabWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAKABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABhW1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAUVzdGJsAAAAuXN0c2QAAAAAAAAAAQAAAKlhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAQABIAAAASAAAAAAAAAABFUxhdmM2MC4zMS4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAAL2F2Y0MBQsAK/+EAF2dCwArZBCbARAAAAwAEAAADACg8SJkgAQAFaMuDyyAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAVwAAAFcAAAAAYc3R0cwAAAAAAAAABAAAABQAACAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAABQAAAAEAAAAoc3RzegAAAAAAAAAAAAAABQAAAo8AAAAKAAAACwAAAAoAAAAKAAAAFHN0Y28AAAAAAAAAAQAAA2gAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYwLjE2LjEwMAAAAAhmcmVlAAACwG1kYXQAAAJwBgX//2zcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY0IHIzMTA4IDMxZTE5ZjkgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDIzIC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MCByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgxOjB4MTExIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0wIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTAgd2VpZ2h0cD0wIGtleWludD0yNTAga2V5aW50X21pbj01IHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAF2WIhAR8mKAANiMnJyddddddddddddeAAAAABkGaOAj4RgAAAAdBmlQCPhGAAAAABkGaYBDwjAAAAAZBmoA/wjA=';
const VIDEO_WEBM = 'data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAJKEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEeTbuMU6uEHFO7a1OsggI07AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiECPQAAAAAAAFlSua8GuAQAAAAAAADjXgQFzxYgBKxnsE0D8zpyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAvrwgDgibCBQLqBQJqBAhJUw2f8c3OgY8CAZ8iaRaOHRU5DT0RFUkSHjUxhdmY2MC4xNi4xMDBzc9ZjwItjxYgBKxnsE0D8zmfIoUWjh0VOQ09ERVJEh5RMYXZjNjAuMzEuMTAyIGxpYnZweGfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMDAwMDAwMDAwAB9DtnVAj+eBAKOqgQAAgPACAJ0BKkAAQAAARwiFhYiFhIgCAgAGcDxCYAqyIPcwAP7/q1CAo5aBAMgA0QEAARAQABgAGFgv9AAIjoAAo5aBAZAA0QEAARAQABgAGFgv9AAIjoAAo5aBAlgA0QEAARAQABgAGFgv9AAIjoAAo5aBAyAA0QEAARAQABgAGFgv9AAIjoAAHFO7a5G7j7OBALeK94EB8YIBn/CBAw==';

export function createWakeLock({ nav = globalThis.navigator, doc = globalThis.document, onChange = () => {}, videoFallback = true } = {}) {
  const apiSupported = !!(nav && nav.wakeLock && typeof nav.wakeLock.request === 'function');
  const canVideo = !!(videoFallback && doc && typeof doc.createElement === 'function' && doc.body);
  const supported = apiSupported || canVideo;
  let enabled = false, sentinel = null, pending = false, video = null, videoOn = false, apiFailed = false;

  const active = () => !!sentinel || videoOn;
  const notify = () => onChange(active(), { api: !!sentinel, video: videoOn });

  async function acquireApi() {
    if (!apiSupported || !enabled || sentinel || pending) return false;
    if (doc && doc.visibilityState && doc.visibilityState !== 'visible') return false; // 見えていない間は取れない
    pending = true;
    try {
      const s = await nav.wakeLock.request('screen');
      if (!enabled) { try { await s.release(); } catch (e) { /* 既に解除 */ } return false; }
      sentinel = s; apiFailed = false;
      s.addEventListener && s.addEventListener('release', () => { if (sentinel === s) { sentinel = null; notify(); } });
      stopVideo(); // APIで足りるので、動画は止める(電池のため)
      notify();
      return true;
    } catch (e) {
      apiFailed = true; // 断られた(省電力モード・ホーム画面アプリ・操作なし等)。動画の方法に切り替える
      return false;
    } finally { pending = false; }
  }

  function ensureVideo() {
    if (video || !canVideo) return video;
    video = doc.createElement('video');
    video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', '');
    video.setAttribute('muted', ''); video.muted = true; video.loop = true;
    video.setAttribute('aria-hidden', 'true'); video.tabIndex = -1;
    video.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;';
    const canWebm = typeof video.canPlayType === 'function' && video.canPlayType('video/webm; codecs="vp8"') !== '';
    video.src = canWebm ? VIDEO_WEBM : VIDEO_MP4;
    video.addEventListener('pause', () => { if (videoOn) { videoOn = false; notify(); } }); // 戻った時にかけ直す
    doc.body.appendChild(video);
    return video;
  }
  async function startVideo() {
    if (!canVideo || !enabled || videoOn) return false;
    const v = ensureVideo(); if (!v) return false;
    try {
      const p = v.play(); if (p && typeof p.then === 'function') await p;
      videoOn = true; notify(); return true;
    } catch (e) { return false; } // まだ操作がない等。次に画面をさわった時にもう一度
  }
  function stopVideo() { if (video && videoOn) { try { video.pause(); } catch (e) { /* 続ける */ } } videoOn = false; }

  /** いまの状態に足りなければ、取りなおす。画面にさわるたび・画面に戻るたびに呼ばれる。 */
  async function ensure() {
    if (!enabled) return;
    if (!sentinel) await acquireApi();
    if (!sentinel && (apiFailed || !apiSupported)) await startVideo();
  }
  function onVisible() { if (doc.visibilityState === 'visible') ensure(); }
  function onGesture() { if (enabled && !active()) ensure(); }
  if (doc && doc.addEventListener) {
    doc.addEventListener('visibilitychange', onVisible);
    for (const t of ['pointerdown', 'touchend', 'click', 'keydown']) doc.addEventListener(t, onGesture, { passive: true, capture: true });
  }
  return {
    supported,
    async enable() { enabled = true; apiFailed = false; await ensure(); return active(); },
    async disable() { enabled = false; const s = sentinel; sentinel = null; stopVideo(); if (s) { try { await s.release(); } catch (e) { /* 既に解除 */ } } notify(); },
    isEnabled: () => enabled,
    isActive: active,
  };
}
