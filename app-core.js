/*
 * app-core.js — pure data logic for Smoke Spotter JP.
 * No DOM here, so it can be unit-tested in Node and reused by the page.
 * Exposes globalThis.SmokeCore in the browser, module.exports in Node.
 */
(function (global) {
  "use strict";

  // OSM smoking=* values that mean "you can smoke here" (a venue allows it).
  var POSITIVE_SMOKING = ["yes", "dedicated", "outside", "isolated", "separated"];

  // Build an Overpass QL query for a bounding box.
  // bbox = {south, west, north, east}
  function buildOverpassQuery(bbox) {
    var bb = [bbox.south, bbox.west, bbox.north, bbox.east].join(",");
    var lines = [];
    // Public designated smoking areas.
    lines.push('  nwr["amenity"="smoking_area"](' + bb + ");");
    // Businesses / venues where smoking is allowed.
    POSITIVE_SMOKING.forEach(function (v) {
      lines.push('  nwr["smoking"="' + v + '"](' + bb + ");");
    });
    return (
      "[out:json][timeout:25];\n(\n" + lines.join("\n") + "\n);\nout center tags;"
    );
  }

  function isPositiveSmoking(v) {
    return POSITIVE_SMOKING.indexOf(v) !== -1;
  }

  // Classify a single OSM element into 'public' or 'business' (or null = ignore).
  function categorize(tags) {
    if (!tags) return null;
    if (tags.amenity === "smoking_area") return "public";
    if (isPositiveSmoking(tags.smoking)) return "business";
    return null;
  }

  // Human-readable venue kind from common OSM tags.
  function venueKind(tags) {
    var map = {
      cafe: "Cafe",
      bar: "Bar",
      pub: "Pub",
      restaurant: "Restaurant",
      fast_food: "Fast food",
      nightclub: "Nightclub",
      biergarten: "Beer garden",
      hookah_lounge: "Shisha lounge",
    };
    if (tags.amenity && map[tags.amenity]) return map[tags.amenity];
    if (tags.shop === "tobacco") return "Tobacco shop";
    if (tags.shop) return "Shop";
    if (tags.leisure) return "Venue";
    if (tags.tourism === "hotel") return "Hotel";
    return "Smoking-friendly venue";
  }

  function displayName(tags, category) {
    var n = (tags && (tags["name:en"] || tags.name)) || "";
    if (n) return n;
    return category === "public" ? "Public smoking area" : "Smoking-friendly venue";
  }

  // Extra human-readable detail lines for the info popup.
  function detailLines(tags, category) {
    var out = [];
    if (!tags) return out;
    if (category === "business") out.push("Type: " + venueKind(tags));
    if (tags.smoking) out.push("Smoking: " + tags.smoking);
    if (tags.operator) out.push("Operator: " + tags.operator);
    if (tags.opening_hours) out.push("Hours: " + tags.opening_hours);
    if (tags.covered === "yes" || tags.shelter === "yes") out.push("Covered / sheltered");
    if (tags["smoking:heated_tobacco"]) out.push("Heated tobacco: " + tags["smoking:heated_tobacco"]);
    if (tags.cuisine) out.push("Cuisine: " + tags.cuisine.replace(/_/g, " "));
    return out;
  }

  function coordsOf(el) {
    if (typeof el.lat === "number" && typeof el.lon === "number") {
      return { lat: el.lat, lng: el.lon };
    }
    if (el.center && typeof el.center.lat === "number") {
      return { lat: el.center.lat, lng: el.center.lon };
    }
    return null;
  }

  // Turn raw Overpass JSON into clean marker objects. De-dupes by type+id.
  function parseElements(json) {
    var els = (json && json.elements) || [];
    var seen = {};
    var out = [];
    els.forEach(function (el) {
      var tags = el.tags || {};
      var category = categorize(tags);
      if (!category) return;
      var c = coordsOf(el);
      if (!c) return;
      var key = el.type + "/" + el.id;
      if (seen[key]) return;
      seen[key] = true;
      out.push({
        id: key,
        lat: c.lat,
        lng: c.lng,
        category: category, // 'public' | 'business'
        name: displayName(tags, category),
        details: detailLines(tags, category),
      });
    });
    return out;
  }

  // Parse a "lat,lng" string into coords, or null if not valid coordinates.
  // Accepts comma and/or whitespace as the separator: "35.6,139.7",
  // "35.6, 139.7", and "35.6 139.7" all work.
  function parseLatLng(str) {
    if (!str) return null;
    var m = String(str).trim().match(/^(-?\d+(?:\.\d+)?)(?:\s*,\s*|\s+)(-?\d+(?:\.\d+)?)$/);
    if (!m) return null;
    var lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat: lat, lng: lng };
  }

  // Build a free Nominatim (OpenStreetMap) geocoding URL for a place query.
  function nominatimUrl(query) {
    return (
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=en&q=" +
      encodeURIComponent(query)
    );
  }

  // Parse the first Nominatim result into {lat, lng, name}, or null.
  function parseGeocode(json) {
    if (!Array.isArray(json) || !json.length) return null;
    var r = json[0];
    var lat = parseFloat(r.lat), lng = parseFloat(r.lon);
    if (isNaN(lat) || isNaN(lng)) return null;
    return { lat: lat, lng: lng, name: r.display_name || "" };
  }

  // --- Japan-aware geocoding ------------------------------------------------
  // Japanese addresses geocode poorly as one messy string (building name +
  // block number + romanized district + postal code). We try several
  // progressively-simpler queries across two geocoders until one resolves.

  function normalizeQuery(str) {
    return String(str || "").replace(/\s+/g, " ").trim();
  }

  function hasJapanese(str) {
    return /[぀-ヿ㐀-鿿ｦ-ﾟ]/.test(String(str || ""));
  }

  // Extract a Japanese postal code (NNN-NNNN or NNNNNNN) -> "NNN-NNNN" or null.
  function extractJpPostal(str) {
    var m = String(str || "").match(/(\d{3})-?(\d{4})(?!\d)/);
    return m ? m[1] + "-" + m[2] : null;
  }

  // Drop the first comma-separated segment (usually a building name that no
  // geocoder can match) -> the rest, or null if there's only one segment.
  function stripLeadingSegment(str) {
    var parts = String(str || "").split(",");
    if (parts.length < 2) return null;
    return parts.slice(1).join(",").replace(/\s+/g, " ").trim();
  }

  // GSI (Geospatial Information Authority of Japan) address search — far better
  // than OSM for Japanese-script addresses. Returns a bare array of features.
  function gsiUrl(query) {
    return "https://msearch.gsi.go.jp/address-search/AddressSearch?q=" +
      encodeURIComponent(query);
  }

  function parseGsi(json) {
    if (!Array.isArray(json) || !json.length) return null;
    var f = json[0];
    var c = f && f.geometry && f.geometry.coordinates;
    if (!c || c.length < 2) return null;
    var lng = parseFloat(c[0]), lat = parseFloat(c[1]);
    if (isNaN(lat) || isNaN(lng)) return null;
    return { lat: lat, lng: lng, name: (f.properties && f.properties.title) || "" };
  }

  // Structured Nominatim lookup by Japanese postal code (reliable neighborhood).
  function nominatimPostalUrl(postal) {
    return "https://nominatim.openstreetmap.org/search?format=json&limit=1" +
      "&countrycodes=jp&postalcode=" + encodeURIComponent(postal);
  }

  // Ordered list of geocoding attempts for a raw address; first hit wins.
  function geocodeQueries(raw) {
    var q = normalizeQuery(raw);
    var list = [];
    if (!q) return list;
    // GSI excels at structured Japanese ADDRESSES but mis-handles bare
    // place/landmark names (can match the wrong prefecture). Only try it first
    // when the query looks address-like: Japanese text with a number in it.
    if (hasJapanese(q) && /\d/.test(q)) list.push({ kind: "gsi", url: gsiUrl(q) });
    list.push({ kind: "nominatim", url: nominatimUrl(q) });
    var stripped = stripLeadingSegment(q);
    if (stripped && stripped !== q) {
      list.push({ kind: "nominatim", url: nominatimUrl(stripped + ", Japan") });
    }
    var postal = extractJpPostal(q);
    if (postal) list.push({ kind: "nominatim", url: nominatimPostalUrl(postal) });
    return list;
  }

  // Parse a geocoder response by its kind.
  function parseGeoResult(kind, json) {
    return kind === "gsi" ? parseGsi(json) : parseGeocode(json);
  }

  // Apple Maps walking-directions deep link (opens Apple Maps app on iOS).
  function appleMapsUrl(lat, lng) {
    return "https://maps.apple.com/?daddr=" + lat + "," + lng + "&dirflg=w";
  }

  // Google Maps walking-directions deep link (opens Google Maps app if installed).
  function googleMapsUrl(lat, lng) {
    return (
      "https://www.google.com/maps/dir/?api=1&destination=" +
      lat +
      "," +
      lng +
      "&travelmode=walking"
    );
  }

  // Work out how far to move the map so an open popup clears the overlay UI.
  // `popup` and `container` are getBoundingClientRect-style boxes (viewport coords).
  // `reserve` = pixels to keep clear inside the container on each edge (+ pad).
  // Returns { dx, dy } = how far the map CONTENT should move; caller does
  // map.panBy([-dx, -dy]).
  function panDelta(popup, container, reserve) {
    var pad = (reserve && reserve.pad) || 8;
    var rTop = (reserve && reserve.top) || 0;
    var rBottom = (reserve && reserve.bottom) || 0;
    var rLeft = (reserve && reserve.left) || 0;
    var rRight = (reserve && reserve.right) || 0;
    var H = container.height, W = container.width;
    var topIn = popup.top - container.top;
    var botIn = popup.bottom - container.top;
    var leftIn = popup.left - container.left;
    var rightIn = popup.right - container.left;
    var dx = 0, dy = 0;
    if (topIn < rTop + pad) dy = (rTop + pad) - topIn;            // move content down
    else if (botIn > H - rBottom - pad) dy = (H - rBottom - pad) - botIn; // up
    if (leftIn < rLeft + pad) dx = (rLeft + pad) - leftIn;        // right
    else if (rightIn > W - rRight - pad) dx = (W - rRight - pad) - rightIn; // left
    return { dx: dx, dy: dy };
  }

  // --- User-saved spots ------------------------------------------------------
  // Spots the user pins themselves ("I'm standing in one right now"), stored in
  // localStorage so they survive a reload and work with no network. Kept here,
  // away from the DOM, so the storage format is unit-tested.
  //
  // Record shape:
  //   { id, lat, lng, name, photo, hasPhoto, savedAt, accuracy, updatedAt, deleted }
  //   photo     = a data: URL (already downscaled by the page), or null
  //   hasPhoto  = a photo exists somewhere, even if this device hasn't fetched
  //               it yet — the sync pull deliberately omits photo bodies
  //   savedAt   = epoch ms the spot was first pinned
  //   accuracy  = GPS accuracy in metres, or null if unknown
  //   updatedAt = epoch ms of the last change; the last-write-wins sync key
  //   deleted   = tombstone. Deletes have to be recorded rather than dropped,
  //               or another device would just sync the spot back.

  var MY_SPOTS_KEY = "smokespotter.mySpots.v1";
  var TRIP_CODE_KEY = "smokespotter.tripCode.v1";
  var SYNC_CURSOR_KEY = "smokespotter.syncCursor.v1";
  var DIRTY_KEY = "smokespotter.dirty.v1";
  var MAX_SPOT_NAME = 80;
  // How long a tombstone is kept before being purged. Long enough that a phone
  // left in a drawer for a month still learns about the delete.
  var TOMBSTONE_TTL_MS = 45 * 24 * 60 * 60 * 1000;

  // Deterministic given its inputs, so it can be tested. The page passes
  // Date.now() and Math.random().
  function makeSpotId(now, rand) {
    var t = Math.floor(Number(now) || 0).toString(36);
    var r = Math.floor(Math.abs(Number(rand) || 0) * 1e9).toString(36);
    return "mine-" + t + "-" + r;
  }

  // Coerce one stored record into a clean spot, or null if it's unusable.
  // Defensive because localStorage can hold anything a previous version wrote.
  function normalizeMySpot(raw) {
    if (!raw || typeof raw !== "object") return null;
    var id = raw.id ? String(raw.id) : "";
    if (!id) return null;
    var lat = Number(raw.lat), lng = Number(raw.lng);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    var name = String(raw.name == null ? "" : raw.name).trim().slice(0, MAX_SPOT_NAME);
    if (!name) name = "My smoking spot";
    // Only accept inline image data — never an arbitrary URL from storage.
    var photo = typeof raw.photo === "string" && /^data:image\//.test(raw.photo)
      ? raw.photo : null;
    var savedAt = Number(raw.savedAt);
    if (!isFinite(savedAt) || savedAt <= 0) savedAt = 0;
    var acc = Number(raw.accuracy);
    // Records written before sync existed have no updatedAt; treat the moment
    // they were saved as their last change so they merge sanely.
    var updatedAt = Number(raw.updatedAt);
    if (!isFinite(updatedAt) || updatedAt <= 0) updatedAt = savedAt;
    var deleted = raw.deleted === true || raw.deleted === 1;
    return {
      id: id,
      lat: lat,
      lng: lng,
      name: name,
      photo: deleted ? null : photo,
      // A pulled record carries hasPhoto without the bytes; holding a photo
      // implies it too.
      hasPhoto: deleted ? false : (!!photo || raw.hasPhoto === true || raw.hasPhoto === 1),
      savedAt: savedAt,
      accuracy: isFinite(acc) && acc >= 0 ? Math.round(acc) : null,
      updatedAt: updatedAt,
      deleted: deleted,
    };
  }

  // Read the stored JSON string -> clean array. Never throws; bad data = [].
  function parseMySpots(text) {
    var arr;
    try {
      arr = JSON.parse(text);
    } catch (e) {
      return [];
    }
    if (!Array.isArray(arr)) return [];
    var seen = {};
    var out = [];
    arr.forEach(function (raw) {
      var s = normalizeMySpot(raw);
      if (!s || seen[s.id]) return;
      seen[s.id] = true;
      out.push(s);
    });
    return out;
  }

  function serializeMySpots(list) {
    return JSON.stringify(list || []);
  }

  // Add a spot, or replace the existing one with the same id. Returns a new
  // array (never mutates), newest last.
  function upsertMySpot(list, spot) {
    var s = normalizeMySpot(spot);
    if (!s) return (list || []).slice();
    var out = (list || []).filter(function (x) { return x.id !== s.id; });
    out.push(s);
    return out;
  }

  function removeMySpot(list, id) {
    return (list || []).filter(function (x) { return x.id !== id; });
  }

  // Local-time "YYYY-MM-DD HH:MM". Deliberately not toLocaleString(), which
  // varies by device locale and would make this untestable.
  function formatSavedAt(ts) {
    if (!ts) return "";
    var d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function mySpotDetails(s) {
    var out = [];
    if (s.savedAt) out.push("Saved " + formatSavedAt(s.savedAt));
    if (s.accuracy != null) out.push("GPS accuracy ±" + s.accuracy + " m");
    return out;
  }

  // Present a saved spot in the same shape as an Overpass spot, so the map and
  // popup code can render both through one path. Category 'mine' is ours alone
  // — categorize() never returns it, since OSM data can't be user-saved.
  function mySpotToMarker(s) {
    return {
      id: s.id,
      lat: s.lat,
      lng: s.lng,
      category: "mine",
      name: s.name,
      details: mySpotDetails(s),
      photo: s.photo,
      hasPhoto: s.hasPhoto,
      savedAt: s.savedAt,
      mine: true,
    };
  }

  // Target dimensions for a downscaled photo, preserving aspect ratio.
  // Images already within `max` are left alone (never upscale).
  function photoScaleDims(w, h, max) {
    w = Number(w); h = Number(h); max = Number(max);
    if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return null;
    if (!isFinite(max) || max <= 0) return null;
    if (w <= max && h <= max) return { w: Math.round(w), h: Math.round(h) };
    var s = Math.min(max / w, max / h);
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
  }

  // Sort saved spots for the "my spots" list: nearest first when we know where
  // the user is, otherwise newest first. Returns a new array.
  function sortMySpots(list, origin) {
    var out = (list || []).slice();
    if (origin && isFinite(origin.lat) && isFinite(origin.lng)) {
      out.sort(function (a, b) {
        return distanceMeters(origin, a) - distanceMeters(origin, b);
      });
    } else {
      out.sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
    }
    return out;
  }

  // --- Cross-device sync -----------------------------------------------------
  // Spots live in localStorage and are mirrored to a shared "trip" bucket, so
  // the same list shows up on your phone and your laptop. The local copy stays
  // the source of truth for rendering: the map must work with no signal, so the
  // network is a background mirror, never something the UI waits on.

  function cloneSpot(s) {
    var out = {};
    for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) out[k] = s[k];
    return out;
  }

  // Tombstones are kept in storage but never shown.
  function activeSpots(list) {
    return (list || []).filter(function (s) { return !s.deleted; });
  }

  // Soft delete. Drops the photo (a tombstone needs no bytes) and stamps
  // updatedAt so the delete beats the older record on other devices.
  function markSpotDeleted(list, id, now) {
    return (list || []).map(function (s) {
      if (s.id !== id) return s;
      var t = cloneSpot(s);
      t.deleted = true;
      t.photo = null;
      t.hasPhoto = false;
      t.updatedAt = Number(now) || 0;
      return t;
    });
  }

  function purgeTombstones(list, now, ttlMs) {
    var ttl = isFinite(ttlMs) ? ttlMs : TOMBSTONE_TTL_MS;
    return (list || []).filter(function (s) {
      return !s.deleted || (Number(now) || 0) - (s.updatedAt || 0) < ttl;
    });
  }

  // Trip codes are the only secret protecting a bucket, so they're normalised
  // to one canonical form and required to be long enough not to be guessed.
  var TRIP_CODE_RE = /^[a-z0-9][a-z0-9-]{5,39}$/;

  function normalizeTripCode(str) {
    return String(str || "").trim().toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function isValidTripCode(str) {
    return TRIP_CODE_RE.test(normalizeTripCode(str));
  }

  // Deterministic given `rand`, so it can be tested.
  function suggestTripCode(rand) {
    var r = Math.floor(Math.abs(Number(rand) || 0) * 1e12).toString(36);
    while (r.length < 8) r = "0" + r;
    return "trip-" + r.slice(0, 8);
  }

  // Last-write-wins union of two lists, keyed by id.
  // Two subtleties this has to get right:
  //   1. A pulled record has hasPhoto but no photo bytes. If it wins purely on
  //      updatedAt we must NOT let that erase a photo this device already holds.
  //   2. On an exact updatedAt tie a delete wins, otherwise a spot deleted on
  //      one device could flap back and forth between two devices forever.
  function mergeSpotLists(local, remote) {
    var byId = {};
    var order = [];
    function put(raw) {
      var n = normalizeMySpot(raw);
      if (!n) return;
      var cur = byId[n.id];
      if (!cur) { byId[n.id] = n; order.push(n.id); return; }
      var takeNew = n.updatedAt > cur.updatedAt ||
        (n.updatedAt === cur.updatedAt && n.deleted && !cur.deleted);
      var winner = takeNew ? n : cur;
      var other = takeNew ? cur : n;
      var merged = cloneSpot(winner);
      if (!merged.photo && merged.hasPhoto && other.photo) merged.photo = other.photo;
      if (other.hasPhoto && !merged.deleted) merged.hasPhoto = true;
      byId[n.id] = merged;
    }
    (local || []).forEach(put);
    (remote || []).forEach(put);
    return order.map(function (id) { return byId[id]; });
  }

  // Records this device has changed and not yet pushed.
  function pickDirty(list, ids) {
    var want = {};
    (ids || []).forEach(function (id) { want[id] = true; });
    return (list || []).filter(function (s) { return want[s.id]; });
  }

  // The push carries photos (the device that took one is the only source of it).
  // The pull deliberately does not — see syncPullUrl.
  function stripPhotos(list) {
    return (list || []).map(function (s) {
      var c = cloneSpot(s);
      c.photo = null;
      return c;
    });
  }

  function syncPullUrl(trip, since) {
    return "api/spots?trip=" + encodeURIComponent(normalizeTripCode(trip)) +
      "&since=" + (Math.floor(Number(since)) || 0);
  }

  function syncPhotoUrl(trip, id) {
    return "api/photo?trip=" + encodeURIComponent(normalizeTripCode(trip)) +
      "&id=" + encodeURIComponent(id);
  }

  // Returns { spots, now } or null if the response is unusable.
  function parsePullResponse(json) {
    if (!json || json.ok !== true || !Array.isArray(json.spots)) return null;
    var now = Number(json.now);
    var spots = [];
    json.spots.forEach(function (r) {
      var n = normalizeMySpot(r);
      if (n) spots.push(n);
    });
    return { spots: spots, now: isFinite(now) && now > 0 ? now : 0 };
  }

  // Haversine distance in metres, for "X m away" in popups.
  function distanceMeters(a, b) {
    var R = 6371000;
    var dLat = ((b.lat - a.lat) * Math.PI) / 180;
    var dLng = ((b.lng - a.lng) * Math.PI) / 180;
    var la1 = (a.lat * Math.PI) / 180;
    var la2 = (b.lat * Math.PI) / 180;
    var h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function formatDistance(m) {
    if (m == null) return "";
    if (m < 1000) return Math.round(m) + " m away";
    return (m / 1000).toFixed(1) + " km away";
  }

  var api = {
    POSITIVE_SMOKING: POSITIVE_SMOKING,
    buildOverpassQuery: buildOverpassQuery,
    parseLatLng: parseLatLng,
    nominatimUrl: nominatimUrl,
    parseGeocode: parseGeocode,
    normalizeQuery: normalizeQuery,
    hasJapanese: hasJapanese,
    extractJpPostal: extractJpPostal,
    stripLeadingSegment: stripLeadingSegment,
    gsiUrl: gsiUrl,
    parseGsi: parseGsi,
    nominatimPostalUrl: nominatimPostalUrl,
    geocodeQueries: geocodeQueries,
    parseGeoResult: parseGeoResult,
    categorize: categorize,
    venueKind: venueKind,
    displayName: displayName,
    detailLines: detailLines,
    parseElements: parseElements,
    appleMapsUrl: appleMapsUrl,
    googleMapsUrl: googleMapsUrl,
    panDelta: panDelta,
    distanceMeters: distanceMeters,
    formatDistance: formatDistance,
    // user-saved spots
    MY_SPOTS_KEY: MY_SPOTS_KEY,
    MAX_SPOT_NAME: MAX_SPOT_NAME,
    makeSpotId: makeSpotId,
    normalizeMySpot: normalizeMySpot,
    parseMySpots: parseMySpots,
    serializeMySpots: serializeMySpots,
    upsertMySpot: upsertMySpot,
    removeMySpot: removeMySpot,
    formatSavedAt: formatSavedAt,
    mySpotDetails: mySpotDetails,
    mySpotToMarker: mySpotToMarker,
    photoScaleDims: photoScaleDims,
    sortMySpots: sortMySpots,
    // cross-device sync
    TRIP_CODE_KEY: TRIP_CODE_KEY,
    SYNC_CURSOR_KEY: SYNC_CURSOR_KEY,
    DIRTY_KEY: DIRTY_KEY,
    TOMBSTONE_TTL_MS: TOMBSTONE_TTL_MS,
    activeSpots: activeSpots,
    markSpotDeleted: markSpotDeleted,
    purgeTombstones: purgeTombstones,
    normalizeTripCode: normalizeTripCode,
    isValidTripCode: isValidTripCode,
    suggestTripCode: suggestTripCode,
    mergeSpotLists: mergeSpotLists,
    pickDirty: pickDirty,
    stripPhotos: stripPhotos,
    syncPullUrl: syncPullUrl,
    syncPhotoUrl: syncPhotoUrl,
    parsePullResponse: parsePullResponse,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.SmokeCore = api;
  }
})(typeof self !== "undefined" ? self : this);
