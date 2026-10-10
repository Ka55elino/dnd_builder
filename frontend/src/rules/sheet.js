/**
 * Derived stats for the character sheet.
 * Pure functions: build (CharacterBuild) + reference data → numbers.
 *
 * No background/feat bonuses or chosen class skills yet —
 * only fixed race/subrace grants are counted.
 */
import { ABILITY_KEYS, modifier } from './abilities.js';
import { SKILLS } from './skills.js';
import { applyModifiers } from './modifiers.js';
import { multiclassInfo } from './multiclass.js';

/** Hit Point Dice as text: [{ die: 10, count: 3 }, { die: 6, count: 2 }] → "3d10 + 2d6". */
export const hitDiceText = (hitDice = []) => hitDice.map((d) => `${d.count}d${d.die}`).join(' + ');

/** Proficiency bonus by level: +2 at 1–4, +3 at 5–8 … +6 at 17–20. */
export const proficiencyBonus = (level) => 2 + Math.floor((Math.max(1, level) - 1) / 4);

/** Race and subrace trait grants (flat), only from traits available at this level. */
const traitGrants = (level, ...sources) =>
    sources
        .flatMap((s) => s?.data?.traits ?? [])
        .filter((t) => (t.level ?? 1) <= level)
        .flatMap((t) => t.grants ?? []);

/**
 * Computes everything for the sheet.
 * ctx: {
 *   race, subrace, cls,
 *   classList — multiclassing: [{ cls, level }] in the order taken, [0] — the primary class
 *             (saving throws, full proficiencies); default — [{ cls, level: build.level }]
 *   levelClasses — the class id gained at each character level (hit points); default — all cls
 *   armor   — worn armor (or null),
 *   shield  — shield in hand (shield object or true / false),
 *   hands   — weapons in hand: [{ hand: 'main' | 'off', weapon }]
 *   emptyHands — hands that hold nothing (not a shield, not taken by a two-handed weapon):
 *             ['main' | 'off'] — each gets an Unarmed Strike row next to the weapon
 *   skills  — extra skill proficiencies (level choices, background): [id]
 *   expertise — expertise: [id]
 *   perks   — feat/fighting style effects: Set id ('tough', 'alert',
 *             'defense', 'archery', 'dueling', 'twf')
 *   modifiers — everything on the character now: conditions, named effects, spell effects
 *             (rules/modifiers.js, each with source). The base stage is here:
 *             { kind: 'acBase', base: 13, ability: 'dex', unarmored: true }  — Mage Armor: another
 *                 way to calculate AC (the best one is used); unarmored — only without body armor
 *             the rest (set → mul → add → min) runs in applyModifiers at the end
 * }
 */
