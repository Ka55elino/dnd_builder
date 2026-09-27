-- Classes (reference data). Scalar fields are columns, the rest (skills,
-- savingThrows, spellcasting, features, asiLevels...) is in data_json.
CREATE TABLE IF NOT EXISTS classes (
    id             TEXT PRIMARY KEY,             -- 'ranger'
    name           TEXT NOT NULL,                -- 'Ranger'
    image          TEXT,                         -- image, "/img/…" URL (see images.go) | NULL
    hit_die        INTEGER,                      -- 10
    caster         TEXT,                         -- full | half | third | none
    subclass_level INTEGER,                      -- level at which the subclass is chosen
    data_json      TEXT NOT NULL,                -- primaryAbility, savingThrows, skills, spellcasting, features...
    is_custom      INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_classes_name ON classes(name COLLATE NOCASE);
