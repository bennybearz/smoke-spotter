# 🚬 Smoke Spotter JP

A tiny personal web app (installable as a PWA) for the boys trip — finds nearby
**public smoking areas** and **smoking-friendly venues** in Japan, shows them on a
map, and hands you off to Apple/Google Maps for walking directions.

## What it does
- Grabs your current location and drops a marker for you.
- Shows smoking spots around you, colored by type:
  - 🔵 **Official smoking area** (OpenStreetMap `amenity=smoking_area`)
  - 🟢 **Smoking-friendly venue** — cafe/bar/restaurant/etc. tagged `smoking=yes/dedicated/outside/...`
- Pan and zoom freely; it reloads spots for whatever area you're looking at (zoom in to level 14+).
  - 🟣 **Your own saved spot** — one you pinned yourself (see below)
- Tap a spot → see its name, type, hours/details, distance from you, and two buttons:
  **Walk (Apple)** opens Apple Maps walking directions; **Google** opens Google Maps walking directions.
- Installable to your iPhone home screen and launches full-screen like a native app.

## Save your own spots
Found a good one OSM doesn't know about? Tap the purple **＋** button (above the ◎
button, bottom-right) to pin **where you're standing right now**:

- It takes a fresh GPS fix, and tells you how accurate it is before you commit.
- Give it a **name** ("Station east exit ashtray") and optionally a **photo** —
  either a new one from the camera or an existing shot from your library.
- Saved spots show as 🟣 purple pins with a ring, and their popup has the photo,
  when you saved it, the GPS accuracy, walking directions, and a delete button.

**Recall them** from the **"N saved spots"** row at the bottom of the legend: it
lists everything you've pinned, nearest first, with a thumbnail and distance.
Tap one to jump the map straight to it.

They're stored on your phone in `localStorage`, which means:

- They **work with no signal** — they load and display before any network call,
  and survive the app being closed or reopened.
- They **never leave your device** and are **not shared** between you, Alex and
  Aaron. Each phone has its own list.
- They're **per-browser**: pin them from the home-screen app and they won't show
  in a normal Safari tab, and vice-versa. Clearing site data deletes them.

Photos are downscaled to 720 px and re-encoded as JPEG before saving (roughly
50–80 KB each) so a whole trip's worth fits in the ~5 MB `localStorage` budget.
If storage does fill up, the app retries with a smaller image and finally saves
the spot without its photo rather than losing the pin — and tells you it did.

## Data source & honesty note
Data comes from **OpenStreetMap** via the free Overpass API. It is *not* CLUB JT's
data — JT has no public API and their listings are proprietary. OSM coverage in Japan
is good for public smoking areas and decent for smoking-friendly venues, but it's
community-maintained, so it won't be 100% complete. Treat it as a strong helper, not gospel.

## Will this cost money? No.
Your host only ever serves the tiny static app (~170 KB once, then cached). The
data-heavy parts — map tiles and the Overpass search — are pulled from **free
third-party services that don't bill you at all**. Three people for two weeks won't
come close to any limit.

**Host it on Cloudflare Pages — unlimited bandwidth on the free plan, no credit card.**
That makes a surprise bill structurally impossible.

1. Go to **https://pages.cloudflare.com** → sign up free → **Create a project** →
   **Direct Upload**.
2. Drag the entire `smoke-spotter` folder in. You get an HTTPS link
   (e.g. `https://smoke-spotter.pages.dev`).
3. Text that link to Alex and Aaron.