export function computeSheet(
    build,
    {
        race, subrace, cls, classList = null, levelClasses = null, armor = null, shield = false, hands = [], emptyHands = [],
        skills: extraSkills = [], expertise = [], perks = new Set(), modifiers = [],
        spellAbility = null, // the class's spellcasting ability (Shillelagh: "$spell")
        scores: givenScores = null, // final scores with feature bonuses (models/Character.js withFeatureScores)
    } = {},
) {
    const level = build.level ?? 1;
    const prof = proficiencyBonus(level);
    const classes = (classList ?? [{ cls, level }]).filter((c) => c?.cls);
    const primary = classes[0]?.cls ?? cls ?? null;
    const scores = givenScores ?? build.totalAbilities ?? build.abilities ?? {};
    const mods = Object.fromEntries(ABILITY_KEYS.map((k) => [k, modifier(scores[k]) ?? 0]));

    const grants = traitGrants(level, race, subrace);
    const effects = grants.filter((g) => g.type === 'effect').map((g) => g.effect);

    // --- saving throws ---
    // saving throws — only from the primary (first) class
    const saveProf = new Set(primary?.data?.savingThrows ?? []);
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
    // no armor: 10 + Dex, or the class's "Unarmored Defense" (monk: Dex+Wis, barbarian: Dex+Con);
    // multiclassing — it doesn't stack: the first class that has it
    const unarmored = classes.find((c) => c.cls.data?.unarmoredDefense?.length)?.cls.data.unarmoredDefense ?? [];
    let ac = unarmored.length ? 10 + unarmored.reduce((sum, k) => sum + (mods[k] ?? 0), 0) : 10 + mods.dex;
    // clothing (category 'clothing') is worn in the armor slot but is not armor
    const wearing = !!armor && armor.category !== 'shield' && armor.category !== 'clothing';
    const clothes = armor?.category === 'clothing' ? armor : null;
    // spell effects: which ones apply now (Mage Armor — only without body armor)
    const acBases = modifiers.filter((e) => e.kind === 'acBase' && !(e.unarmored && wearing));
    // magic clothing: its own base AC (Robe of the Archmagi: 15 + Dex) and/or a bonus
    const later = [];
    if (clothes?.baseAC) acBases.push({ kind: 'acBase', base: clothes.baseAC, ability: clothes.data?.addDex ? 'dex' : null, source: clothes.name });
    if (Number(clothes?.data?.acBonus)) later.push({ kind: 'ac', op: 'add', value: Number(clothes.data.acBonus), source: clothes.name });
    const acSources = [];
    if (wearing) {
        const d = armor.data ?? {};
        let dex = d.addDex ? mods.dex : 0;
        if (d.addDex && d.maxDex != null) dex = Math.min(dex, d.maxDex);
        ac = (armor.baseAC ?? 10) + dex + (Number(d.acBonus) || 0); // + armor's magic bonus
    }
    // another base AC (Mage Armor: 13 + Dex) — used if it is better
    for (const e of acBases) {
        const alt = (Number(e.base) || 10) + (e.ability ? mods[e.ability] ?? 0 : 0);
        if (alt > ac) {
            ac = alt;
            acSources.push({ name: e.source ?? e.name, text: `base AC ${e.base}${e.ability ? ` + ${e.ability.toUpperCase()}` : ''}` });
        }
    }
    // shield: +2 (or its acBonus if the shield is magic); shield — shield object or true
    if (shield) ac += Number(shield?.data?.acBonus) || 2;
    if (perks.has('defense') && wearing) ac += 1; // "Defense" fighting style

    // --- speed (race base + bonus effects) ---
    const speed =
        (race?.data?.speed ?? 30) +
        effects
            .filter((e) => e.kind === 'bonus' && e.target === 'speed')
            .reduce((sum, e) => sum + (Number(e.value) || 0), 0);

    // --- hit points: lvl 1 — max die, then average (die/2 + 1) of the class gained at each level ---
    const hitDie = primary?.hitDie ?? 8;
    const dieOf = (id) => classes.find((c) => c.cls.id === id)?.cls.hitDie ?? hitDie;
    const dice = Array.from({ length: level }, (_, i) => (levelClasses?.[i] ? dieOf(levelClasses[i]) : hitDie));
    const hp = Math.max(
        1,
        dice.reduce((sum, d, i) => sum + (i === 0 ? d : Math.floor(d / 2) + 1) + mods.con, 0) +
            (perks.has('tough') ? 2 * level : 0), // "Tough" feat
    );
    // Hit Point Dice by size: [{ die: 10, count: 3 }, { die: 6, count: 2 }] (largest first)
    const hitDice = Object.entries(dice.reduce((m, d) => ((m[d] = (m[d] ?? 0) + 1), m), {}))
        .map(([die, count]) => ({ die: Number(die), count }))
        .sort((a, b) => b.die - a.die);

    // --- proficiencies: the primary class in full, other classes — their multiclass part ---
    const profFrom = (key, mcKey) =>
        new Set(classes.flatMap((c, i) => (i === 0 ? c.cls.data?.[key] : multiclassInfo(c.cls).proficiencies[mcKey]) ?? []));
    const armorTraining = [...profFrom('armorTraining', 'armor')];

    // --- darkvision ---
    const darkvision =
        effects.find((e) => e.kind === 'sense' && e.sense === 'darkvision')?.range ?? 0;

    // --- attacks: weapons in hand; empty hands — unarmed strike ---
    const weaponProf = profFrom('weaponProficiencies', 'weapons');
    // spells that change the weapons held (Shillelagh): { kind: 'weapon' } modifiers
    const weaponMods = modifiers.filter((m) => m.kind === 'weapon');
    // Monk "Martial Arts": the die for Unarmed Strikes and Monk weapons, Dex instead of Str
    const ma = classes.find((c) => martialArtsDie(c.cls, c.level));
    const martialDie = ma ? martialArtsDie(ma.cls, ma.level) : null;
    const attacks = handAttacks(hands, {
        mods, prof, weaponProf, weaponMods, spellAbility, level, martialDie,
        bonusAddsMod: perks.has('twf'), // "Two-Weapon Fighting" fighting style
        archery: perks.has('archery'),
        dueling: perks.has('dueling'),
    });
    if (!attacks.length) {
        attacks.push(unarmedAttack('main', { mods, prof, martialDie }));
    } else {
        // a hand that is really empty (not a shield, not the second hand of a two-handed weapon)
        for (const h of emptyHands) {
            if (!attacks.some((a) => a.hand === h)) attacks.push(unarmedAttack(h, { mods, prof, martialDie }));
        }
    }

    const sheet = {
        level,
        prof,
        mods,
        saves,
        skills,
        passivePerception,
        ac,
        acSources, // active effects that changed AC: [{ name, text }]
        initiative: mods.dex + (perks.has('alert') ? prof : 0), // "Alert" feat
        speed,
        hp,
        hitDie,   // the primary class's die
        hitDice,  // [{ die, count }] — all classes
        armorTraining,
        weaponProficiencies: [...weaponProf],
        darkvision,
        attacks,
    };
    // conditions and effects: set → mul → add → min (rules/modifiers.js);
    // effectSummary — what changed, flags (Advantage / Disadvantage…) and notes for Status
    sheet.effectSummary = applyModifiers(sheet, [...modifiers.filter((m) => m.kind !== 'acBase'), ...later]);
    return sheet;
}

