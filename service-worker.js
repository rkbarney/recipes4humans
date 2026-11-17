const CACHE_NAME = 'recipes4humans-v19';
const base = self.location.pathname.replace(/\/[^/]*$/, '/') || '/';
const SHELL_URLS = [
  base,
  base + 'index.html',
  base + 'privacy.html',
  base + 'manifest.json',
  base + 'css/style.css',
  base + 'js/config.js',
  base + 'js/app.js',
  base + 'js/storage.js',
  base + 'js/url.js',
  base + 'js/sync.js',
  base + 'js/engine/steps-duration.js',
  base + 'js/engine/steps-sentences.js',
  base + 'js/engine/text-utils.js',
  base + 'js/engine/verbs.js',
  base + 'js/engine/quantity.js',
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

// Network first: when online, always load the latest files (and keep a copy); when the network is
// down or too slow, fall back to the saved copy so the app still opens offline. The API is never cached.
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  e.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const network = fetch(req).then((res) => {
    // Redirected responses are not stored: Safari refuses to serve them for a page load.
    if (res.ok && !res.redirected && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch {
    // offline: use the saved copy below
  }
  const cached = (await cache.match(req, { ignoreSearch: req.mode === 'navigate' }))
    || (req.mode === 'navigate' ? (await cache.match(base + 'index.html')) || (await cache.match(base)) : null);
  if (cached) return cached;
  return network; // nothing saved: wait for the network after all (or fail as the browser would)
}
