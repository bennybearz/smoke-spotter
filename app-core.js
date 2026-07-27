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
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.SmokeCore = api;
  }
})(typeof self !== "undefined" ? self : this);
