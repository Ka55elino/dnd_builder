-- Queries for the characters table.
-- Each query starts with a "-- name: QueryName" line (see queries.go).

-- name: CountCharacters
SELECT COUNT(*) FROM characters;

-- name: UpsertCharacter
-- A new character is inserted; an existing one (same id) is updated.
INSERT INTO characters (id, name, level, class_id, subclass_id, race_id, background_id, portrait, build_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    name          = excluded.name,
    level         = excluded.level,
    class_id      = excluded.class_id,
    subclass_id   = excluded.subclass_id,
    race_id       = excluded.race_id,
    background_id = excluded.background_id,
    portrait      = excluded.portrait,
    build_json    = excluded.build_json,
    updated_at    = strftime('%s','now');

-- name: GetCharacter
SELECT build_json FROM characters WHERE id = ?;

-- name: ListCharacters
-- For the grid on the start page: most recent first.
SELECT ch.id, ch.name, ch.level, ch.race_id, ch.class_id,
       COALESCE(c.name, ''), ch.portrait, ch.updated_at
FROM characters ch
LEFT JOIN classes c ON c.id = ch.class_id
ORDER BY ch.updated_at DESC, ch.name COLLATE NOCASE;

-- name: GetCharacterState
SELECT state_json FROM characters WHERE id = ?;

-- name: SaveCharacterState
-- Play state changes often, so updated_at is not touched
-- to keep the character list order from jumping around.
UPDATE characters SET state_json = ? WHERE id = ?;
