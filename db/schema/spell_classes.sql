-- Many-to-many link: which classes have access to a spell.
-- Used to find "all spells of class X at level N" via JOIN.
CREATE TABLE IF NOT EXISTS spell_classes (
    spell_id TEXT NOT NULL REFERENCES spells(id) ON DELETE CASCADE,
    class_id TEXT NOT NULL,
    PRIMARY KEY (spell_id, class_id)
);

CREATE INDEX IF NOT EXISTS idx_spell_classes_class ON spell_classes(class_id);
