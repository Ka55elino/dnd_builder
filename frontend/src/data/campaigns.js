/**
 * Campaigns (campaigns.go, db/schema/campaigns.sql).
 *
 *   campaign: { id, name, description, status, data, createdAt, updatedAt, npcs, locations, … }
 *     status: planned | active | paused | finished
 *     data.startLocationId — where the adventure begins (one location of the campaign)
 *   location: { id, campaignId, parentId ('' — top level), name, type, image, visible,
 *               data: { readAloud, notes, tags: [] } }
 *   npc:      { id, campaignId, name, portrait, role, race, status, attitude, locationId,
 *               monsterId (statblock from the bestiary), visible,
 *               data: { appearance, voice, motivation, secret, notes, tags: [] } }
 *   encounter: { id, name, notes, monsters: [{ monsterId, count }], locationId } — a preset
 *              (also in the Bestiary) the campaign includes; locationId — where it happens
 *   quest:    { id, campaignId, name, kind (main | side | personal), status, giverNpcId, locationId,
 *               reward, visible, data: { summary, objectives: [{ text, done }], notes, tags: [] } }
 *   faction:  { id, campaignId, name, type, emblem, attitude, reputation (-10…10), leaderNpcId,
 *               hqLocationId, visible, data: { description, goals, secret, notes, tags: [] } }
 *               members — NPCs linked to it: npc → faction, kind 'member_of' (note — their rank)
 *   link:     { id, campaignId, fromType, fromId, toType, toId, kind, note }
 *   session:  { id, campaignId, number, title, playedOn, ingameDate, status (planned | active | played),
 *               data: { prep, secrets: [{ text, revealed }], planned: { npcs, locations, encounters, quests },
 *                       recap, notes, attendees: [], xp, loot }, events (count) }
 *   event:    { id, sessionId, kind, refType, refId, refName, outcome, note, auto, at, position,
 *               change: { field, from, to, delta?, index? } | null } — see EVENT_KINDS
 *   map layer: every location / encounter can have a map (maps.go) — { ownerType ('location' |
 *               'encounter'), ownerId, tiles: { tileId: [x1, y1, x2, y2…] }, markers: [{ refType
 *               ('location' | 'npc' | 'encounter'), refId, x, y }] }; the layer list — { ownerType,
 *               ownerId, cells, markers } (counts)
 *   visible — the players know it (shown to them later; for now just a flag)
 *
 * An app built before these bindings existed has no methods: lists are empty and
 * saving explains why (wails3 dev regenerates the bindings).
 */
import {
    GetCampaigns, GetCampaign, SaveCampaign, DeleteCampaign,
    GetCampaignLocations, SaveLocation, DeleteLocation,
    GetCampaignNpcs, SaveNpc, DeleteNpc,
    GetCampaignLinks, SaveLink, DeleteLink,
    GetCampaignEncounters, SaveCampaignEncounter, AddCampaignEncounter, RemoveCampaignEncounter,
    GetCampaignQuests, SaveQuest, DeleteQuest,
    GetCampaignFactions, SaveFaction, DeleteFaction,
    GetCampaignSessions, GetSession, GetActiveSession, SaveSession, SetSessionStatus, DeleteSession,
    GetSessionEvents, GetRefEvents, AddSessionEvent, LogToActiveSession, UpdateSessionEvent, DeleteSessionEvent,
    GetMapLayers, GetMapLayer, SaveMapCells, PlaceMapMarker, RemoveMapMarker,
} from '../api.js';

export const CAMPAIGN_STATUSES = [
    { id: 'planned', name: 'Planned' },
    { id: 'active', name: 'Active' },
    { id: 'paused', name: 'Paused' },
    { id: 'finished', name: 'Finished' },
];

export const NPC_STATUSES = [
    { id: 'alive', name: 'Alive' },
    { id: 'dead', name: 'Dead' },
    { id: 'missing', name: 'Missing' },
    { id: 'unknown', name: 'Unknown' },
];

/** Towards the party, from worst to best. */
export const NPC_ATTITUDES = [
    { id: 'hostile', name: 'Hostile' },
    { id: 'unfriendly', name: 'Unfriendly' },
    { id: 'neutral', name: 'Neutral' },
    { id: 'friendly', name: 'Friendly' },
    { id: 'ally', name: 'Ally' },
];

export const QUEST_KINDS = [
    { id: 'main', name: 'Main' },
    { id: 'side', name: 'Side' },
    { id: 'personal', name: 'Personal' },
];

