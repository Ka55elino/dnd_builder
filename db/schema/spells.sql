-- Заклинания и способности (kind: spell | class | martial).
-- Искомые поля — колонками; casting/uses/damage/effects/scaleDie — в data_json.
CREATE TABLE IF NOT EXISTS spells (
    id            TEXT PRIMARY KEY,              -- 'magicMissile'
    name          TEXT NOT NULL,                 -- 'Волшебная стрела'
    kind          TEXT NOT NULL DEFAULT 'spell', -- spell | class | martial
    level         INTEGER NOT NULL,              -- 0..9 (0 = заговор)
    school        TEXT,                          -- evocation, abjuration...
    action        TEXT,                          -- action | bonus | reaction | free
    concentration INTEGER NOT NULL DEFAULT 0,    -- 0/1
    ritual        INTEGER NOT NULL DEFAULT 0,    -- 0/1
    description   TEXT,                          -- поле 'desc' из JSON
    data_json     TEXT NOT NULL,                 -- casting, uses, damage, effects, scaleDie, source...
    is_custom     INTEGER NOT NULL DEFAULT 0,    -- 0 = справочник, 1 = добавлено пользователем
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_spells_level  ON spells(level);
CREATE INDEX IF NOT EXISTS idx_spells_school ON spells(school);
CREATE INDEX IF NOT EXISTS idx_spells_kind   ON spells(kind);
CREATE INDEX IF NOT EXISTS idx_spells_name   ON spells(name COLLATE NOCASE);
