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

/** FULL table row for a caster level + the BOOST house rule (by CHARACTER level). */
function slotRow(cl, boostProgression, charLevel) {
    const row = [...(FULL[Math.min(20, Math.max(0, cl))] ?? [])];
    for (const [at, slots] of Object.entries(BOOST[boostProgression] ?? {})) {
        if (charLevel < Number(at)) continue;
        for (const [sl, n] of Object.entries(slots)) {
            const i = Number(sl) - 1;
            if (i < row.length) row[i] = Math.max(row[i], n);
        }
    }
    return row.map((max, i) => ({ level: i + 1, max }));
}

const pactSlots = (level) => {
    const [count, circle] = PACT[Math.min(20, Math.max(0, level))];
    return count ? [{ level: circle, max: count, pact: true }] : [];
};

/**
 * Slots for a class: [{ level: slot level, max, pact? }]
 * Warlock — separate pact slots (recovered on a Short Rest).
 * level — the class level; charLevel — the character level (BOOST), default — the same.
 */
export function spellSlots(progression, level, charLevel = level) {
    if (progression === 'pact') return pactSlots(level);
    return slotRow(casterLevel(progression, level), progression, charLevel);
}

const STRENGTH = { full: 3, half: 2, third: 1 };

/**
 * A character's slots, multiclassing included (PHB 2024):
 *   one spellcasting class — its own table;
 *   several — caster level = full levels + half levels / 2 (round up) + third levels / 3
 *   (round down), on the full caster table;
 *   Pact Magic — separate, by the warlock level.
 * BOOST (house rule): by the character level, with the strongest progression among the classes.
 * casters — [{ progression, level }] (classes whose spellcasting has started); charLevel — total.
 */
export function multiclassSlots(casters, charLevel) {
    const pact = casters.filter((c) => c.progression === 'pact');
    const other = casters.filter((c) => STRENGTH[c.progression]);
    let slots = [];
    if (other.length === 1) {
        slots = spellSlots(other[0].progression, other[0].level, charLevel);
    } else if (other.length > 1) {
        const cl = other.reduce((sum, c) => {
            if (c.progression === 'full') return sum + c.level;
            if (c.progression === 'half') return sum + Math.ceil(c.level / 2);
            return sum + Math.floor(c.level / 3);
        }, 0);
        const best = other.reduce((a, c) => (STRENGTH[c.progression] > STRENGTH[a.progression] ? c : a)).progression;
        slots = slotRow(cl, best, charLevel);
    }
    const pactLevel = pact.reduce((sum, c) => sum + c.level, 0);
    return [...slots, ...(pactLevel ? pactSlots(pactLevel) : [])];
}
