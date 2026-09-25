/**
 * Labels and calculations for equipment (weapons, armor).
 * Shared by the builder's "Equipment" tab and the "Give Item" page.
 */

export const ARMOR_CAT = { light: 'Light', medium: 'Medium', heavy: 'Heavy', shield: 'Shield' };
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
    if (!d.addDex) return `${a.baseAC}`;
    return d.maxDex != null ? `${a.baseAC} + Dex (max ${d.maxDex})` : `${a.baseAC} + Dex`;
}

const fmtBonus = (n) => (n > 0 ? `+${n}` : `${n}`);

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
        lines.push(`AC: ${acText(r)}${d.acBonus && r.category !== 'shield' ? ` ${fmtBonus(d.acBonus)}` : ''}`);
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
