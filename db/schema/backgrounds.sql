-- Backgrounds (reference data).
CREATE TABLE IF NOT EXISTS backgrounds (
    id         TEXT PRIMARY KEY,                 -- 'wayfarer'
    name       TEXT NOT NULL,                    -- 'Wayfarer'
    feat       TEXT,                             -- starting feat (e.g. 'lucky')
    data_json  TEXT NOT NULL,                    -- abilities.options, skills, tool...
    is_custom  INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_backgrounds_name ON backgrounds(name COLLATE NOCASE);
