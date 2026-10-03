-- Rules reference data: backgrounds, feats (plus fighting styles, metamagic, invocations),
-- spells and class/species abilities.
-- Each query starts with a "-- name: QueryName" line (see queries.go).

-- ---------- backgrounds ----------

-- name: CountBackgrounds
SELECT COUNT(*) FROM backgrounds;

-- name: InsertBackground
INSERT INTO backgrounds (id, name, feat, data_json) VALUES (?, ?, ?, ?);

-- name: GetAllBackgrounds
SELECT id, name, feat, data_json FROM backgrounds ORDER BY name COLLATE NOCASE;

-- ---------- feats ----------
-- category: origin | general | boon | fightingStyle | metamagic | invocation

-- name: CountFeats
SELECT COUNT(*) FROM feats;

-- name: InsertFeat
INSERT INTO feats (id, name, category, level, description, data_json) VALUES (?, ?, ?, ?, ?, ?);

-- name: GetAllFeats
SELECT id, name, category, level, description, data_json
FROM feats
ORDER BY category, name COLLATE NOCASE;

-- ---------- spells and abilities ----------
-- kind: spell | class | martial | action

-- name: CountSpells
SELECT COUNT(*) FROM spells;

-- name: InsertSpell
INSERT INTO spells (id, name, kind, level, school, action, concentration, ritual, description, data_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);

-- name: InsertSpellClass
INSERT OR IGNORE INTO spell_classes (spell_id, class_id) VALUES (?, ?);

-- name: GetAllSpells
SELECT id, name, kind, level, school, action, concentration, ritual, description, data_json
FROM spells
ORDER BY kind, level, name COLLATE NOCASE;

-- ---------- conditions and named effects ----------
-- category: condition | effect

-- name: CountConditions
SELECT COUNT(*) FROM conditions;

-- name: InsertCondition
INSERT INTO conditions (id, name, category, description, data_json) VALUES (?, ?, ?, ?, ?);

-- name: GetAllConditions
SELECT id, name, category, description, data_json
FROM conditions
ORDER BY category, name COLLATE NOCASE;

-- name: CountWildShapeForms
SELECT COUNT(*) FROM wild_shape_forms;

-- name: InsertWildShapeForm
INSERT INTO wild_shape_forms (monster_id, class_id, subclass_id, min_level, sort, is_custom)
VALUES (?, ?, ?, ?, ?, 0)
ON CONFLICT(monster_id, class_id, subclass_id) DO UPDATE SET min_level = excluded.min_level, sort = excluded.sort;

-- name: GetWildShapeForms
-- The forms whose monster is in the bestiary (a deleted custom monster drops out).
-- With a summary of the monster for the choice lists; the full stat block: GetMonsters.
SELECT f.monster_id, f.class_id, f.subclass_id, f.min_level, f.sort, f.is_custom,
       m.name, m.type, m.size, m.cr, m.ac, m.hp, COALESCE(m.image, ''), COALESCE(json_extract(m.data_json, '$.speed'), '{}')
FROM wild_shape_forms f JOIN monsters m ON m.id = f.monster_id
ORDER BY f.class_id, f.min_level, f.sort, m.name;

-- name: MonsterExists
SELECT COUNT(*) FROM monsters WHERE id = ?;
