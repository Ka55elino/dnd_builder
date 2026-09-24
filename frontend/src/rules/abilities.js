/**
 * Правила характеристик (D&D 5e / 2024).
 * Чистые функции и константы — без состояния.
 */

export const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const ABILITIES = {
    str: { short: 'СИЛ', name: 'Сила' },
    dex: { short: 'ЛОВ', name: 'Ловкость' },
    con: { short: 'ТЕЛ', name: 'Телосложение' },
    int: { short: 'ИНТ', name: 'Интеллект' },
    wis: { short: 'МДР', name: 'Мудрость' },
    cha: { short: 'ХАР', name: 'Харизма' },
};

export const ABILITY_METHODS = {
    array:    { name: 'Стандартный набор', hint: '15, 14, 13, 12, 10, 8' },
    pointbuy: { name: 'Покупка очков', hint: '27 очков, значения 8–15' },
    roll:     { name: 'Бросок кубиков', hint: '4к6, откинуть меньший' },
};

// --- стандартный набор ---
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

// --- покупка очков ---
export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_MIN = 8;
export const POINT_BUY_MAX = 15;
export const POINT_BUY_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

export const pointBuySpent = (scores) =>
    ABILITY_KEYS.reduce((sum, k) => sum + (POINT_BUY_COST[scores[k]] ?? 0), 0);

/** Сколько стоит поднять значение на 1 (null — нельзя). */
export const pointBuyStepCost = (score) =>
    score >= POINT_BUY_MAX ? null : POINT_BUY_COST[score + 1] - POINT_BUY_COST[score];

// --- бросок ---
const d6 = () => {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return (buf[0] % 6) + 1;
};

/** 4к6, откинуть наименьший. Возвращает { dice: [4 шт.], total }. */
export function roll4d6DropLowest() {
    const dice = [d6(), d6(), d6(), d6()];
    const sorted = [...dice].sort((a, b) => a - b);
    return { dice, total: sorted[1] + sorted[2] + sorted[3] };
}

/** Шесть бросков. */
export const rollAbilitySet = () => Array.from({ length: 6 }, roll4d6DropLowest);

// --- модификатор ---
export const modifier = (score) => (score == null ? null : Math.floor((score - 10) / 2));

export const formatModifier = (mod) => (mod == null ? '—' : mod >= 0 ? `+${mod}` : `${mod}`);
