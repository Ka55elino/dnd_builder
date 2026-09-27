/**
 * Bestiary data: monsters and encounter presets (Go: bestiary.go), labels and
 * the numbers the DM counts with (XP by CR, encounter XP budgets).
 * Nothing here rolls dice — the app is a companion to a real table.
 *
 *   const monsters = await loadMonsters();       // cached; save/delete refresh it
 *   const encounters = await GetEncounters();
 */
import {
    GetMonsters,
    SaveCustomMonster,
    DeleteCustomMonster,
    GetEncounters,
    SaveEncounter,
    DeleteEncounter,
} from '../api.js';

// ---------- labels ----------

export const CREATURE_TYPES = {
    aberration: 'Aberration',
    beast: 'Beast',
    celestial: 'Celestial',
    construct: 'Construct',
    dragon: 'Dragon',
    elemental: 'Elemental',
    fey: 'Fey',
    fiend: 'Fiend',
    giant: 'Giant',
    humanoid: 'Humanoid',
    monstrosity: 'Monstrosity',
    ooze: 'Ooze',
    plant: 'Plant',
    undead: 'Undead',
};

export const SIZES = {
    tiny: 'Tiny',
    small: 'Small',
    medium: 'Medium',
    large: 'Large',
    huge: 'Huge',
    gargantuan: 'Gargantuan',
};

export const HABITATS = {
    any: 'Any',
    arctic: 'Arctic',
    coastal: 'Coastal',
    desert: 'Desert',
    forest: 'Forest',
    grassland: 'Grassland',
    hill: 'Hill',
    mountain: 'Mountain',
    planar: 'Planar',
    swamp: 'Swamp',
    underdark: 'Underdark',
    underwater: 'Underwater',
    urban: 'Urban',
};

export const SPEEDS = { walk: 'Walk', fly: 'Fly', swim: 'Swim', climb: 'Climb', burrow: 'Burrow' };
export const SENSES = { darkvision: 'Darkvision', blindsight: 'Blindsight', tremorsense: 'Tremorsense', truesight: 'Truesight' };

export const CONDITIONS = [
    'blinded', 'charmed', 'deafened', 'exhaustion', 'frightened', 'grappled', 'incapacitated',
    'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious',
];

/** Sections of a stat block, in order. */
export const ACTION_GROUPS = [
    { key: 'traits', title: 'Traits' },
    { key: 'actions', title: 'Actions' },
    { key: 'bonusActions', title: 'Bonus Actions' },
    { key: 'reactions', title: 'Reactions' },
];

export const cap = (s) => String(s ?? '').replace(/^\w/, (c) => c.toUpperCase());

// ---------- numbers ----------

/** All Challenge Ratings, in order. */
export const CRS = [0, 0.125, 0.25, 0.5, ...Array.from({ length: 30 }, (_, i) => i + 1)];

/** "1/8", "1/4", "1/2", "5". */
export const crLabel = (cr) => ({ 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' })[cr] ?? String(cr);

/** XP a monster is worth by Challenge Rating. */
export const XP_BY_CR = {
    0: 10, 0.125: 25, 0.25: 50, 0.5: 100,
    1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900, 9: 5000, 10: 5900,
    11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000, 16: 15000, 17: 18000, 18: 20000,
    19: 22000, 20: 25000, 21: 33000, 22: 41000, 23: 50000, 24: 62000, 25: 75000, 26: 90000,
    27: 105000, 28: 120000, 29: 135000, 30: 155000,
};

/** Proficiency Bonus by Challenge Rating. */
export const profByCR = (cr) => (cr < 5 ? 2 : Math.min(9, Math.floor((cr - 1) / 4) + 2));

export const abilityMod = (score) => Math.floor((Number(score ?? 10) - 10) / 2);
export const fmtMod = (n) => (n >= 0 ? `+${n}` : `${n}`);
export const fmtXP = (n) => Number(n ?? 0).toLocaleString('en-US');

/**
 * Encounter XP budget per character, by character level (D&D 2024):
 * [Low, Moderate, High]. The party's budget is the sum over its characters.
 */
export const XP_BUDGET = {
    1: [50, 75, 100], 2: [100, 150, 200], 3: [150, 225, 400], 4: [250, 375, 500],
    5: [500, 750, 1100], 6: [600, 1000, 1400], 7: [750, 1300, 1700], 8: [1000, 1700, 2100],
    9: [1300, 2000, 2600], 10: [1600, 2300, 3100], 11: [1900, 2900, 4100], 12: [2200, 3700, 4700],
    13: [2600, 4200, 5400], 14: [2900, 4900, 6200], 15: [3300, 5400, 7800], 16: [3800, 6100, 9800],
    17: [4500, 7200, 11700], 18: [5000, 8700, 14200], 19: [5500, 10700, 17200], 20: [6400, 13200, 22000],
};

export const DIFFICULTIES = ['Low', 'Moderate', 'High'];

/** Party budget: levels = [3, 3, 4, 2] → { low, moderate, high }. */
export function partyBudget(levels) {
    const b = [0, 0, 0];
    for (const l of levels) {
        const row = XP_BUDGET[Math.min(20, Math.max(1, Math.floor(l) || 1))];
        for (let i = 0; i < 3; i++) b[i] += row[i];
    }
    return { low: b[0], moderate: b[1], high: b[2] };
}

/**
 * Where an encounter's XP lands against the party's budget:
 * 'trivial' (under Low) | 'low' | 'moderate' | 'high' | 'deadly' (over High).
 */
export function difficultyOf(xp, budget) {
    if (!xp) return 'none';
    if (xp > budget.high) return 'deadly';
    if (xp > budget.moderate) return 'high';
    if (xp > budget.low) return 'moderate';
    if (xp >= budget.low * 0.5) return 'low';
    return 'trivial';
}

export const DIFFICULTY_LABELS = {
    none: '—',
    trivial: 'Trivial',
    low: 'Low',
    moderate: 'Moderate',
    high: 'High',
    deadly: 'Beyond High',
};

// ---------- monsters (cached) ----------

let cache = null;

export function loadMonsters() {
    cache ??= GetMonsters().catch((e) => {
        cache = null;
        throw e;
    });
    return cache;
}

export async function refreshMonsters() {
    cache = null;
    return loadMonsters();
}

/** Create/update the DM's own monster; refreshes the cache. Returns the id. */
export async function saveMonster(monster) {
    const id = await SaveCustomMonster(typeof monster === 'string' ? monster : JSON.stringify(monster));
    await refreshMonsters();
    return id;
}

export async function deleteMonster(id) {
    await DeleteCustomMonster(id);
    await refreshMonsters();
}

export const isCustomMonster = (m) => !!m?.data?.custom;

// ---------- encounters ----------

export const loadEncounters = () => GetEncounters();
export const saveEncounter = (enc) => SaveEncounter(JSON.stringify(enc));
export const deleteEncounter = (id) => DeleteEncounter(id);

/** Total XP and monster count of an encounter, given the bestiary. */
export function encounterTotals(enc, monsters) {
    const byId = new Map(monsters.map((m) => [m.id, m]));
    let xp = 0;
    let count = 0;
    for (const line of enc?.monsters ?? []) {
        const m = byId.get(line.monsterId);
        if (!m) continue;
        xp += m.xp * line.count;
        count += line.count;
    }
    return { xp, count };
}
