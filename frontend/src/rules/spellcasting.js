/**
 * Spell slots (D&D 2024 + the BOOST house rule below).
 * progression: full | half | third | pact | none
 */

// Full caster slots by caster level: [1st … 9th level]
const FULL = [
    [],
    [2],
    [3],
    [4, 2],
    [4, 3],
    [4, 3, 2],
    [4, 3, 3],
    [4, 3, 3, 1],
    [4, 3, 3, 2],
    [4, 3, 3, 3, 1],
    [4, 3, 3, 3, 2],
    [4, 3, 3, 3, 2, 1],
    [4, 3, 3, 3, 2, 1],
    [4, 3, 3, 3, 2, 1, 1],
    [4, 3, 3, 3, 2, 1, 1],
    [4, 3, 3, 3, 2, 1, 1, 1],
    [4, 3, 3, 3, 2, 1, 1, 1],
    [4, 3, 3, 3, 2, 1, 1, 1, 1],
    [4, 3, 3, 3, 3, 1, 1, 1, 1],
    [4, 3, 3, 3, 3, 2, 1, 1, 1],
    [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

// Pact Magic (warlock): [slot count, slot level] by level
const PACT = [
    [0, 0], [1, 1], [2, 1], [2, 2], [2, 2], [2, 3], [2, 3], [2, 4], [2, 4], [2, 5], [2, 5],
    [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [4, 5], [4, 5], [4, 5], [4, 5],
];

// House rule: extra slots from these CHARACTER levels on (cumulative).
// { characterLevel: { slotLevel: at least N slots } } — a slot level the class doesn't have yet is ignored.
const BOOST = {
    full: {
        8: { 1: 5, 2: 4 },
        12: { 1: 6, 2: 5, 3: 4 },
        16: { 4: 4, 6: 2 },
        20: { 3: 5, 6: 3, 8: 2 },
    },
    half: {
        8: { 1: 5 },
        12: { 2: 4 },
        16: { 1: 6, 2: 5, 3: 4 },
        20: { 3: 5, 4: 4, 5: 3 },
    },
    third: {
        8: { 1: 5 },
        16: { 1: 6, 2: 4 },
        20: { 3: 4, 4: 3 },
    },
};

/** Caster level for the FULL table. */
export function casterLevel(progression, level) {
    switch (progression) {
        case 'full': return level;
        case 'half': return Math.ceil(level / 2);   // 2024: half casters from level 1
        case 'third': return level >= 3 ? Math.ceil(level / 3) : 0;
        default: return 0;
    }
}

/**
 * Slots for a class: [{ level: slot level, max, pact? }]
 * Warlock — separate pact slots (recovered on a Short Rest).
 */
export function spellSlots(progression, level) {
    if (progression === 'pact') {
        const [count, circle] = PACT[Math.min(20, Math.max(0, level))];
        return count ? [{ level: circle, max: count, pact: true }] : [];
    }
    const cl = casterLevel(progression, level);
    const row = [...(FULL[Math.min(20, cl)] ?? [])];
    for (const [at, slots] of Object.entries(BOOST[progression] ?? {})) {
        if (level < Number(at)) continue;
        for (const [sl, n] of Object.entries(slots)) {
            const i = Number(sl) - 1;
            if (i < row.length) row[i] = Math.max(row[i], n);
        }
    }
    return row.map((max, i) => ({ level: i + 1, max }));
}
