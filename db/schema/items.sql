-- Adventuring gear (flask, rope, thieves' tools...).
CREATE TABLE IF NOT EXISTS items (
    id          TEXT PRIMARY KEY,                -- 'rope'
    name        TEXT NOT NULL,                   -- 'Rope (50 feet)'
    image       TEXT,                            -- "/img/…" URL (see images.go) | NULL
    weight      REAL,                            -- pounds
    cost        TEXT,                            -- '1 GP'
    description TEXT,                            -- the 'desc' field from JSON
    is_default  INTEGER NOT NULL DEFAULT 0,      -- 0/1
    data_json   TEXT NOT NULL,                   -- everything else
    is_custom   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_items_default ON items(is_default);
CREATE INDEX IF NOT EXISTS idx_items_name    ON items(name COLLATE NOCASE);
