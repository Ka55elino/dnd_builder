-- Characters created by the user.
-- Hybrid: searchable/list fields are columns, the full build object is in build_json.
CREATE TABLE IF NOT EXISTS characters (
    id            TEXT PRIMARY KEY,             -- 'c_xxxx'
    name          TEXT NOT NULL DEFAULT '',     -- character name
    level         INTEGER NOT NULL DEFAULT 1,
    class_id      TEXT,                          -- primary class
    subclass_id   TEXT,
    race_id       TEXT,
    background_id TEXT,
    portrait      TEXT,                          -- portrait data URL/path (nullable)
    build_json    TEXT NOT NULL,                 -- the entire character object (the player's choices)
    state_json    TEXT,                          -- play state: hit points, spent resources/slots (nullable)
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_characters_updated ON characters(updated_at);
CREATE INDEX IF NOT EXISTS idx_characters_name    ON characters(name COLLATE NOCASE);
