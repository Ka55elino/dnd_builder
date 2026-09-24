/**
 * CharacterState — ИГРОВОЕ состояние (то, что меняется за столом).
 * Хранится отдельно от build: колонка characters.state_json.
 *
 * Хранит только «сколько потрачено», а максимумы берёт из Character —
 * так повышение уровня или смена снаряжения не ломают состояние.
 *
 * Реактивный (Svelte 5), файл обязан быть .svelte.js.
 */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class CharacterState {
    hpLost = $state(0);          // сколько хитов потеряно (текущие = max - hpLost)
    tempHp = $state(0);          // временные хиты
    resourcesUsed = $state({});  // { [resourceId]: потрачено }
    slotsUsed = $state({});      // { [круг]: потрачено }, ячейки договора — ключ 'pact'
    hitDiceUsed = $state(0);
    deathSaves = $state({ success: 0, fail: 0 });
    conditions = $state([]);     // ['poisoned', ...]
    inspiration = $state(false);
    equipped = $state(null);     // { main, off, armor } — ключи предметов рюкзака, см. rules/loadout.js
    notes = $state('');          // заметки игрока (свободный текст)

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
    }

    // ---------- хиты ----------

    currentHp(ch) {
        return clamp(ch.maxHp - this.hpLost, 0, ch.maxHp);
    }

    /** Урон: сначала снимаются временные хиты. */
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

    // ---------- ресурсы ----------

    resourceLeft(res) {
        return clamp(res.max - (this.resourcesUsed[res.id] ?? 0), 0, res.max);
    }

    spend(res, n = 1) {
        this.resourcesUsed[res.id] = clamp((this.resourcesUsed[res.id] ?? 0) + n, 0, res.max);
    }

    restore(res, n = 1) {
        this.resourcesUsed[res.id] = clamp((this.resourcesUsed[res.id] ?? 0) - n, 0, res.max);
    }

    // ---------- ячейки ----------

    slotKey = (slot) => (slot.pact ? 'pact' : String(slot.level));

    slotsLeft(slot) {
        return clamp(slot.max - (this.slotsUsed[this.slotKey(slot)] ?? 0), 0, slot.max);
    }

    useSlot(slot, n = 1) {
        const k = this.slotKey(slot);
        this.slotsUsed[k] = clamp((this.slotsUsed[k] ?? 0) + n, 0, slot.max);
    }

    // ---------- отдых ----------

    /** Короткий отдых: ресурсы 'short' целиком, shortRestRegain — частично, ячейки договора. */
    shortRest(ch) {
        for (const r of ch.resources) {
            if (r.recharge === 'short') this.resourcesUsed[r.id] = 0;
            else if (r.shortRestRegain) this.restore(r, r.shortRestRegain);
        }
        if (this.slotsUsed.pact) this.slotsUsed.pact = 0;
    }

    /** Долгий отдых: всё восстанавливается, кости хитов — половина. */
    longRest(ch) {
        this.hpLost = 0;
        this.tempHp = 0;
        this.resourcesUsed = {};
        this.slotsUsed = {};
        this.hitDiceUsed = Math.max(0, this.hitDiceUsed - Math.max(1, Math.floor(ch.level / 2)));
        this.deathSaves = { success: 0, fail: 0 };
    }

    // ---------- сериализация ----------

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
        });
    }

    static fromJSON(data) {
        return new CharacterState(typeof data === 'string' ? JSON.parse(data || '{}') : data ?? {});
    }
}
