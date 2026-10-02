/**
 * CharacterState — IN-PLAY state (what changes at the table).
 * Stored separately from build: the characters.state_json column.
 *
 * Stores only "how much is spent"; maximums come from Character —
 * so leveling up or changing equipment doesn't break the state.
 *
 * Reactive (Svelte 5); the file must be .svelte.js.
 */

import {
    normalizeCondition,
    findCondition,
    withCondition,
    withoutCondition,
    withLevel,
    tickEndOfTurn,
    resolveSave,
} from '../rules/conditions.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Max quantity of one backpack row. */
export const BAG_MAX = 1000;

export class CharacterState {
    hpLost = $state(0);          // Hit Points lost (current = max - hpLost)
    tempHp = $state(0);          // Temporary Hit Points
    resourcesUsed = $state({});  // { [resourceId]: spent }
    slotsUsed = $state({});      // { [spell level]: spent }, Pact Magic slots — key 'pact'
    hitDiceUsed = $state(0);
    deathSaves = $state({ success: 0, fail: 0 });
    inspiration = $state(false);
    equipped = $state(null);     // { main, off, armor } — backpack item keys, see rules/loadout.js
    notes = $state('');          // player notes (free text)
    concentration = $state(null); // id of the spell being concentrated on, or null
    turnUsed = $state({});        // this turn: { action: 1, bonus: 0, reaction: 1 } — spent (Character.economy has the max)
    turnExtra = $state({});       // this turn only: { action: { n: 1, from: ['Action Surge'] } } — gained by using an ability
    effects = $state([]);         // what is on the character (rules/conditions.js, rules/modifiers.js):
                                  //   { id, type: 'condition', level?, rounds?, save?, choice?, conc?, tempHp? }
                                  //   — conditions (Prone, Exhaustion 2…) and named effects, including
                                  //   spell effects (Mage Armor, Bless, Guidance…: assets/data/conditions)
                                  // comes from the spell's data.apply (see Character, rules/sheet.js)
    bagAdjust = $state({});      // { [backpack item key]: qty delta } — used up / found / thrown away;
                                 // an item whose qty drops to 0 is removed (see Character)

