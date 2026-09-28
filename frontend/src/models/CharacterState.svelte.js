/**
 * CharacterState — IN-PLAY state (what changes at the table).
 * Stored separately from build: the characters.state_json column.
 *
 * Stores only "how much is spent"; maximums come from Character —
 * so leveling up or changing equipment doesn't break the state.
 *
 * Reactive (Svelte 5); the file must be .svelte.js.
 */

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
    conditions = $state([]);     // ['poisoned', ...]
    inspiration = $state(false);
    equipped = $state(null);     // { main, off, armor } — backpack item keys, see rules/loadout.js
    notes = $state('');          // player notes (free text)
    bagAdjust = $state({});      // { [backpack item key]: qty delta } — used up / found / thrown away;
                                 // an item whose qty drops to 0 is removed (see Character)

    constructor(data = {}) {
        this.hpLost = Math.max(0, data.hpLost ?? 0);
        this.tempHp = Math.max(0, data.tempHp ?? 0);
        this.resourcesUsed = { ...(data.resourcesUsed ?? {}) };
        this.slotsUsed = { ...(data.slotsUsed ?? {}) };
        this.hitDiceUsed = Math.max(0, data.hitDiceUsed ?? 0);
        this.deathSaves = { success: 0, fail: 0, ...(data.deathSaves ?? {}) };
        this.conditions = [...(data.conditions ?? [])];
        this.inspiration = !!data.inspiration;
        this.equipped = data.equipped ? { ...data.equipped } : null;
        this.notes = typeof data.notes === 'string' ? data.notes : '';
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

    // ---------- rest ----------

    /** Short Rest: 'short' resources fully, shortRestRegain partially, Pact Magic slots. */
    shortRest(ch) {
        for (const r of ch.resources) {
            if (r.recharge === 'short') this.resourcesUsed[r.id] = 0;
            else if (r.shortRestRegain) this.restore(r, r.shortRestRegain);
        }
        if (this.slotsUsed.pact) this.slotsUsed.pact = 0;
    }

    /** Long Rest: everything is restored, Hit Point Dice — half. */
    longRest(ch) {
        this.hpLost = 0;
        this.tempHp = 0;
        this.resourcesUsed = {};
        this.slotsUsed = {};
        this.hitDiceUsed = Math.max(0, this.hitDiceUsed - Math.max(1, Math.floor(ch.level / 2)));
        this.deathSaves = { success: 0, fail: 0 };
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
            conditions: this.conditions,
            inspiration: this.inspiration,
            equipped: this.equipped,
            notes: this.notes,
            bagAdjust: this.bagAdjust,
        });
    }

    static fromJSON(data) {
        return new CharacterState(typeof data === 'string' ? JSON.parse(data || '{}') : data ?? {});
    }
}
