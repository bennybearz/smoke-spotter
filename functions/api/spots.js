/* /api/spots — the sync endpoint.
 *
 *   GET  ?trip=CODE&since=MS  -> changes since a cursor, WITHOUT photo bodies
 *   POST { trip, spots: [] }  -> upsert this device's changes, WITH photos
 *
 * Photos are excluded from the pull on purpose: they are ~99% of the bytes, and
 * this app is used on pocket wifi in Japan. Clients fetch them one at a time
 * from /api/photo only when a spot is actually opened.
 *
 * Requires a D1 binding named DB (see README).
 */
import {
  json, badRequest, readTripCode, validateSpot, rowToSpot,
  MAX_SPOTS_PER_PUSH, MAX_PULL_ROWS,
} from "../_shared.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB) return badRequest("sync is not configured on this deployment", 503);

  const url = new URL(request.url);
  const trip = readTripCode(url.searchParams.get("trip"));
  if (!trip) return badRequest("invalid trip code");

  const since = Math.max(0, Math.floor(Number(url.searchParams.get("since"))) || 0);

  const { results } = await env.DB.prepare(
    `SELECT id, name, lat, lng, saved_at, accuracy, updated_at, deleted,
            CASE WHEN photo IS NULL THEN 0 ELSE 1 END AS has_photo
       FROM spots
      WHERE trip = ?1 AND updated_at > ?2
      ORDER BY updated_at ASC
      LIMIT ?3`
  ).bind(trip, since, MAX_PULL_ROWS).all();

  const rows = results || [];
  const spots = rows.map(rowToSpot);

  // If we hit the row cap there may be more; advancing the cursor only as far
  // as the last row we actually returned means the next pull picks up the rest
  // instead of silently skipping it.
  const capped = rows.length >= MAX_PULL_ROWS;
  const now = capped ? rows[rows.length - 1].updated_at : Date.now();

  return json({ ok: true, now, spots, more: capped });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return badRequest("sync is not configured on this deployment", 503);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return badRequest("body must be JSON");
  }

  const trip = readTripCode(body && body.trip);
  if (!trip) return badRequest("invalid trip code");

  const incoming = body && Array.isArray(body.spots) ? body.spots : [];
  if (incoming.length > MAX_SPOTS_PER_PUSH) {
    return badRequest("too many spots in one push", 413);
  }

  const rows = [];
  for (const raw of incoming) {
    const v = validateSpot(raw);
    if (v) rows.push(v);
  }

  if (rows.length) {
    const stmt = env.DB.prepare(
      `INSERT INTO spots
         (trip, id, name, lat, lng, photo, saved_at, accuracy, updated_at, deleted)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT(trip, id) DO UPDATE SET
         name       = excluded.name,
         lat        = excluded.lat,
         lng        = excluded.lng,
         -- A tombstone clears the photo. Otherwise keep whatever we already
         -- hold when the pushing device didn't send one: it may simply never
         -- have downloaded it, and losing it here would lose it for everyone.
         photo      = CASE WHEN excluded.deleted = 1     THEN NULL
                           WHEN excluded.photo IS NOT NULL THEN excluded.photo
                           ELSE spots.photo END,
         saved_at   = excluded.saved_at,
         accuracy   = excluded.accuracy,
         updated_at = excluded.updated_at,
         deleted    = excluded.deleted
       WHERE excluded.updated_at > spots.updated_at`
    );

    await env.DB.batch(rows.map((r) => stmt.bind(
      trip, r.id, r.name, r.lat, r.lng, r.photo,
      r.saved_at, r.accuracy, r.updated_at, r.deleted
    )));
  }

  return json({
    ok: true,
    now: Date.now(),
    accepted: rows.length,
    rejected: incoming.length - rows.length,
  });
}
