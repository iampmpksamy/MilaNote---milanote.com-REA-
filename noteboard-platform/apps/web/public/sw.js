// Noteboard service worker: makes the app installable and lets its shell open without a network.
// It never stores API answers, boards or pictures: everything under /api/ always goes to the server.
const CACHE = 'noteboard-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.well-known/')) return;
  if (req.mode === 'navigate') {
    // Pages: always the network first, so a new version shows at once; the cached shell offline.
    event.respondWith(fetch(req).catch(() => caches.match('/')));
    return;
  }
  if (/-[A-Za-z0-9]{8,}\.(js|css|woff2?)$/.test(url.pathname) || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
