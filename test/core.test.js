/* Unit tests for the data layer. Run with:  node test/core.test.js
   No dependencies, no network — pure logic checks. */
const C = require("../app-core.js");
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log("  FAIL:", name); } }

// Query builder
const bbox = { south: 35.655, west: 139.695, north: 35.665, east: 139.705 };
const q = C.buildOverpassQuery(bbox);
ok("query has smoking_area", q.includes('["amenity"="smoking_area"]'));
ok("query has smoking=yes", q.includes('["smoking"="yes"]'));
ok("query has smoking=dedicated", q.includes('["smoking"="dedicated"]'));
ok("query has bbox", q.includes("35.655,139.695,35.665,139.705"));
ok("query has out center", q.includes("out center tags"));

// Categorize
ok("cat public", C.categorize({ amenity: "smoking_area" }) === "public");
ok("cat business yes", C.categorize({ amenity: "cafe", smoking: "yes" }) === "business");
ok("cat business outside", C.categorize({ smoking: "outside" }) === "business");
ok("cat ignore smoking=no", C.categorize({ amenity: "cafe", smoking: "no" }) === null);
ok("cat ignore unrelated", C.categorize({ amenity: "bank" }) === null);

// Parse mixed response
const sample = { elements: [
  { type: "node", id: 1, lat: 35.66, lon: 139.70, tags: { amenity: "smoking_area", covered: "yes" } },
  { type: "way", id: 2, center: { lat: 35.661, lon: 139.701 }, tags: { amenity: "cafe", smoking: "dedicated", name: "Cafe Smoke", "name:en": "Cafe Smoke EN", opening_hours: "10:00-22:00" } },
  { type: "node", id: 1, lat: 35.66, lon: 139.70, tags: { amenity: "smoking_area" } }, // dup
  { type: "node", id: 3, lat: 35.662, lon: 139.702, tags: { amenity: "bank" } },        // ignore
  { type: "node", id: 4, tags: { smoking: "yes" } },                                      // no coords
  { type: "node", id: 5, lat: 35.663, lon: 139.703, tags: { smoking: "separated", shop: "tobacco" } },
]};
const spots = C.parseElements(sample);
ok("parse count = 3", spots.length === 3);
const byId = Object.fromEntries(spots.map(s => [s.id, s]));
ok("public name fallback", byId["node/1"].name === "Public smoking area");
ok("public category", byId["node/1"].category === "public");
ok("covered detail", byId["node/1"].details.some(d => /Covered/.test(d)));
ok("business prefers name:en", byId["way/2"].name === "Cafe Smoke EN");
ok("business category", byId["way/2"].category === "business");
ok("business hours detail", byId["way/2"].details.some(d => d.includes("10:00-22:00")));
ok("business type cafe", byId["way/2"].details.some(d => d.includes("Cafe")));
ok("tobacco shop kind", byId["node/5"].details.some(d => d.includes("Tobacco shop")));
ok("way center coords used", byId["way/2"].lat === 35.661 && byId["way/2"].lng === 139.701);

// Deep links
const a = C.appleMapsUrl(35.66, 139.70);
ok("apple maps host", a.startsWith("https://maps.apple.com/?daddr=35.66,139.7"));
ok("apple walking flag", a.includes("dirflg=w"));
const g = C.googleMapsUrl(35.66, 139.70);
ok("google dir api", g.includes("/maps/dir/?api=1"));
ok("google destination", g.includes("destination=35.66,139.7"));
ok("google walking", g.includes("travelmode=walking"));

// parseLatLng
ok("latlng basic", JSON.stringify(C.parseLatLng("35.66, 139.70")) === JSON.stringify({ lat: 35.66, lng: 139.7 }));
ok("latlng no space", JSON.stringify(C.parseLatLng("35.66,139.70")) === JSON.stringify({ lat: 35.66, lng: 139.7 }));
ok("latlng negative", JSON.stringify(C.parseLatLng("-33.86,151.2")) === JSON.stringify({ lat: -33.86, lng: 151.2 }));
ok("latlng rejects words", C.parseLatLng("Shibuya, Tokyo") === null);
ok("latlng rejects out-of-range", C.parseLatLng("200,300") === null);
ok("latlng rejects empty", C.parseLatLng("") === null);

// nominatimUrl
const nu = C.nominatimUrl("Shibuya, Tokyo");
ok("nominatim host", nu.startsWith("https://nominatim.openstreetmap.org/search?"));
ok("nominatim json", nu.includes("format=json"));
ok("nominatim encodes query", nu.includes("q=Shibuya%2C%20Tokyo"));

// parseGeocode
const geo = C.parseGeocode([{ lat: "35.6595", lon: "139.7005", display_name: "Shibuya" }]);
ok("geocode lat", geo.lat === 35.6595);
ok("geocode lng", geo.lng === 139.7005);
ok("geocode name", geo.name === "Shibuya");
ok("geocode empty -> null", C.parseGeocode([]) === null);
ok("geocode bad -> null", C.parseGeocode([{ lat: "x", lon: "y" }]) === null);

// Distance
const d = C.distanceMeters({ lat: 35.6595, lng: 139.7005 }, { lat: 35.6595, lng: 139.7050 });
ok("distance ~407m", Math.abs(d - 407) < 40);
ok("format m", C.formatDistance(420) === "420 m away");
ok("format km", C.formatDistance(1500) === "1.5 km away");

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
