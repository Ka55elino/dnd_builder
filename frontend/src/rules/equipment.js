/**
 * Labels and calculations for equipment (weapons, armor).
 * Shared by the builder's "Equipment" tab and the "Give Item" page.
 */

// clothing — worn in the Armor slot but doesn't count as armor (unarmored AC, Mage Armor and
// Unarmored Defense still work); it may carry its own baseAC (Robe of the Archmagi) or acBonus
export const ARMOR_CAT = { clothing: 'Clothing', light: 'Light', medium: 'Medium', heavy: 'Heavy', shield: 'Shield' };

/** Clothing: worn, but not armor. */
export const isClothing = (a) => a?.category === 'clothing';
/** Body armor that counts as armor (not a shield, not clothing). */
export const isBodyArmor = (a) => !!a && a.category !== 'shield' && a.category !== 'clothing';
export const WEAPON_CAT = { simple: 'Simple', martial: 'Martial' };

export const WEAPON_PROPS = {
    finesse: 'finesse',
    light: 'light',
    thrown: 'thrown',
    versatile: 'versatile',
    ranged: 'ranged',
    twoHanded: 'two-handed',
    heavy: 'heavy',
    reach: 'reach',
    loading: 'loading',
    ammunition: 'ammunition',
};

/** Armor AC as text: "13 + Dex (max 2)", for a shield "+2". */
export function acText(a) {
    const d = a.data ?? {};
    if (a.category === 'shield') return `+${d.acBonus ?? 2}`;
    if (isClothing(a) && !a.baseAC) return d.acBonus ? fmtBonus(d.acBonus) : '—';
    if (!d.addDex) return `${a.baseAC}`;
    return d.maxDex != null ? `${a.baseAC} + Dex (max ${d.maxDex})` : `${a.baseAC} + Dex`;
}

function fmtBonus(n) {
    return n > 0 ? `+${n}` : `${n}`;
}

/** "Light · AC 11 + Dex", "Clothing · not armor", "Clothing · AC 15 + Dex". */
export function armorSummary(a) {
    const cat = ARMOR_CAT[a.category] ?? a.category ?? '';
    const d = a.data ?? {};
    if (isClothing(a) && !a.baseAC && !d.acBonus) return `${cat} · not armor`;
    const bonus = d.acBonus && a.category !== 'shield' && !(isClothing(a) && !a.baseAC) ? ` ${fmtBonus(d.acBonus)}` : '';
    return `${cat} · AC ${acText(a)}${bonus}`;
}

/**
 * Item description for a tooltip: { title, tag, lines: [stat lines], desc }.
 * item — a backpack entry (Character.inventory): { kind: 'weapon'|'armor'|'shield'|'item', ref, qty }
 */
export function describeItem(item, { damageShort = (t) => t } = {}) {
    const r = item.ref ?? {};
    const d = r.data ?? {};
    const lines = [];

    if (item.kind === 'weapon') {
        lines.push(WEAPON_CAT[r.category] ?? r.category ?? '');
        lines.push(['Damage:', r.damage, damageShort(r.damageType)].filter(Boolean).join(' '));
        if (d.attackBonus || d.damageBonus) {
            lines.push(
                [d.attackBonus ? `${fmtBonus(d.attackBonus)} to hit` : '', d.damageBonus ? `${fmtBonus(d.damageBonus)} to damage` : '']
                    .filter(Boolean)
                    .join(', '),
            );
        }
        for (const x of d.extraDamage ?? []) lines.push(`Extra damage: ${x.dice} ${damageShort(x.type)}`);
        if (d.mastery) lines.push(`Mastery: ${d.mastery}`);
        if (d.properties?.length) lines.push(d.properties.map((p) => WEAPON_PROPS[p] ?? p).join(', '));
    } else if (item.kind === 'armor' || item.kind === 'shield') {
        lines.push(ARMOR_CAT[r.category] ?? r.category ?? '');
        if (isClothing(r)) {
            lines.push("Doesn't count as armor");
            if (r.baseAC) lines.push(`AC: ${acText(r)} (if you wear no armor)`);
            if (d.acBonus) lines.push(`AC ${fmtBonus(d.acBonus)}`);
            if (d.weight) lines.push(`Weight: ${d.weight} lb.`);
            if (d.cost) lines.push(`Cost: ${d.cost}`);
        } else lines.push(`AC: ${acText(r)}${d.acBonus && r.category !== 'shield' ? ` ${fmtBonus(d.acBonus)}` : ''}`);
        if (d.strengthReq) lines.push(`Requires Strength ${d.strengthReq}`);
        if (d.stealthDisadvantage) lines.push('Disadvantage on Stealth');
    } else {
        if (r.weight) lines.push(`Weight: ${r.weight} lb.`);
        if (r.cost) lines.push(`Cost: ${r.cost}`);
    }
    if (item.qty > 1) lines.push(`Quantity: ${item.qty}`);

    return {
        title: r.name ?? item.name,
        tag: d.custom ? 'custom' : r.isDefault === false ? 'named' : '',
        lines: lines.filter(Boolean),
        desc: r.desc ?? d.desc ?? '',
    };
}
