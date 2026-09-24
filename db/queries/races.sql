-- Запросы к таблице races.
-- Каждый запрос начинается со строки «-- name: ИмяЗапроса» (см. queries.go).

-- name: CountRaces
SELECT COUNT(*) FROM races;

-- name: InsertRace
INSERT INTO races (id, name, parent_race, image, data_json)
VALUES (?, ?, ?, ?, ?);

-- name: GetAllRaces
-- Все расы и подрасы: сначала базовые расы, затем подрасы; внутри — по имени.
SELECT id, name, parent_race, image, data_json, is_custom
FROM races
ORDER BY parent_race IS NOT NULL, name COLLATE NOCASE;
