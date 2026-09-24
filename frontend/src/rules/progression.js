/**
 * Прогрессия по уровням: что даёт уровень и что на нём нужно выбрать.
 *
 *   levelPlan(build, level, refs) → { level, gains, choices, hp, ... }
 *     gains   — информация: новые умения класса/подкласса/расы/происхождения
 *     choices — что игрок должен выбрать на этом уровне
 *
 *   summarizeChoices(build, refs) → что уже выбрано на всех уровнях
 *     (навыки, компетентность, черты, заклинания…) — для листа персонажа.
 *
 * Выбор хранится в build.choices[key] = { kind, ids: [...], asi?: {...} }.
 * Ключ начинается с уровня: `L<уровень>:<источник>:<что>` — так при
 * повышении уровня видно, что относится к какому уровню.
 *
 * Виды выбора (kind):
 *   skills | skill       — навыки (класс на 1 уровне, раса, черта «Умелый»)
 *   expertise            — компетентность (удвоенный бонус мастерства)
 *   feat                 — черта (раса, повышение характеристик)
 *   asi                  — +к характеристикам (у черты с полем asi)
 *   fightingStyle        — боевой стиль
 *   cantrips | spells    — заговоры / подготовленные заклинания
 *   metamagic | invocations — метамагия чародея / воззвания колдуна
 *   subclass             — подкласс
 *   option               — прочее (Божественный / Первобытный орден)
 *   pool                 — «выбери N» из пула подкласса (приёмы Мастера боя,
 *                          магические выстрелы) — поле subclass.optionPools
 */
import { SKILLS } from './skills.js';
import { ABILITY_KEYS, ABILITIES, modifier } from './abilities.js';
import { byLevelPairs } from './formula.js';
import { spellSlots } from './spellcasting.js';
import { proficiencyBonus } from './sheet.js';
import { SCHOOLS } from './labels.js';

const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));
const skillOption = (id) => ({ id, name: SKILL_BY_ID[id]?.name ?? id });
const lvlOf = (x) => x?.level ?? 1;

/** Короткая ссылка на объект справочника → вариант выбора. */
// ref — исходная запись (для карточки с описанием, уроном, типом действия)
const asOption = (x, meta) => ({ id: x.id, name: x.name, desc: x.desc ?? x.data?.desc ?? '', meta, ref: x });
const spellOption = (sp) =>
    asOption(sp, [sp.level === 0 ? 'заговор' : `${sp.level} круг`, SCHOOLS[sp.school]].filter(Boolean).join(' · '));

// ---------------------------------------------------------------------------
// справочные выборки

const featsBy = (refs, category, level = 20) =>
    (refs.feats ?? []).filter((f) => f.category === category && lvlOf(f) <= level);

/** Заклинания списка класса (или другого списка), круг ≤ maxLevel. */
function spellList(refs, list, { minLevel = 0, maxLevel = 9 } = {}) {
    return (refs.spells ?? []).filter(
        (sp) =>
            sp.kind === 'spell' &&
            sp.level >= minLevel &&
            sp.level <= maxLevel &&
            (sp.data?.classes ?? []).includes(list),
    );
}

const findCls = (build, refs) => (refs.classes ?? []).find((c) => c.id === build.classId) ?? null;
const findRace = (build, refs) => (refs.races ?? []).find((r) => r.id === build.raceId) ?? null;
const findBg = (build, refs) => (refs.backgrounds ?? []).find((b) => b.id === build.backgroundId) ?? null;
const findFeat = (refs, id) => (refs.feats ?? []).find((f) => f.id === id) ?? null;

// ---------------------------------------------------------------------------
// что уже выбрано (по всем уровням ≤ upTo)

