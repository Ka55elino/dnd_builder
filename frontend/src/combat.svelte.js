/**
 * Encounter (combat) state — the initiative line.
 *
 * DM side (`combat`): the running encounter. The line holds every combatant —
 * the players of the game and each monster separately ("Goblin Warrior 2"
 * with its own Hit Points). Only the DM changes the order. Monsters' HP are
 * counted here; players' HP stay in the player's app (changed with "hp" events).
 * Kept at module level, so it survives leaving and reopening the DM screen.
 *
 * Player side (`seen`): what the DM shares — names, icons and the order only.
 *
 * Event (DM → all players, see game.js):
 *   "encounter" { active: true, name, turn, round, line: [{ id, kind: 'player' | 'monster', name, image, type, playerId, conditions }],
 *                 positions: { combatantId: "x,y" } }     — where the DM put them on the encounter's map
 *   "encmap"    { key, name, tiles: { tileId: [x, y, …] } } — the encounter's map (terrain only), sent when
 *                 it opens and to newcomers; {} — no map. Players show it read-only (combat/PlayerMap.svelte)
 *                                                        — turn: id of the combatant whose turn it is (or null)
 *                                                        — conditions: names everyone can see ("Prone", "Exhaustion 2")
 *
 * Conditions (rules/conditions.js): monsters keep their instances here (c.effects); players'
 * live in their app — the DM sends "condition" events (game.js). When the turn passes on
 * from a combatant, its turn has ended: monsters tick here, players get { op: 'tick' }.
 *   "encounter" { active: false }                         — ended
 *
 * Nothing is rolled: the DM sets the order as it comes out at the table.
 */
import { SendGameEvent } from './api.js';
import { onGameEvent } from './server.svelte.js';
import { Character } from './models/Character.js';
import { CharacterBuild } from './models/CharacterBuild.svelte.js';
import { CharacterState } from './models/CharacterState.svelte.js';
import { isSummary } from './rules/summary.js';
import { EV } from './game.js';
import { withCondition, withoutCondition, withLevel, tickEndOfTurn, resolveSave } from './rules/conditions.js';
import { resolveConditions, conditionModifiers, applyModifiers, rowName } from './rules/modifiers.js';
import { logToActiveSession } from './data/campaigns.js';

export const EV_ENCOUNTER = 'encounter';

// ---------- DM ----------

/**
 * combat.line: [{
 *   id, kind: 'player' | 'monster', name, image,
 *   playerId,                       — player
 *   monsterId, type, ac, hp, maxHp, temp  — monster (HP counted here)
 *   effects                         — monster: condition instances (rules/conditions.js)
 * }]
 * round — counts up each time the turn wraps from the last combatant to the first
 * presetId — the encounter preset it was started from (null — a hand-made pick)
 *
 * Ending an encounter logs it into the session being played (data/campaigns.js
 * logToActiveSession): the preset, rounds, which monsters went down — the DM edits the
 * outcome afterwards if it wasn't a win.
 * playerConds — player id → condition names (from their summaries), for the public line
 * positions — combatant id → "x,y": where the DM put them on the encounter's map
 *             (MapView; for now only the DM sees it)
 */
export const combat = $state({ active: false, name: '', presetId: null, turn: null, round: 1, line: [], playerConds: {}, positions: {}, map: null });
export const EV_ENCOUNTER_MAP = 'encmap';

// condition definitions (refs.conditions) — set by the DM screen once loaded
let condDefs = [];
export function setConditionDefs(defs) {
    condDefs = defs ?? [];
}

let seq = 0;

/**
 * Start an encounter: players (lobby order) first, then the monsters.
 * lines — [{ monsterId, count }] (an encounter preset or a hand-made pick)
 */
