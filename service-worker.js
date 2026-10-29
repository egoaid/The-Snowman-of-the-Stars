/* service-worker.js (v1.57)
 * オフライン対応と更新。BUILD と PRECACHE は、tools/build-public.mjs が公開用に書き換える(開発中は空=何もキャッシュしない)。
 *   ・同じオリジンのファイル: ネットワーク優先(オンラインなら常に最新。取れた物はキャッシュに入れ、オフラインではキャッシュを使う)
 *   ・vendor/(three.js等)・icons/: キャッシュ優先(中身が変わらない)
 *   ・version.json: 常にネットワーク(更新の確認用。キャッシュしない)
 *   ・新しい版のService Workerは、待機状態になる。画面の「新しい版があります」を押すと(SKIP_WAITING)、切り替わる。
 */
const BUILD = '1.80-20261029';
const PRECACHE = [
  "./",
  "css/layout.css",
  "icons/apple-touch-icon.png",
  "icons/favicon-16.png",
  "icons/favicon-32.png",
  "icons/icon-192-maskable.png",
  "icons/icon-192.png",
  "icons/icon-512-maskable.png",
  "icons/icon-512.png",
  "index.html",
  "js/admin.js",
  "js/app-update.js",
  "js/audio/bees.js",
  "js/audio/birds.js",
  "js/audio/context.js",
  "js/audio/fire.js",
  "js/audio/footsteps.js",
  "js/audio/gather-sounds.js",
  "js/audio/insects.js",
  "js/audio/rain.js",
  "js/audio/river.js",
  "js/audio/sfx.js",
  "js/audio/star-bells.js",
  "js/audio/thunder.js",
  "js/audio/ui-sounds.js",
  "js/audio/wind.js",
  "js/collectibles.js",
  "js/config.js",
  "js/equipment.js",
  "js/inventory.js",
  "js/i18n.js",
  "js/i18n/en.js",
  "js/i18n/ja.js",
  "js/items.js",
  "js/physics.js",
  "js/placement.js",
  "js/pouch.js",
  "js/presets.js",
  "js/recipes.js",
  "js/recorder.js",
  "js/remnants.js",
  "js/save/save-store.js",
  "js/save/save-ui.js",
  "js/session-mode.js",
  "js/title-flow.js",
  "js/update-check.js",
  "js/visual3d/camera-director.js",
  "js/visual3d/camera-ground.js",
  "js/visual3d/campfire.js",
  "js/visual3d/chest.js",
  "js/visual3d/daynight.js",
  "js/visual3d/edit-mode.js",
  "js/visual3d/fallen-log-system.js",
  "js/visual3d/fallen-wood.js",
  "js/visual3d/falling-star.js",
  "js/visual3d/fish.js",
  "js/visual3d/flowers.js",
  "js/visual3d/glue-math.js",
  "js/visual3d/glue-tool.js",
  "js/visual3d/ground-detail.js",
  "js/visual3d/held-items.js",
  "js/visual3d/igloo.js",
  "js/visual3d/interaction.js",
  "js/visual3d/lantern.js",
  "js/visual3d/leaf-fall.js",
  "js/visual3d/log-obstacles.js",
  "js/visual3d/mountains3d.js",
  "js/visual3d/noise.js",
  "js/visual3d/pollinators.js",
  "js/visual3d/remnants-visual.js",
  "js/visual3d/debug-log.js",
  "js/visual3d/moon-stone.js",
  "js/visual3d/river-ends.js",
  "js/visual3d/river.js",
  "js/visual3d/rng.js",
  "js/visual3d/rocks.js",
  "js/visual3d/scene3d.js",
  "js/visual3d/season.js",
  "js/visual3d/shading.js",
  "js/visual3d/shard-system.js",
  "js/visual3d/starfield.js",
  "js/visual3d/shadow-flags.js",
  "js/visual3d/shadow-snap.js",
  "js/visual3d/snowman.js",
  "js/visual3d/emote-brain.js",
  "js/visual3d/star-torch.js",
  "js/visual3d/butterfly-visit.js",
  "js/visual3d/drop-field.js",
  "js/visual3d/activity-log.js",
  "js/drops.js",
  "js/visual3d/tent.js",
  "js/visual3d/terrain-noise.js",
  "js/visual3d/terrain.js",
  "js/visual3d/traversal.js",
  "js/visual3d/tree-decor.js",
  "js/visual3d/tree.js",
  "js/visual3d/walk-controls.js",
  "js/visual3d/wander-nav.js",
  "js/visual3d/wander-watchdog.js",
  "js/visual3d/water-ripples.js",
  "js/visual3d/weather.js",
  "js/wake-lock.js",
  "manifest.json",
  "vendor/LICENSE-cannon-es.txt",
  "vendor/LICENSE-three.txt",
  "vendor/OrbitControls.js",
  "vendor/PointerLockControls.js",
  "vendor/cannon-es.js",
  "vendor/three.module.min.js"
];
const CACHE = `snowman-${BUILD}`;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 1つ取れなくても、全体の導入は止めない(取れた物から使う)
    await Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('snowman-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => { if (event.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 他のサイトへの通信には触れない
  if (url.pathname.endsWith('/version.json')) return; // 更新の確認は、常に最新を見る(キャッシュしない)
  const immutable = /\/(vendor|icons)\//.test(url.pathname);
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (immutable) {
      const hit = await cache.match(req);
      if (hit) return hit;
    }
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (e) {
      const hit = (await cache.match(req)) || (req.mode === 'navigate' ? await cache.match(new URL('./index.html', self.location).href) : null);
      if (hit) return hit;
      throw e;
    }
  })());
});
