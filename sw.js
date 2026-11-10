/* Alexa 中文练习 service worker
 * Bump CACHE when SW logic or the app shell changes.
 * New daily drills do not need a bump: index.html and drills.json are
 * network-first, and new HTML is prefetched into the cache when the catalog updates.
 */
const CACHE = 'alexa-zh-v1';

const SHELL = [
  './',
  './index.html',
  './drills.json',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png'
];

function scopeURL(path) {
  return new URL(path, self.registration.scope);
}

async function cacheShell(cache) {
  for (const path of SHELL) {
    const url = scopeURL(path);
    try {
      const res = await fetch(url, {cache: 'no-store'});
      if (res && res.ok) await cache.put(url, res);
    } catch (e) {}
  }
}

async function prefetchDrills(cache, drills) {
  if (!Array.isArray(drills)) return;
  await Promise.all(drills.map(async function (d) {
    if (!d || !d.href) return;
    const url = scopeURL(d.href);
    try {
      const res = await fetch(url);
      if (res && res.ok) await cache.put(url, res);
    } catch (e) {}
  }));
}

async function cacheCatalogAndDrills(cache) {
  try {
    const res = await fetch(scopeURL('./drills.json'), {cache: 'no-store'});
    if (!res || !res.ok) return;
    await cache.put(scopeURL('./drills.json'), res.clone());
    const drills = await res.json();
    await prefetchDrills(cache, drills);
  } catch (e) {}
}

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    const cache = await caches.open(CACHE);
    await cacheShell(cache);
    await cacheCatalogAndDrills(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    const keys = await caches.keys();
    await Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) {
      return caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

function isCatalogRequest(url) {
  if (url.origin !== self.location.origin) return false;
  const base = new URL('./', self.registration.scope).pathname.replace(/\/+$/, '');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === base) return true;
  if (path === base + '/index.html') return true;
  if (path === base + '/drills.json' || url.pathname.endsWith('/drills.json')) return true;
  return false;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request, {cache: 'no-store'});
    if (fresh && fresh.ok) {
      await cache.put(request, fresh.clone());
      const url = new URL(request.url);
      if (url.pathname.endsWith('/drills.json')) {
        try {
          const drills = await fresh.clone().json();
          prefetchDrills(cache, drills);
        } catch (e) {}
      }
    }
    return fresh;
  } catch (e) {
    const cached = await cache.match(request, {ignoreSearch: true});
    if (cached) return cached;
    // Navigating to ./ might have been cached as index.html
    if (request.mode === 'navigate') {
      const idx = await cache.match(scopeURL('./index.html'), {ignoreSearch: true})
        || await cache.match(scopeURL('./'), {ignoreSearch: true});
      if (idx) return idx;
    }
    throw e;
  }
}

async function cacheFirstUpdate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, {ignoreSearch: true});
  const updating = fetch(request).then(function (fresh) {
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  }).catch(function () { return null; });
  if (cached) return cached;
  const fresh = await updating;
  if (fresh) return fresh;
  return Response.error();
}

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isCatalogRequest(url)) {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(cacheFirstUpdate(req));
  }
});
