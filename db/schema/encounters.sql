-- Encounter presets made by the DM in the bestiary: a named group of monsters.
CREATE TABLE IF NOT EXISTS encounters (
    id            TEXT PRIMARY KEY,              -- 'enc_xxxx'
    name          TEXT NOT NULL,                 -- 'Goblin ambush'
    notes         TEXT NOT NULL DEFAULT '',      -- the DM's notes: tactics, terrain, loot
    monsters_json TEXT NOT NULL DEFAULT '[]',    -- [{ "monsterId": "goblinWarrior", "count": 4 }, …]
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_encounters_updated ON encounters(updated_at);
