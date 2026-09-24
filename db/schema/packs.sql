-- Наборы снаряжения (набор взломщика, путешественника...).
-- Связь с предметами — многие-ко-многим через pack_items:
-- в наборе много предметов, один предмет может входить в разные наборы.
CREATE TABLE IF NOT EXISTS packs (
    id          TEXT PRIMARY KEY,                -- 'explorerPack'
    name        TEXT NOT NULL,                   -- 'Набор путешественника'
    image       TEXT,                            -- data URL (base64) | NULL
    cost        TEXT,                            -- '10 зм'
    description TEXT,                            -- поле 'desc' из JSON
    is_default  INTEGER NOT NULL DEFAULT 0,      -- 0/1
    data_json   TEXT NOT NULL,                   -- прочее (без items — они в pack_items)
    is_custom   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_packs_default ON packs(is_default);
CREATE INDEX IF NOT EXISTS idx_packs_name    ON packs(name COLLATE NOCASE);

-- Промежуточная таблица: какие предметы и сколько лежат в наборе.
CREATE TABLE IF NOT EXISTS pack_items (
    pack_id  TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
    item_id  TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (pack_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_pack_items_item ON pack_items(item_id);