export function summarizeChoices(build, refs, upTo = build.level ?? 1) {
    const out = {
        skills: new Set(),
        expertise: new Set(),
        feats: [],          // id черт (включая черту предыстории)
        fightingStyles: [],
        metamagic: [],
        invocations: [],
        cantrips: [],
        spells: [],
        options: [],
        pool: [],           // выбранное из пулов подкласса (приёмы, выстрелы)
    };

    const bg = findBg(build, refs);
    for (const s of bg?.data?.skills ?? []) out.skills.add(s);
    if (bg?.feat) out.feats.push(bg.feat);

    // по уровням; внутри уровня «забыть» раньше «выучить» (замена воззвания)
    const lvlKey = (k) => Number(/^L(\d+):/.exec(k)?.[1] ?? 0);
    const entries = Object.entries(build.choices ?? {}).sort(
        ([a, ca], [b, cb]) =>
            lvlKey(a) - lvlKey(b) || (cb?.kind === 'invocationForget') - (ca?.kind === 'invocationForget'),
    );
    for (const [key, c] of entries) {
        const m = /^L(\d+):/.exec(key);
        if (m && Number(m[1]) > upTo) continue;
        // новое воззвание по замене считается, только если старое забыто
        if (key.endsWith(':invocationSwap') && !build.choices[key.replace(/Swap$/, 'Forget')]?.ids?.length) continue;
        const ids = c?.ids ?? [];
        switch (c?.kind) {
            case 'skills':
            case 'skill':
                ids.forEach((id) => out.skills.add(id));
                break;
            case 'expertise':
                ids.forEach((id) => out.expertise.add(id));
                break;
            case 'feat':
                out.feats.push(...ids);
                break;
            case 'fightingStyle':
                out.fightingStyles.push(...ids);
                break;
            case 'metamagic':
                out.metamagic.push(...ids);
                break;
            case 'invocations':
                out.invocations.push(...ids);
                break;
            case 'invocationForget':
                out.invocations = out.invocations.filter((id) => !ids.includes(id));
                break;
            case 'cantrips':
                out.cantrips.push(...ids);
                break;
            case 'spells':
                out.spells.push(...ids);
                break;
            case 'option':
                out.options.push(...ids);
                break;
            case 'pool':
                out.pool.push(...ids);
                break;
        }
    }

    // фиксированные навыки расы
    const race = findRace(build, refs);
    const sub = race?.subraces?.find((s) => s.id === build.subraceId);
    for (const t of [...(race?.data?.traits ?? []), ...(sub?.data?.traits ?? [])]) {
        if (lvlOf(t) > upTo) continue;
        for (const g of t.grants ?? []) if (g.type === 'skill' && g.id) out.skills.add(g.id);
    }
    return out;
}

// ---------------------------------------------------------------------------
// план уровня

/**
 * @returns {{
 *   level, prof, profChanged, hp: { gain, formula },
 *   slots: [{ level, max, pact? }], slotsChanged,
 *   gains: [{ title, items: [{ name, desc, tag? }] }],
 *   choices: [{ key, kind, title, desc?, pick, options, value, repeatable? }]
 * }}
 */