/** In display order: what's being done first. */
export const QUEST_STATUSES = [
    { id: 'active', name: 'Active' },
    { id: 'open', name: 'Open' },
    { id: 'completed', name: 'Completed' },
    { id: 'failed', name: 'Failed' },
    { id: 'abandoned', name: 'Abandoned' },
];

/** Suggestions for a faction's type (free text). */
export const FACTION_TYPES = ['Guild', 'Cult', 'Noble house', 'Town guard', 'Army', 'Church', 'Bandit gang', 'Thieves\' guild', 'Tribe', 'Secret society'];

/** Suggestions for a location's type (it is free text). */
export const LOCATION_TYPES = ['Region', 'Settlement', 'District', 'Building', 'Room', 'Dungeon', 'Wilderness', 'Landmark', 'Plane'];

const need = (fn) => {
    if (!fn) throw new Error('Update the app: this version has no campaigns yet.');
    return fn;
};
const list = async (fn, ...args) => (fn ? (await fn(...args)) ?? [] : []);

export const loadCampaigns = () => list(GetCampaigns);
export const loadCampaign = (id) => need(GetCampaign)(id);
/** Create (no id) or update; returns the id. */
export const saveCampaign = (c) => need(SaveCampaign)(JSON.stringify(c));
export const deleteCampaign = (id) => need(DeleteCampaign)(id);

export const loadLocations = (campaignId) => list(GetCampaignLocations, campaignId);
export const saveLocation = (l) => need(SaveLocation)(JSON.stringify(l));
export const deleteLocation = (id) => need(DeleteLocation)(id);

export const loadNpcs = (campaignId) => list(GetCampaignNpcs, campaignId);
export const saveNpc = (n) => need(SaveNpc)(JSON.stringify(n));
export const deleteNpc = (id) => need(DeleteNpc)(id);

export const loadQuests = (campaignId) => list(GetCampaignQuests, campaignId);
export const saveQuest = (q) => need(SaveQuest)(JSON.stringify(q));
export const deleteQuest = (id) => need(DeleteQuest)(id);

export const loadFactions = (campaignId) => list(GetCampaignFactions, campaignId);
export const saveFaction = (f) => need(SaveFaction)(JSON.stringify(f));
export const deleteFaction = (id) => need(DeleteFaction)(id);

// ---------- sessions and their log ----------

export const SESSION_STATUSES = [
    { id: 'planned', name: 'Planned' },
    { id: 'active', name: 'Playing now' },
    { id: 'played', name: 'Played' },
];

/**
 * What can be logged. ref — what it is about (the subject list in the log bar);
 * param — what else to ask: attitude | npcStatus | questStatus | objective | delta | outcome | secret.
 * Kinds with a change (Go: sessions.go eventKinds) update the subject — deleting the entry undoes it.
 */
export const EVENT_KINDS = [
    { id: 'encounter_done', group: 'Encounters', name: 'Encounter fought', icon: '⚔', ref: 'encounter', param: 'outcome' },
    { id: 'encounter_skipped', group: 'Encounters', name: 'Encounter skipped', icon: '↷', ref: 'encounter', param: 'skip' },
    { id: 'npc_met', group: 'NPCs', name: 'Met an NPC', icon: '☺', ref: 'npc', changes: 'known to the players' },
    { id: 'npc_talked', group: 'NPCs', name: 'Talked with an NPC', icon: '💬', ref: 'npc' },
    { id: 'npc_attitude', group: 'NPCs', name: 'NPC attitude changed', icon: '⇅', ref: 'npc', param: 'attitude', changes: 'attitude' },
    { id: 'npc_status', group: 'NPCs', name: 'NPC died / went missing…', icon: '✝', ref: 'npc', param: 'npcStatus', changes: 'status' },
    { id: 'quest_received', group: 'Quests', name: 'Quest received', icon: '✦', ref: 'quest', changes: 'status → active' },
    { id: 'quest_objective', group: 'Quests', name: 'Quest objective done', icon: '☑', ref: 'quest', param: 'objective', changes: 'the objective' },
    { id: 'quest_status', group: 'Quests', name: 'Quest completed / failed…', icon: '✔', ref: 'quest', param: 'questStatus', changes: 'status' },
    { id: 'location_visited', group: 'World', name: 'Location visited', icon: '⌂', ref: 'location', changes: 'known to the players' },
    { id: 'faction_reputation', group: 'World', name: 'Faction reputation', icon: '⚑', ref: 'faction', param: 'delta', changes: 'reputation' },
    { id: 'faction_attitude', group: 'World', name: 'Faction attitude changed', icon: '⇅', ref: 'faction', param: 'attitude', changes: 'attitude' },
    { id: 'secret_revealed', group: 'World', name: 'Secret / clue revealed', icon: '🗝', ref: 'session', param: 'secret', changes: 'the secret' },
    { id: 'item_given', group: 'Party', name: 'Item given', icon: '🎁' },
    { id: 'loot', group: 'Party', name: 'Loot found', icon: '💰' },
    { id: 'xp', group: 'Party', name: 'XP / milestone', icon: '★' },
    { id: 'character', group: 'Party', name: 'Character event', icon: '♙' },
    { id: 'rest', group: 'Party', name: 'Rest', icon: '☾' },
    { id: 'time', group: 'Party', name: 'Time passes', icon: '⧗' },
    { id: 'note', group: 'Party', name: 'Note', icon: '✎' },
];
export const eventKind = (id) => EVENT_KINDS.find((k) => k.id === id) ?? { id, name: id, icon: '•' };

