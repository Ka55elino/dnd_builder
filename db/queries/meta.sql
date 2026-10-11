-- App metadata (db/schema/meta.sql).
-- Each query starts with a "-- name: QueryName" line (see queries.go).

-- name: GetMeta
SELECT value FROM app_meta WHERE key = ?;

-- name: SetMeta
INSERT INTO app_meta (key, value) VALUES (?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value;
