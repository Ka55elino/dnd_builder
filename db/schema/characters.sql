-- Персонажи, созданные пользователем.
-- Гибрид: искомые/списочные поля — колонками, полный объект build — в build_json.
CREATE TABLE IF NOT EXISTS characters (
    id            TEXT PRIMARY KEY,             -- 'c_xxxx'
    name          TEXT NOT NULL DEFAULT '',     -- имя персонажа
    level         INTEGER NOT NULL DEFAULT 1,
    class_id      TEXT,                          -- основной класс
    subclass_id   TEXT,
    race_id       TEXT,
    background_id TEXT,
    portrait      TEXT,                          -- data-URL/путь к портрету (nullable)
    build_json    TEXT NOT NULL,                 -- весь объект персонажа целиком (выбор игрока)
    state_json    TEXT,                          -- игровое состояние: хиты, потраченные ресурсы/ячейки (nullable)
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_characters_updated ON characters(updated_at);
CREATE INDEX IF NOT EXISTS idx_characters_name    ON characters(name COLLATE NOCASE);