export const ENCOUNTER_OUTCOMES = [
    { id: 'victory', name: 'Victory' },
    { id: 'negotiated', name: 'Talked out of it' },
    { id: 'fled', name: 'The party fled' },
    { id: 'enemies_fled', name: 'The enemies fled' },
    { id: 'defeated', name: 'The party was defeated' },
    { id: 'ended', name: 'Ended' },
];
export const SKIP_REASONS = [
    { id: 'skipped', name: 'Skipped' },
    { id: 'avoided', name: 'Avoided (stealth, another route)' },
    { id: 'not_reached', name: "Didn't get there" },
    { id: 'postponed', name: 'Postponed' },
];

export const loadSessions = (campaignId) => list(GetCampaignSessions, campaignId);
export const loadSession = (id) => need(GetSession)(id);
/** The session being played now (the game's auto-log goes there), or null. */
export const loadActiveSession = async () => (GetActiveSession ? (await GetActiveSession()) ?? null : null);
export const saveSession = (s) => need(SaveSession)(JSON.stringify(s));
/** 'active' — start it (any other active one ends), 'played' — end it, 'planned'. */
export const setSessionStatus = (id, status) => need(SetSessionStatus)(id, status);
export const deleteSession = (id) => need(DeleteSession)(id);

export const loadEvents = (sessionId) => list(GetSessionEvents, sessionId);
/** The history of one thing across the sessions (npc | quest | location | faction | encounter). */
export const loadRefEvents = (campaignId, refType, refId) => list(GetRefEvents, campaignId, refType, refId);
/** Log an event (and apply its change). Returns the stored event. */
export const addEvent = (e) => need(AddSessionEvent)(JSON.stringify(e));
export const updateEvent = (id, note, outcome, position) => need(UpdateSessionEvent)(id, note ?? '', outcome ?? '', position ?? 0);
/** Delete it and undo its change (if nobody changed the value since). */
export const deleteEvent = (id) => need(DeleteSessionEvent)(id);

/**
 * The game's auto-log (combat, Give Item): into the session being played now; nothing
 * happens without one, or in an app without the binding. Never throws.
 */
export async function logToActiveSession(e) {
    try {
        if (!LogToActiveSession) return '';
        return (await LogToActiveSession(JSON.stringify(e))) ?? '';
    } catch (err) {
        console.warn('[session log]', err);
        return '';
    }
}

/** An event as one line of text (names: the session's secrets, the quest's objectives). */
export function eventText(e, { attitudes = [], statuses = [], questStatuses = [], secrets = [], objectives = {} } = {}) {
    const ref = e.refName || '';
    const nm = (list, id) => list.find((x) => x.id === id)?.name ?? id;
    const c = e.change;
    switch (e.kind) {
        case 'encounter_done': return `Fought ${ref || 'an encounter'}`;
        case 'encounter_skipped': return `Skipped ${ref || 'an encounter'}`;
        case 'npc_met': return `Met ${ref}`;
        case 'npc_talked': return `Talked with ${ref}`;
        case 'npc_attitude': return `${ref}: ${nm(attitudes, c?.from)} → ${nm(attitudes, c?.to)}`;
        case 'npc_status': return `${ref} — ${nm(statuses, c?.to)}`;
        case 'quest_received': return `Quest received: ${ref}`;
        case 'quest_objective': {
            const t = objectives[e.refId]?.[c?.index]?.text;
            return `${ref}: objective done${t ? ` — ${t}` : ''}`;
        }
        case 'quest_status': return `${ref}: ${nm(questStatuses, c?.to)}`;
        case 'location_visited': return `Visited ${ref}`;
        case 'faction_reputation': return `${ref}: reputation ${c?.from ?? '?'} → ${c?.to ?? '?'}`;
        case 'faction_attitude': return `${ref}: ${nm(attitudes, c?.from)} → ${nm(attitudes, c?.to)}`;
        case 'secret_revealed': return `Revealed: ${secrets[c?.index]?.text ?? 'a secret'}`;
        default: return eventKind(e.kind).name;
    }
}

