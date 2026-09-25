-- Races and lineages/subraces (reference data).
-- parent_race is set for subraces (e.g. 'aasimar') and NULL for a base race.
-- image is moved out of the JSON into its own column; it is not in data_json.
CREATE TABLE IF NOT EXISTS races (
    id          TEXT PRIMARY KEY,                -- 'fallen'
    name        TEXT NOT NULL,                   -- 'Fallen Aasimar'
    parent_race TEXT,                            -- 'aasimar' | NULL (the 'race' field from JSON)
    image       TEXT,                            -- image/icon, data URL (base64) | NULL
    data_json   TEXT NOT NULL,                   -- traits and everything else
    is_custom   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_races_parent ON races(parent_race);
CREATE INDEX IF NOT EXISTS idx_races_name   ON races(name COLLATE NOCASE);
