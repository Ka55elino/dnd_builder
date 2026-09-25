/**
 * Ability score rules (D&D 5e / 2024).
 * Pure functions and constants — stateless.
 */

export const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const ABILITIES = {
    str: { short: 'STR', name: 'Strength' },
    dex: { short: 'DEX', name: 'Dexterity' },
    con: { short: 'CON', name: 'Constitution' },
    int: { short: 'INT', name: 'Intelligence' },
    wis: { short: 'WIS', name: 'Wisdom' },
    cha: { short: 'CHA', name: 'Charisma' },
};

export const ABILITY_METHODS = {
    array:    { name: 'Standard Array', hint: '15, 14, 13, 12, 10, 8' },
    pointbuy: { name: 'Point Buy', hint: '27 points, values 8–15' },
    roll:     { name: 'Roll Dice', hint: '4d6, drop the lowest' },
};

// --- standard array ---
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

// --- point buy ---
export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_MIN = 8;
export const POINT_BUY_MAX = 15;
export const POINT_BUY_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

export const pointBuySpent = (scores) =>
    ABILITY_KEYS.reduce((sum, k) => sum + (POINT_BUY_COST[scores[k]] ?? 0), 0);

/** Cost to raise a score by 1 (null — not allowed). */
export const pointBuyStepCost = (score) =>
    score >= POINT_BUY_MAX ? null : POINT_BUY_COST[score + 1] - POINT_BUY_COST[score];

// --- roll ---
const d6 = () => {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return (buf[0] % 6) + 1;
};

/** 4d6, drop the lowest. Returns { dice: [4 items], total }. */
export function roll4d6DropLowest() {
    const dice = [d6(), d6(), d6(), d6()];
    const sorted = [...dice].sort((a, b) => a - b);
    return { dice, total: sorted[1] + sorted[2] + sorted[3] };
}

/** Six rolls. */
export const rollAbilitySet = () => Array.from({ length: 6 }, roll4d6DropLowest);

// --- modifier ---
export const modifier = (score) => (score == null ? null : Math.floor((score - 10) / 2));

export const formatModifier = (mod) => (mod == null ? '—' : mod >= 0 ? `+${mod}` : `${mod}`);
