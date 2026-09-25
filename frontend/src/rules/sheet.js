/**
 * Derived stats for the character sheet.
 * Pure functions: build (CharacterBuild) + reference data → numbers.
 *
 * No background/feat bonuses or chosen class skills yet —
 * only fixed race/subrace grants are counted.
 */
import { ABILITY_KEYS, modifier } from './abilities.js';
import { SKILLS } from './skills.js';

/** Proficiency bonus by level: +2 at 1–4, +3 at 5–8 … +6 at 17–20. */
export const proficiencyBonus = (level) => 2 + Math.floor((Math.max(1, level) - 1) / 4);

/** All race and subrace trait grants (flat). */
const traitGrants = (...sources) =>
    sources.flatMap((s) => s?.data?.traits ?? []).flatMap((t) => t.grants ?? []);

/**
 * Computes everything for the sheet.
 * ctx: {
 *   race, subrace, cls,
 *   armor   — worn armor (or null),
 *   shield  — shield in hand (shield object or true / false),
 *   hands   — weapons in hand: [{ hand: 'main' | 'off', weapon }]
 *   skills  — extra skill proficiencies (level choices, background): [id]
 *   expertise — expertise: [id]
 *   perks   — feat/fighting style effects: Set id ('tough', 'alert',
 *             'defense', 'archery', 'dueling', 'twf')
 * }
 */
export function computeSheet(
    build,
    {
        race, subrace, cls, armor = null, shield = false, hands = [],
        skills: extraSkills = [], expertise = [], perks = new Set(),
    } = {},
) {
    const level = build.level ?? 1;
    const prof = proficiencyBonus(level);
    const scores = build.totalAbilities ?? build.abilities ?? {};
    const mods = Object.fromEntries(ABILITY_KEYS.map((k) => [k, modifier(scores[k]) ?? 0]));

    const grants = traitGrants(race, subrace);
    const effects = grants.filter((g) => g.type === 'effect').map((g) => g.effect);

    // --- saving throws ---
    const saveProf = new Set(cls?.data?.savingThrows ?? []);
    const saves = ABILITY_KEYS.map((k) => ({
        key: k,
        proficient: saveProf.has(k),
        value: mods[k] + (saveProf.has(k) ? prof : 0),
    }));

    // --- skills (proficiency — only fixed race grants) ---
    const skillProf = new Set([
        ...grants.filter((g) => g.type === 'skill' && g.id).map((g) => g.id),
        ...extraSkills,
    ]);
    const expert = new Set(expertise);
    const skills = SKILLS.map((s) => {
        const proficient = skillProf.has(s.id) || expert.has(s.id);
        const mult = expert.has(s.id) ? 2 : proficient ? 1 : 0;
        return { ...s, proficient, expertise: expert.has(s.id), value: mods[s.ability] + prof * mult };
    });
    const passivePerception = 10 + (skills.find((s) => s.id === 'perception')?.value ?? mods.wis);

    // --- AC ---
    // no armor: 10 + Dex, or the class's "Unarmored Defense" (monk: Dex+Wis, barbarian: Dex+Con)
    const unarmored = cls?.data?.unarmoredDefense ?? [];
    let ac = unarmored.length ? 10 + unarmored.reduce((sum, k) => sum + (mods[k] ?? 0), 0) : 10 + mods.dex;
    if (armor && armor.category !== 'shield') {
        const d = armor.data ?? {};
        let dex = d.addDex ? mods.dex : 0;
        if (d.addDex && d.maxDex != null) dex = Math.min(dex, d.maxDex);
        ac = (armor.baseAC ?? 10) + dex + (Number(d.acBonus) || 0); // + armor's magic bonus
    }
    // shield: +2 (or its acBonus if the shield is magic); shield — shield object or true
    if (shield) ac += Number(shield?.data?.acBonus) || 2;
    if (perks.has('defense') && armor && armor.category !== 'shield') ac += 1; // "Defense" fighting style

    // --- speed (race base + bonus effects) ---
    const speed =
        (race?.data?.speed ?? 30) +
        effects
            .filter((e) => e.kind === 'bonus' && e.target === 'speed')
            .reduce((sum, e) => sum + (Number(e.value) || 0), 0);

    // --- hit points: lvl 1 — max die, then average (die/2 + 1) ---
    const hitDie = cls?.hitDie ?? 8;
    const hp = Math.max(
        1,
        hitDie + mods.con + (level - 1) * (Math.floor(hitDie / 2) + 1 + mods.con) +
            (perks.has('tough') ? 2 * level : 0), // "Tough" feat
    );

    // --- darkvision ---
    const darkvision =
        effects.find((e) => e.kind === 'sense' && e.sense === 'darkvision')?.range ?? 0;

    // --- attacks: weapons in hand; empty hands — unarmed strike ---
    const weaponProf = new Set(cls?.data?.weaponProficiencies ?? []);
    const attacks = handAttacks(hands, {
        mods, prof, weaponProf,
        bonusAddsMod: perks.has('twf'), // "Two-Weapon Fighting" fighting style
        archery: perks.has('archery'),
        dueling: perks.has('dueling'),
    });
    if (!attacks.length) {
        attacks.push({
            id: 'unarmed',
            name: 'Unarmed Strike',
            hand: 'main',
            action: 'action',
            ability: 'str',
            proficient: true,
            toHit: mods.str + prof,
            damage: `${Math.max(0, 1 + mods.str)}`,
            damageType: 'bludgeoning',
        });
    }

    return {
        level,
        prof,
        mods,
        saves,
        skills,
        passivePerception,
        ac,
        initiative: mods.dex + (perks.has('alert') ? prof : 0), // "Alert" feat
        speed,
        hp,
        hitDie,
        darkvision,
        attacks,
    };
}

