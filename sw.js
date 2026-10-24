// Word Challenge service worker
// Caches the game's own files so it opens instantly and can show a "No signal" screen.
// Calls to the Google Sheet (Apps Script) always go live and are never cached.

const CACHE = 'word-challenge-v3';   // bump to v2, v3... whenever you change these files
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/config.js',
  './js/rules.js',
  './js/demo-api.js',
  './js/app.js',
  './js/wrapper.js',
  './img/landscape.svg',
  './img/foliage-left.svg',
  './img/foliage-right.svg',
  './img/foliage-bottom.svg',
  './img/plumeria.svg',
  './img/hibiscus.svg',
  './img/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // never touch Google's requests

  // Network first, fall back to cache, so updates show up as soon as there is signal.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
