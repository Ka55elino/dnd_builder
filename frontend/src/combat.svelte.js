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
 *   "encounter" { active: true, name, turn, line: [{ id, kind: 'player' | 'monster', name, image, type, playerId }] }
 *                                                        — turn: id of the combatant whose turn it is (or null)
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

export const EV_ENCOUNTER = 'encounter';

// ---------- DM ----------

/**
 * combat.line: [{
 *   id, kind: 'player' | 'monster', name, image,
 *   playerId,                       — player
 *   monsterId, type, ac, hp, maxHp, temp  — monster (HP counted here)
 * }]
 */
export const combat = $state({ active: false, name: '', turn: null, line: [] });

let seq = 0;

/**
 * Start an encounter: players (lobby order) first, then the monsters.
 * lines — [{ monsterId, count }] (an encounter preset or a hand-made pick)
 */
export function startEncounter({ name = '', lines = [], monsters = [], players = [] }) {
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
            });
        }
    }
    combat.active = true;
    combat.name = name;
    combat.turn = null;
    combat.line = line;
    broadcast();
}

export function endEncounter() {
    combat.active = false;
    combat.name = '';
    combat.turn = null;
    combat.line = [];
    broadcast();
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

/** Mark whose turn it is (one for the whole line; players see it). */
export function setTurn(id) {
    combat.turn = combat.line.some((c) => c.id === id) ? id : null;
    broadcast();
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
    }));
}

/** Send the current line to every player (also used to catch up newcomers). */
export function broadcast() {
    const data = combat.active
        ? { active: true, name: combat.name, turn: combat.turn, line: publicLine() }
        : { active: false };
    SendGameEvent(EV_ENCOUNTER, '', JSON.stringify(data)).catch(() => {}); // not hosting — nothing to do
}

/**
 * A player's numbers for the DM's line: from the summary the player's app sent
 * (rules/summary.js), or — for older players / test tools — computed here from
 * their snapshot and latest state.
 */
export function playerSheet(snap, state, refs, summary = null) {
    if (isSummary(summary)) return { hp: summary.hp, maxHp: summary.maxHp, temp: summary.temp ?? 0, ac: summary.ac };
    try {
        if (!snap?.build?.classId || !refs) return null;
        const build = CharacterBuild.fromJSON(snap.build);
        const st = CharacterState.fromJSON(state ?? snap.state ?? {});
        const ch = new Character(build, refs, st.equipped ?? null, st.bagAdjust ?? null);
        return { hp: st.currentHp(ch), maxHp: ch.maxHp, temp: st.tempHp ?? 0, ac: ch.ac };
    } catch {
        return null;
    }
}

// ---------- player ----------

/** The line the DM shares with this player. */
export const seen = $state({ active: false, name: '', turn: null, line: [] });

export function resetSeen() {
    seen.active = false;
    seen.name = '';
    seen.turn = null;
    seen.line = [];
}

let listening = false;

/** Called once at startup (main.js): follow the DM's "encounter" events. */
export function initCombat() {
    if (listening) return;
    listening = true;
    onGameEvent((ev) => {
        if (ev?.kind !== EV_ENCOUNTER) return;
        const d = ev.data ?? {};
        seen.active = !!d.active;
        seen.name = d.name ?? '';
        seen.turn = d.active ? (d.turn ?? null) : null;
        seen.line = d.active && Array.isArray(d.line) ? d.line : [];
    });
}