const cap = (t) => String(t)[0].toUpperCase() + String(t).slice(1);
const isLight = (w) => (w?.data?.properties ?? []).includes('light');

/** Martial Arts die by class level: class data `martialArtsDie` or the built-in Monk table. */
const MARTIAL_ARTS = { monk: [[1, 'd6'], [5, 'd8'], [11, 'd10'], [17, 'd12']] };
export function martialArtsDie(cls, level = 1) {
    const table = cls?.data?.martialArtsDie ?? MARTIAL_ARTS[cls?.id];
    let die = null;
    for (const [l, d] of table ?? []) if (level >= l) die = d;
    return die;
}

// average of a die like '1d8' / 'd8' — to pick the better of two dice
const dieAvg = (s) => {
    const m = /^(\d*)d(\d+)$/.exec(String(s ?? '').trim());
    return m ? (Number(m[1] || 1) * (Number(m[2]) + 1)) / 2 : 0;
};

/** Monk weapon (2024): Simple melee, or Martial melee with the Light property. */
const isMonkWeapon = (w) => {
    const p = w?.data?.properties ?? [];
    if (p.includes('ranged')) return false;
    return w?.category === 'simple' || (w?.category === 'martial' && p.includes('light'));
};

/**
 * Unarmed Strike: 1 + Str (bludgeoning); with Martial Arts — the Martial Arts die
 * + Str or Dex (whichever is higher).
 */
