-- Расы и происхождения/подрасы (справочник).
-- parent_race заполнен у подрас (напр. 'aasimar'), NULL у базовой расы.
-- image вынесен из JSON в отдельную колонку, в data_json его нет.
CREATE TABLE IF NOT EXISTS races (
    id          TEXT PRIMARY KEY,                -- 'fallen'
    name        TEXT NOT NULL,                   -- 'Аасимар-падший'
    parent_race TEXT,                            -- 'aasimar' | NULL (поле 'race' из JSON)
    image       TEXT,                            -- картинка/иконка, data URL (base64) | NULL
    data_json   TEXT NOT NULL,                   -- traits и прочее
    is_custom   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_races_parent ON races(parent_race);
CREATE INDEX IF NOT EXISTS idx_races_name   ON races(name COLLATE NOCASE);
