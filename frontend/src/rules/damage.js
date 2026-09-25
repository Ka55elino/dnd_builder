/**
 * Spell and ability damage scaling with level (v2 data format).
 *
 *   damage: { dice: '1d10', type: 'fire', scaling: 'cantrip' }
 *   damage: { dice: '1d6', scaling: 'sneak' }              — sneak attack: ⌈lvl/2⌉ d6
 *   damage: { dice: '1d6', scaling: 'mark' }               — hunter's mark: d10 at lvl 20
 *   damage: { dice: '2d8', scaling: { 5: '3d8', 11: '4d8' } } — table by level
 *   damage: { primary: {...}, secondary: {...} }            — several parts
 *
 *   scaleDie: [[2, '2d8'], [7, '3d8']]                      — ability die by level
 */

/** Damage parts at the character's level: [{ dice, type }]. */
export function damageParts(dmg, level = 1) {
    if (!dmg) return [];
    const isPart = (v) => v && typeof v === 'object' && ('dice' in v || 'type' in v || 'scaling' in v);
    if (!('dice' in dmg) && !('type' in dmg)) {
        return Object.values(dmg).filter(isPart).map((p) => part(p, level)).filter(Boolean);
    }
    const one = part(dmg, level);
    return one ? [one] : [];
}

function part(p, level) {
    const type = p.type ?? null;
    const sc = p.scaling;

    if (typeof sc === 'string') {
        const m = /^(\d+)d(\d+)$/.exec(p.dice ?? '');
        let count = m ? Number(m[1]) : 1;
        const die = m ? Number(m[2]) : null;
        if (sc === 'cantrip') count += (level >= 5) + (level >= 11) + (level >= 17);
        else if (sc === 'sneak') count = Math.ceil(level / 2);
        else if (sc === 'mark') return { dice: `${count}d${level >= 20 ? 10 : die ?? 6}`, type };
        if (!p.dice) return null;
        return { dice: die ? `${count}d${die}` : p.dice, type };
    }

    if (sc && typeof sc === 'object') {
        let val = p.dice ?? null;
        for (const k of Object.keys(sc).map(Number).sort((a, b) => a - b)) if (level >= k) val = sc[k];
        const dice = formatDice(val);
        return dice ? { dice, type } : null;
    }

    if (!p.dice) return type ? { dice: null, type } : null; // weapon damage without its own dice
    return { dice: p.dice, type };
}

function formatDice(v) {
    if (v == null) return null;
    const s = String(v);
    const m = s.match(/\d+d\d+/);
    const mod = /spellcastingmodifier/i.test(s);
    if (m) return m[0] + (mod ? '+mod' : '');
    return mod ? 'mod' : s;
}

/** Ability die by level from scaleDie: [[level, 'die'], ...]. */
export function dieAt(scaleDie, level = 1) {
    let val = null;
    for (const [l, d] of scaleDie ?? []) if (level >= l) val = d;
    return val;
}
