/**
 * Пассивные эффекты персонажа — то, что действует всегда и не тратит действие:
 *
 *   effects   — сводка структурированных эффектов, по группам
 *               (сопротивления, чувства, преимущества, помехи, бонусы…)
 *               источники: гранты черт расы { type: 'effect' }, гранты умений
 *               класса { type: 'effect' | 'passive' }, поле effects черт/воззваний
 *   abilities — пассивные умения списком (Уклонение, Мастерство оружия,
 *               воззвания, боевые стили, черты…) с описанием для подсказки
 *
 * Умение класса считается пассивным, если у него нет карточки действия
 * (записи в таблице способностей с тем же именем), это не контейнер выбора
 * и не «служебное» умение (Заклинательство, Боевой стиль…).
 * Явно переопределить можно полем умения passive: true | false.
 */
import { DAMAGE_TYPES } from './labels.js';
import { ABILITIES } from './abilities.js';
import { SKILLS } from './skills.js';

// группы сводки — в этом порядке
export const EFFECT_GROUPS = [
    { id: 'resistance', title: 'Сопротивление' },
    { id: 'immunity', title: 'Иммунитет' },
    { id: 'sense', title: 'Чувства' },
    { id: 'advantage', title: 'Преимущество' },
    { id: 'disadvantage', title: 'Помеха' },
    { id: 'bonus', title: 'Бонусы' },
    { id: 'note', title: 'Прочее' },
];

// служебные умения: сами по себе ничего не дают (их суть — выбор, ячейки, ресурсы)
const SERVICE =
    /^(Заклинательство|Магия договора|Использование заклинаний|Мистические инвокации|Метамагия|Мистический арканум|Боевой стиль|Дополнительный боевой стиль|Повышение характеристик|Дар договора|Источник магии|Очки сосредоточения)/i;

const SENSES = {
    darkvision: 'Тёмное зрение',
    blindsight: 'Слепое зрение',
    tremorsense: 'Чувство вибрации',
    truesight: 'Истинное зрение',
};

const CONDITIONS = {
    charmed: 'очарования',
    frightened: 'испуга',
    paralyzed: 'паралича',
    poisoned: 'отравления',
    poison: 'яда',
    stunned: 'ошеломления',
    magic: 'магии',
};

const TARGETS = {
    savingThrow: 'спасброски',
    skillCheck: 'проверки',
    attackRoll: 'броски атаки',
    concentration: 'спасброски концентрации',
    initiative: 'инициатива',
};

const ABIL_SHORT = Object.fromEntries(
    Object.entries(ABILITIES ?? {}).map(([k, a]) => [k, a?.short ?? a?.name ?? k]),
);
const skillName = (id) => SKILLS.find((s) => s.id === id)?.name ?? id;
// «сопротивление: огонь» — именительный падеж (в DAMAGE_TYPES — «уроном огнём»)
const DMG_NOUN = {
    acid: 'кислота', cold: 'холод', fire: 'огонь', force: 'силовое поле', lightning: 'электричество',
    necrotic: 'некротическая энергия', poison: 'яд', psychic: 'психическая энергия', radiant: 'излучение',
    thunder: 'звук', bludgeoning: 'дробящий', piercing: 'колющий', slashing: 'рубящий',
};
const dmgName = (t) => DMG_NOUN[t] ?? DAMAGE_TYPES[t]?.name?.toLowerCase() ?? t;
/** «Наложение рук (пул)» → «наложение рук» — для сравнения умения с карточкой действия. */
export const normName = (s) => String(s ?? '').toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').trim();
const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);

