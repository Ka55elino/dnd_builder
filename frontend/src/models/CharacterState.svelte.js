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
    resourcesHeld = $state({});  // { [resourceId]: held } — resources that start empty (r.startEmpty: Soul Trinkets);
                                 // kept as a count held, so a bigger max doesn't hand out free ones
    slotsUsed = $state({});      // { [spell level]: spent }, Pact Magic slots — key 'pact'
    hitDiceUsed = $state({});    // { [die size]: spent }
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
    wildShape = $state(null);    // Wild Shape: { monsterId, name, since } — the beast form now (rules/wildshape.js)
    summons = $state([]);        // summoned creatures (rules/summon.js makeSummon): { uid, monsterId, name, image,
                                 //   size, source, sourceName, group, slot, conc, ac, maxHp, hpLost, tempHp,
                                 //   initiative: 'owner' | 'own', since } — the DM puts them in the line and on the map
    bagAdjust = $state({});      // { [backpack item key]: qty delta } — used up / found / thrown away;
                                 // an item whose qty drops to 0 is removed (see Character)

    constructor(data = {}) {
        this.hpLost = Math.max(0, data.hpLost ?? 0);
        this.tempHp = Math.max(0, data.tempHp ?? 0);
        this.resourcesUsed = { ...(data.resourcesUsed ?? {}) };
        this.resourcesHeld = { ...(data.resourcesHeld ?? {}) };
        this.slotsUsed = { ...(data.slotsUsed ?? {}) };
        // spent Hit Point Dice by die size: { 10: 2, 6: 1 } (multiclassing — several sizes)
        this.hitDiceUsed = Object.fromEntries(
            Object.entries(data.hitDiceUsed && typeof data.hitDiceUsed === 'object' ? data.hitDiceUsed : {})
                .map(([d, n]) => [d, Math.max(0, Math.floor(Number(n) || 0))])
                .filter(([, n]) => n > 0),
        );
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
        this.wildShape =
            data.wildShape && typeof data.wildShape.monsterId === 'string'
                ? { monsterId: data.wildShape.monsterId, name: String(data.wildShape.name ?? ''), since: Number(data.wildShape.since) || 0 }
                : null;
        this.summons = Array.isArray(data.summons)
            ? data.summons
                .filter((s) => s && typeof s.uid === 'string' && typeof s.monsterId === 'string')
                .map((s) => ({
                    ...s,
                    // a token (Flaming Sphere) may have no Hit Points / AC: null
                    maxHp: s.maxHp == null ? null : Math.max(1, Math.floor(Number(s.maxHp) || 1)),
                    hpLost: Math.max(0, Math.floor(Number(s.hpLost) || 0)),
                    tempHp: Math.max(0, Math.floor(Number(s.tempHp) || 0)),
                    ac: s.ac == null ? null : Math.floor(Number(s.ac) || 10),
                    conc: typeof s.conc === 'string' && s.conc ? s.conc : null,
                    initiative: s.initiative === 'owner' ? 'owner' : 'own',
                }))
            : [];
    }

    // ---------- summons (rules/summon.js) ----------

    /**
     * New summons of one cast (makeSummons): one cast per group — a second familiar replaces
     * the first; Animate Dead gives each cast its own group, so they add up.
     */
    addSummons(list) {
        const add = (Array.isArray(list) ? list : [list]).filter(Boolean);
        if (!add.length) return;
        const groups = new Set(add.map((s) => s.group));
        this.summons = [...this.summons.filter((x) => !groups.has(x.group)), ...add];
    }

    addSummon(s) {
        this.addSummons([s]);
    }

    /** It is dismissed / disappears. */
    removeSummon(uid) {
        this.summons = this.summons.filter((s) => s.uid !== uid);
    }

    /** Its Hit Points now; null — it has none (a token: Flaming Sphere). */
    summonHp(s) {
        return s.maxHp == null ? null : clamp(s.maxHp - s.hpLost, 0, s.maxHp);
    }

    /**
     * Hit Points of a summon: op 'damage' | 'heal' | 'temp', n.
     * Damage takes Temporary Hit Points first; at 0 Hit Points it disappears.
     */
    changeSummonHp(uid, op, n) {
        n = Math.max(0, Math.floor(Number(n) || 0));
        const s = this.summons.find((x) => x.uid === uid);
        if (!s || s.maxHp == null || (!n && op !== 'temp')) return;
        let { hpLost, tempHp } = s;
        if (op === 'damage') {
            const fromTemp = Math.min(tempHp, n);
            tempHp -= fromTemp;
            hpLost = Math.min(s.maxHp, hpLost + n - fromTemp);
        } else if (op === 'heal') hpLost = Math.max(0, hpLost - n);
        else if (op === 'temp') tempHp = Math.max(tempHp, n);
        if (hpLost >= s.maxHp) return this.removeSummon(uid);
        this.summons = this.summons.map((x) => (x.uid === uid ? { ...x, hpLost, tempHp } : x));
    }

    // ---------- Wild Shape ----------

    /**
     * Turn into a beast: spend the uses, take the Temporary Hit Points (they don't add up —
     * the higher stays), remember the form. form — { monsterId, name }, res — the Wild Shape
     * resource (Character.resources), cost — uses, tempHp — from the form.
     */
    startWildShape(form, { res = null, cost = 1, tempHp = 0 } = {}) {
        if (res) this.spend(res, cost);
        this.tempHp = Math.max(this.tempHp, Math.max(0, Math.floor(tempHp)));
        this.wildShape = { monsterId: form.monsterId, name: form.name ?? '', since: Date.now() };
    }

    /** Back to the druid's own shape (the Temporary Hit Points stay until they're lost). */
    endWildShape() {
        this.wildShape = null;
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
        // 0 Hit Points → Unconscious → Concentration ends, the beast form too
        if (this.concentration && this.currentHp(ch) === 0) this.concentrate(null);
        if (this.wildShape && this.currentHp(ch) === 0) this.endWildShape();
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
        if (res.startEmpty) return clamp(this.resourcesHeld[res.id] ?? 0, 0, res.max);
        return clamp(res.max - (this.resourcesUsed[res.id] ?? 0), 0, res.max);
    }

    spend(res, n = 1) {
        if (res.startEmpty) return void (this.resourcesHeld[res.id] = clamp(this.resourceLeft(res) - n, 0, res.max));
        this.resourcesUsed[res.id] = clamp((this.resourcesUsed[res.id] ?? 0) + n, 0, res.max);
    }

    restore(res, n = 1) {
        if (res.startEmpty) return void (this.resourcesHeld[res.id] = clamp(this.resourceLeft(res) + n, 0, res.max));
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
        // and so do the creatures it summoned (Summon Beast)
        if (this.summons.some((s) => s.conc && s.conc !== this.concentration))
            this.summons = this.summons.filter((s) => !s.conc || s.conc === this.concentration);
    }

    /** End an effect (the × in Status). Ending the effect of the spell you concentrate on ends the Concentration. */
    removeEffect(id) {
        const e = this.condition(id);
        this.removeCondition(id);
        if (e?.conc && this.concentration === e.conc) this.concentrate(null);
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

    /** Hit Point Dice left: [{ die, count, left }] (ch.hitDice from the sheet). */
    hitDiceLeft(ch) {
        return (ch.hitDice ?? []).map((d) => ({ ...d, left: Math.max(0, d.count - (this.hitDiceUsed[d.die] ?? 0)) }));
    }

    /** Long Rest: everything is restored, Hit Point Dice — half. */
    longRest(ch) {
        this.turnUsed = {};
        this.turnExtra = {};
        this.hpLost = 0;
        this.tempHp = 0;
        // resources with recharge 'none' (Soul Trinkets) don't come back on a rest
        this.resourcesUsed = Object.fromEntries(
            ch.resources.filter((r) => r.recharge === 'none' && this.resourcesUsed[r.id]).map((r) => [r.id, this.resourcesUsed[r.id]]),
        );
        this.slotsUsed = {};
        // half the character's total Hit Point Dice come back (min 1) — the largest ones first
        let back = Math.max(1, Math.floor(ch.level / 2));
        const used = { ...this.hitDiceUsed };
        for (const d of Object.keys(used).map(Number).sort((a, b) => b - a)) {
            const n = Math.min(back, used[d]);
            used[d] -= n;
            back -= n;
            if (!used[d]) delete used[d];
        }
        this.hitDiceUsed = used;
        this.deathSaves = { success: 0, fail: 0 };
        this.concentration = null;
        this.wildShape = null; // 8 hours: longer than any form lasts before level 16
        // summons held by Concentration are gone; a familiar / a companion stays (healed)
        this.summons = this.summons.filter((s) => !s.conc).map((s) => ({ ...s, hpLost: 0, tempHp: 0 }));
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
            resourcesHeld: this.resourcesHeld,
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
            wildShape: this.wildShape,
            summons: this.summons,
        });
    }

    static fromJSON(data) {
        return new CharacterState(typeof data === 'string' ? JSON.parse(data || '{}') : data ?? {});
    }
}