export function startEncounter({ name = '', presetId = null, lines = [], monsters = [], players = [] }) {
    const byId = new Map(monsters.map((m) => [m.id, m]));
    const line = players.map(playerEntry);
    for (const l of lines) {
        const m = byId.get(l.monsterId);
        if (!m || !(l.count > 0)) continue;
        for (let i = 1; i <= l.count; i++) {
            line.push({
                id: `m${++seq}`,
                kind: 'monster',
                name: l.count > 1 ? `${m.name} ${i}` : m.name,
                image: m.image || '',
                monsterId: m.id,
                type: m.type,
                ac: m.ac,
                hp: m.hp,
                maxHp: m.hp,
                temp: 0,
                effects: [],
            });
        }
    }
    combat.active = true;
    combat.name = name;
    combat.presetId = presetId;
    combat.turn = null;
    combat.round = 1;
    combat.line = line;
    combat.positions = {};
    combat.map = null;
    broadcast();
    sendMap();
}

export function endEncounter() {
    if (combat.active) logEncounter();
    combat.active = false;
    combat.name = '';
    combat.presetId = null;
    combat.turn = null;
    combat.round = 1;
    combat.line = [];
    combat.positions = {};
    combat.map = null;
    broadcast();
}

// ---------- the encounter's map: where the combatants stand (the DM moves them) ----------

/** Put a combatant into a cell (or move them). A cell holds one; returns false if it is taken. */
export function placeToken(id, x, y) {
    if (!combat.line.some((c) => c.id === id)) return false;
    const k = `${x},${y}`;
    if (Object.entries(combat.positions).some(([other, pos]) => pos === k && other !== id && combat.line.some((c) => c.id === other))) return false;
    combat.positions = { ...combat.positions, [id]: k };
    broadcast();
    return true;
}

/** Take a combatant off the map. */
export function removeToken(id) {
    const { [id]: _, ...rest } = combat.positions; // eslint-disable-line no-unused-vars
    combat.positions = rest;
    broadcast();
}

/** The encounter's map (MapView sets it when it opens): { key, name, tiles } — sent to the players. */
export function setCombatMap(m) {
    combat.map = m ?? null;
    sendMap();
}

/** Send the encounter's map — to everyone, or to one player (a newcomer). */
export function sendMap(to = '') {
    const data = combat.active && combat.map ? combat.map : {};
    SendGameEvent(EV_ENCOUNTER_MAP, to, JSON.stringify(data)).catch(() => {}); // not hosting — nothing to do
}

/** The finished encounter → the session log (no session being played — nothing happens). */
function logEncounter() {
    const monsters = combat.line.filter((c) => c.kind === 'monster');
    if (!monsters.length) return;
    const down = monsters.filter((c) => c.hp <= 0);
    // "3× Goblin, 1× Bugbear" — the name of a hand-made encounter, and what fell
    const count = (list) => {
        const m = new Map();
        for (const c of list) {
            const base = c.monsterId;
            m.set(base, { n: (m.get(base)?.n ?? 0) + 1, name: c.name.replace(/ \d+$/, '') });
        }
        return [...m.values()].map((x) => `${x.n}× ${x.name}`).join(', ');
    };
    const rounds = combat.round;
    logToActiveSession({
        kind: 'encounter_done',
        refType: combat.presetId ? 'encounter' : '',
        refId: combat.presetId ?? '',
        refName: combat.name || count(monsters),
        outcome: down.length === monsters.length ? 'victory' : 'ended',
        note: [`${rounds} round${rounds === 1 ? '' : 's'}`, `${down.length}/${monsters.length} monsters down`, down.length && down.length < monsters.length ? `(${count(down)})` : '']
            .filter(Boolean)
            .join(' · '),
    });
}

const playerEntry = (p) => ({
    id: `p:${p.id}`,
    kind: 'player',
    name: p.name,
    image: p.portrait || '',
    playerId: p.id,
});

/** Move a combatant one place left (-1) or right (+1). */
export function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= combat.line.length) return;
    [combat.line[i], combat.line[j]] = [combat.line[j], combat.line[i]];
    broadcast();
}

/** Put the combatant from index `from` at index `to` (drag and drop). */
export function moveTo(from, to) {
    if (from === to || from < 0 || to < 0 || from >= combat.line.length || to >= combat.line.length) return;
    const [c] = combat.line.splice(from, 1);
    combat.line.splice(to, 0, c);
    broadcast();
}