/** Подстановка {chaMod}, {level}, {halfLevel}, {rageBonus}, {prof} в текст. */
export function fillTemplate(text, ctx) {
    const vars = {
        level: ctx.level,
        halfLevel: Math.floor(ctx.level / 2),
        prof: ctx.prof,
        rageBonus: ctx.level >= 16 ? 4 : ctx.level >= 9 ? 3 : 2,
        ...Object.fromEntries(Object.entries(ctx.mods ?? {}).map(([k, v]) => [`${k}Mod`, sign(Math.max(1, v))])),
    };
    return String(text ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

/** Условие эффекта — «против очарования», «Скрытность», «на солнце». */
function whenText(w = {}) {
    const parts = [];
    if (w.against && ABIL_SHORT[w.against]) parts.push(ABIL_SHORT[w.against]); // «спасброски ИНТ»
    else if (w.against) parts.push(`против ${CONDITIONS[w.against] ?? w.against}`);
    if (w.skill) parts.push(skillName(w.skill));
    if (w.in === 'sunlight') parts.push('на солнечном свету');
    else if (w.in) parts.push(w.in);
    if (w.weapon === 'ranged') parts.push('дальнобойное оружие');
    if (w.weapon === 'melee') parts.push('рукопашное оружие');
    if (w.armored) parts.push('в доспехе');
    return parts.join(', ');
}

/**
 * Эффект → { group, key, label } для сводки или null, если такой эффект
 * в сводку не выносим (он уже учтён в листе или описан самим умением).
 */
function effectLine(e, ctx) {
    if (!e) return null;
    switch (e.kind) {
        case 'resistance':
            return { group: 'resistance', key: `res:${e.value}`, label: dmgName(e.value), dmg: e.value };
        case 'immunity':
            return { group: 'immunity', key: `imm:${e.value}`, label: CONDITIONS[e.value] ?? dmgName(e.value) };
        case 'sense': {
            const name = SENSES[e.sense] ?? e.sense;
            return { group: 'sense', key: `sense:${e.sense}`, label: `${name} ${e.range} фт.`, range: e.range, note: e.note };
        }
        case 'advantage':
        case 'disadvantage': {
            const what = TARGETS[e.target] ?? e.target ?? '';
            const cond = whenText(e.when);
            const label = [what, cond].filter(Boolean).join(' ');
            return { group: e.kind, key: `${e.kind}:${label}`, label };
        }
        case 'bonus': {
            if (e.target === 'note') return { group: 'note', key: `note:${e.note}`, label: fillTemplate(e.note, ctx) };
            if (ABILITIES?.[e.target]) return null; // бонусы характеристик уже в значениях
            let v = e.value;
            if (e.ability) v = ctx.mods?.[e.ability] ?? 0;
            else if (v === 'prof') v = ctx.prof;
            else if (e.per === 'level') v = Number(v) * ctx.level;
            if (typeof v !== 'number') return null;
            const names = {
                speed: `Скорость ${sign(v)} фт.`,
                initiative: `Инициатива ${sign(v)}`,
                hpMax: `Хиты ${sign(v)}`,
                ac: `КД ${sign(v)}`,
                attackRoll: `Атака ${sign(v)}`,
                damage: `Урон ${sign(v)}`,
            };
            const base = names[e.target];
            if (!base) return null;
            const cond = whenText(e.when);
            return { group: 'bonus', key: `bonus:${e.target}:${cond}`, label: cond ? `${base} (${cond})` : base, value: v };
        }
        default:
            // set / reroll / rider… — если есть пояснение, показываем его
            return e.note ? { group: 'note', key: `note:${e.note}`, label: fillTemplate(e.note, ctx) } : null;
    }
}

/**
 * @param src {
 *   raceTraits, classFeatures, subclassFeatures,  — уже отфильтрованы по уровню
 *   raceName, className, subclassName,
 *   feats: [{ ...feat, sourceTitle }]               — выбранные черты/стили/воззвания
 *   activeNames: Set<string>                        — имена умений с карточкой действия
 *   ctx: { level, prof, mods }
 * }
 * @returns {{ effects: [{ id, title, items: [{ label, sources: [{ name, desc }] }] }], abilities: [...] }}
 */
export function collectPassives(src) {
    const { ctx } = src;
    const lines = new Map(); // key → { group, label, sources }
    const push = (e, source) => {
        const l = effectLine(e, ctx);
        if (!l) return;
        const prev = lines.get(l.key);
        // чувства: берём наибольшую дальность
        if (prev && l.group === 'sense' && l.range > prev.range) {
            prev.label = l.label;
            prev.range = l.range;
        }
        if (prev) prev.sources.push(source);
        else lines.set(l.key, { ...l, sources: [source] });
    };

    const abilities = [];
    const addAbility = (f, source, extra = []) =>
        abilities.push({ name: f.name, desc: f.desc ?? '', level: f.level ?? null, source, notes: extra });

    // --- раса: эффекты — в сводку; текстовые черты без грантов — в умения ---
    for (const t of src.raceTraits ?? []) {
        const grants = t.grants ?? [];
        const source = { name: t.name, desc: t.desc, from: src.raceName };
        grants.filter((g) => g.type === 'effect').forEach((g) => push(g.effect, source));
        if (!grants.length && t.passive !== false) addAbility(t, src.raceName);
    }

    // --- класс и подкласс ---
    const features = [
        ...(src.classFeatures ?? []).map((f) => [f, src.className]),
        ...(src.subclassFeatures ?? []).map((f) => [f, src.subclassName]),
    ];
    const seenFeature = new Set();
    for (const [f, from] of features) {
        const source = { name: f.name, desc: f.desc, from };
        const grants = f.grants ?? [];
        grants.filter((g) => g.type === 'effect').forEach((g) => push(g.effect, source));
        const notes = grants.filter((g) => g.type === 'passive' && g.note).map((g) => fillTemplate(g.note, ctx));

        let passive = f.passive;
        if (passive == null) {
            passive =
                !f.choice && !f.choices &&
                !SERVICE.test(f.name) &&
                !src.activeNames?.has(normName(f.name));
        }
        // одно и то же умение (Дополнительная атака / Движение без доспехов на 2 и 6 ур.) — один раз, последнее
        if (passive) {
            const key = `${from}:${f.name}`;
            if (seenFeature.has(key)) {
                const i = abilities.findIndex((a) => a.source === from && a.name === f.name);
                if (i >= 0) abilities.splice(i, 1);
            }
            seenFeature.add(key);
            addAbility(f, from, notes);
        }
    }

    // --- черты, боевые стили, воззвания ---
    for (const f of src.feats ?? []) {
        const source = { name: f.name, desc: f.desc, from: f.sourceTitle };
        (f.effects ?? f.data?.effects ?? []).forEach((e) => push(e, source));
        addAbility({ name: f.name, desc: f.desc }, f.sourceTitle);
    }

    const effects = EFFECT_GROUPS.map((g) => ({
        ...g,
        items: [...lines.values()].filter((l) => l.group === g.id),
    })).filter((g) => g.items.length);

    return { effects, abilities };
}
