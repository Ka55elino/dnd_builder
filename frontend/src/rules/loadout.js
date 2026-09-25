/**
 * Loadout: what is held and what is worn.
 *
 * Inventory (backpack) — everything the character has; built in Character:
 *   [{ key, kind: 'weapon' | 'shield' | 'armor' | 'item', name, ref, qty }]
 *   key: 'weapon:<id>' | 'shield' | 'armor:<id>' | 'item:<id>'
 *
 * Loadout (stored in CharacterState.equipped):
 *   { main: key | null,   // right hand — weapon or shield
 *     off:  key | null,   // left hand  — weapon or shield
 *     armor: key | null } // armor only
 *
 * Rules:
 *   - hands hold only weapons or shields; the armor slot holds only armor;
 *   - one item cannot be held in both hands at once;
 *   - a two-handed weapon takes both hands: the other hand becomes empty.
 */

export const SLOTS = [
    { id: 'main', label: 'Right hand' },
    { id: 'off', label: 'Left hand' },
    { id: 'armor', label: 'Armor' },
];

export const EMPTY = { main: null, off: null, armor: null };

const isHandItem = (it) => it.kind === 'weapon' || it.kind === 'shield';
export const isTwoHanded = (it) =>
    it?.kind === 'weapon' && (it.ref?.data?.properties ?? []).includes('twoHanded');

const byKey = (inventory, key) => (key ? inventory.find((it) => it.key === key) ?? null : null);

/** Options for a slot (for the select). */
export function slotOptions(slot, inventory) {
    return slot === 'armor'
        ? inventory.filter((it) => it.kind === 'armor')
        : inventory.filter(isHandItem);
}

/** Default loadout — from what was chosen in the builder. */
export function defaultEquipped(inventory) {
    const armor = inventory.find((it) => it.kind === 'armor')?.key ?? null;
    const weapons = inventory.filter((it) => it.kind === 'weapon');
    const shield = inventory.find((it) => it.kind === 'shield')?.key ?? null;

    let main = weapons[0]?.key ?? null;
    let off = shield;
    if (isTwoHanded(weapons[0])) off = null; // two-handed — the shield stays in the backpack
    return normalize({ main, off, armor }, inventory);
}

/**
 * Brings the loadout in line with the rules: removes missing items,
 * items of the wrong kind, duplicates and conflicts with two-handed weapons.
 */
export function normalize(equipped, inventory) {
    const e = { ...EMPTY, ...(equipped ?? {}) };
    const main = byKey(inventory, e.main);
    const off = byKey(inventory, e.off);
    const armor = byKey(inventory, e.armor);

    e.main = main && isHandItem(main) ? main.key : null;
    e.off = off && isHandItem(off) && off.key !== e.main ? off.key : null;
    e.armor = armor?.kind === 'armor' ? armor.key : null;

    if (isTwoHanded(byKey(inventory, e.main))) e.off = null;
    else if (isTwoHanded(byKey(inventory, e.off))) e.main = null;
    return e;
}

/** Put an item in a slot (null — unequip). Returns the new loadout. */
export function equip(equipped, slot, key, inventory) {
    const e = { ...EMPTY, ...(equipped ?? {}) };
    e[slot] = key || null;

    if (slot !== 'armor' && key) {
        const other = slot === 'main' ? 'off' : 'main';
        // same item in the other hand — move it
        if (e[other] === key) e[other] = null;
        // two-handed — the other hand is emptied
        if (isTwoHanded(byKey(inventory, key))) e[other] = null;
        // the other hand holds a two-handed weapon — it has to go
        else if (isTwoHanded(byKey(inventory, e[other]))) e[other] = null;
    }
    return normalize(e, inventory);
}

/** Resolved loadout items → objects. */
export function resolve(equipped, inventory) {
    return {
        main: byKey(inventory, equipped.main),
        off: byKey(inventory, equipped.off),
        armor: byKey(inventory, equipped.armor),
    };
}

/** Where the item is now: 'main' | 'off' | 'armor' | null. */
export function slotOf(key, equipped) {
    return SLOTS.find((s) => equipped[s.id] === key)?.id ?? null;
}