export function remove(i) {
    const [c] = combat.line.splice(i, 1);
    if (c?.id === combat.turn) combat.turn = null;
    broadcast();
}

/**
 * Mark whose turn it is (one for the whole line; players see it). The combatant whose
 * turn it was has ended its turn: its conditions tick (rounds, end-of-turn saves).
 */
export function setTurn(id) {
    const next = combat.line.some((c) => c.id === id) ? id : null;
    if (next === combat.turn) return;
    const prev = combat.line.find((c) => c.id === combat.turn);
    if (prev) endTurnOf(prev);
    combat.turn = next;
    broadcast();
}

/** The next combatant in the line (wraps around: a new round). */
export function nextTurn() {
    if (!combat.line.length) return;
    const i = combat.line.findIndex((c) => c.id === combat.turn);
    const j = i < 0 ? 0 : (i + 1) % combat.line.length;
    if (i >= 0 && j === 0) combat.round += 1;
    setTurn(combat.line[j].id);
}

function endTurnOf(c) {
    if (c.kind === 'monster') {
        if (c.effects?.length) c.effects = tickEndOfTurn(c.effects).list;
    } else if (c.playerId) {
        SendGameEvent(EV.CONDITION, c.playerId, JSON.stringify({ op: 'tick' })).catch(() => {});
    }
}

/**
 * Monsters' conditions — the same "condition" data the DM sends to players (game.js):
 * { op: 'add', id, level?, rounds?, save? } | { op: 'remove', id } | { op: 'level', id, level }
 * | { op: 'save', id, success }
 */
export function monsterCondition(c, data) {
    const list = c.effects ?? [];
    switch (data?.op) {
        case 'add':
            c.effects = withCondition(list, data.id, {
                level: data.level ?? undefined, rounds: data.rounds ?? null, save: data.save ?? null, choice: data.choice ?? undefined,
            });
            break;
        case 'remove':
            c.effects = withoutCondition(list, data.id);
            break;
        case 'level':
            c.effects = withLevel(list, data.id, data.level, Number(condDefs.find((d) => d.id === data.id)?.data?.levels) || 6);
            break;
        case 'save':
            c.effects = resolveSave(list, data.id, !!data.success);
            break;
        default:
            return;
    }
    broadcast();
}

/**
 * A monster's conditions as the DM's card shows them:
 * { rows (resolveConditions), names, ac (with Slowed −2 etc.), summary: { changes, flags, notes } }
 */
export function monsterView(c) {
    const rows = resolveConditions(c.effects ?? [], condDefs);
    const sheet = { ac: c.ac, acSources: [], speed: 30, saves: [], skills: [], attacks: [], initiative: 0, passivePerception: 0 };
    const summary = applyModifiers(sheet, conditionModifiers(rows));
    return { rows, names: conditionNames(rows), ac: sheet.ac, summary };
}

const conditionNames = (rows) => rows.filter((r) => !r.immune).map((r) => rowName(r));

/** A player's condition names (from their summary) — for the line everyone sees. */
export function notePlayerConditions(playerId, names) {
    const next = Array.isArray(names) ? names.map(String) : [];
    if (JSON.stringify(combat.playerConds[playerId] ?? []) === JSON.stringify(next)) return;
    combat.playerConds[playerId] = next;
    if (combat.active) broadcast();
}

/** Monsters' Hit Points (players' go to their app as "hp" events). Same rules as the character sheet. */
export function monsterHp(c, op, n) {
    n = Math.max(0, Math.floor(Number(n) || 0));
    if (op === 'damage') {
        const fromTemp = Math.min(c.temp, n);
        c.temp -= fromTemp;
        c.hp = Math.max(0, c.hp - (n - fromTemp));
    } else if (op === 'heal') {
        c.hp = Math.min(c.maxHp, c.hp + n);
    } else if (op === 'temp') {
        c.temp = n;
    }
}

/**
 * Keep the players in the line in step with the lobby: newcomers join at the
 * end, those who left are dropped. Returns true if something changed.
 */
