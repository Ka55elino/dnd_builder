-- Wild Shape forms: which bestiary monsters a class (or a subclass) can turn into, from
-- which level. A separate link: the monsters themselves don't change, and a form can be
-- added or removed here (is_custom = 1 — added by the user). Seeds: assets/data/wildshape.
CREATE TABLE IF NOT EXISTS wild_shape_forms (
    monster_id  TEXT NOT NULL,                   -- monsters.id
    class_id    TEXT NOT NULL,                   -- 'druid'
    subclass_id TEXT NOT NULL DEFAULT '',        -- 'moon' — that subclass only; '' — every druid
    min_level   INTEGER NOT NULL DEFAULT 2,      -- the class level it becomes available at
    sort        INTEGER NOT NULL DEFAULT 0,
    is_custom   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (monster_id, class_id, subclass_id)
);

CREATE INDEX IF NOT EXISTS idx_wild_shape_class ON wild_shape_forms(class_id);
