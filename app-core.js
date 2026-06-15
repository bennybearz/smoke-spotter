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
    categorize: categorize,
    venueKind: venueKind,
    displayName: displayName,
    detailLines: detailLines,
    parseElements: parseElements,
    appleMapsUrl: appleMapsUrl,
    googleMapsUrl: googleMapsUrl,
    distanceMeters: distanceMeters,
    formatDistance: formatDistance,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.SmokeCore = api;
  }
})(typeof self !== "undefined" ? self : this);
