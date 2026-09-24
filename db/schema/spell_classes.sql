-- Связь «многие-ко-многим»: какие классы имеют доступ к заклинанию.
-- Нужна для поиска «все заклинания класса X уровня N» через JOIN.
CREATE TABLE IF NOT EXISTS spell_classes (
    spell_id TEXT NOT NULL REFERENCES spells(id) ON DELETE CASCADE,
    class_id TEXT NOT NULL,
    PRIMARY KEY (spell_id, class_id)
);

CREATE INDEX IF NOT EXISTS idx_spell_classes_class ON spell_classes(class_id);
