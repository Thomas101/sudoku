// service-worker.js — offline app shell. Paths are relative so the app works
// from a GitHub Pages project subpath (e.g. /sudoku/) without changes.
const CACHE = 'sudoku-v6';
const ASSETS = [
  '.',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/sudoku.js',
  'js/storage.js',
  'js/multiplayer.js',
  'js/qr.js',
  'js/haptics.js',
  'js/vendor/qrcode.js',
  'js/vendor/jsQR.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => {})
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for same-origin GETs: always serve the freshest code when
// online (and refresh the cache), falling back to the cache only when offline.
// This avoids the classic "stale cached build" problem of cache-first.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return; // pass through cross-origin
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('index.html')))
  );
});
