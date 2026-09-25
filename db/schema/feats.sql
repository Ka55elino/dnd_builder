-- Feats (reference data).
CREATE TABLE IF NOT EXISTS feats (
    id          TEXT PRIMARY KEY,                -- 'boonSpeed'
    name        TEXT NOT NULL,                   -- 'Boon of Speed'
    category    TEXT,                            -- 'boon' | 'general' | 'origin' | 'fighting'...
    level       INTEGER,                         -- required level (nullable)
    description TEXT,                             -- the 'desc' field from JSON
    data_json   TEXT NOT NULL,                   -- effects, prerequisites...
    is_custom   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_feats_category ON feats(category);
CREATE INDEX IF NOT EXISTS idx_feats_name     ON feats(name COLLATE NOCASE);
