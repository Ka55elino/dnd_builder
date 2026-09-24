-- Предметы снаряжения (фляга, верёвка, отмычки...).
CREATE TABLE IF NOT EXISTS items (
    id          TEXT PRIMARY KEY,                -- 'rope'
    name        TEXT NOT NULL,                   -- 'Верёвка (15 м)'
    image       TEXT,                            -- data URL (base64) | NULL
    weight      REAL,                            -- фунты
    cost        TEXT,                            -- '1 зм'
    description TEXT,                            -- поле 'desc' из JSON
    is_default  INTEGER NOT NULL DEFAULT 0,      -- 0/1
    data_json   TEXT NOT NULL,                   -- прочее
    is_custom   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_items_default ON items(is_default);
CREATE INDEX IF NOT EXISTS idx_items_name    ON items(name COLLATE NOCASE);
