/* Shared helpers for the sync API (Cloudflare Pages Functions).
 *
 * The validation here is deliberately a second implementation of the checks the
 * client already does. The client's copy is for UX; this one is the real one,
 * because anything can POST to these endpoints. Never relax it to match the
 * client — the two are allowed to disagree, and the server always wins.
 */

// A trip code is the only secret guarding a bucket, so require enough length
// that it can't be brute-forced casually. Matches SmokeCore.normalizeTripCode.
export const TRIP_CODE_RE = /^[a-z0-9][a-z0-9-]{5,39}$/;

export const MAX_SPOTS_PER_PUSH = 200;
export const MAX_NAME_CHARS = 80;
// ~300 KB of base64. The client targets 50-80 KB; this is headroom, not a target.
export const MAX_PHOTO_CHARS = 400000;
export const MAX_PULL_ROWS = 500;

export function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Never cache: a cached sync response would serve stale spots forever,
      // via either Cloudflare's edge cache or the app's own service worker.
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}

export function badRequest(msg, status) {
  return json({ ok: false, error: msg }, status || 400);
}

export function readTripCode(value) {
  const trip = String(value == null ? "" : value).trim().toLowerCase();
  return TRIP_CODE_RE.test(trip) ? trip : null;
}

/* Coerce one client-supplied spot into exactly the columns we store, or null.
   Returns values in the bind order used by the INSERT in spots.js. */
export function validateSpot(raw) {
  if (!raw || typeof raw !== "object") return null;

  const id = String(raw.id == null ? "" : raw.id);
  if (!id || id.length > 64) return null;

  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const deleted = raw.deleted === true || raw.deleted === 1 ? 1 : 0;

  let name = String(raw.name == null ? "" : raw.name).trim().slice(0, MAX_NAME_CHARS);
  if (!name) name = "My smoking spot";

  // Only ever store inline image data. A remote or javascript: URL must not be
  // able to reach another device's <img src> through us.
  let photo = null;
  if (!deleted && typeof raw.photo === "string" && raw.photo.startsWith("data:image/")) {
    if (raw.photo.length > MAX_PHOTO_CHARS) return null;
    photo = raw.photo;
  }

  const savedAt = Number(raw.savedAt);
  const updatedAt = Number(raw.updatedAt);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return null;

  const acc = Number(raw.accuracy);

  return {
    id,
    name,
    lat,
    lng,
    photo,
    saved_at: Number.isFinite(savedAt) && savedAt > 0 ? Math.floor(savedAt) : Math.floor(updatedAt),
    accuracy: Number.isFinite(acc) && acc >= 0 ? Math.round(acc) : null,
    updated_at: Math.floor(updatedAt),
    deleted,
  };
}

/* DB row -> the camelCase shape the client's normalizeMySpot() expects. */
export function rowToSpot(row) {
  return {
    id: row.id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    savedAt: row.saved_at,
    accuracy: row.accuracy,
    updatedAt: row.updated_at,
    deleted: row.deleted === 1,
    hasPhoto: row.has_photo === 1,
  };
}
