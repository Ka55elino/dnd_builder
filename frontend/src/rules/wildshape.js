/**
 * Wild Shape (PHB 2024).
 *
 * The forms a class can take are a separate link: refs.wildShapeForms — [{ monsterId, classId,
 * subclassId, minLevel, name, cr, type, image, ac, hp, speed }] (db wild_shape_forms, seeds in
 * assets/data/wildshape/forms.json); the stat block is the bestiary's monster.
 *
 * The rules come from data:
 *   the class ability (refs.spells, id "wildShape"): data.wildShape = { known: [[2, 4], [4, 6],
 *     [8, 8]], tempHp: 'level', hours: 'level/2' }, uses (2 / 3 / 4, one back on a Short Rest)
 *   the subclass (Circle of the Moon): data.wildShape = { cr: 'level/3', acMin: '13+wis',
 *     tempHp: '3*level', elementalCost: 2 }
 *
 * In the form (CharacterState.wildShape = { monsterId, since }): the druid keeps their own Hit
 * Points and gains Temporary Hit Points (damage takes those first — nothing else to count);
 * the beast's AC / speed / STR, DEX, CON / attacks are on the beast card, the sheet stays the
 * druid's. No spellcasting in the form (until level 18), Concentration stays.
 */
import { byLevelPairs } from './formula.js';
import { modifier } from './abilities.js';

/** The Wild Shape ability of a class (the one with data.wildShape), or null. */
export function wildShapeAbility(refs, classId) {
    return (refs?.spells ?? []).find((sp) => sp.data?.wildShape && (sp.data?.classes ?? []).includes(classId)) ?? null;
}

/** How many forms the character knows at this level (0 — no Wild Shape yet). */
export function formsKnownAt(refs, classId, level) {
    const ab = wildShapeAbility(refs, classId);
    if (!ab || level < (ab.level ?? 2)) return 0;
    return byLevelPairs(ab.data.wildShape.known ?? [], level);
}

const flies = (f) => Number(f?.speed?.fly) > 0;

/**
 * Forms the character may learn at this level: the class's links (and the subclass's), from
 * their level; Circle of the Moon also any of the class's forms up to CR level / 3. Flying
 * forms — from level 8 (the base Wild Shape table).
 */
export function formsAvailable(refs, classId, subclassId, level, subclass = null) {
    const moon = subclass?.data?.wildShape ?? null;
    const moonCr = moon?.cr === 'level/3' ? Math.floor(level / 3) : null;
    return (refs?.wildShapeForms ?? []).filter((f) => {
        if (f.classId !== classId) return false;
        if (f.subclassId && f.subclassId !== subclassId) return false;
        if (f.minLevel <= level) return true;
        // Circle Forms: a higher-CR form of the class, before its own level (no flying before 8)
        return moonCr != null && !f.subclassId && f.cr <= moonCr && (!flies(f) || level >= 8);
    });
}

/** Temporary Hit Points the form gives: the subclass's formula, else the ability's. */
export function formTempHp(refs, classId, subclass, level) {
    const f = subclass?.data?.wildShape?.tempHp ?? wildShapeAbility(refs, classId)?.data?.wildShape?.tempHp ?? 'level';
    const m = /^(\d+)\s*\*\s*level$/.exec(String(f));
    return m ? Number(m[1]) * level : level;
}

/** How long the form lasts, hours. */
export const formHours = (level) => Math.max(1, Math.floor(level / 2));

/** Uses a form costs (Circle of the Moon: an Elemental — 2). */
export function formCost(form, subclass) {
    const cost = subclass?.data?.wildShape?.elementalCost;
    return cost && (form?.type === 'elemental' || form?.subclassId) ? cost : 1;
}

/**
 * The beast card's numbers: the monster's AC (Circle of the Moon: at least 13 + WIS), speed,
 * STR / DEX / CON; INT / WIS / CHA stay the druid's.
 */
export function formStats(monster, { mods = {}, scores = {}, subclass = null } = {}) {
    if (!monster) return null;
    const ab = monster.data?.abilities ?? monster.abilities ?? {};
    const acMin = subclass?.data?.wildShape?.acMin === '13+wis' ? 13 + (mods.wis ?? 0) : 0;
    const ac = Math.max(Number(monster.ac) || 10, acMin);
    const abilities = {
        str: { score: ab.str ?? 10, mod: modifier(ab.str ?? 10), beast: true },
        dex: { score: ab.dex ?? 10, mod: modifier(ab.dex ?? 10), beast: true },
        con: { score: ab.con ?? 10, mod: modifier(ab.con ?? 10), beast: true },
        int: { score: scores.int ?? 10, mod: mods.int ?? 0, beast: false },
        wis: { score: scores.wis ?? 10, mod: mods.wis ?? 0, beast: false },
        cha: { score: scores.cha ?? 10, mod: mods.cha ?? 0, beast: false },
    };
    return { ac, acFromCircle: acMin > (Number(monster.ac) || 10), abilities };
}

/** "Walk 40 ft. · Climb 30 ft." */
export function speedText(speed) {
    const order = ['walk', 'climb', 'swim', 'fly', 'burrow'];
    return order
        .filter((k) => Number(speed?.[k]) > 0)
        .map((k) => `${k === 'walk' ? '' : k[0].toUpperCase() + k.slice(1) + ' '}${speed[k]} ft.`)
        .join(' · ');
}

/** CR as text: ⅛, ¼, ½, 1… */
export const crText = (cr) => ({ 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' })[cr] ?? String(cr);
