-- D1 schema for cross-device spot sync.
-- Apply with:  npx wrangler d1 execute smoke-spotter --remote --file=./schema.sql
--
-- One row per (trip, spot). `trip` is the shared code people type in; it is the
-- only thing separating one group's list from another's, so it is part of every
-- key and every query.
CREATE TABLE IF NOT EXISTS spots (
  trip       TEXT    NOT NULL,
  id         TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  lat        REAL    NOT NULL,
  lng        REAL    NOT NULL,
  -- data: URL, already downscaled by the client. NULL for tombstones.
  photo      TEXT,
  saved_at   INTEGER NOT NULL,
  accuracy   INTEGER,
  -- last-write-wins key; also the cursor clients page through
  updated_at INTEGER NOT NULL,
  -- tombstone: kept so a delete propagates instead of the spot syncing back
  deleted    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (trip, id)
);

-- Every read is "changes for this trip since a cursor", so index exactly that.
CREATE INDEX IF NOT EXISTS idx_spots_trip_updated ON spots (trip, updated_at);
