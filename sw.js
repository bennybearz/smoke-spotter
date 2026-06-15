/* Service worker — keeps data use (and cost) low.
   - App shell + Leaflet are self-hosted and cached: downloaded once, then free/offline.
   - Map tiles are cached (cache-first, capped) so re-walking an area doesn't re-download.
   - Overpass data is always fetched fresh from the network (never cached). */
var SHELL_CACHE = "smoke-shell-v4";
var TILE_CACHE = "smoke-tiles-v1";
var TILE_MAX = 400; // ~ a few MB; plenty for a day of walking a neighborhood

var SHELL = [
  "./",
  "./index.html",
  "./app-core.js",
  "./manifest.webmanifest",
  "./vendor/leaflet.js",
  "./vendor/leaflet.css",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(SHELL_CACHE).then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== SHELL_CACHE && k !== TILE_CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function trimCache(name, max) {
  caches.open(name).then(function (cache) {
    cache.keys().then(function (keys) {
      if (keys.length > max) {
        // delete oldest (FIFO) entries
        for (var i = 0; i < keys.length - max; i++) cache.delete(keys[i]);
      }
    });
  });
}

self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);

  // Overpass data: always network, never cache (we want fresh results).
  if (/overpass/.test(url.hostname) || /interpreter/.test(url.pathname)) {
    return;
  }

  // Map tiles: cache-first, store a capped number to save mobile data.
  if (/basemaps\.cartocdn\.com/.test(url.hostname)) {
    e.respondWith(
      caches.open(TILE_CACHE).then(function (cache) {
        return cache.match(e.request).then(function (hit) {
          if (hit) return hit;
          return fetch(e.request).then(function (resp) {
            if (resp && resp.status === 200) {
              cache.put(e.request, resp.clone());
              trimCache(TILE_CACHE, TILE_MAX);
            }
            return resp;
          });
        });
      })
    );
    return;
  }

  // App shell: cache-first, fall back to network.
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      return cached || fetch(e.request);
    })
  );
});
