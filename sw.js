/* Service worker — keeps data use (and cost) low.
   - App shell + Leaflet are self-hosted and cached: downloaded once, then free/offline.
   - Map tiles: CARTO now requires an API key, so tile requests are transparently
     re-sourced to a free no-key dark basemap (Esri), with OpenStreetMap as a
     fallback, and cached. index.html is untouched.
   - Overpass data is always fetched fresh from the network (never cached). */
// Bump SHELL_CACHE *and* the ?v= on app-core.js in index.html together — they
// are one version number split across two files.
var SHELL_CACHE = "smoke-shell-v10";
var TILE_CACHE = "smoke-tiles-v2"; // v2: purge broken key-gated CARTO tiles
var TILE_MAX = 400; // ~ a few MB; plenty for a day of walking a neighborhood

var SHELL = [
  "./",
  "./index.html",
  // Must carry the same ?v= the page requests, or this entry never matches and
  // app-core.js quietly stops working offline.
  "./app-core.js?v=10",
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

// --- Tile re-sourcing -----------------------------------------------------
// Pull z/x/y out of a CARTO tile URL (/dark_all/{z}/{x}/{y}.png).
function tileZXY(url) {
  var m = url.pathname.match(/\/(\d+)\/(\d+)\/(\d+)(?:@\dx)?\.png$/);
  return m ? { z: m[1], x: m[2], y: m[3] } : null;
}
// Esri World Dark Gray Base — free, no key, dark. Note z/y/x order.
function esriTile(t) {
  return "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/" +
    t.z + "/" + t.y + "/" + t.x;
}
// OpenStreetMap standard — free, no key (fallback).
function osmTile(t) {
  return "https://tile.openstreetmap.org/" + t.z + "/" + t.x + "/" + t.y + ".png";
}
function fetchCorsOk(u) {
  return fetch(u, { mode: "cors" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r; });
}
function serveTile(request, url) {
  var t = tileZXY(url);
  if (!t) return fetch(request);
  return caches.open(TILE_CACHE).then(function (cache) {
    return cache.match(request).then(function (hit) {
      if (hit) return hit;
      // CORS first (lets us cache + fall back); if blocked, no-cors still displays.
      return fetchCorsOk(esriTile(t))
        .catch(function () { return fetchCorsOk(osmTile(t)); })
        .then(function (resp) {
          cache.put(request, resp.clone());
          trimCache(TILE_CACHE, TILE_MAX);
          return resp;
        })
        .catch(function () { return fetch(esriTile(t), { mode: "no-cors" }); });
    });
  });
}

self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);

  // Overpass data: always network, never cache (we want fresh results).
  if (/overpass/.test(url.hostname) || /interpreter/.test(url.pathname)) {
    return;
  }

  // Sync API: always network, never cache.
  if (url.pathname.indexOf("/api/") === 0 || /\/api\//.test(url.pathname)) {
    return;
  }

  // Map tiles (requested from CARTO URLs): re-source to a working no-key basemap.
  if (/basemaps\.cartocdn\.com/.test(url.hostname)) {
    e.respondWith(serveTile(e.request, url));
    return;
  }

  // App shell: cache-first, fall back to network.
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      return cached || fetch(e.request);
    })
  );
});
