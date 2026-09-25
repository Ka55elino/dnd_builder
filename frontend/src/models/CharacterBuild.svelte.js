/**
 * CharacterBuild — all the data the builder collects.
 *
 * Reactive class (Svelte 5 runes): fields are declared with $state,
 * so components can bind to them directly:
 *   <input bind:value={build.name} />
 *
 * The file must have the .svelte.js suffix — otherwise $state won't work.
 *
 * Stores only the player's choices (ids, values). Derived
 * stats (AC, Hit Points, bonuses) are computed separately.
 */

import {
    ABILITY_KEYS,
    ABILITY_METHODS,
    STANDARD_ARRAY,
    POINT_BUY_MIN,
    POINT_BUY_MAX,
    POINT_BUY_BUDGET,
    POINT_BUY_COST,
    pointBuySpent,
    rollAbilitySet,
} from '../rules/abilities.js';

export { ABILITY_KEYS };

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 20;

/**
 * Character description text fields, grouped for the UI.
 * Each field: { key, label, wide } — wide = full-width multiline field.
 */
export const BIO_GROUPS = [
    {
        title: 'Appearance',
        fields: [
            { key: 'gender', label: 'Gender', wide: false },
            { key: 'identity', label: 'Identity', wide: false },
            { key: 'attraction', label: 'Attraction', wide: false },
            { key: 'age', label: 'Age', wide: false },
            { key: 'height', label: 'Height', wide: false },
            { key: 'weight', label: 'Weight', wide: false },
            { key: 'eyes', label: 'Eyes', wide: false },
            { key: 'skin', label: 'Skin', wide: false },
            { key: 'hair', label: 'Hair', wide: false },
        ],
    },
    {
        title: 'Personality',
        fields: [
            { key: 'alignment', label: 'Alignment', wide: true },
            { key: 'trait', label: 'Personality trait', wide: true },
            { key: 'ideal', label: 'Ideal', wide: true },
            { key: 'bond', label: 'Bond', wide: true },
            { key: 'flaw', label: 'Flaw / secret', wide: true },
            { key: 'weakness', label: 'Weakness', wide: true },
        ],
    }
];

export const BIO_KEYS = BIO_GROUPS.flatMap((g) => g.fields.map((f) => f.key));

const defaultBio = () => Object.fromEntries(BIO_KEYS.map((k) => [k, '']));

const clampLevel = (n) =>
    Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(Number(n) || MIN_LEVEL)));

const byAbility = (fn) => Object.fromEntries(ABILITY_KEYS.map((k) => [k, fn(k)]));

const defaultPointBuy = () => byAbility(() => POINT_BUY_MIN);
const emptyAssign = () => byAbility(() => null);

const defaultEquipment = () => ({
    armorId: null,   // armor (one)
    shield: false,
    weaponIds: [],   // weapons (several)
    packId: null,    // equipment pack (one)
    items: [],       // individual items: [{ id, qty }]
    bag: [],         // granted later ("Give item"): [{ kind: 'weapon'|'armor'|'item', id, qty }]
});

