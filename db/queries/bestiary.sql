-- Bestiary: monsters and encounter presets.
-- Each query starts with a "-- name: QueryName" line (see queries.go).

-- ---------- monsters ----------

-- name: CountMonsters
SELECT COUNT(*) FROM monsters;

-- name: InsertMonster
INSERT INTO monsters (id, name, image, type, size, alignment, cr, xp, ac, hp, is_legendary, habitats, data_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);

-- name: GetAllMonsters
SELECT id, name, image, type, size, alignment, cr, xp, ac, hp, is_legendary, habitats, data_json
FROM monsters
ORDER BY name COLLATE NOCASE;

-- ---------- encounters ----------

-- name: GetAllEncounters
SELECT id, name, notes, monsters_json, updated_at
FROM encounters
ORDER BY updated_at DESC, name COLLATE NOCASE;

-- name: UpsertEncounter
INSERT INTO encounters (id, name, notes, monsters_json) VALUES (?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    name          = excluded.name,
    notes         = excluded.notes,
    monsters_json = excluded.monsters_json,
    updated_at    = strftime('%s','now');

-- name: DeleteEncounter
DELETE FROM encounters WHERE id = ?;
