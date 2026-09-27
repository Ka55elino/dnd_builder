-- Equipment packs (Burglar's Pack, Explorer's Pack...).
-- Items are linked many-to-many via pack_items:
-- a pack contains many items, and one item can belong to several packs.
CREATE TABLE IF NOT EXISTS packs (
    id          TEXT PRIMARY KEY,                -- 'explorerPack'
    name        TEXT NOT NULL,                   -- 'Explorer''s Pack'
    image       TEXT,                            -- "/img/…" URL (see images.go) | NULL
    cost        TEXT,                            -- '10 GP'
    description TEXT,                            -- the 'desc' field from JSON
    is_default  INTEGER NOT NULL DEFAULT 0,      -- 0/1
    data_json   TEXT NOT NULL,                   -- everything else (without items, which are in pack_items)
    is_custom   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_packs_default ON packs(is_default);
CREATE INDEX IF NOT EXISTS idx_packs_name    ON packs(name COLLATE NOCASE);

-- Junction table: which items, and how many, are in a pack.
CREATE TABLE IF NOT EXISTS pack_items (
    pack_id  TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
    item_id  TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (pack_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_pack_items_item ON pack_items(item_id);