export function levelPlan(build, level, refs) {
    const cls = findCls(build, refs);
    const race = findRace(build, refs);
    const sub = race?.subraces?.find((s) => s.id === build.subraceId) ?? null;
    const subclass = cls?.subclasses?.find((s) => s.id === build.subclassId) ?? null;
    const bg = findBg(build, refs);

    const gains = [];
    const choices = [];
    const done = summarizeChoices(build, refs, level - 1);

    const value = (key) => build.choices?.[key] ?? null;
    const add = (c) => choices.push({ ...c, value: value(c.key) });
    const addGain = (title, items) => items.length && gains.push({ title, items });

    // --- хиты и мастерство ---
    const con = modifier(build.totalAbilities?.con ?? build.abilities?.con) ?? 0;
    const die = cls?.hitDie ?? 8;
    const hp =
        level === 1
            ? { gain: Math.max(1, die + con), formula: `d${die} (максимум) ${fmt(con)} Тел` }
            : { gain: Math.max(1, Math.floor(die / 2) + 1 + con), formula: `${Math.floor(die / 2) + 1} (среднее d${die}) ${fmt(con)} Тел` };
    const prof = proficiencyBonus(level);
    const profChanged = level === 1 || prof !== proficiencyBonus(level - 1);

    // --- ячейки ---
    // заклинательство класса или подкласса (Мистический рыцарь / ловкач — с 3 уровня)
    const sc = spellcastingOf(cls, subclass);
    const scOwner = cls?.data?.spellcasting ? cls : subclass;
    const progression = sc?.progression ?? cls?.caster ?? 'none';
    const scOn = (lvl) => !!sc && lvl >= (sc.startLevel ?? 1);
    const slots = scOn(level) ? spellSlots(progression, level) : [];
    const prevSlots = level > 1 && scOn(level - 1) ? spellSlots(progression, level - 1) : [];
    const slotsChanged = JSON.stringify(slots) !== JSON.stringify(prevSlots);

    // ================= класс =================
    const clsFeatures = (cls?.data?.features ?? []).filter((f) => lvlOf(f) === level);
    addGain(
        cls ? `${cls.name} · ${level} уровень` : 'Класс',
        clsFeatures.map((f) => ({ name: f.name, desc: f.desc })),
    );

    // навыки класса — на 1 уровне
    if (level === 1 && cls?.data?.skills?.length) {
        add({
            key: 'L1:class:skills',
            kind: 'skills',
            title: `Навыки класса (${cls.name})`,
            desc: `Выберите ${cls.data.skillCount ?? 2} из списка класса.`,
            pick: cls.data.skillCount ?? 2,
            options: cls.data.skills.filter((s) => !done.skills.has(s)).map(skillOption),
        });
    }

    for (const f of clsFeatures) featureChoices(f, 'class', level, done, refs, add);

    // подкласс
    if (cls && level === (cls.subclassLevel ?? 3) && cls.subclasses?.length) {
        choices.push({
            key: `L${level}:class:subclass`,
            kind: 'subclass',
            title: `Подкласс (${cls.name})`,
            pick: 1,
            options: cls.subclasses.map((s) => asOption(s)),
            value: build.subclassId ? { kind: 'subclass', ids: [build.subclassId] } : null,
        });
    }

    // умения подкласса
    if (subclass) {
        const subFeatures = (subclass.data?.features ?? []).filter((f) => lvlOf(f) === level);
        addGain(subclass.name, subFeatures.map((f) => ({ name: f.name, desc: f.desc })));
        for (const f of subFeatures) featureChoices(f, 'subclass', level, done, refs, add);

        // пулы «выбери N»: приёмы Мастера боя, магические выстрелы…
        for (const pool of subclass.data?.optionPools ?? []) {
            const n = byLevelPairs(pool.known, level) - (level > 1 ? byLevelPairs(pool.known, level - 1) : 0);
            if (n <= 0) continue;
            add({
                key: `L${level}:subclass:pool:${pool.id}`,
                kind: 'pool',
                title: pool.name,
                pick: n,
                options: (refs.spells ?? [])
                    .filter((sp) => sp.data?.pool === pool.id && sp.data?.subclass === subclass.id)
                    .filter((sp) => sp.level <= level && !done.pool.includes(sp.id))
                    .map((sp) => asOption(sp)),
            });
        }
    }

    // способности класса (из таблицы spells) — то, что открывается на уровне
    const powers = (refs.spells ?? []).filter((sp) => {
        if (sp.kind === 'spell' || sp.level !== level) return false;
        const d = sp.data ?? {};
        if (d.pool) return false; // варианты пула выбираются отдельно
        if (d.subclass) return !!subclass && d.subclass === subclass.id;
        return sp.kind === 'class' && (d.classes ?? []).includes(cls?.id);
    });
    // то, что уже описано умением класса/подкласса с тем же названием, не дублируем
    const shown = new Set(gains.flatMap((g) => g.items.map((it) => norm(it.name))));
    addGain(
        'Способности',
        powers
            .filter((sp) => !shown.has(norm(sp.name)))
            .map((sp) => ({ name: sp.name, desc: sp.desc, ref: sp })),
    );

    // повышение характеристик / черта
    if ((cls?.data?.asiLevels ?? []).includes(level)) {
        const key = `L${level}:class:feat`;
        add({
            key,
            kind: 'feat',
            title: 'Повышение характеристик или черта',
            desc: 'Черта «Повышение характеристик» даёт +2 к одной или +1 к двум характеристикам.',
            pick: 1,
            options: featsBy(refs, 'general', level)
                .filter((f) => f.data?.repeatable || !done.feats.includes(f.id))
                .map((f) => asOption(f, f.data?.asi ? 'с повышением характеристик' : '')),
        });
        featFollowUps(value(key)?.ids?.[0], key, level, done, refs, add);
    }

    // метамагия / воззвания — сколько новых на этом уровне
    const newCount = (table) => byLevelPairs(table ?? [], level) - (level > 1 ? byLevelPairs(table ?? [], level - 1) : 0);
    const mmNew = newCount(cls?.data?.metamagicKnown);
    if (mmNew > 0) {
        add({
            key: `L${level}:class:metamagic`,
            kind: 'metamagic',
            title: 'Метамагия',
            pick: mmNew,
            options: featsBy(refs, 'metamagic').filter((f) => !done.metamagic.includes(f.id)).map((f) => asOption(f)),
        });
    }
    const invNew = newCount(cls?.data?.invocationsKnown);
    if (invNew > 0) {
        add({
            key: `L${level}:class:invocations`,
            kind: 'invocations',
            title: 'Таинственные воззвания',
            pick: invNew,
            options: featsBy(refs, 'invocation', level).filter((f) => !done.invocations.includes(f.id)).map((f) => asOption(f)),
        });
    }
    // PHB 2024: при каждом повышении уровня колдун может заменить одно известное воззвание
    if (level > 1 && cls?.data?.invocationsKnown?.length && done.invocations.length) {
        const forgetKey = `L${level}:class:invocationForget`;
        const forgotten = value(forgetKey)?.ids ?? [];
        add({
            key: forgetKey,
            kind: 'invocationForget',
            title: 'Заменить воззвание — забыть',
            desc: 'По желанию: выберите известное воззвание, которое хотите заменить другим.',
            pick: 1,
            optional: true,
            options: featsBy(refs, 'invocation').filter((f) => done.invocations.includes(f.id)).map((f) => asOption(f)),
        });
        if (forgotten.length) {
            add({
                key: `L${level}:class:invocationSwap`,
                kind: 'invocations',
                title: 'Заменить воззвание — новое',
                pick: 1,
                options: featsBy(refs, 'invocation', level)
                    .filter((f) => !done.invocations.includes(f.id))
                    .map((f) => asOption(f)),
            });
        }
    }

    // заклинания класса (или подкласса)
    if (scOn(level)) {
        const list = sc.list ?? cls.id;
        const who = scOwner?.name ?? cls.name;
        const maxCircle = Math.max(0, ...slots.map((s) => s.level));
        const cNew = byLevelPairs(sc.cantripsKnown, level) - (level > 1 ? byLevelPairs(sc.cantripsKnown, level - 1) : 0);
        const pNew = byLevelPairs(sc.preparedKnown, level) - (level > 1 ? byLevelPairs(sc.preparedKnown, level - 1) : 0);
        if (cNew > 0) {
            add({
                key: `L${level}:class:cantrips`,
                kind: 'cantrips',
                title: `Заговоры (${who})`,
                pick: cNew,
                options: spellList(refs, list, { maxLevel: 0 }).filter((sp) => !done.cantrips.includes(sp.id)).map(spellOption),
            });
        }
        if (pNew > 0 && maxCircle > 0) {
            add({
                key: `L${level}:class:spells`,
                kind: 'spells',
                title: `Заклинания (${who})`,
                desc: `Круг — до ${maxCircle}.`,
                pick: pNew,
                options: spellList(refs, list, { minLevel: 1, maxLevel: maxCircle })
                    .filter((sp) => !done.spells.includes(sp.id))
                    .map(spellOption),
            });
        }
    }

    // ================= раса =================
    const raceTraits = [
        ...(race?.data?.traits ?? []).map((t) => ({ t, src: 'race', title: race.name })),
        ...(sub?.data?.traits ?? []).map((t) => ({ t, src: 'subrace', title: sub.name })),
    ].filter(({ t }) => lvlOf(t) === level);
    const byTitle = {};
    for (const { t, title } of raceTraits) (byTitle[title] ??= []).push({ name: t.name, desc: t.desc });
    for (const [title, items] of Object.entries(byTitle)) addGain(title, items);

    for (const { t, src } of raceTraits) {
        for (const g of t.grants ?? []) {
            if (g.choose == null) continue;
            const key = `L${level}:${src}:${g.type}:${t.name}`;
            if (g.type === 'skill') {
                add({
                    key, kind: 'skill', title: `${t.name}: навык`, pick: g.choose,
                    options: (g.options ?? SKILLS.map((s) => s.id)).filter((s) => !done.skills.has(s)).map(skillOption),
                });
            } else if (g.type === 'feat') {
                add({
                    key, kind: 'feat', title: `${t.name}: черта происхождения`, pick: g.choose,
                    options: featsBy(refs, 'origin').filter((f) => !done.feats.includes(f.id)).map((f) => asOption(f)),
                });
                featFollowUps(value(key)?.ids?.[0], key, level, done, refs, add);
            } else if (g.type === 'spell') {
                add({
                    key, kind: g.level === 0 ? 'cantrips' : 'spells',
                    title: `${t.name}: ${g.level === 0 ? 'заговор' : 'заклинание'}`,
                    pick: g.choose,
                    options: spellList(refs, g.from, { minLevel: g.level ?? 0, maxLevel: g.level ?? 0 })
                        .filter((sp) => !done.cantrips.includes(sp.id))
                        .map(spellOption),
                });
            }
        }
    }

    // ================= происхождение (1 уровень) =================
    if (level === 1 && bg) {
        const feat = findFeat(refs, bg.feat);
        addGain(`Происхождение: ${bg.name}`, [
            { name: 'Навыки', desc: (bg.data?.skills ?? []).map((s) => SKILL_BY_ID[s]?.name ?? s).join(', ') },
            ...(bg.data?.tool ? [{ name: 'Инструменты', desc: bg.data.tool }] : []),
            ...(feat ? [{ name: `Черта: ${feat.name}`, desc: feat.desc }] : []),
        ]);
        featFollowUps(bg.feat, 'L1:background:feat', level, done, refs, add);
    }

    return { level, prof, profChanged, hp, slots, slotsChanged, gains, choices };
}

