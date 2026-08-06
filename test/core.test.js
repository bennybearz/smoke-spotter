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
ok("latlng space separated", JSON.stringify(C.parseLatLng("35.66 139.70")) === JSON.stringify({ lat: 35.66, lng: 139.7 }));
ok("latlng comma+space", JSON.stringify(C.parseLatLng("35.66 , 139.70")) === JSON.stringify({ lat: 35.66, lng: 139.7 }));
ok("latlng multi-space", JSON.stringify(C.parseLatLng("35.66   139.70")) === JSON.stringify({ lat: 35.66, lng: 139.7 }));
ok("latlng neg space", JSON.stringify(C.parseLatLng("-33.86 151.2")) === JSON.stringify({ lat: -33.86, lng: 151.2 }));
ok("latlng high precision comma-space", JSON.stringify(C.parseLatLng("35.70034380, 139.66725540")) === JSON.stringify({ lat: 35.7003438, lng: 139.6672554 }));
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

// Japan-aware geocoding
const jpAddr = "申ブリリア中野, 23-10, Chuo 5-Chōme\nNakano, Tokyo\nJapan 164-0011";
ok("normalizeQuery collapses newlines/spaces", C.normalizeQuery(jpAddr) === "申ブリリア中野, 23-10, Chuo 5-Chōme Nakano, Tokyo Japan 164-0011");
ok("hasJapanese true", C.hasJapanese(jpAddr) === true);
ok("hasJapanese false", C.hasJapanese("Shibuya, Tokyo") === false);
ok("extractJpPostal hyphen", C.extractJpPostal(jpAddr) === "164-0011");
ok("extractJpPostal 7-digit", C.extractJpPostal("Chuo, Nakano 1640011") === "164-0011");
ok("extractJpPostal none", C.extractJpPostal("Shibuya Crossing") === null);
ok("extractJpPostal ignores block 23-10", C.extractJpPostal("23-10 only") === null);
ok("stripLeadingSegment drops building", C.stripLeadingSegment("Brillia, 23-10, Chuo, Tokyo") === "23-10, Chuo, Tokyo");
ok("stripLeadingSegment single -> null", C.stripLeadingSegment("Tokyo") === null);
const gsiu = C.gsiUrl("東京都中野区中央5-23-10");
ok("gsi host", gsiu.startsWith("https://msearch.gsi.go.jp/address-search/AddressSearch?q="));
const gg = C.parseGsi([{ geometry: { coordinates: [139.6672, 35.7003] }, properties: { title: "中央五丁目" } }]);
ok("parseGsi lat/lng (lng,lat order)", gg.lat === 35.7003 && gg.lng === 139.6672);
ok("parseGsi name", gg.name === "中央五丁目");
ok("parseGsi empty -> null", C.parseGsi([]) === null);
ok("parseGeoResult routes gsi", C.parseGeoResult("gsi", [{ geometry: { coordinates: [139, 35] } }]).lat === 35);
ok("parseGeoResult routes nominatim", C.parseGeoResult("nominatim", [{ lat: "35", lon: "139" }]).lng === 139);
const nq = C.nominatimPostalUrl("164-0011");
ok("nominatim postal url", nq.includes("postalcode=164-0011") && nq.includes("countrycodes=jp"));
// geocodeQueries: JP address -> GSI first, then OSM full, stripped, postal
const gq = C.geocodeQueries(jpAddr);
ok("geocodeQueries first is gsi", gq[0].kind === "gsi");
ok("geocodeQueries includes postal fallback", gq.some(a => a.url.includes("postalcode=164-0011")));
ok("geocodeQueries includes stripped", gq.some(a => a.kind === "nominatim" && /23-10/.test(decodeURIComponent(a.url)) && !/ブリリア/.test(decodeURIComponent(a.url))));
// non-Japanese query -> no GSI attempt
const gq2 = C.geocodeQueries("Shibuya Crossing, Tokyo");
ok("geocodeQueries no gsi for romaji", gq2.every(a => a.kind === "nominatim"));
// Japanese landmark NAME (no digits) -> no GSI first (avoids wrong-prefecture match)
const gq3 = C.geocodeQueries("渋谷スクランブル交差点");
ok("geocodeQueries no gsi for JP name w/o digits", gq3.every(a => a.kind === "nominatim"));
// Clean Japanese ADDRESS (has digits) -> GSI first
const gq4 = C.geocodeQueries("東京都中野区中央5-23-10");
ok("geocodeQueries gsi first for JP address", gq4[0].kind === "gsi");