export function syncPlayers(players) {
    if (!combat.active) return false;
    const ids = new Set(players.map((p) => p.id));
    const before = combat.line.length;
    combat.line = combat.line.filter((c) => c.kind !== 'player' || ids.has(c.playerId));
    if (combat.turn && !combat.line.some((c) => c.id === combat.turn)) combat.turn = null;
    let changed = combat.line.length !== before;
    for (const p of players) {
        if (!combat.line.some((c) => c.playerId === p.id)) {
            combat.line.push(playerEntry(p));
            changed = true;
        }
    }
    if (changed) broadcast();
    return changed;
}

/** What players see: names, icons, order — no Hit Points, no stats. */
function publicLine() {
    return combat.line.map((c) => ({
        id: c.id,
        kind: c.kind,
        name: c.name,
        image: c.image,
        type: c.type ?? '',
        playerId: c.playerId ?? '',
        conditions: c.kind === 'monster' ? conditionNames(resolveConditions(c.effects ?? [], condDefs)) : (combat.playerConds[c.playerId] ?? []),
    }));
}

/** Send the current line to every player (also used to catch up newcomers). */
// positions of the combatants still in the line
function publicPositions() {
    const ids = new Set(combat.line.map((c) => c.id));
    return Object.fromEntries(Object.entries(combat.positions).filter(([id]) => ids.has(id)));
}

export function broadcast() {
    const data = combat.active
        ? { active: true, name: combat.name, turn: combat.turn, round: combat.round, line: publicLine(), positions: publicPositions() }
        : { active: false };
    SendGameEvent(EV_ENCOUNTER, '', JSON.stringify(data)).catch(() => {}); // not hosting — nothing to do
}

/**
 * A player's numbers for the DM's line: from the summary the player's app sent
 * (rules/summary.js), or — for older players / test tools — computed here from
 * their snapshot and latest state.
 */
export function playerSheet(snap, state, refs, summary = null) {
    if (isSummary(summary))
        return {
            hp: summary.hp, maxHp: summary.maxHp, temp: summary.temp ?? 0, ac: summary.ac,
            conditions: summary.conditions ?? [], conditionInstances: summary.conditionInstances ?? [],
        };
    try {
        if (!snap?.build?.classId || !refs) return null;
        const build = CharacterBuild.fromJSON(snap.build);
        const st = CharacterState.fromJSON(state ?? snap.state ?? {});
        const ch = new Character(build, refs, st.equipped ?? null, st.bagAdjust ?? null, st.effects ?? null);
        return {
            hp: st.currentHp(ch), maxHp: ch.maxHp, temp: st.tempHp ?? 0, ac: ch.ac,
            conditions: ch.conditions.filter((r) => !r.immune).map((r) => rowName(r)),
            conditionInstances: st.effects.filter((e) => e.type === 'condition'),
        };
    } catch {
        return null;
    }
}

// ---------- player ----------

/** The line the DM shares with this player. */
export const seen = $state({ active: false, name: '', turn: null, round: 1, line: [], positions: {}, map: null });

export function resetSeen() {
    seen.active = false;
    seen.name = '';
    seen.turn = null;
    seen.line = [];
    seen.positions = {};
    seen.map = null;
}

let listening = false;

/** Called once at startup (main.js): follow the DM's "encounter" events. */
export function initCombat() {
    if (listening) return;
    listening = true;
    onGameEvent((ev) => {
        if (ev?.kind === EV_ENCOUNTER_MAP) {
            const d = ev.data ?? {};
            seen.map = d.tiles && typeof d.tiles === 'object' ? { key: d.key ?? '', name: d.name ?? '', tiles: d.tiles, at: Date.now() } : null;
            return;
        }
        if (ev?.kind !== EV_ENCOUNTER) return;
        const d = ev.data ?? {};
        seen.active = !!d.active;
        seen.name = d.name ?? '';
        seen.turn = d.active ? (d.turn ?? null) : null;
        seen.round = d.active ? Number(d.round) || 1 : 1;
        seen.line = d.active && Array.isArray(d.line) ? d.line : [];
        seen.positions = d.active && d.positions && typeof d.positions === 'object' ? d.positions : {};
        if (!d.active) seen.map = null;
    });
}