// ---------- maps (maps.go) ----------

/** Every map of the campaign without its cells: [{ ownerType, ownerId, cells, markers }]. */
export const loadMapLayers = (campaignId) => list(GetMapLayers, campaignId);
/** One map: { tiles, markers } (empty if nothing is painted yet). */
export const loadMapLayer = (campaignId, ownerType, ownerId) => need(GetMapLayer)(campaignId, ownerType, ownerId);
/** Store a map's terrain; cells — { "x,y": tileId }. */
export const saveMapCells = (campaignId, ownerType, ownerId, cells) =>
    need(SaveMapCells)(campaignId, ownerType, ownerId, JSON.stringify(cellsToTiles(cells)));
export const placeMapMarker = (campaignId, ownerType, ownerId, refType, refId, x, y) =>
    need(PlaceMapMarker)(campaignId, ownerType, ownerId, refType, refId, x, y);
export const removeMapMarker = (campaignId, ownerType, ownerId, refType, refId) =>
    need(RemoveMapMarker)(campaignId, ownerType, ownerId, refType, refId);

/** { "x,y": tileId } → the stored form, grouped by tile: { v: 1, tiles: { tileId: [x, y, …] } }. */
export function cellsToTiles(cells) {
    const tiles = {};
    for (const [k, t] of Object.entries(cells ?? {})) {
        if (!t) continue;
        const [x, y] = k.split(',').map(Number);
        (tiles[t] ??= []).push(x, y);
    }
    return { v: 1, tiles };
}

/** The stored tiles → { "x,y": tileId }. */
export function tilesToCells(tiles) {
    const cells = {};
    for (const [t, xy] of Object.entries(tiles ?? {})) for (let i = 0; i + 1 < xy.length; i += 2) cells[`${xy[i]},${xy[i + 1]}`] = t;
    return cells;
}

export const loadLinks = (campaignId) => list(GetCampaignLinks, campaignId);
/** Create a link (or update the note of the same one); returns the id. */
export const saveLink = (l) => need(SaveLink)(JSON.stringify(l));
export const deleteLink = (id) => need(DeleteLink)(id);

export const loadCampaignEncounters = (campaignId) => list(GetCampaignEncounters, campaignId);
/** Save the preset (new or changed) and put it in the campaign at locationId ('' — none). Returns its id. */
export const saveCampaignEncounter = (campaignId, enc, locationId = '') =>
    need(SaveCampaignEncounter)(campaignId, JSON.stringify(enc), locationId || '');
/** Put an existing preset (from the Bestiary) into the campaign. */
export const addCampaignEncounter = (campaignId, encounterId, locationId = '') =>
    need(AddCampaignEncounter)(campaignId, encounterId, locationId || '');
/** Take it out of the campaign; deletePreset — delete the preset everywhere (Bestiary too). */
export const removeCampaignEncounter = (campaignId, encounterId, deletePreset = false) =>
    need(RemoveCampaignEncounter)(campaignId, encounterId, !!deletePreset);

/**
 * Locations as a tree in display order: [{ loc, depth, path }] — parents first, children
 * under them, alphabetical within a level. path — "Region › City".
 */
export function locationTree(locations) {
    const kids = new Map();
    const ids = new Set(locations.map((l) => l.id));
    for (const l of locations) {
        const p = l.parentId && ids.has(l.parentId) ? l.parentId : '';
        if (!kids.has(p)) kids.set(p, []);
        kids.get(p).push(l);
    }
    for (const arr of kids.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    const out = [];
    const walk = (p, depth, path) => {
        for (const l of kids.get(p) ?? []) {
            out.push({ loc: l, depth, path: [...path, l.name].join(' › ') });
            if (depth < 32) walk(l.id, depth + 1, [...path, l.name]);
        }
    };
    walk('', 0, []);
    return out;
}

/** A location and everything inside it (ids) — it can't be its own parent. */
export function locationAndDescendants(locations, id) {
    const out = new Set([id]);
    let grew = true;
    while (grew) {
        grew = false;
        for (const l of locations) if (l.parentId && out.has(l.parentId) && !out.has(l.id)) (out.add(l.id), (grew = true));
    }
    return out;
}