// panDelta — popup positioning relative to reserved overlay zones
const cont = { top: 0, left: 0, width: 400, height: 800 };
const reserve = { top: 120, bottom: 90, left: 6, right: 6, pad: 10 };
// fully clear -> no movement
ok("panDelta clear", JSON.stringify(C.panDelta({ top: 300, bottom: 450, left: 100, right: 300 }, cont, reserve)) === JSON.stringify({ dx: 0, dy: 0 }));
// popup under the header (top=40) -> push content DOWN
const pd1 = C.panDelta({ top: 40, bottom: 240, left: 100, right: 300 }, cont, reserve);
ok("panDelta top clipped -> dy down", pd1.dy === (120 + 10) - 40 && pd1.dy > 0);
ok("panDelta top clipped -> dx 0", pd1.dx === 0);
// popup below the bottom controls -> push content UP (negative dy)
const pd2 = C.panDelta({ top: 600, bottom: 760, left: 100, right: 300 }, cont, reserve);
ok("panDelta bottom clipped -> dy up", pd2.dy < 0);
// popup off the right edge -> push content LEFT (negative dx)
const pd3 = C.panDelta({ top: 300, bottom: 450, left: 260, right: 410 }, cont, reserve);
ok("panDelta right clipped -> dx left", pd3.dx < 0);
// popup off the left edge -> push content RIGHT (positive dx)
const pd4 = C.panDelta({ top: 300, bottom: 450, left: -10, right: 140 }, cont, reserve);
ok("panDelta left clipped -> dx right", pd4.dx > 0);

// Distance
const d = C.distanceMeters({ lat: 35.6595, lng: 139.7005 }, { lat: 35.6595, lng: 139.7050 });
ok("distance ~407m", Math.abs(d - 407) < 40);
ok("format m", C.formatDistance(420) === "420 m away");
ok("format km", C.formatDistance(1500) === "1.5 km away");

// --- User-saved spots -------------------------------------------------------

// makeSpotId — deterministic given its inputs, and unique across calls
ok("makeSpotId prefixed", C.makeSpotId(1000, 0.5).startsWith("mine-"));
ok("makeSpotId deterministic", C.makeSpotId(1754500000000, 0.42) === C.makeSpotId(1754500000000, 0.42));
ok("makeSpotId varies by time", C.makeSpotId(1000, 0.5) !== C.makeSpotId(1001, 0.5));
ok("makeSpotId varies by rand", C.makeSpotId(1000, 0.5) !== C.makeSpotId(1000, 0.6));

// normalizeMySpot — accepts good records, rejects/repairs bad ones
const goodRaw = { id: "mine-a", lat: 35.66, lng: 139.7, name: "Station east exit", photo: "data:image/jpeg;base64,AAA", savedAt: 1754500000000, accuracy: 8.4 };
const good = C.normalizeMySpot(goodRaw);
ok("normalize keeps coords", good.lat === 35.66 && good.lng === 139.7);
ok("normalize keeps name", good.name === "Station east exit");
ok("normalize keeps data-url photo", good.photo === "data:image/jpeg;base64,AAA");
ok("normalize rounds accuracy", good.accuracy === 8);
ok("normalize no id -> null", C.normalizeMySpot({ lat: 35, lng: 139 }) === null);
ok("normalize bad coords -> null", C.normalizeMySpot({ id: "x", lat: "abc", lng: 139 }) === null);
ok("normalize out-of-range -> null", C.normalizeMySpot({ id: "x", lat: 200, lng: 139 }) === null);
ok("normalize non-object -> null", C.normalizeMySpot("nope") === null);
ok("normalize null -> null", C.normalizeMySpot(null) === null);
ok("normalize blank name -> default", C.normalizeMySpot({ id: "x", lat: 35, lng: 139, name: "   " }).name === "My smoking spot");
ok("normalize missing name -> default", C.normalizeMySpot({ id: "x", lat: 35, lng: 139 }).name === "My smoking spot");
ok("normalize trims name", C.normalizeMySpot({ id: "x", lat: 35, lng: 139, name: "  Alley  " }).name === "Alley");
ok("normalize caps name length", C.normalizeMySpot({ id: "x", lat: 35, lng: 139, name: "z".repeat(200) }).name.length === C.MAX_SPOT_NAME);
// a non-data URL in storage must never reach an <img src>
ok("normalize rejects http photo", C.normalizeMySpot({ id: "x", lat: 35, lng: 139, photo: "http://evil/x.png" }).photo === null);
ok("normalize rejects js photo", C.normalizeMySpot({ id: "x", lat: 35, lng: 139, photo: "javascript:alert(1)" }).photo === null);
ok("normalize missing photo -> null", C.normalizeMySpot({ id: "x", lat: 35, lng: 139 }).photo === null);
ok("normalize missing accuracy -> null", C.normalizeMySpot({ id: "x", lat: 35, lng: 139 }).accuracy === null);
ok("normalize coerces numeric strings", C.normalizeMySpot({ id: "x", lat: "35.5", lng: "139.5" }).lat === 35.5);

