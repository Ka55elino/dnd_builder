-- Bestiary (reference data + the DM's own monsters, is_custom = 1).
-- List/filter fields are columns; the full stat block is in data_json
-- (speed, abilities, saves, skills, defenses, senses, traits, actions…,
-- see assets/data/monsters/README.md).
CREATE TABLE IF NOT EXISTS monsters (
    id           TEXT PRIMARY KEY,               -- 'zombie'
    name         TEXT NOT NULL,                  -- 'Zombie'
    image        TEXT,                           -- "/img/…" URL (see images.go) | NULL
    type         TEXT NOT NULL,                  -- aberration | beast | … | undead (14 creature types)
    size         TEXT NOT NULL,                  -- tiny | small | medium | large | huge | gargantuan
    alignment    TEXT,                           -- 'neutral evil', 'unaligned'
    cr           REAL NOT NULL,                  -- Challenge Rating: 0, 0.125, 0.25, 0.5, 1…30
    xp           INTEGER NOT NULL,               -- XP for the encounter budget
    ac           INTEGER NOT NULL,
    hp           INTEGER NOT NULL,               -- average Hit Points
    is_legendary INTEGER NOT NULL DEFAULT 0,     -- 0/1: has legendary actions
    habitats     TEXT NOT NULL DEFAULT '[]',     -- JSON array: ["forest","underdark"]
    data_json    TEXT NOT NULL,
    is_custom    INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_monsters_type ON monsters(type);
CREATE INDEX IF NOT EXISTS idx_monsters_cr   ON monsters(cr);
CREATE INDEX IF NOT EXISTS idx_monsters_name ON monsters(name COLLATE NOCASE);
