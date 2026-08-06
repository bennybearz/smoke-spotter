/* /api/photo?trip=CODE&id=SPOT — one spot's photo.
 *
 * Split out from /api/spots so the metadata pull stays tiny. Clients call this
 * lazily, only when a spot is actually opened, and cache the result locally so
 * each photo crosses the network once per device.
 */
import { json, badRequest, readTripCode } from "../_shared.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB) return badRequest("sync is not configured on this deployment", 503);

  const url = new URL(request.url);
  const trip = readTripCode(url.searchParams.get("trip"));
  if (!trip) return badRequest("invalid trip code");

  const id = String(url.searchParams.get("id") || "");
  if (!id || id.length > 64) return badRequest("invalid spot id");

  const row = await env.DB.prepare(
    `SELECT photo FROM spots WHERE trip = ?1 AND id = ?2 AND deleted = 0`
  ).bind(trip, id).first();

  if (!row || !row.photo) return badRequest("no photo for that spot", 404);

  return json({ ok: true, id, photo: row.photo });
}
