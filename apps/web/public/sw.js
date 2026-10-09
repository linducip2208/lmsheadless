/* LMS Admin service worker. Bump VERSION to ship an update. */
const VERSION = 'lms-web-v1';
const SHELL = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Public, safe-to-cache GET endpoints only. Private API responses are never cached.
const SAFE_API_PREFIXES = [
  '/api/v1/openapi.json',
  '/api/v1/push/config',
  '/api/v1/certificates/verify/',
];
const SAFE_API_SUFFIX = '/branding';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void self.skipWaiting();
});

function isSafeApi(url) {
  return (
    SAFE_API_PREFIXES.some((p) => url.pathname.startsWith(p)) ||
    url.pathname.endsWith(SAFE_API_SUFFIX)
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // writes always go to network (idempotent on retry)
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network first, shell cache, offline page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches
            .open(VERSION)
            .then((c) => c.put('/index.html', copy))
            .catch(() => undefined);
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r ?? caches.match('/offline.html')))
    );
    return;
  }

  // Bundled assets: cache first.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then((hit) => {
        if (hit) return hit;
        return fetch(request).then((res) => {
          const copy = res.clone();
          caches
            .open(VERSION)
            .then((c) => c.put(request, copy))
            .catch(() => undefined);
          return res;
        });
      })
    );
    return;
  }

  // Safe public API reads: stale-while-revalidate.
  if (url.pathname.startsWith('/api/') && isSafeApi(url)) {
    event.respondWith(
      caches.match(request).then((hit) => {
        const net = fetch(request)
          .then((res) => {
            const copy = res.clone();
            caches
              .open(VERSION)
              .then((c) => c.put(request, copy))
              .catch(() => undefined);
            return res;
          })
          .catch(() => hit);
        return hit ?? net;
      })
    );
  }
  // All other API traffic: network only. Never cache private data.
});

// Push architecture: displays notifications once the deployment configures keys.
self.addEventListener('push', (event) => {
  let data = { title: 'LMS', body: 'You have a new notification.' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    /* plain text payload */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, { body: data.body, icon: '/icons/icon-192.png' })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/'));
});
