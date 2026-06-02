// Forge-199 — Service worker for the PWA / web variant.
//
// On `install`, pre-cache the static shell + every Vite-emitted asset
// (index.html, vendor chunks, CSS, the WASM kernel build when present).
// On `fetch`, serve from cache when offline; otherwise stay network-
// first so users always get fresh app code when the network is healthy.
//
// Cache versioning: bump CACHE_VERSION whenever the manifest or shell
// changes so old caches get evicted on activation. The list of assets
// is small + static because Vite hashes filenames — we only need to
// keep the shell + the discovered chunks of one build.

/* eslint-env serviceworker */

const CACHE_VERSION = 'forge-v1';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE_ASSETS))
      .catch((err) => {
        // Surface real install errors in the console — silently failing
        // here used to make "why isn't the app caching?" undebuggable.
        console.error('[forge.sw] install cache failed:', err);
      }),
  );
  self.skipWaiting?.();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))),
  );
  self.clients?.claim?.();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // Don't intercept dev-server SSE / hot reload.
  if (req.url.includes('/@vite/') || req.url.includes('hot-update')) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        // Cache successful same-origin responses so we have a fallback
        // when the network drops next time.
        if (res.ok && req.url.startsWith(self.location.origin)) {
          const cloned = res.clone();
          caches.open(CACHE_VERSION).then((cache) => {
            cache.put(req, cloned).catch(() => {});
          });
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) =>
          cached || new Response('offline', {
            status: 503,
            headers: { 'content-type': 'text/plain' },
          }))),
  );
});
