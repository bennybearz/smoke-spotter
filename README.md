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

They're stored on your phone in `localStorage`, so they **work with no signal** —
they load and display before any network call, and survive the app being closed
or reopened. By default they stay on that one device (and that one browser: the
home-screen app and a normal Safari tab have separate storage). To share them,
turn on sync — see below.

## Sync across devices (optional)
Open **My spots → ⇅ Sync across devices**, enter a **trip code**, and every
device using that code shares one list. There are no accounts and no passwords.

- Use the same code on your own phone and laptop to sync **just yours**.
- Give the code to Alex and Aaron to **pool everyone's** spots.
- Leave it off and nothing leaves the device — that's the default.

> ⚠️ The trip code is the only thing protecting the list. Anyone who knows it can
> read and change it, so use the **Suggest one** button rather than something
> guessable like `tokyo`. Minimum 6 characters.

**Data use stays low, deliberately.** The sync pull carries only names, coordinates
and dates — never photo data, which is ~99% of the bytes. A photo taken on someone
else's phone shows a 📷 placeholder in the list and is downloaded only when you
actually open that spot, then kept locally so it crosses the network once. Nothing
in the app ever waits on the network: the map renders from local storage first and
sync happens in the background.

**Deletes are tombstones.** Deleting a spot records the deletion rather than just
dropping it, so the delete travels to the other phones instead of the spot syncing
straight back from a device that hadn't heard yet. Tombstones are purged after 45 days.

### Setting up the backend (once)
Sync needs a [Cloudflare D1](https://developers.cloudflare.com/d1/) database bound to
the Pages project. Everything else is already in the repo (`functions/`, `schema.sql`).

```bash
npx wrangler d1 create smoke-spotter
npx wrangler d1 execute smoke-spotter --remote --file=./schema.sql
```

Then in the Cloudflare dashboard: **Workers & Pages → your Pages project → Settings
→ Bindings → Add → D1 database**, variable name **`DB`**, pointed at `smoke-spotter`.
Add it for **both** Production and Preview, then redeploy. Until that binding exists
the endpoints return **503** and the app just carries on working locally — sync is
additive, and nothing breaks without it.

**It stays free.** On Cloudflare's free tier D1 allows 5 GB of storage, 100,000 row
writes and 5 million row reads per day, and Workers allow 100,000 requests per day.
Three people on a two-week trip use a rounding error of that (a few megabytes and a
few hundred requests), so there is no path to a bill.

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
- `functions/` — the sync API, run by Cloudflare Pages Functions
  (`api/spots.js` = pull/push, `api/photo.js` = one photo, `_shared.js` = validation).
- `schema.sql` — the D1 table. Apply it once; see the setup steps above.
- `_headers` — Cloudflare Pages cache rules; keeps the app shell revalidated.

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
- **Sync** → merge rules, tombstones and trip codes are pure functions in `app-core.js`
  (`mergeSpotLists`, `markSpotDeleted`, `purgeTombstones`, `parsePullResponse`, …) and
  unit-tested; the fetch/queue wiring is in `index.html`; the server is `functions/`.
  Two rules the merge has to keep: a delete wins an exact `updatedAt` tie (otherwise a
  spot flaps between two devices forever), and a metadata-only pull must never erase a
  photo the device already holds. The server re-validates everything independently —
  never relax `functions/_shared.js` to match the client.
- **Caching / offline / data budget** → `sw.js`. Note `/api/` is explicitly excluded from
  caching: the app-shell rule is cache-first, which would otherwise pin the first sync
  response forever and make the list look frozen.

> ### ⚠️ When you change `app-core.js`, bump the version in **three** places
> `index.html`'s `<script src="app-core.js?v=N">`, the matching `./app-core.js?v=N` in
> `sw.js`'s `SHELL` list, and `SHELL_CACHE` in `sw.js`. They are one version number
> split across two files.
>
> This exists because of a real failure. `index.html` and `app-core.js` are separate
> cacheable URLs, so a browser can pair a **fresh `index.html` with a cached old
> `app-core.js`**. The two then disagree about what `SmokeCore` exports and the app dies
> on the first missing function — silently, since the error is swallowed by a click
> handler. The visible symptom is bizarre: the legend reads the hardcoded "My spots"
> instead of a spot count, and tapping it does nothing at all. The `?v=` makes each
> release a distinct URL, so a stale copy simply can't be reached. `_headers` keeps
> `index.html` and `sw.js` revalidated so the new `?v=` is always seen.

Tile source is CARTO dark basemap; data source is the public Overpass API (`amenity=smoking_area`
plus `smoking=yes|dedicated|outside|isolated|separated`). Both are free third-party services —
please keep queries debounced so we stay polite to them.

## Tested
- 214 unit tests on the data layer (query building, parsing nodes/ways, de-duping,
  categorization, walking deep-links, distance, Japan-aware geocoding, the saved-spot
  storage format, and the sync merge rules) — all passing (`node test/core.test.js`).
- JS syntax, manifest validity, asset references, and PWA tags verified.
- The saved-spot flow is checked end-to-end in a real headless browser with a faked
  GPS fix and **all third-party network blocked**: save with a photo → persists across
  a reload → survives an Overpass refresh → recall from the list → delete. Corrupt
  `localStorage` is checked too (the app must still load).
- Sync is checked with **two browser contexts against the real `functions/` code and
  the real SQL**: save on device A → appears on device B → photo fetched lazily on open
  → deleted on B → delete reaches A → and stays deleted when A re-uploads. Plus a
  different trip code seeing nothing, and the server rejecting short codes, oversized
  pushes, out-of-range coordinates and non-`data:` photo URLs.
- On-device checks (live data, GPS prompt, camera, map handoff, Add to Home Screen)
  are quick to confirm once it's hosted — see steps above.
