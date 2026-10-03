-- Queries for campaigns and what's in them (see db/schema/campaigns.sql).
-- Each query starts with a "-- name: QueryName" line (see queries.go).

-- name: GetAllCampaigns
-- The list, most recently changed first, with how much is in each.
SELECT c.id, c.name, c.description, c.status, c.data_json, c.created_at, c.updated_at,
       (SELECT COUNT(*) FROM campaign_npcs n WHERE n.campaign_id = c.id),
       (SELECT COUNT(*) FROM campaign_locations l WHERE l.campaign_id = c.id),
       (SELECT COUNT(*) FROM campaign_links k
        WHERE k.campaign_id = c.id AND k.from_type = 'campaign' AND k.to_type = 'encounter' AND k.kind = 'includes'),
       (SELECT COUNT(*) FROM campaign_quests q WHERE q.campaign_id = c.id),
       (SELECT COUNT(*) FROM campaign_factions f WHERE f.campaign_id = c.id),
       (SELECT COUNT(*) FROM campaign_sessions s WHERE s.campaign_id = c.id)
FROM campaigns c
ORDER BY c.updated_at DESC, c.name COLLATE NOCASE;

-- name: GetCampaign
SELECT c.id, c.name, c.description, c.status, c.data_json, c.created_at, c.updated_at,
       (SELECT COUNT(*) FROM campaign_npcs n WHERE n.campaign_id = c.id),
       (SELECT COUNT(*) FROM campaign_locations l WHERE l.campaign_id = c.id),
       (SELECT COUNT(*) FROM campaign_links k
        WHERE k.campaign_id = c.id AND k.from_type = 'campaign' AND k.to_type = 'encounter' AND k.kind = 'includes'),
       (SELECT COUNT(*) FROM campaign_quests q WHERE q.campaign_id = c.id),
       (SELECT COUNT(*) FROM campaign_factions f WHERE f.campaign_id = c.id),
       (SELECT COUNT(*) FROM campaign_sessions s WHERE s.campaign_id = c.id)
FROM campaigns c
WHERE c.id = ?;

