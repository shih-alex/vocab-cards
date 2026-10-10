/* 單字卡 service worker — offline app shell + stale-while-revalidate.
 *
 * Every same-origin GET is answered from the cache when possible while a fresh
 * copy is fetched in the background, so the app opens instantly (and offline)
 * and picks up updated files on the next launch.
 * Bump CACHE when the SHELL list changes; old caches are removed on activate.
 * Files are refreshed one by one, so a launch right after an update can mix versions: app.js
 * compares VC.version (core.js) with its APP_VERSION and, if they differ, deletes these caches
 * and reloads once. Keep the two version numbers equal on every release.
 */
'use strict';

const CACHE = 'vocabcards-v4';

const SHELL = [
  './',
  'index.html',
  'style.css',
  'core.js',
  'sample.js',
  'app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

// Paths (relative to the scope) the worker never touches: test pages, build output, dev tools.
const BYPASS = /^(tests|dist|tools)\//;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(SHELL.map((url) =>
        // cache: 'reload' bypasses the HTTP cache so a new worker gets fresh files.
        // One missing file must not abort the whole install: it keeps the copy from the
        // previous cache (deleted on activate), so the app still opens offline.
        cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
          console.warn('[sw] precache failed:', url, err);
          return caches.match(url).then((prev) => prev && cache.put(url, prev));
        }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('vocabcards-') && key !== CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const scopePath = new URL(self.registration.scope).pathname;
  if (BYPASS.test(url.pathname.slice(scopePath.length))) return;

  const isPage = req.mode === 'navigate';
  // Pages are stored without their query string (e.g. ?sk=...) so all variants share one entry.
  const key = isPage ? url.origin + url.pathname : req;

  // 'no-cache' revalidates with the server (a cheap 304 when nothing changed).
  const network = fetch(req, { cache: 'no-cache' });
  const update = network.then((res) => {
    if (!res.ok || res.type !== 'basic') return undefined;
    const copy = res.clone(); // clone now, before the page starts reading the body
    return caches.open(CACHE).then((cache) => cache.put(key, copy));
  });
  event.waitUntil(update.catch(() => {}));

  event.respondWith(
    caches.open(CACHE)
      .then((cache) => cache.match(key))
      .then((cached) => cached || network)
      .catch(() => (isPage ? offlinePage() : Response.error()))
  );
});

function offlinePage() {
  return caches.open(CACHE)
    .then((cache) => cache.match('index.html').then((res) => res || cache.match('./')))
    .then((res) => res || Response.error());
}
