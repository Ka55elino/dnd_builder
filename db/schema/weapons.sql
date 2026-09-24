-- Оружие (справочник). Структура — как в JSON dndbuilder-v2.
-- is_default = 1 — показывается в билдере; 0 — скрыто (напр. именное/магическое).
CREATE TABLE IF NOT EXISTS weapons (
    id          TEXT PRIMARY KEY,                -- 'longsword'
    name        TEXT NOT NULL,                   -- 'Длинный меч'
    image       TEXT,                            -- data URL (base64) | NULL
    category    TEXT NOT NULL,                   -- simple | martial
    damage      TEXT,                            -- '1d8'
    damage_type TEXT,                            -- bludgeoning | piercing | slashing
    is_default  INTEGER NOT NULL DEFAULT 0,      -- 0/1
    data_json   TEXT NOT NULL,                   -- mastery, properties, range, base, desc...
    is_custom   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_weapons_category ON weapons(category);
CREATE INDEX IF NOT EXISTS idx_weapons_default  ON weapons(is_default);
CREATE INDEX IF NOT EXISTS idx_weapons_name     ON weapons(name COLLATE NOCASE);