// parseMySpots — tolerant of anything localStorage might hold
ok("parse round-trips", C.parseMySpots(C.serializeMySpots([good])).length === 1);
ok("parse bad json -> []", C.parseMySpots("{not json").length === 0);
ok("parse null -> []", C.parseMySpots(null).length === 0);
ok("parse non-array -> []", C.parseMySpots('{"a":1}').length === 0);
ok("parse drops invalid entries", C.parseMySpots('[{"id":"a","lat":35,"lng":139},{"lat":1}]').length === 1);
ok("parse de-dupes by id", C.parseMySpots('[{"id":"a","lat":35,"lng":139},{"id":"a","lat":36,"lng":140}]').length === 1);

// upsert / remove — immutable list operations
const list0 = [];
const list1 = C.upsertMySpot(list0, { id: "a", lat: 35, lng: 139, name: "A" });
ok("upsert adds", list1.length === 1 && list1[0].name === "A");
ok("upsert does not mutate input", list0.length === 0);
const list2 = C.upsertMySpot(list1, { id: "b", lat: 36, lng: 140, name: "B" });
ok("upsert appends second", list2.length === 2);
const list3 = C.upsertMySpot(list2, { id: "a", lat: 35, lng: 139, name: "A renamed" });
ok("upsert replaces same id", list3.length === 2);
ok("upsert applies new value", list3.filter(s => s.id === "a")[0].name === "A renamed");
ok("upsert rejects invalid spot", C.upsertMySpot(list2, { lat: 1 }).length === 2);
ok("remove drops by id", C.removeMySpot(list2, "a").length === 1);
ok("remove leaves others", C.removeMySpot(list2, "a")[0].id === "b");
ok("remove unknown id is a no-op", C.removeMySpot(list2, "zzz").length === 2);
ok("remove does not mutate input", list2.length === 2);

// formatSavedAt — local time, stable regardless of the runner's timezone
const stamp = new Date(2026, 7, 6, 14, 32).getTime(); // 2026-08-06 14:32 local
ok("formatSavedAt local", C.formatSavedAt(stamp) === "2026-08-06 14:32");
ok("formatSavedAt pads", C.formatSavedAt(new Date(2026, 0, 3, 9, 5).getTime()) === "2026-01-03 09:05");
ok("formatSavedAt 0 -> empty", C.formatSavedAt(0) === "");

// mySpotToMarker — renders through the same path as OSM spots
const marker = C.mySpotToMarker(good);
ok("marker category mine", marker.category === "mine");
ok("marker mine flag", marker.mine === true);
ok("marker carries photo", marker.photo === good.photo);
ok("marker keeps coords", marker.lat === 35.66 && marker.lng === 139.7);
ok("marker details has saved date", marker.details.some(d => /^Saved \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(d)));
ok("marker details has accuracy", marker.details.some(d => d.includes("±8 m")));
ok("marker details omit unknown accuracy", C.mySpotToMarker(C.normalizeMySpot({ id: "x", lat: 35, lng: 139 })).details.every(d => !d.includes("±")));
// 'mine' must stay ours — OSM tags can never produce it
ok("categorize never returns mine", C.categorize({ amenity: "smoking_area" }) !== "mine");

// photoScaleDims — downscale to fit a box, preserve aspect, never upscale
ok("scale landscape", JSON.stringify(C.photoScaleDims(4000, 3000, 720)) === JSON.stringify({ w: 720, h: 540 }));
ok("scale portrait", JSON.stringify(C.photoScaleDims(3000, 4000, 720)) === JSON.stringify({ w: 540, h: 720 }));
ok("scale square", JSON.stringify(C.photoScaleDims(2000, 2000, 720)) === JSON.stringify({ w: 720, h: 720 }));
ok("scale leaves small image alone", JSON.stringify(C.photoScaleDims(300, 200, 720)) === JSON.stringify({ w: 300, h: 200 }));
ok("scale never upscales", C.photoScaleDims(100, 100, 720).w === 100);
ok("scale extreme panorama keeps >=1px", C.photoScaleDims(10000, 3, 720).h >= 1);
ok("scale zero -> null", C.photoScaleDims(0, 100, 720) === null);
ok("scale non-numeric -> null", C.photoScaleDims("x", 100, 720) === null);

// sortMySpots — nearest-first with an origin, newest-first without
const far = C.normalizeMySpot({ id: "far", lat: 35.70, lng: 139.75, savedAt: 3000 });
const near = C.normalizeMySpot({ id: "near", lat: 35.6596, lng: 139.7006, savedAt: 1000 });
const mid = C.normalizeMySpot({ id: "mid", lat: 35.67, lng: 139.71, savedAt: 2000 });
const origin = { lat: 35.6595, lng: 139.7005 };
ok("sort nearest first", C.sortMySpots([far, mid, near], origin).map(s => s.id).join(",") === "near,mid,far");
ok("sort newest first w/o origin", C.sortMySpots([near, far, mid], null).map(s => s.id).join(",") === "far,mid,near");
ok("sort does not mutate input", (() => { const src = [far, near]; C.sortMySpots(src, origin); return src[0].id === "far"; })());
ok("sort empty is safe", C.sortMySpots([], origin).length === 0);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