const isLight = (w) => (w?.data?.properties ?? []).includes('light');

/**
 * Attacks from what is in hand (2024 rules, the "Light" property):
 *
 *   - Weapon in the right hand — a normal attack (the "Attack" action).
 *   - Weapon in the left hand:
 *       · if BOTH weapons are light — an extra attack as a Bonus Action,
 *         damage without the ability modifier (unless negative);
 *       · otherwise — just a second weapon for the "Attack" action (full modifier),
 *         no extra attack;
 *       · if the right hand is empty/holds a shield — the left weapon is the main one.
 *
 * opts.bonusAddsMod — hook for a feature/feat ("Two-Weapon Fighting" fighting style)
 * that adds the modifier to the extra attack's damage. opts.anyLight — for the
 * "Dual Wielder" feat (extra attack not only with light weapons).
 */
export function handAttacks(
    hands,
    { mods, prof, weaponProf, bonusAddsMod = false, anyLight = false, archery = false, dueling = false },
) {
    const main = hands.find((h) => h.hand === 'main')?.weapon ?? null;
    const off = hands.find((h) => h.hand === 'off')?.weapon ?? null;
    // "Dueling": +2 damage with a one-handed melee weapon if the other hand holds no weapon
    const oneWeapon = !!main !== !!off;
    const base = { mods, prof, weaponProf, archery, dueling: dueling && oneWeapon };
    const out = [];

    if (main) out.push(weaponAttack(main, { ...base, hand: 'main' }));

    if (off) {
        const canBonus = main && (anyLight || (isLight(main) && isLight(off)));
        if (canBonus) {
            out.push(weaponAttack(off, { ...base, hand: 'off', bonus: true, bonusAddsMod }));
        } else {
            const a = weaponAttack(off, { ...base, hand: 'off' });
            if (main) a.note = 'no extra attack: both weapons must be light';
            out.push(a);
        }
    }
    return out;
}

/**
 * Weapon attack.
 * bonus — extra attack as a Bonus Action: damage without the modifier
 * (unless negative), unless bonusAddsMod.
 */
export function weaponAttack(
    w,
    { mods, prof, weaponProf, hand = 'main', bonus = false, bonusAddsMod = false, archery = false, dueling = false },
) {
    const p = w.data?.properties ?? [];
    const ranged = p.includes('ranged');
    const finesse = p.includes('finesse');
    const ability = ranged ? 'dex' : finesse ? (mods.dex > mods.str ? 'dex' : 'str') : 'str';
    const proficient = weaponProf.has(w.category) || weaponProf.has(w.id);

    const abilMod = mods[ability];
    const noMod = bonus && !bonusAddsMod;
    const twoHanded = p.includes('twoHanded');

    // the weapon's own bonuses (magic / named): +to hit, +to damage, extra damage
    const d = w.data ?? {};
    const magicHit = Number(d.attackBonus) || 0;
    const magicDmg = Number(d.damageBonus) || 0;
    const extra = (d.extraDamage ?? []).filter((x) => x?.dice);

    const dmgMod =
        (noMod ? Math.min(0, abilMod) : abilMod) +
        (dueling && !ranged && !twoHanded ? 2 : 0) +
        magicDmg;
    const hitBonus = (archery && ranged ? 2 : 0) + magicHit; // "Archery" + weapon bonus

    return {
        id: w.id,
        name: w.name,
        hand,
        action: bonus ? 'bonus' : 'action',
        ability,
        proficient,
        toHit: abilMod + (proficient ? prof : 0) + hitBonus,
        damage: w.damage ? `${w.damage}${fmtMod(dmgMod)}` : '—',
        damageType: w.damageType,
        extra, // [{ dice, type }] — extra damage on hit
        magic: magicHit || magicDmg || extra.length ? { hit: magicHit, dmg: magicDmg } : null,
        note: noMod ? 'no modifier to damage' : null,
    };
}

const fmtMod = (m) => (m > 0 ? ` + ${m}` : m < 0 ? ` − ${-m}` : '');
