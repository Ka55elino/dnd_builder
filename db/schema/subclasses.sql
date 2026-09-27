-- Subclasses (reference data). Linked to their class via class_id.
CREATE TABLE IF NOT EXISTS subclasses (
    id         TEXT PRIMARY KEY,                 -- 'hunter'
    class_id   TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,                    -- 'Hunter'
    image      TEXT,                             -- image, "/img/…" URL (see images.go) | NULL
    data_json  TEXT NOT NULL,                    -- features and everything else
    is_custom  INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_subclasses_class ON subclasses(class_id);
CREATE INDEX IF NOT EXISTS idx_subclasses_name  ON subclasses(name COLLATE NOCASE);
