-- Conditions and named effects (reference data): Prone, Grappled, Exhaustion… and
-- effects like Slowed or Enlarged. What they do is in data_json.modifiers (see
-- frontend/src/rules/modifiers.js); which ones a character has is in state_json.effects.
CREATE TABLE IF NOT EXISTS conditions (
    id          TEXT PRIMARY KEY,                -- 'prone'
    name        TEXT NOT NULL,                   -- 'Prone'
    category    TEXT NOT NULL DEFAULT 'condition', -- condition | effect
    description TEXT,                            -- the 'desc' field from JSON
    data_json   TEXT NOT NULL,                   -- modifiers, implies, levels, icon...
    is_custom   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_conditions_name ON conditions(name COLLATE NOCASE);