/** Заклинательство класса, иначе подкласса. */
export const spellcastingOf = (cls, subclass) =>
    cls?.data?.spellcasting ?? subclass?.data?.spellcasting ?? null;

/** Выборы умения: поле choice (один) или choices (несколько). */
function featureChoices(f, src, level, done, refs, add) {
    const list = f.choices ?? (f.choice ? [f.choice] : []);
    list.forEach((ch, i) => classChoice(f, ch, list.length > 1 ? i : null, src, level, done, refs, add));
}

/** Один выбор умения класса/подкласса. */
function classChoice(f, ch, idx, src, level, done, refs, add) {
    const key = `L${level}:${src}:${ch.type}:${f.name}` + (idx != null ? `:${idx}` : '');
    if (ch.type === 'fightingStyle') {
        add({
            key, kind: 'fightingStyle', title: f.name, desc: f.desc, pick: ch.pick ?? 1,
            options: featsBy(refs, 'fightingStyle').filter((x) => !done.fightingStyles.includes(x.id)).map((x) => asOption(x)),
        });
    } else if (ch.type === 'expertise') {
        add({
            key, kind: 'expertise', title: f.name, desc: 'Выберите навыки, которыми вы владеете: бонус мастерства удваивается.',
            pick: ch.pick ?? 1,
            // владение на этом же уровне (навыки класса 1 уровня) тоже считается
            options: SKILLS.map((s) => s.id).filter((s) => !done.expertise.has(s)).map(skillOption),
            needsProficiency: true,
        });
    } else if (ch.type === 'skill') {
        add({
            key, kind: 'skill', title: f.name, pick: ch.pick ?? 1,
            options: (ch.options ?? SKILLS.map((s) => s.id)).filter((s) => !done.skills.has(s)).map(skillOption),
        });
    } else if (ch.type === 'cantrip' || ch.type === 'spell') {
        // конкретный список заклинаний по id (напр. «Фокусы» или «Искусство друидов»)
        const byId = new Map((refs.spells ?? []).map((sp) => [sp.id, sp]));
        add({
            key, kind: ch.type === 'cantrip' ? 'cantrips' : 'spells', title: `${f.name}: ${ch.type === 'cantrip' ? 'заговор' : 'заклинание'}`,
            pick: ch.pick ?? 1,
            options: (ch.options ?? []).map((id) => byId.get(id)).filter(Boolean)
                .filter((sp) => !done.cantrips.includes(sp.id) && !done.spells.includes(sp.id))
                .map(spellOption),
        });
    } else if (ch.options?.length) {
        add({
            key, kind: 'option', title: f.name, desc: f.desc, pick: ch.pick ?? 1,
            options: ch.options.map((o) => (typeof o === 'string' ? { id: o, name: o } : asOption(o))),
        });
    }
}

