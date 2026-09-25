-- Armor and shields (reference data). Structure matches the dndbuilder-v2 JSON.
-- is_default = 1: shown in the builder.
CREATE TABLE IF NOT EXISTS armor (
    id          TEXT PRIMARY KEY,                -- 'chainMail'
    name        TEXT NOT NULL,                   -- 'Chain Mail'
    image       TEXT,                            -- data URL (base64) | NULL
    category    TEXT NOT NULL,                   -- light | medium | heavy | shield
    base_ac     INTEGER,                         -- 16 (NULL for a shield)
    is_default  INTEGER NOT NULL DEFAULT 0,      -- 0/1
    data_json   TEXT NOT NULL,                   -- addDex, maxDex, stealthDisadvantage, strengthReq, acBonus...
    is_custom   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_armor_category ON armor(category);
CREATE INDEX IF NOT EXISTS idx_armor_default  ON armor(is_default);
CREATE INDEX IF NOT EXISTS idx_armor_name     ON armor(name COLLATE NOCASE);