**Equally safe alternative: GitHub Pages** — free, no bandwidth billing (it may throttle
a wildly popular site, which won't happen with three of you).

> ⚠️ Avoid **Netlify** for this. As of April 2026 its free tier moved to a credit model
> (~15 GB effective, then it can charge). You don't need that risk — Cloudflare Pages is
> free and unlimited.

The app needs **HTTPS** for location + PWA install, which all of the above provide
automatically. Don't open it as a local `file://` — location won't work.

## Built to be cheap on your phone data too
In Japan you'll likely be on pocket-wifi or an eSIM, so the app minimizes data:
- **Leaflet is self-hosted and cached** — downloaded once, never again.
- **Standard-resolution map tiles** (no @2x retina) ≈ one-third the tile data.
- **Map tiles are cached** — re-walking the same blocks doesn't re-download them.
- **Searches are debounced and de-duped** — small pans won't re-query; it only searches
  when you actually move to a new area (and only at zoom 14+).
- A typical afternoon of wandering a neighborhood is on the order of a few MB.

## Install on iPhone (each person)
1. Open the link in **Safari**.
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Launch it from the new home-screen icon. Allow **Location** when asked.

## Use it
- Tap the **◎** button (bottom-right) anytime to recenter on your location.
- Tap the **＋** button just above it to save the spot you're standing in.
- Tap any colored dot for details and directions.
- If you're standing somewhere with nothing nearby, pan the map — it searches wherever you look.

## Files
- `index.html` — the app (map, location, UI). Plain Leaflet + vanilla JS, no build step.
- `app-core.js` — pure data logic (Overpass query, parsing, directions links). Unit-tested,
  framework-free, exported for both browser (`window.SmokeCore`) and Node (`require`).
- `manifest.webmanifest`, `sw.js`, `icon-*.png` — PWA install + offline app shell.
- `vendor/` — self-hosted Leaflet 1.9.4 (so there's no third-party CDN dependency).
- `test/core.test.js` — data-layer unit tests.

## Developer notes (Aaron 👋)
No framework, no bundler, no build — it's a static site, so "deploy" is just serving these
files. To hack on it:

```bash
# clone, then from the project root:
python3 -m http.server 8000      # or: npx serve .
# open http://localhost:8000  (geolocation works on localhost without HTTPS)

node test/core.test.js           # run the data-layer tests (no deps)
```

Where to make changes:
- **Look & feel / map / UI** → `index.html` (all CSS and the Leaflet wiring are inline).
- **What counts as a "spot", how data is parsed, the directions links** → `app-core.js`.
  Keep it dependency-free and add/extend a test in `test/core.test.js` for any logic change.
- **Saved spots** → the storage format, validation and sorting are in `app-core.js`
  (`parseMySpots`, `normalizeMySpot`, `upsertMySpot`, `photoScaleDims`, …) and unit-tested;
  the camera/canvas/sheet wiring is in `index.html`. Two things are load-bearing:
  saved pins live in their own `mineLayer` so an Overpass refresh (which calls
  `markersLayer.clearLayers()`) can't wipe them, and `normalizeMySpot` only accepts
  a `data:image/` URL for `photo`, so nothing else can reach an `<img src>`.
- **Caching / offline / data budget** → `sw.js`. Bump the `SHELL_CACHE` version string when
  you change cached shell files so clients pick up the update.

Tile source is CARTO dark basemap; data source is the public Overpass API (`amenity=smoking_area`
plus `smoking=yes|dedicated|outside|isolated|separated`). Both are free third-party services —
please keep queries debounced so we stay polite to them.

## Tested
- 136 unit tests on the data layer (query building, parsing nodes/ways, de-duping,
  categorization, walking deep-links, distance, Japan-aware geocoding, and the
  saved-spot storage format) — all passing (`node test/core.test.js`).
- JS syntax, manifest validity, asset references, and PWA tags verified.
- The saved-spot flow is checked end-to-end in a real headless browser with a faked
  GPS fix and **all third-party network blocked**: save with a photo → persists across
  a reload → survives an Overpass refresh → recall from the list → delete. Corrupt
  `localStorage` is checked too (the app must still load).
- On-device checks (live data, GPS prompt, camera, map handoff, Add to Home Screen)
  are quick to confirm once it's hosted — see steps above.