/** Выборы, которые требует сама черта: +характеристики, навыки, заклинания. */
function featFollowUps(featId, key, level, done, refs, add) {
    const feat = featId ? findFeat(refs, featId) : null;
    if (!feat) return;
    const d = feat.data ?? {};

    // +к характеристикам
    if (d.asi) {
        const opts = Array.isArray(d.asi) ? d.asi : d.asi.options ?? ABILITY_KEYS;
        const amount = Array.isArray(d.asi) ? 1 : d.asi.amount ?? 1;
        const pick = Array.isArray(d.asi) ? 1 : d.asi.pick ?? 1;
        add({
            key: `${key}:asi`,
            kind: 'asi',
            title: `${feat.name}: +${amount} к характеристике`,
            desc: pick > 1 ? `Распределите +${pick * amount}: одной +${pick * amount} или нескольким по +${amount}.` : '',
            pick,
            amount,
            repeatable: pick > 1, // можно выбрать одну характеристику дважды
            options: opts.map((k) => ({ id: k, name: ABILITIES[k]?.name ?? k })),
        });
    }
    // навыки («Умелый»)
    if (d.skillChoice) {
        add({
            key: `${key}:skills`,
            kind: 'skills',
            title: `${feat.name}: навыки`,
            pick: d.skillChoice.choose ?? 1,
            options: SKILLS.map((s) => s.id).filter((s) => !done.skills.has(s)).map(skillOption),
        });
    }
    // «Посвящённый в магию» — 2 заговора и 1 заклинание 1 круга из списка
    const mi = /^magicInitiate(\w+)$/.exec(feat.id);
    if (mi) {
        const list = mi[1].toLowerCase();
        add({
            key: `${key}:cantrips`, kind: 'cantrips', title: `${feat.name}: заговоры`, pick: 2,
            options: spellList(refs, list, { maxLevel: 0 }).filter((sp) => !done.cantrips.includes(sp.id)).map(spellOption),
        });
        add({
            key: `${key}:spells`, kind: 'spells', title: `${feat.name}: заклинание 1 круга`, pick: 1,
            options: spellList(refs, list, { minLevel: 1, maxLevel: 1 }).filter((sp) => !done.spells.includes(sp.id)).map(spellOption),
        });
    }
}

