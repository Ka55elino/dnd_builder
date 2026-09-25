-- Queries for the races table.
-- Each query starts with a "-- name: QueryName" line (see queries.go).

-- name: CountRaces
SELECT COUNT(*) FROM races;

-- name: InsertRace
INSERT INTO races (id, name, parent_race, image, data_json)
VALUES (?, ?, ?, ?, ?);

-- name: GetAllRaces
-- All races and subraces: base races first, then subraces; each group sorted by name.
SELECT id, name, parent_race, image, data_json, is_custom
FROM races
ORDER BY parent_race IS NOT NULL, name COLLATE NOCASE;

-- name: GetRaceImage
-- Image of a race or subrace by id (subrace ids are unique within the same table).
SELECT COALESCE(image, '') FROM races WHERE id = ?;
