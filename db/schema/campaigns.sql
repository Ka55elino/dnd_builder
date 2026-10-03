-- Campaigns (the DM's own data, not reference data): a campaign with its NPCs, locations
-- and the links between anything in it (who lives where, who knows whom, which encounter
-- happens where…). Everything inside a campaign is deleted with it (ON DELETE CASCADE).

CREATE TABLE IF NOT EXISTS campaigns (
    id          TEXT PRIMARY KEY,                -- 'cmp_xxxx'
    name        TEXT NOT NULL,                   -- 'The Lost Mine of Phandelver'
    description TEXT NOT NULL DEFAULT '',        -- premise, setting, tone
    status      TEXT NOT NULL DEFAULT 'active',  -- planned | active | paused | finished
    data_json   TEXT NOT NULL DEFAULT '{}',      -- anything else (cover image, settings…)
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_campaigns_updated ON campaigns(updated_at);

-- Locations: a tree (region → city → tavern → cellar) through parent_id.
CREATE TABLE IF NOT EXISTS campaign_locations (
    id          TEXT PRIMARY KEY,                -- 'loc_xxxx'
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    parent_id   TEXT REFERENCES campaign_locations(id) ON DELETE SET NULL,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT '',        -- region | settlement | building | dungeon | wilderness | room…
    image       TEXT,                            -- "/img/db/…" (images table) | NULL
    visible     INTEGER NOT NULL DEFAULT 0,      -- 1: the players know it (shown to them later)
    data_json   TEXT NOT NULL DEFAULT '{}',      -- readAloud, notes (DM only), tags…
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_locations_campaign ON campaign_locations(campaign_id);
CREATE INDEX IF NOT EXISTS idx_locations_parent   ON campaign_locations(parent_id);

-- NPCs: people the party meets. Combat stats come from a bestiary monster (monster_id).
CREATE TABLE IF NOT EXISTS campaign_npcs (
    id          TEXT PRIMARY KEY,                -- 'npc_xxxx'
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    portrait    TEXT,                            -- "/img/db/…" | NULL
    role        TEXT NOT NULL DEFAULT '',        -- 'innkeeper', 'cult leader'
    race        TEXT NOT NULL DEFAULT '',        -- free text or a species id
    status      TEXT NOT NULL DEFAULT 'alive',   -- alive | dead | missing | unknown
    attitude    TEXT NOT NULL DEFAULT 'neutral', -- hostile | unfriendly | neutral | friendly | ally (towards the party)
    location_id TEXT REFERENCES campaign_locations(id) ON DELETE SET NULL, -- where they are now
    monster_id  TEXT,                            -- statblock: a monster in the bestiary (no FK: custom ones can be deleted)
    visible     INTEGER NOT NULL DEFAULT 0,      -- 1: the players know them
    data_json   TEXT NOT NULL DEFAULT '{}',      -- appearance, voice, motivation, secret (DM only), notes, tags…
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_npcs_campaign ON campaign_npcs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_npcs_location ON campaign_npcs(location_id);

-- Quests: plot threads the party can take on. Objectives are a checklist in data_json.
CREATE TABLE IF NOT EXISTS campaign_quests (
    id           TEXT PRIMARY KEY,                -- 'qst_xxxx'
    campaign_id  TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL DEFAULT 'side',    -- main | side | personal
    status       TEXT NOT NULL DEFAULT 'open',    -- open (known, not taken) | active | completed | failed | abandoned
    giver_npc_id TEXT REFERENCES campaign_npcs(id) ON DELETE SET NULL,
    location_id  TEXT REFERENCES campaign_locations(id) ON DELETE SET NULL,
    reward       TEXT NOT NULL DEFAULT '',
    visible      INTEGER NOT NULL DEFAULT 0,      -- 1: the players know about it
    data_json    TEXT NOT NULL DEFAULT '{}',      -- summary, objectives [{ text, done }], notes (DM), tags…
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_quests_campaign ON campaign_quests(campaign_id);

-- Factions: guilds, cults, noble houses… Members are NPCs linked to it (npc → faction "member_of").
CREATE TABLE IF NOT EXISTS campaign_factions (
    id             TEXT PRIMARY KEY,              -- 'fac_xxxx'
    campaign_id    TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    type           TEXT NOT NULL DEFAULT '',      -- guild | cult | noble house | army | church…
    emblem         TEXT,                          -- "/img/db/…" | NULL
    attitude       TEXT NOT NULL DEFAULT 'neutral', -- towards the party (as for NPCs)
    reputation     INTEGER NOT NULL DEFAULT 0,    -- the party's standing with it, -10…10
    leader_npc_id  TEXT REFERENCES campaign_npcs(id) ON DELETE SET NULL,
    hq_location_id TEXT REFERENCES campaign_locations(id) ON DELETE SET NULL,
    visible        INTEGER NOT NULL DEFAULT 0,
    data_json      TEXT NOT NULL DEFAULT '{}',    -- description, goals, secret, notes, tags…
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_factions_campaign ON campaign_factions(campaign_id);

-- Sessions: one game night. Prep (plan, secrets & clues), the log (campaign_session_events),
-- and after: recap and the DM's notes (nothing here is shown to the players).
--   status: planned | active (being played now — the game's auto-log writes to it) | played
CREATE TABLE IF NOT EXISTS campaign_sessions (
    id          TEXT PRIMARY KEY,                -- 'ses_xxxx'
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    number      INTEGER NOT NULL DEFAULT 0,      -- 1, 2, 3…
    title       TEXT NOT NULL DEFAULT '',
    played_on   TEXT NOT NULL DEFAULT '',        -- real date, 'YYYY-MM-DD'
    ingame_date TEXT NOT NULL DEFAULT '',        -- free text: 'Day 12, autumn'
    status      TEXT NOT NULL DEFAULT 'planned',
    data_json   TEXT NOT NULL DEFAULT '{}',      -- prep, secrets [{ text, revealed }], planned { npcs, locations,
                                                 -- encounters, quests }, recap, notes, attendees, xp, loot
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_campaign ON campaign_sessions(campaign_id);

-- The session log. An event can change what it is about (quest → completed, NPC → met):
-- change_json keeps { field, from, to, index? } so deleting the event can put it back.
--   kind: npc_met | npc_talked | npc_attitude | npc_status | quest_received | quest_objective |
--         quest_status | location_visited | faction_reputation | faction_attitude |
--         encounter_done | encounter_skipped | secret_revealed | item_given | xp | loot | rest |
--         time | character | note
CREATE TABLE IF NOT EXISTS campaign_session_events (
    id          TEXT PRIMARY KEY,                -- 'evt_xxxx'
    session_id  TEXT NOT NULL REFERENCES campaign_sessions(id) ON DELETE CASCADE,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    at          INTEGER NOT NULL DEFAULT (strftime('%s','now')), -- when it was logged
    position    INTEGER NOT NULL DEFAULT 0,      -- order in the log (can be rearranged)
    kind        TEXT NOT NULL,
    ref_type    TEXT NOT NULL DEFAULT '',        -- npc | quest | location | faction | encounter | session | …
    ref_id      TEXT NOT NULL DEFAULT '',
    ref_name    TEXT NOT NULL DEFAULT '',        -- the name then: readable even if it's deleted later
    outcome     TEXT NOT NULL DEFAULT '',        -- victory | fled | defeated | negotiated | skipped …
    change_json TEXT NOT NULL DEFAULT '{}',
    note        TEXT NOT NULL DEFAULT '',
    auto        INTEGER NOT NULL DEFAULT 0       -- 1: written by the game (combat, Give Item)
);

CREATE INDEX IF NOT EXISTS idx_events_session ON campaign_session_events(session_id, position);
CREATE INDEX IF NOT EXISTS idx_events_ref     ON campaign_session_events(ref_type, ref_id);

-- The old campaign board (Overview graph) is gone: drop its tables from existing databases.
DROP TABLE IF EXISTS campaign_board_nodes;
DROP TABLE IF EXISTS campaign_boards;

-- Links between anything in a campaign — the edges of the future diagram.
--   from/to type: npc | location | encounter | character | quest | faction | session …
--   kind: lives_in | knows | ally | enemy | family | works_for | gives_quest | happens_at | …
-- One table for every pair of types: no junction table per pair. Not checked by foreign
-- keys (the ends live in different tables): deleting an NPC/location deletes its links in Go.
-- Encounters stay global presets (the encounters table); a campaign uses them through links.
CREATE TABLE IF NOT EXISTS campaign_links (
    id          TEXT PRIMARY KEY,                -- 'lnk_xxxx'
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    from_type   TEXT NOT NULL,
    from_id     TEXT NOT NULL,
    to_type     TEXT NOT NULL,
    to_id       TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT '',
    note        TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE (campaign_id, from_type, from_id, to_type, to_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_links_campaign ON campaign_links(campaign_id);
CREATE INDEX IF NOT EXISTS idx_links_from     ON campaign_links(from_type, from_id);
CREATE INDEX IF NOT EXISTS idx_links_to       ON campaign_links(to_type, to_id);
