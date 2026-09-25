-- Queries for the classes and subclasses tables.
-- Each query starts with a "-- name: QueryName" line (see queries.go).

-- name: CountClasses
SELECT COUNT(*) FROM classes;

-- name: InsertClass
INSERT INTO classes (id, name, image, hit_die, caster, subclass_level, data_json)
VALUES (?, ?, ?, ?, ?, ?, ?);

-- name: GetAllClasses
SELECT id, name, image, hit_die, caster, subclass_level, data_json, is_custom
FROM classes
ORDER BY name COLLATE NOCASE;

-- name: CountSubclasses
SELECT COUNT(*) FROM subclasses;

-- name: InsertSubclass
INSERT INTO subclasses (id, class_id, name, image, data_json)
VALUES (?, ?, ?, ?, ?);

-- name: GetAllSubclasses
SELECT id, class_id, name, image, data_json, is_custom
FROM subclasses
ORDER BY name COLLATE NOCASE;