    constructor(data = {}) {
        this.hpLost = Math.max(0, data.hpLost ?? 0);
        this.tempHp = Math.max(0, data.tempHp ?? 0);
        this.resourcesUsed = { ...(data.resourcesUsed ?? {}) };
        this.slotsUsed = { ...(data.slotsUsed ?? {}) };
        this.hitDiceUsed = Math.max(0, data.hitDiceUsed ?? 0);
        this.deathSaves = { success: 0, fail: 0, ...(data.deathSaves ?? {}) };
        this.inspiration = !!data.inspiration;
        this.equipped = data.equipped ? { ...data.equipped } : null;
        this.notes = typeof data.notes === 'string' ? data.notes : '';
        this.concentration = typeof data.concentration === 'string' && data.concentration ? data.concentration : null;
        this.turnExtra = Object.fromEntries(
            Object.entries(data.turnExtra ?? {})
                .filter(([, v]) => Number(v?.n) > 0)
                .map(([k, v]) => [k, { n: Math.floor(Number(v.n)), from: (Array.isArray(v.from) ? v.from : []).map(String) }]),
        );
        this.turnUsed = Object.fromEntries(
            Object.entries(data.turnUsed ?? {}).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Math.floor(Number(v))]),
        );
        this.effects = Array.isArray(data.effects)
            ? data.effects
                .filter((e) => e && typeof e.id === 'string')
                .map((e) =>
                    normalizeCondition(
                        e.type === 'condition'
                            ? e // rules/conditions.js: level, rounds, save, choice, conc, def…
                            : // old saves: a spell effect { id: spell id, conc: true } → the effect with that id
                              { id: e.id, type: 'condition', conc: e.conc ? e.id : undefined, tempHp: e.tempHp },
                    ),
                )
                .filter(Boolean)
            : [];
        // old saves: conditions: ['poisoned', …] → condition instances
        for (const c of Array.isArray(data.conditions) ? data.conditions : []) {
            const id = typeof c === 'string' ? c : c?.id;
            if (id && !this.hasCondition(id)) this.effects.push({ id, type: 'condition' });
        }
        this.bagAdjust = { ...(data.bagAdjust ?? {}) };
    }

    // ---------- backpack ----------

    #shift(key, d) {
        const v = (this.bagAdjust[key] ?? 0) + d;
        if (v) this.bagAdjust[key] = v;
        else delete this.bagAdjust[key];
    }

    /** Change a backpack row's quantity by n (it = a Character.inventory row), 1…BAG_MAX. */
    changeQty(it, n) {
        const next = clamp(it.qty + n, 1, BAG_MAX);
        if (next !== it.qty) this.#shift(it.key, next - it.qty);
    }

    /** Throw the whole row out of the backpack. */
    removeItem(it) {
        this.#shift(it.key, -it.qty);
        if (this.equipped) {
            for (const s of ['main', 'off', 'armor']) if (this.equipped[s] === it.key) this.equipped[s] = null;
        }
    }

    // ---------- Hit Points ----------

    currentHp(ch) {
        return clamp(ch.maxHp - this.hpLost, 0, ch.maxHp);
    }

    /** Damage: Temporary Hit Points are removed first. */
    damage(n, ch) {
        n = Math.max(0, Math.floor(n));
        const fromTemp = Math.min(this.tempHp, n);
        this.tempHp -= fromTemp;
        this.hpLost = clamp(this.hpLost + (n - fromTemp), 0, ch.maxHp);
        // Symbiotic Entity: ends when its Temporary Hit Points run out
        if (!this.tempHp && this.effects.some((e) => e.tempHp)) this.effects = this.effects.filter((e) => !e.tempHp);
        // 0 Hit Points → Unconscious → Concentration ends
        if (this.concentration && this.currentHp(ch) === 0) this.concentrate(null);
    }

    heal(n, ch) {
        this.hpLost = clamp(this.hpLost - Math.max(0, Math.floor(n)), 0, ch.maxHp);
        if (this.hpLost < ch.maxHp) this.deathSaves = { success: 0, fail: 0 };
    }

    setTempHp(n) {
        this.tempHp = Math.max(0, Math.floor(n) || 0);
    }

    // ---------- resources ----------

    resourceLeft(res) {
        return clamp(res.max - (this.resourcesUsed[res.id] ?? 0), 0, res.max);
    }

    spend(res, n = 1) {
        this.resourcesUsed[res.id] = clamp((this.resourcesUsed[res.id] ?? 0) + n, 0, res.max);
    }

    restore(res, n = 1) {
        this.resourcesUsed[res.id] = clamp((this.resourcesUsed[res.id] ?? 0) - n, 0, res.max);
    }

    // ---------- spell slots ----------

    slotKey = (slot) => (slot.pact ? 'pact' : String(slot.level));

    slotsLeft(slot) {
        return clamp(slot.max - (this.slotsUsed[this.slotKey(slot)] ?? 0), 0, slot.max);
    }

    useSlot(slot, n = 1) {
        const k = this.slotKey(slot);
        this.slotsUsed[k] = clamp((this.slotsUsed[k] ?? 0) + n, 0, slot.max);
    }

    // ---------- concentration ----------

    /** Start concentrating on a spell (id), or stop (null). Only one at a time. */
    concentrate(id) {
        this.concentration = id || null;
        // effects that last only while you concentrate on their spell end with it
        this.effects = this.effects.filter((e) => !e.conc || e.conc === this.concentration);
    }

    /** End an effect (the × in Status). Ending the effect of the spell you concentrate on ends the Concentration. */
    removeEffect(id) {
        const e = this.condition(id);
        this.removeCondition(id);
        if (e?.conc && this.concentration === e.conc) this.concentration = null;
    }

    // ---------- conditions (Prone, Grappled, Exhaustion…) ----------

    /** The condition instance, or null. */
    condition(id) {
        return findCondition(this.effects, id);
    }

    hasCondition(id) {
        return !!this.condition(id);
    }

    /**
     * Put a condition on (once — the same condition doesn't stack).
     * breaks: it (or what it implies) Incapacitates → Concentration ends (rules/modifiers.js breaksConcentration)
     * level (Exhaustion 1–6), rounds, save { ability, dc }, by, def — see rules/conditions.js;
     * on a condition that is already there they update it (conditions don't stack)
     */
    addCondition(id, { breaks = false, level, rounds, save, by, def, choice, conc, tempHp } = {}) {
        if (!id) return;
        const had = !!this.condition(id);
        this.effects = withCondition(this.effects, id, { level: level ?? undefined, rounds, save, by, def, choice, conc, tempHp });
        if (!had && breaks && this.concentration) this.concentrate(null);
    }

    removeCondition(id) {
        this.effects = withoutCondition(this.effects, id);
    }

    // ---------- action economy (Action / Bonus Action / Reaction) ----------

    /** This turn's total of e (e.id: 'action' | 'bonus' | 'reaction'): per turn + gained this turn. */
    turnTotal(e) {
        return e.count + (this.turnExtra[e.id]?.n ?? 0);
    }

    /** How many of e are left this turn. */
    turnLeft(e) {
        const total = this.turnTotal(e);
        return clamp(total - (this.turnUsed[e.id] ?? 0), 0, total);
    }

    /** Pip i of e clicked: spent pips are the first `used` ones; a fresh one is spent, a spent one given back. */
    toggleTurn(e, i) {
        const total = this.turnTotal(e);
        const used = this.turnUsed[e.id] ?? 0;
        const next = i >= used ? used + 1 : used - 1;
        this.turnUsed = { ...this.turnUsed, [e.id]: clamp(next, 0, total) };
    }

    /** An ability gives one more of this for this turn only (Action Surge: +1 action, data.turnGain). */
    gainTurn(id, n = 1, from = '') {
        const cur = this.turnExtra[id] ?? { n: 0, from: [] };
        this.turnExtra = { ...this.turnExtra, [id]: { n: cur.n + n, from: from ? [...cur.from, from] : cur.from } };
    }

    /** A new turn: everything is available again (the start of your turn — Reactions too); extras are gone. */
    newTurn() {
        this.turnUsed = {};
        this.turnExtra = {};
    }

    /** End of this character's turn (the DM passed the turn on): rounds count down, saves come due. */
    endOfTurn() {
        const r = tickEndOfTurn(this.effects);
        this.effects = r.list;
        return r;
    }

    /** The pending end-of-turn save was rolled: success ends the condition. */
    resolveSave(id, success) {
        this.effects = resolveSave(this.effects, id, success);
    }

    toggleCondition(id, opts = {}) {
        if (this.hasCondition(id)) this.removeCondition(id);
        else this.addCondition(id, opts);
    }

    /** Exhaustion level (1…max); 0 — removes the condition. */
    setConditionLevel(id, level, max = 6) {
        this.effects = withLevel(this.effects, id, level, max);
    }

    /** The spell being concentrated on, from the list the character can concentrate on (Character.concentrationSpells). */
    concentratingOn(ch) {
        return this.concentration ? ch.concentrationSpells.find((sp) => sp.id === this.concentration) ?? null : null;
    }

    // ---------- rest ----------

    /** Short Rest: 'short' resources fully, shortRestRegain partially, Pact Magic slots. */
    shortRest(ch) {
        this.turnUsed = {};
        this.turnExtra = {};
        for (const r of ch.resources) {
            if (r.recharge === 'short') this.resourcesUsed[r.id] = 0;
            else if (r.shortRestRegain) this.restore(r, r.shortRestRegain);
        }
        if (this.slotsUsed.pact) this.slotsUsed.pact = 0;
    }

    /** Long Rest: everything is restored, Hit Point Dice — half. */
    longRest(ch) {
        this.turnUsed = {};
        this.turnExtra = {};
        this.hpLost = 0;
        this.tempHp = 0;
        this.resourcesUsed = {};
        this.slotsUsed = {};
        this.hitDiceUsed = Math.max(0, this.hitDiceUsed - Math.max(1, Math.floor(ch.level / 2)));
        this.deathSaves = { success: 0, fail: 0 };
        this.concentration = null;
        // 8 hours pass: spell effects are over; conditions stay, except those that a Long Rest
        // changes (definition longRest: 'level' — Exhaustion −1, 'remove' — gone)
        const defs = new Map((ch.conditionDefs ?? []).map((d) => [d.id, d.data ?? d]));
        this.effects = this.effects
            .filter((e) => e.type === 'condition')
            .map((e) => {
                const rule = defs.get(e.id)?.longRest;
                if (rule === 'remove') return null;
                if (rule === 'level') return (e.level ?? 1) > 1 ? { ...e, level: (e.level ?? 1) - 1 } : null;
                return e;
            })
            .filter(Boolean);
    }

    // ---------- serialization ----------

    toJSON() {
        return $state.snapshot({
            hpLost: this.hpLost,
            tempHp: this.tempHp,
            resourcesUsed: this.resourcesUsed,
            slotsUsed: this.slotsUsed,
            hitDiceUsed: this.hitDiceUsed,
            deathSaves: this.deathSaves,
            inspiration: this.inspiration,
            equipped: this.equipped,
            notes: this.notes,
            concentration: this.concentration,
            turnUsed: this.turnUsed,
            turnExtra: this.turnExtra,
            effects: this.effects,
            bagAdjust: this.bagAdjust,
        });
    }

    static fromJSON(data) {
        return new CharacterState(typeof data === 'string' ? JSON.parse(data || '{}') : data ?? {});
    }
}