const newId = () =>
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export class CharacterBuild {
    // --- internal ---
    id = $state('');
    createdAt = $state('');
    updatedAt = $state('');

    // --- Basics ---
    name = $state('');
    portrait = $state(null);   // character portrait, data URL (image/jpeg) or null
    bio = $state(defaultBio()); // Personality + Appearance, see BIO_GROUPS
    level = $state(MIN_LEVEL);
    backgroundId = $state(null);

    // --- Abilities ---
    abilityMethod = $state('array');       // 'array' | 'pointbuy' | 'roll'
    pointBuy = $state(defaultPointBuy());  // { str: 8..15, ... } — for 'pointbuy'
    abilityRolls = $state(null);           // [{ dice: [4], total }] ×6 — for 'roll'
    abilityAssign = $state(emptyAssign()); // { str: pool index | null } — for 'array' and 'roll'

    /** Pool of values to assign (array / roll). */
    abilityPool = $derived(
        this.abilityMethod === 'array'
            ? STANDARD_ARRAY
            : this.abilityMethod === 'roll'
                ? (this.abilityRolls ?? []).map((r) => r.total)
                : [],
    );

    /** Resulting base scores { str, ... } (null — not assigned yet). */
    abilities = $derived(
        this.abilityMethod === 'pointbuy'
            ? { ...this.pointBuy }
            : byAbility((k) => {
                const i = this.abilityAssign[k];
                return i == null ? null : (this.abilityPool[i] ?? null);
            }),
    );

    // --- Origin (2024 background): ability score bonuses ---
    // mode '2-1': +2 to one, +1 to another; '1-1-1': +1 to three (from the background's list)
    backgroundBonusMode = $state('2-1');
    backgroundBonus = $state({});          // { str: 2, dex: 1 }

    /**
     * Final ability scores: base + origin + increases from level
     * choices (choices[*].asi). Max 20. null — base not assigned yet.
     */
    totalAbilities = $derived(
        byAbility((k) => {
            const base = this.abilities[k];
            if (base == null) return null;
            const fromChoices = Object.values(this.choices ?? {}).reduce(
                (sum, c) => sum + (c?.asi?.[k] ?? 0),
                0,
            );
            return Math.min(20, base + (this.backgroundBonus[k] ?? 0) + fromChoices);
        }),
    );

    pointsSpent = $derived(pointBuySpent(this.pointBuy));
    pointsLeft = $derived(POINT_BUY_BUDGET - this.pointsSpent);

    // --- Species ---
    raceId = $state(null);
    subraceId = $state(null);

    // --- Class ---
    classId = $state(null);
    subclassId = $state(null);

    // --- Equipment ---
    equipment = $state(defaultEquipment());

    // --- Other choices (skills, languages, feats, etc.) ---
    // key — the choice source, e.g. 'class:skills', 'background:abilities'
    choices = $state({});

    constructor(data = {}) {
        const now = new Date().toISOString();

        this.id = data.id ?? newId();
        this.createdAt = data.createdAt ?? now;
        this.updatedAt = data.updatedAt ?? now;

        this.name = data.name ?? '';
        this.portrait = data.portrait ?? null;
        this.bio = { ...defaultBio(), ...(data.bio ?? {}) };
        this.level = clampLevel(data.level);
        this.backgroundId = data.backgroundId ?? null;
        this.backgroundBonusMode = data.backgroundBonusMode === '1-1-1' ? '1-1-1' : '2-1';
        this.backgroundBonus = { ...(data.backgroundBonus ?? {}) };

        this.abilityMethod = data.abilityMethod in ABILITY_METHODS ? data.abilityMethod : 'array';
        this.pointBuy = { ...defaultPointBuy(), ...(data.pointBuy ?? {}) };
        this.abilityRolls = Array.isArray(data.abilityRolls) ? data.abilityRolls : null;
        this.abilityAssign = { ...emptyAssign(), ...(data.abilityAssign ?? {}) };

        this.raceId = data.raceId ?? null;
        this.subraceId = data.subraceId ?? null;

        this.classId = data.classId ?? null;
        this.subclassId = data.subclassId ?? null;

        this.equipment = { ...defaultEquipment(), ...(data.equipment ?? {}) };

        this.choices = { ...(data.choices ?? {}) };
    }

    // --- mutations ---

    setLevel(n) {
        this.level = clampLevel(n);
        this.touch();
    }

    // --- abilities ---

    setAbilityMethod(method) {
        if (!(method in ABILITY_METHODS) || method === this.abilityMethod) return;
        this.abilityMethod = method;
        this.abilityAssign = emptyAssign();
        if (method === 'roll' && !this.abilityRolls) this.abilityRolls = rollAbilitySet();
        this.touch();
    }

    /** Point buy: change a score by delta (+1 / -1) if enough points remain. */
    pointBuyStep(key, delta) {
        const next = this.pointBuy[key] + delta;
        if (next < POINT_BUY_MIN || next > POINT_BUY_MAX) return false;
        const cost = POINT_BUY_COST[next] - POINT_BUY_COST[this.pointBuy[key]];
        if (cost > this.pointsLeft) return false;
        this.pointBuy[key] = next;
        this.touch();
        return true;
    }

    resetPointBuy() {
        this.pointBuy = defaultPointBuy();
        this.touch();
    }

    /**
     * Assign a pool value (index) to an ability, or clear it (null).
     * If the index is already taken by another ability, the values are swapped.
     */
    assignAbility(key, index) {
        const prev = this.abilityAssign[key];
        const owner = ABILITY_KEYS.find((k) => k !== key && this.abilityAssign[k] === index);
        if (index != null && owner) this.abilityAssign[owner] = prev;
        this.abilityAssign[key] = index;
        this.touch();
    }

    clearAssign() {
        this.abilityAssign = emptyAssign();
        this.touch();
    }

    reroll() {
        this.abilityRolls = rollAbilitySet();
        this.abilityAssign = emptyAssign();
        this.touch();
    }

    /** Select a species (null — clear). The subrace is reset. */
    setRace(raceId, subraceId = null) {
        this.raceId = raceId ?? null;
        this.subraceId = this.raceId ? subraceId : null;
        this.touch();
    }

    /** Select a subrace of the current species (null — clear). */
    setSubrace(subraceId) {
        if (!this.raceId) return;
        this.subraceId = subraceId ?? null;
        this.touch();
    }

    /** Select a class (null — clear). The subclass is reset. */
    setClass(classId, subclassId = null) {
        this.classId = classId ?? null;
        this.subclassId = this.classId ? subclassId : null;
        this.touch();
    }

    /** Select a subclass of the current class (null — clear). */
    setSubclass(subclassId) {
        if (!this.classId) return;
        this.subclassId = subclassId ?? null;
        this.touch();
    }

    // --- equipment ---

    /** Armor (null — remove). */
    setArmor(armorId) {
        this.equipment.armorId = armorId ?? null;
        this.touch();
    }

    /** Shield: taken / not taken. */
    setShield(on) {
        this.equipment.shield = !!on;
        this.touch();
    }

    /** Add / remove a weapon. */
    toggleWeapon(weaponId) {
        const list = this.equipment.weaponIds;
        const i = list.indexOf(weaponId);
        if (i === -1) list.push(weaponId);
        else list.splice(i, 1);
        this.touch();
    }

    /** Equipment pack (null — remove). */
    setPack(packId) {
        this.equipment.packId = packId ?? null;
        this.touch();
    }

    /** Give an item to the backpack (weapon, armor or catalog item). */
    addToBag(kind, id, qty = 1) {
        const bag = this.equipment.bag ?? (this.equipment.bag = []);
        const it = bag.find((b) => b.kind === kind && b.id === id);
        if (it) it.qty += qty;
        else bag.push({ kind, id, qty });
        this.touch();
    }

    /** Remove a granted item (qty pieces; 0 — all). */
    removeFromBag(kind, id, qty = 1) {
        const bag = this.equipment.bag ?? [];
        const i = bag.findIndex((b) => b.kind === kind && b.id === id);
        if (i === -1) return;
        if (!qty || bag[i].qty <= qty) bag.splice(i, 1);
        else bag[i].qty -= qty;
        this.touch();
    }

    /** How many of this item have been granted. */
    bagCount(kind, id) {
        return (this.equipment.bag ?? []).find((b) => b.kind === kind && b.id === id)?.qty ?? 0;
    }

    /** Add / remove an individual item. */
    toggleItem(itemId, qty = 1) {
        const list = this.equipment.items;
        const i = list.findIndex((it) => it.id === itemId);
        if (i === -1) list.push({ id: itemId, qty });
        else list.splice(i, 1);
        this.touch();
    }

    // --- origin ---

    setBackground(backgroundId) {
        if (backgroundId === this.backgroundId) return;
        this.backgroundId = backgroundId ?? null;
        this.backgroundBonus = {};
        // choices tied to the background's feat are no longer relevant
        for (const k of Object.keys(this.choices)) if (k.includes(':background')) delete this.choices[k];
        this.touch();
    }

    setBackgroundBonusMode(mode) {
        this.backgroundBonusMode = mode === '1-1-1' ? '1-1-1' : '2-1';
        this.backgroundBonus = {};
        this.touch();
    }

    /**
     * Assign a bonus to an ability.
     * '2-1': value 2 or 1 (each value goes to one ability);
     * '1-1-1': +1 toggle.
     */
    setBackgroundBonus(key, value) {
        const b = { ...this.backgroundBonus };
        if (this.backgroundBonusMode === '1-1-1') {
            if (b[key]) delete b[key];
            else b[key] = 1;
        } else {
            for (const k of Object.keys(b)) if (b[k] === value || k === key) delete b[k];
            if (value) b[key] = value;
        }
        this.backgroundBonus = b;
        this.touch();
    }

    // --- level choices (see rules/progression.js) ---

    /** value: { kind, ids?: [...], asi?: { str: 1 } } or null — clear. */
    setChoice(key, value) {
        if (value == null) delete this.choices[key];
        else this.choices[key] = value;
        this.touch();
    }

    /** Drop level choices above the given level (e.g. when undoing a level-up). */
    dropChoicesAbove(level) {
        for (const k of Object.keys(this.choices)) {
            const m = /^L(\d+):/.exec(k);
            if (m && Number(m[1]) > level) delete this.choices[k];
        }
    }

    touch() {
        this.updatedAt = new Date().toISOString();
    }

    // --- serialization ---

    /** Plain object for saving (JSON / Go backend). */
    toJSON() {
        return $state.snapshot({
            id: this.id,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            name: this.name,
            portrait: this.portrait,
            bio: this.bio,
            level: this.level,
            backgroundId: this.backgroundId,
            backgroundBonusMode: this.backgroundBonusMode,
            backgroundBonus: this.backgroundBonus,
            abilityMethod: this.abilityMethod,
            pointBuy: this.pointBuy,
            abilityRolls: this.abilityRolls,
            abilityAssign: this.abilityAssign,
            abilities: this.abilities, // derived, for readability
            totalAbilities: this.totalAbilities, // derived: with bonuses
            raceId: this.raceId,
            subraceId: this.subraceId,
            classId: this.classId,
            subclassId: this.subclassId,
            equipment: this.equipment,
            choices: this.choices,
        });
    }

    static fromJSON(data) {
        return new CharacterBuild(typeof data === 'string' ? JSON.parse(data) : data);
    }
}
