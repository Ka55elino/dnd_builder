-- Доспехи и щиты (справочник). Структура — как в JSON dndbuilder-v2.
-- is_default = 1 — показывается в билдере.
CREATE TABLE IF NOT EXISTS armor (
    id          TEXT PRIMARY KEY,                -- 'chainMail'
    name        TEXT NOT NULL,                   -- 'Кольчуга'
    image       TEXT,                            -- data URL (base64) | NULL
    category    TEXT NOT NULL,                   -- light | medium | heavy | shield
    base_ac     INTEGER,                         -- 16 (у щита NULL)
    is_default  INTEGER NOT NULL DEFAULT 0,      -- 0/1
    data_json   TEXT NOT NULL,                   -- addDex, maxDex, stealthDisadvantage, strengthReq, acBonus...
    is_custom   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_armor_category ON armor(category);
CREATE INDEX IF NOT EXISTS idx_armor_default  ON armor(is_default);
CREATE INDEX IF NOT EXISTS idx_armor_name     ON armor(name COLLATE NOCASE);
