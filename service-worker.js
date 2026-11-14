const CACHE_NAME = 'recipes4humans-v16';
const base = self.location.pathname.replace(/\/[^/]*$/, '/') || '/';
const SHELL_URLS = [
  base,
  base + 'index.html',
  base + 'manifest.json',
  base + 'css/style.css',
  base + 'js/config.js',
  base + 'js/app.js',
  base + 'js/storage.js',
  base + 'js/sync.js',
  base + 'js/extract.js',
  base + 'js/ui.js',
  base + 'js/pdf.js',
  base + 'js/engine/index.js',
  base + 'js/engine/types.js',
  base + 'js/engine/ingredients.js',
  base + 'js/engine/steps.js',
  base + 'js/engine/match.js',
  base + 'js/engine/amounts.js',
  base + 'js/engine/prep.js',
  base + 'js/engine/windows.js',
  base + 'icons/icon.svg',
  base + 'icons/icon-192.png',
  base + 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // the API is always live, never cached
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        if (res.status === 200 && (e.request.mode === 'navigate' || e.request.destination === 'document')) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