// ---------------------------------------------------------------------------
// оценка плана: что видно, что выбрано корректно, всё ли сделано

// один и тот же навык/заклинание нельзя выбрать в двух выборах одного уровня
const FAMILY = { skills: 'skill', skill: 'skill', cantrips: 'cantrip', spells: 'spell', pool: 'pool', invocations: 'invocation' };

/**
 * Дополняет выборы плана:
 *   visible — варианты, которые сейчас можно выбрать
 *   valid   — выбранное, которое допустимо (остальное не считается)
 *   count / need / done
 * и возвращает { choices, complete }.
 */
export function evaluatePlan(plan, build, refs) {
    const proficient = summarizeChoices(build, refs, plan.level).skills;
    const takenElsewhere = (c) => {
        const fam = FAMILY[c.kind];
        if (!fam) return new Set();
        return new Set(
            plan.choices.filter((o) => o.key !== c.key && FAMILY[o.kind] === fam).flatMap((o) => o.value?.ids ?? []),
        );
    };
    const choices = plan.choices.map((c) => {
        if (c.kind === 'asi') {
            const count = Object.values(c.value?.asi ?? {}).reduce((s, v) => s + v, 0) / (c.amount ?? 1);
            return { ...c, visible: c.options, valid: [], count, need: c.pick, done: count >= c.pick };
        }
        const taken = takenElsewhere(c);
        let visible = c.options.filter((o) => !taken.has(o.id));
        if (c.needsProficiency) visible = visible.filter((o) => proficient.has(o.id));
        const ok = new Set(visible.map((o) => o.id));
        const valid = (c.value?.ids ?? []).filter((id) => ok.has(id));
        const need = c.optional ? 0 : Math.min(c.pick, visible.length);
        return { ...c, visible, valid, count: valid.length, need, done: valid.length >= need };
    });
    return { choices, complete: choices.every((c) => c.done) };
}

/** Все ли выборы плана сделаны. */
export function planComplete(plan) {
    return plan.choices.every((c) => c.optional || choiceCount(c) >= Math.min(c.pick, c.options.length || c.pick));
}

/** Сколько выбрано в выборе. */
export function choiceCount(c) {
    if (c.kind === 'asi') return Object.values(c.value?.asi ?? {}).reduce((s, v) => s + v, 0) / (c.amount ?? 1);
    return c.value?.ids?.length ?? 0;
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s*\(.*?\)\s*/g, '').trim();
const fmt = (n) => (n >= 0 ? `+ ${n}` : `− ${-n}`);
const actionTag = (a) => ({ action: 'действие', bonus: 'бонусное', reaction: 'реакция', free: 'свободное' })[a] ?? '';
