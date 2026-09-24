/**
 * Производные показатели для листа персонажа.
 * Чистые функции: build (CharacterBuild) + справочные данные → числа.
 *
 * Пока без бонусов предыстории/черт и выбранных навыков класса —
 * учитываются только фиксированные гранты расы/подрасы.
 */
import { ABILITY_KEYS, modifier } from './abilities.js';
import { SKILLS } from './skills.js';

/** Бонус мастерства по уровню: +2 на 1–4, +3 на 5–8 … +6 на 17–20. */
export const proficiencyBonus = (level) => 2 + Math.floor((Math.max(1, level) - 1) / 4);

/** Все гранты черт расы и подрасы (плоско). */
const traitGrants = (...sources) =>
    sources.flatMap((s) => s?.data?.traits ?? []).flatMap((t) => t.grants ?? []);

/**
 * Считает всё для листа.
 * ctx: {
 *   race, subrace, cls,
 *   armor   — надетый доспех (или null),
 *   shield  — щит в руке (объект щита или true / false),
 *   hands   — оружие в руках: [{ hand: 'main' | 'off', weapon }]
 *   skills  — доп. владение навыками (выборы уровней, предыстория): [id]
 *   expertise — компетентность: [id]
 *   perks   — эффекты черт/боевых стилей: Set id ('tough', 'alert',
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

    // --- спасброски ---
    const saveProf = new Set(cls?.data?.savingThrows ?? []);
    const saves = ABILITY_KEYS.map((k) => ({
        key: k,
        proficient: saveProf.has(k),
        value: mods[k] + (saveProf.has(k) ? prof : 0),
    }));

    // --- навыки (владение — только фиксированные гранты расы) ---
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

    // --- КД ---
    // без доспеха: 10 + Лов, либо «Защита без доспехов» класса (монах: Лов+Мдр, варвар: Лов+Тел)
    const unarmored = cls?.data?.unarmoredDefense ?? [];
    let ac = unarmored.length ? 10 + unarmored.reduce((sum, k) => sum + (mods[k] ?? 0), 0) : 10 + mods.dex;
    if (armor && armor.category !== 'shield') {
        const d = armor.data ?? {};
        let dex = d.addDex ? mods.dex : 0;
        if (d.addDex && d.maxDex != null) dex = Math.min(dex, d.maxDex);
        ac = (armor.baseAC ?? 10) + dex + (Number(d.acBonus) || 0); // + магический бонус доспеха
    }
    // щит: +2 (или его acBonus, если щит магический); shield — объект щита или true
    if (shield) ac += Number(shield?.data?.acBonus) || 2;
    if (perks.has('defense') && armor && armor.category !== 'shield') ac += 1; // боевой стиль «Защита»

    // --- скорость (база расы + бонусы-эффекты) ---
    const speed =
        (race?.data?.speed ?? 30) +
        effects
            .filter((e) => e.kind === 'bonus' && e.target === 'speed')
            .reduce((sum, e) => sum + (Number(e.value) || 0), 0);

    // --- хиты: 1 ур. — максимум кости, дальше — среднее (кость/2 + 1) ---
    const hitDie = cls?.hitDie ?? 8;
    const hp = Math.max(
        1,
        hitDie + mods.con + (level - 1) * (Math.floor(hitDie / 2) + 1 + mods.con) +
            (perks.has('tough') ? 2 * level : 0), // черта «Крепкий»
    );

    // --- тёмное зрение ---
    const darkvision =
        effects.find((e) => e.kind === 'sense' && e.sense === 'darkvision')?.range ?? 0;

    // --- атаки: оружие в руках; руки пусты — безоружный удар ---
    const weaponProf = new Set(cls?.data?.weaponProficiencies ?? []);
    const attacks = handAttacks(hands, {
        mods, prof, weaponProf,
        bonusAddsMod: perks.has('twf'), // боевой стиль «Бой двумя оружиями»
        archery: perks.has('archery'),
        dueling: perks.has('dueling'),
    });
    if (!attacks.length) {
        attacks.push({
            id: 'unarmed',
            name: 'Безоружный удар',
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
        initiative: mods.dex + (perks.has('alert') ? prof : 0), // черта «Бдительный»
        speed,
        hp,
        hitDie,
        darkvision,
        attacks,
    };
}

const isLight = (w) => (w?.data?.properties ?? []).includes('light');

/**
 * Атаки из того, что в руках (правила 2024, свойство «Лёгкое»):
 *
 *   - Оружие в правой руке — обычная атака (действие «Атака»).
 *   - Оружие в левой руке:
 *       · если ОБА оружия лёгкие — дополнительная атака бонусным действием,
 *         урон без модификатора характеристики (кроме отрицательного);
 *       · иначе — просто второе оружие для действия «Атака» (полный модификатор),
 *         доп. атаки нет;
 *       · если правая рука пуста/со щитом — левое оружие и есть основное.
 *
 * opts.bonusAddsMod — задел под умение/черту (боевой стиль «Бой двумя оружиями»),
 * которые добавляют модификатор к урону доп. атаки. opts.anyLight — под черту
 * «Боец с двумя оружиями» (доп. атака не только лёгким оружием).
 */
export function handAttacks(
    hands,
    { mods, prof, weaponProf, bonusAddsMod = false, anyLight = false, archery = false, dueling = false },
) {
    const main = hands.find((h) => h.hand === 'main')?.weapon ?? null;
    const off = hands.find((h) => h.hand === 'off')?.weapon ?? null;
    // «Дуэлянт»: +2 к урону оружием ближнего боя в одной руке, если во второй нет оружия
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
            if (main) a.note = 'без доп. атаки: оба оружия должны быть лёгкими';
            out.push(a);
        }
    }
    return out;
}

/**
 * Атака оружием.
 * bonus — доп. атака бонусным действием: урон без модификатора
 * (кроме отрицательного), если не bonusAddsMod.
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

    // бонусы самого оружия (магическое / именное): +к попаданию, +к урону, доп. урон
    const d = w.data ?? {};
    const magicHit = Number(d.attackBonus) || 0;
    const magicDmg = Number(d.damageBonus) || 0;
    const extra = (d.extraDamage ?? []).filter((x) => x?.dice);

    const dmgMod =
        (noMod ? Math.min(0, abilMod) : abilMod) +
        (dueling && !ranged && !twoHanded ? 2 : 0) +
        magicDmg;
    const hitBonus = (archery && ranged ? 2 : 0) + magicHit; // «Стрельба» + бонус оружия

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
        extra, // [{ dice, type }] — доп. урон при попадании
        magic: magicHit || magicDmg || extra.length ? { hit: magicHit, dmg: magicDmg } : null,
        note: noMod ? 'без модификатора к урону' : null,
    };
}

const fmtMod = (m) => (m > 0 ? ` + ${m}` : m < 0 ? ` − ${-m}` : '');
