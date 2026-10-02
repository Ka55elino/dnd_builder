/**
 * Condition instances — pure functions over an effects list, shared by the player's
 * CharacterState and the DM's monsters in the initiative line (combat.svelte.js).
 *
 *   instance: {
 *     id, type: 'condition',
 *     level?,              — Exhaustion 1–6
 *     rounds?,             — rounds left; counts down at the end of the creature's turn, 0 → gone
 *     save?: { ability, dc },   — "repeat the save at the end of each of its turns"
 *     savePending?: true,  — the turn just ended: the save is waiting to be rolled
 *     by?: 'DM',           — who put it on (shown in the tooltip)
 *     choice?: 'stealth',  — what was chosen when it was cast (Guidance: a skill) → '$choice' in modifiers
 *     conc?: 'bless',      — it lasts while that spell is concentrated on (CharacterState.concentrate)
 *     tempHp?: true,       — it ends when the Temporary Hit Points run out (Symbiotic Entity)
 *     def?: { … }          — the definition itself, for a custom condition the other app
 *                            may not have (a DM's homebrew sent over the LAN)
 *   }
 *
 * What a condition does is never stored here — see rules/modifiers.js.
 */

const ABILS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** Clean an instance read from JSON / the network (unknown fields are dropped). */
export function normalizeCondition(e) {
    if (!e || typeof e.id !== 'string' || !e.id) return null;
    const out = { id: e.id, type: 'condition' };
    if (Number(e.level) > 0) out.level = Math.floor(Number(e.level));
    if (Number(e.rounds) > 0) out.rounds = Math.floor(Number(e.rounds));
    if (e.save && ABILS.includes(e.save.ability) && Number(e.save.dc) > 0)
        out.save = { ability: e.save.ability, dc: Math.floor(Number(e.save.dc)) };
    if (e.savePending && out.save) out.savePending = true;
    if (typeof e.by === 'string' && e.by) out.by = e.by.slice(0, 40);
    if (typeof e.choice === 'string' && e.choice) out.choice = e.choice.slice(0, 40);
    if (typeof e.conc === 'string' && e.conc) out.conc = e.conc.slice(0, 80);
    if (e.tempHp) out.tempHp = true;
    if (e.def && typeof e.def === 'object' && e.def.id === e.id && typeof e.def.name === 'string') out.def = e.def;
    return out;
}

export const isCondition = (e) => e?.type === 'condition';
export const findCondition = (list, id) => (list ?? []).find((e) => isCondition(e) && e.id === id) ?? null;

/**
 * Put a condition on (or update it): the same condition doesn't stack — a second
 * application refreshes its options (level, rounds, save).
 * opts: { level, rounds, save, by, def }
 */
export function withCondition(list, id, opts = {}) {
    const cur = findCondition(list, id);
    const next = normalizeCondition({ ...(cur ?? {}), id, type: 'condition', ...clean(opts) });
    if (!next) return list;
    return cur ? list.map((e) => (e === cur ? next : e)) : [...list, next];
}

// undefined options keep the current value; null clears it
function clean(opts) {
    const o = {};
    for (const [k, v] of Object.entries(opts)) if (v !== undefined) o[k] = v;
    return o;
}

export const withoutCondition = (list, id) => (list ?? []).filter((e) => !(isCondition(e) && e.id === id));

/** Level 1…max; 0 removes it. */
export function withLevel(list, id, level, max = 6) {
    const n = Math.min(max, Math.floor(Number(level) || 0));
    if (n <= 0) return withoutCondition(list, id);
    return list.map((e) => (isCondition(e) && e.id === id ? { ...e, level: n } : e));
}

/**
 * End of the creature's turn: rounds count down (0 → removed) and conditions with a
 * save get savePending — the player / DM rolls it and calls resolveSave.
 * @returns { list, expired: [id], saves: [id] }
 */
export function tickEndOfTurn(list) {
    const expired = [];
    const saves = [];
    const out = [];
    for (const e of list ?? []) {
        if (!isCondition(e)) {
            out.push(e);
            continue;
        }
        let x = e;
        if (x.rounds) {
            const left = x.rounds - 1;
            if (left <= 0) {
                expired.push(x.id);
                continue;
            }
            x = { ...x, rounds: left };
        }
        if (x.save) {
            x = { ...x, savePending: true };
            saves.push(x.id);
        }
        out.push(x);
    }
    return { list: out, expired, saves };
}

/** The pending save was rolled: success removes the condition, a failure keeps it. */
export function resolveSave(list, id, success) {
    if (success) return withoutCondition(list, id);
    return list.map((e) => {
        if (!(isCondition(e) && e.id === id)) return e;
        const { savePending, ...rest } = e; // eslint-disable-line no-unused-vars
        return rest;
    });
}

/** "2 rounds", "WIS save DC 15", "by DM" — for chips and tooltips. */
export function instanceInfo(e, abilityShort = (k) => k.toUpperCase()) {
    const parts = [];
    if (e?.rounds) parts.push(`${e.rounds} ${e.rounds === 1 ? 'round' : 'rounds'} left`);
    if (e?.save) parts.push(`${abilityShort(e.save.ability)} save DC ${e.save.dc} at the end of each turn`);
    if (e?.by) parts.push(`by ${e.by}`);
    return parts.join(' · ');
}
