/**
 * Common reference labels: damage types, action types, rest types, schools of magic.
 * Used in cards, tables and choices. Icons use the same ids
 * (see components/common/Icon.svelte, files src/assets/icons/<id>.svg).
 */

/** Damage types. short — for narrow spots (tables, chips). */
export const DAMAGE_TYPES = {
    bludgeoning: { name: 'Bludgeoning', short: 'bludg.' },
    piercing: { name: 'Piercing', short: 'pierc.' },
    slashing: { name: 'Slashing', short: 'slash.' },
    acid: { name: 'Acid', short: 'acid' },
    cold: { name: 'Cold', short: 'cold' },
    fire: { name: 'Fire', short: 'fire' },
    force: { name: 'Force', short: 'force' },
    lightning: { name: 'Lightning', short: 'light.' },
    necrotic: { name: 'Necrotic', short: 'necr.' },
    poison: { name: 'Poison', short: 'poison' },
    psychic: { name: 'Psychic', short: 'psych.' },
    radiant: { name: 'Radiant', short: 'rad.' },
    thunder: { name: 'Thunder', short: 'thund.' },
    physical: { name: 'Physical', short: 'phys.' },
    weapon: { name: 'Weapon damage', short: 'weap.' },
};

/** Action types (the action field of spells and abilities). */
export const ACTION_TYPES = {
    action: { name: 'Action', short: 'A' },
    bonus: { name: 'Bonus Action', short: 'BA' },
    reaction: { name: 'Reaction', short: 'R' },
    free: { name: 'Free Action', short: 'F' },
};

/** Recovery periods (uses.per). */
export const REST_TYPES = {
    shortRest: { name: 'Short Rest', short: 'SR' },
    longRest: { name: 'Long Rest', short: 'LR' },
    day: { name: 'Day', short: 'day' },
};

/** Schools of magic. */
export const SCHOOLS = {
    abjuration: 'Abjuration',
    conjuration: 'Conjuration',
    divination: 'Divination',
    enchantment: 'Enchantment',
    evocation: 'Evocation',
    illusion: 'Illusion',
    necromancy: 'Necromancy',
    transmutation: 'Transmutation',
};

/** Action normalization: 'bonus_action' → 'bonus'. */
export const normAction = (a) => (a ? String(a).replace(/_action$/, '') : null);

export const damageName = (t) => DAMAGE_TYPES[t]?.name ?? t ?? '';
/** Tooltip label: "Fire damage", "Piercing damage". */
export const damageLabel = (t) => {
    const n = DAMAGE_TYPES[t]?.name;
    if (!n) return t ?? '';
    if (t === 'weapon') return n;
    return `${n} damage`;
};
export const damageShort = (t) => DAMAGE_TYPES[t]?.short ?? t ?? '';
export const actionName = (a) => ACTION_TYPES[normAction(a)]?.name ?? a ?? '';
export const restName = (r) => REST_TYPES[r]?.name ?? r ?? '';