export function unarmedAttack(hand, { mods, prof, martialDie = null }) {
    const ability = martialDie && mods.dex > mods.str ? 'dex' : 'str';
    const m = mods[ability];
    return {
        id: 'unarmed',
        name: 'Unarmed Strike',
        hand,
        action: 'action',
        ranged: false,
        ability,
        proficient: true,
        toHit: m + prof,
        damage: martialDie ? `1${martialDie}${fmtMod(m)}` : `${Math.max(0, 1 + mods.str)}`,
        damageType: 'bludgeoning',
        extra: [],
        magic: null,
        note: martialDie ? 'Martial Arts' : null,
    };
}

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
    { mods, prof, weaponProf, bonusAddsMod = false, anyLight = false, archery = false, dueling = false, weaponMods = [], spellAbility = null, level = 1, martialDie = null },
) {
    const main = hands.find((h) => h.hand === 'main')?.weapon ?? null;
    const off = hands.find((h) => h.hand === 'off')?.weapon ?? null;
    // "Dueling": +2 damage with a one-handed melee weapon if the other hand holds no weapon
    const oneWeapon = !!main !== !!off;
    const base = { mods, prof, weaponProf, archery, dueling: dueling && oneWeapon, weaponMods, spellAbility, level, martialDie };
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
    {
        mods, prof, weaponProf, hand = 'main', bonus = false, bonusAddsMod = false, archery = false, dueling = false,
        weaponMods = [], spellAbility = null, level = 1, martialDie = null,
    },
) {
    const p = w.data?.properties ?? [];
    const ranged = p.includes('ranged');
    const finesse = p.includes('finesse');
    // Martial Arts on a Monk weapon: Dex instead of Str, and its die if it is better
    const martial = !!martialDie && isMonkWeapon(w);
    let ability = ranged ? 'dex' : finesse || martial ? (mods.dex > mods.str ? 'dex' : 'str') : 'str';

    // a spell on this weapon (Shillelagh on a Club / Quarterstaff): every weapon held that it
    // fits gets it — two Clubs, both; a sword, never
    const base = w.data?.base ?? w.base ?? '';
    const spell = weaponMods.find((m) => (m.weapons ?? []).some((id) => id === w.id || id === base) && !(m.melee && ranged));
    let die = w.damage;
    if (martial && dieAvg(`1${martialDie}`) > dieAvg(die)) die = `1${martialDie}`;
    if (spell) {
        const alt = spell.ability === '$spell' ? spellAbility : spell.ability;
        if (alt && (mods[alt] ?? -99) > mods[ability]) ability = alt; // "can use … instead of Strength"
        if (typeof spell.die === 'string') die = spell.die;
        else if (spell.die) {
            const at = Object.keys(spell.die).map(Number).filter((l) => l <= level).sort((a, b) => b - a)[0];
            if (at != null) die = spell.die[at];
        }
    }
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
        ranged, // melee-only / ranged-only damage modifiers (rules/modifiers.js)
        ability,
        proficient,
        toHit: abilMod + (proficient ? prof : 0) + hitBonus,
        damage: die ? `${die}${fmtMod(dmgMod)}` : '—',
        damageType: w.damageType,
        extra, // [{ dice, type }] — extra damage on hit
        magic: magicHit || magicDmg || extra.length ? { hit: magicHit, dmg: magicDmg } : null,
        // the spell on it: its name, and what it changed
        spell: spell ? { name: spell.source ?? 'spell', ability, damageTypeAlt: spell.damageTypeAlt ?? null } : null,
        note: [noMod ? 'no modifier to damage' : '', spell ? `${spell.source ?? 'spell'}${spell.damageTypeAlt ? `: or ${cap(spell.damageTypeAlt)} damage` : ''}` : '']
            .filter(Boolean)
            .join(' · ') || null,
    };
}

const fmtMod = (m) => (m > 0 ? ` + ${m}` : m < 0 ? ` − ${-m}` : '');
