-- Spells and abilities (kind: spell | class | martial).
-- Searchable fields are columns; casting/uses/damage/effects/scaleDie are in data_json.
CREATE TABLE IF NOT EXISTS spells (
    id            TEXT PRIMARY KEY,              -- 'magicMissile'
    name          TEXT NOT NULL,                 -- 'Magic Missile'
    kind          TEXT NOT NULL DEFAULT 'spell', -- spell | class | martial
    level         INTEGER NOT NULL,              -- 0..9 (0 = cantrip)
    school        TEXT,                          -- evocation, abjuration...
    action        TEXT,                          -- action | bonus | reaction | free
    concentration INTEGER NOT NULL DEFAULT 0,    -- 0/1
    ritual        INTEGER NOT NULL DEFAULT 0,    -- 0/1
    description   TEXT,                          -- the 'desc' field from JSON
    data_json     TEXT NOT NULL,                 -- casting, uses, damage, effects, scaleDie, source...
    is_custom     INTEGER NOT NULL DEFAULT 0,    -- 0 = built-in, 1 = added by the user
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_spells_level  ON spells(level);
CREATE INDEX IF NOT EXISTS idx_spells_school ON spells(school);
CREATE INDEX IF NOT EXISTS idx_spells_kind   ON spells(kind);
CREATE INDEX IF NOT EXISTS idx_spells_name   ON spells(name COLLATE NOCASE);
