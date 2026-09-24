-- Запросы к таблицам снаряжения: weapons, armor, items, packs, pack_items.
-- Каждый запрос начинается со строки «-- name: ИмяЗапроса» (см. queries.go).

-- ---------- оружие ----------

-- name: CountWeapons
SELECT COUNT(*) FROM weapons;

-- name: InsertWeapon
INSERT INTO weapons (id, name, image, category, damage, damage_type, is_default, data_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?);

-- name: GetDefaultWeapons
-- Только оружие с is_default = 1 — для билдера.
SELECT id, name, image, category, damage, damage_type, data_json, is_default
FROM weapons
WHERE is_default = 1
ORDER BY category = 'martial', name COLLATE NOCASE;

-- name: GetAllWeapons
-- Всё оружие, включая именное/магическое (для выдачи предметов).
SELECT id, name, image, category, damage, damage_type, data_json, is_default
FROM weapons
ORDER BY is_default DESC, category = 'martial', name COLLATE NOCASE;

-- ---------- доспехи ----------

-- name: CountArmor
SELECT COUNT(*) FROM armor;

-- name: InsertArmor
INSERT INTO armor (id, name, image, category, base_ac, is_default, data_json)
VALUES (?, ?, ?, ?, ?, ?, ?);

-- name: GetDefaultArmor
-- Только доспехи с is_default = 1; лёгкие → средние → тяжёлые → щиты.
SELECT id, name, image, category, base_ac, data_json, is_default
FROM armor
WHERE is_default = 1
ORDER BY CASE category
             WHEN 'light'  THEN 1
             WHEN 'medium' THEN 2
             WHEN 'heavy'  THEN 3
             ELSE 4
         END,
         name COLLATE NOCASE;

-- name: GetAllArmor
SELECT id, name, image, category, base_ac, data_json, is_default
FROM armor
ORDER BY is_default DESC,
         CASE category WHEN 'light' THEN 1 WHEN 'medium' THEN 2 WHEN 'heavy' THEN 3 ELSE 4 END,
         name COLLATE NOCASE;

-- ---------- предметы ----------

-- name: CountItems
SELECT COUNT(*) FROM items;

-- name: InsertItem
INSERT INTO items (id, name, image, weight, cost, description, is_default, data_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?);

-- name: GetDefaultItems
SELECT id, name, image, weight, cost, description, data_json
FROM items
WHERE is_default = 1
ORDER BY name COLLATE NOCASE;

-- name: GetAllItems
SELECT id, name, image, weight, cost, description, data_json
FROM items
ORDER BY name COLLATE NOCASE;

-- ---------- наборы ----------

-- name: CountPacks
SELECT COUNT(*) FROM packs;

-- name: InsertPack
INSERT INTO packs (id, name, image, cost, description, is_default, data_json)
VALUES (?, ?, ?, ?, ?, ?, ?);

-- name: InsertPackItem
INSERT INTO pack_items (pack_id, item_id, quantity)
VALUES (?, ?, ?);

-- name: GetDefaultPacks
SELECT id, name, image, cost, description, data_json
FROM packs
WHERE is_default = 1
ORDER BY name COLLATE NOCASE;

-- name: GetPackItems
-- Содержимое всех наборов (JOIN через промежуточную таблицу).
SELECT pi.pack_id, pi.quantity,
       i.id, i.name, i.image, i.weight, i.cost, i.description, i.data_json
FROM pack_items pi
JOIN items i ON i.id = pi.item_id
ORDER BY pi.pack_id, i.name COLLATE NOCASE;
