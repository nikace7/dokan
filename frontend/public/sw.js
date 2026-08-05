/**
 * App-shell service worker (Phase 3 offline POS).
 *
 * Scope is deliberately tiny:
 * - precaches the app shell ('/', manifest) for instant, offline-capable boot;
 * - navigation requests are network-first with a cached-shell fallback
 *   (SPA route reloads while offline);
 * - same-origin static assets (hashed Vite bundles) are cache-first;
 * - `/api` is NEVER touched here — API GETs the counter needs offline are
 *   served from the Dexie lookup cache, and POSTs must never be cached.
 *
 * Bump CACHE when the precache list changes; hashed /assets filenames make
 * the runtime cache self-invalidating.
 */

const CACHE = 'dokan-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok && url.pathname.startsWith('/assets/')) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