-- name: UpsertCampaign
INSERT INTO campaigns (id, name, description, status, data_json) VALUES (?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    name        = excluded.name,
    description = excluded.description,
    status      = excluded.status,
    data_json   = excluded.data_json,
    updated_at  = strftime('%s','now');

-- Deleting a campaign: its links, NPCs and locations first, then the campaign
-- (explicitly, in one transaction — not only relying on ON DELETE CASCADE).

-- name: DeleteCampaignLinks
DELETE FROM campaign_links WHERE campaign_id = ?;

-- name: DeleteCampaignBoardNodes
DELETE FROM campaign_board_nodes WHERE board_id IN (SELECT id FROM campaign_boards WHERE campaign_id = ?);

-- name: DeleteCampaignBoards
DELETE FROM campaign_boards WHERE campaign_id = ?;

-- name: DeleteCampaignEvents
DELETE FROM campaign_session_events WHERE campaign_id = ?;

-- name: DeleteCampaignSessions
DELETE FROM campaign_sessions WHERE campaign_id = ?;

-- name: DeleteCampaignQuests
DELETE FROM campaign_quests WHERE campaign_id = ?;

-- name: DeleteCampaignFactions
DELETE FROM campaign_factions WHERE campaign_id = ?;

-- name: DeleteCampaignNpcs
DELETE FROM campaign_npcs WHERE campaign_id = ?;

-- name: DeleteCampaignLocations
DELETE FROM campaign_locations WHERE campaign_id = ?;

-- name: DeleteCampaign
DELETE FROM campaigns WHERE id = ?;

-- ---------- locations ----------

-- name: GetCampaignLocations
SELECT id, campaign_id, parent_id, name, type, image, visible, data_json, created_at, updated_at
FROM campaign_locations
WHERE campaign_id = ?
ORDER BY name COLLATE NOCASE;

-- name: GetLocationCampaign
SELECT campaign_id FROM campaign_locations WHERE id = ?;

-- name: UpsertLocation
INSERT INTO campaign_locations (id, campaign_id, parent_id, name, type, image, visible, data_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    parent_id  = excluded.parent_id,
    name       = excluded.name,
    type       = excluded.type,
    image      = excluded.image,
    visible    = excluded.visible,
    data_json  = excluded.data_json,
    updated_at = strftime('%s','now');

-- Deleting a location: sub-locations move up to its parent, NPCs there lose their
-- location, links to it go (explicitly — not only relying on the foreign keys).

-- name: ReparentLocations
UPDATE campaign_locations SET parent_id = ?, updated_at = strftime('%s','now') WHERE parent_id = ?;

-- name: UnsetNpcLocation
UPDATE campaign_npcs SET location_id = NULL, updated_at = strftime('%s','now') WHERE location_id = ?;

-- name: DeleteLocation
DELETE FROM campaign_locations WHERE id = ?;

-- name: UnsetStartLocation
-- The campaign's starting location (data_json.startLocationId) was deleted.
UPDATE campaigns SET data_json = json_remove(data_json, '$.startLocationId')
WHERE id = ? AND json_extract(data_json, '$.startLocationId') = ?;

-- ---------- NPCs ----------

-- name: GetCampaignNpcs
SELECT id, campaign_id, name, portrait, role, race, status, attitude, location_id, monster_id, visible,
       data_json, created_at, updated_at
FROM campaign_npcs
WHERE campaign_id = ?
ORDER BY name COLLATE NOCASE;

-- name: UpsertNpc
INSERT INTO campaign_npcs (id, campaign_id, name, portrait, role, race, status, attitude, location_id, monster_id, visible, data_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    name        = excluded.name,
    portrait    = excluded.portrait,
    role        = excluded.role,
    race        = excluded.race,
    status      = excluded.status,
    attitude    = excluded.attitude,
    location_id = excluded.location_id,
    monster_id  = excluded.monster_id,
    visible     = excluded.visible,
    data_json   = excluded.data_json,
    updated_at  = strftime('%s','now');

-- name: GetNpcCampaign
SELECT campaign_id FROM campaign_npcs WHERE id = ?;

-- name: DeleteNpc
DELETE FROM campaign_npcs WHERE id = ?;

-- ---------- links (used by deletes for now) ----------

-- name: DeleteLinksOf
-- Every link from or to this thing (type + id).
DELETE FROM campaign_links WHERE (from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?);

-- name: TouchCampaign
UPDATE campaigns SET updated_at = strftime('%s','now') WHERE id = ?;

-- ---------- links ----------

-- name: GetCampaignLinks
SELECT id, campaign_id, from_type, from_id, to_type, to_id, kind, note, created_at
FROM campaign_links
WHERE campaign_id = ?
ORDER BY created_at, id;

-- name: UpsertLink
-- The same two ends with the same kind are one link: a second save only updates the note.
INSERT INTO campaign_links (id, campaign_id, from_type, from_id, to_type, to_id, kind, note)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(campaign_id, from_type, from_id, to_type, to_id, kind) DO UPDATE SET note = excluded.note;

-- name: GetLinkId
SELECT id FROM campaign_links
WHERE campaign_id = ? AND from_type = ? AND from_id = ? AND to_type = ? AND to_id = ? AND kind = ?;

-- name: DeleteLink
DELETE FROM campaign_links WHERE id = ?;

-- name: DeleteLinksFrom
-- In one campaign: every link of this kind from this thing (an encounter's "happens_at").
DELETE FROM campaign_links WHERE campaign_id = ? AND from_type = ? AND from_id = ? AND kind = ?;

-- name: DeleteCampaignLinksOf
-- In one campaign: every link from or to this thing.
DELETE FROM campaign_links
WHERE campaign_id = ? AND ((from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?));

-- ---------- encounters in a campaign ----------
-- Encounters stay presets (the encounters table, also in the Bestiary). A campaign has one
-- through a link campaign → encounter ("includes"); where it happens — encounter → location
-- ("happens_at").

-- name: GetCampaignEncounters
SELECT e.id, e.name, e.notes, e.monsters_json, e.updated_at,
       COALESCE((SELECT h.to_id FROM campaign_links h
                 WHERE h.campaign_id = l.campaign_id AND h.from_type = 'encounter' AND h.from_id = e.id
                   AND h.kind = 'happens_at' AND h.to_type = 'location' LIMIT 1), '')
FROM campaign_links l
JOIN encounters e ON e.id = l.to_id
WHERE l.campaign_id = ? AND l.from_type = 'campaign' AND l.to_type = 'encounter' AND l.kind = 'includes'
ORDER BY e.name COLLATE NOCASE;

-- name: EncounterExists
SELECT COUNT(*) FROM encounters WHERE id = ?;

-- name: CountCampaigns
SELECT COUNT(*) FROM campaigns;

-- ---------- quests ----------

-- name: GetCampaignQuests
SELECT id, campaign_id, name, kind, status, giver_npc_id, location_id, reward, visible, data_json, created_at, updated_at
FROM campaign_quests
WHERE campaign_id = ?
ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'open' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
         CASE kind WHEN 'main' THEN 0 ELSE 1 END, name COLLATE NOCASE;

-- name: GetQuestCampaign
SELECT campaign_id FROM campaign_quests WHERE id = ?;

-- name: UpsertQuest
INSERT INTO campaign_quests (id, campaign_id, name, kind, status, giver_npc_id, location_id, reward, visible, data_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    name         = excluded.name,
    kind         = excluded.kind,
    status       = excluded.status,
    giver_npc_id = excluded.giver_npc_id,
    location_id  = excluded.location_id,
    reward       = excluded.reward,
    visible      = excluded.visible,
    data_json    = excluded.data_json,
    updated_at   = strftime('%s','now');

-- name: DeleteQuest
DELETE FROM campaign_quests WHERE id = ?;

-- ---------- factions ----------

-- name: GetCampaignFactions
SELECT id, campaign_id, name, type, emblem, attitude, reputation, leader_npc_id, hq_location_id, visible, data_json, created_at, updated_at
FROM campaign_factions
WHERE campaign_id = ?
ORDER BY name COLLATE NOCASE;

-- name: GetFactionCampaign
SELECT campaign_id FROM campaign_factions WHERE id = ?;

-- name: UpsertFaction
INSERT INTO campaign_factions (id, campaign_id, name, type, emblem, attitude, reputation, leader_npc_id, hq_location_id, visible, data_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    name           = excluded.name,
    type           = excluded.type,
    emblem         = excluded.emblem,
    attitude       = excluded.attitude,
    reputation     = excluded.reputation,
    leader_npc_id  = excluded.leader_npc_id,
    hq_location_id = excluded.hq_location_id,
    visible        = excluded.visible,
    data_json      = excluded.data_json,
    updated_at     = strftime('%s','now');

-- name: DeleteFaction
DELETE FROM campaign_factions WHERE id = ?;

-- An NPC / location is deleted: quests and factions that pointed at it keep going without it.

-- name: UnsetNpcRefs
UPDATE campaign_quests SET giver_npc_id = NULL WHERE giver_npc_id = ?;

-- name: UnsetFactionLeader
UPDATE campaign_factions SET leader_npc_id = NULL WHERE leader_npc_id = ?;

-- name: UnsetQuestLocation
UPDATE campaign_quests SET location_id = NULL WHERE location_id = ?;

-- name: UnsetFactionHq
UPDATE campaign_factions SET hq_location_id = NULL WHERE hq_location_id = ?;

-- ---------- sessions ----------

-- name: GetCampaignSessions
SELECT s.id, s.campaign_id, s.number, s.title, s.played_on, s.ingame_date, s.status, s.data_json,
       s.created_at, s.updated_at,
       (SELECT COUNT(*) FROM campaign_session_events e WHERE e.session_id = s.id)
FROM campaign_sessions s
WHERE s.campaign_id = ?
ORDER BY s.number DESC, s.created_at DESC;

-- name: GetSession
SELECT s.id, s.campaign_id, s.number, s.title, s.played_on, s.ingame_date, s.status, s.data_json,
       s.created_at, s.updated_at,
       (SELECT COUNT(*) FROM campaign_session_events e WHERE e.session_id = s.id)
FROM campaign_sessions s
WHERE s.id = ?;

-- name: GetActiveSession
-- The session being played now (at most one in the whole app).
SELECT s.id, s.campaign_id, s.number, s.title, s.played_on, s.ingame_date, s.status, s.data_json,
       s.created_at, s.updated_at,
       (SELECT COUNT(*) FROM campaign_session_events e WHERE e.session_id = s.id)
FROM campaign_sessions s
WHERE s.status = 'active'
ORDER BY s.updated_at DESC
LIMIT 1;

-- name: NextSessionNumber
SELECT COALESCE(MAX(number), 0) + 1 FROM campaign_sessions WHERE campaign_id = ?;

-- name: UpsertSession
INSERT INTO campaign_sessions (id, campaign_id, number, title, played_on, ingame_date, status, data_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    number      = excluded.number,
    title       = excluded.title,
    played_on   = excluded.played_on,
    ingame_date = excluded.ingame_date,
    status      = excluded.status,
    data_json   = excluded.data_json,
    updated_at  = strftime('%s','now');

-- name: GetSessionCampaign
SELECT campaign_id FROM campaign_sessions WHERE id = ?;

-- name: SetSessionStatus
UPDATE campaign_sessions SET status = ?, updated_at = strftime('%s','now') WHERE id = ?;

-- name: EndActiveSessions
-- Starting a session ends any other one being played.
UPDATE campaign_sessions SET status = 'played', updated_at = strftime('%s','now') WHERE status = 'active' AND id <> ?;

-- name: DeleteSessionEvents
DELETE FROM campaign_session_events WHERE session_id = ?;

-- name: DeleteSession
DELETE FROM campaign_sessions WHERE id = ?;

-- ---------- session events (the log) ----------

-- name: GetSessionEvents
SELECT id, session_id, campaign_id, at, position, kind, ref_type, ref_id, ref_name, outcome, change_json, note, auto
FROM campaign_session_events
WHERE session_id = ?
ORDER BY position, at, id;

-- name: GetRefEvents
-- The history of one thing (an NPC, a quest…) across the campaign's sessions, with the session's number.
SELECT e.id, e.session_id, e.campaign_id, e.at, e.position, e.kind, e.ref_type, e.ref_id, e.ref_name, e.outcome,
       e.change_json, e.note, e.auto, s.number, s.title
FROM campaign_session_events e
JOIN campaign_sessions s ON s.id = e.session_id
WHERE e.campaign_id = ? AND e.ref_type = ? AND e.ref_id = ?
ORDER BY s.number, e.position, e.at;

-- name: GetEvent
SELECT id, session_id, campaign_id, at, position, kind, ref_type, ref_id, ref_name, outcome, change_json, note, auto
FROM campaign_session_events WHERE id = ?;

-- name: NextEventPosition
SELECT COALESCE(MAX(position), 0) + 1 FROM campaign_session_events WHERE session_id = ?;

-- name: InsertEvent
INSERT INTO campaign_session_events (id, session_id, campaign_id, at, position, kind, ref_type, ref_id, ref_name, outcome, change_json, note, auto)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);

-- name: UpdateEvent
-- What can be edited afterwards: the note, the outcome, the order (not the change itself).
UPDATE campaign_session_events SET note = ?, outcome = ?, position = ? WHERE id = ?;

-- name: DeleteEvent
DELETE FROM campaign_session_events WHERE id = ?;

-- name: TouchSession
UPDATE campaign_sessions SET updated_at = strftime('%s','now') WHERE id = ?;

-- ---------- the board (the campaign's diagram) ----------

-- name: GetCampaignBoard
SELECT id, campaign_id, name, data_json FROM campaign_boards WHERE campaign_id = ? ORDER BY created_at LIMIT 1;

-- name: InsertBoard
INSERT INTO campaign_boards (id, campaign_id, name) VALUES (?, ?, ?);

-- name: GetBoardCampaign
SELECT campaign_id FROM campaign_boards WHERE id = ?;

-- name: GetBoardNodes
SELECT ref_type, ref_id, x, y, w, h FROM campaign_board_nodes WHERE board_id = ?;

-- name: UpsertBoardNode
INSERT INTO campaign_board_nodes (board_id, ref_type, ref_id, x, y, w, h) VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(board_id, ref_type, ref_id) DO UPDATE SET x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h;

-- name: ClearBoardNodes
-- "Tidy up": forget every position (the board lays itself out again).
DELETE FROM campaign_board_nodes WHERE board_id = ?;

-- name: TouchBoard
UPDATE campaign_boards SET updated_at = strftime('%s','now') WHERE id = ?;

-- name: GetPartyLocation
-- Where the party is: the latest "location visited" in the campaign's logs.
SELECT e.ref_id
FROM campaign_session_events e
JOIN campaign_sessions s ON s.id = e.session_id
WHERE e.campaign_id = ? AND e.kind = 'location_visited' AND e.ref_id <> ''
ORDER BY s.number DESC, e.position DESC, e.at DESC
LIMIT 1;

-- name: GetQuestRoutesWith
-- Quests whose route goes through a location (to drop it from the route when it is deleted).
SELECT id, data_json FROM campaign_quests
WHERE campaign_id = ? AND data_json LIKE '%' || ? || '%';

-- name: SetQuestData
UPDATE campaign_quests SET data_json = ?, updated_at = strftime('%s','now') WHERE id = ?;
