/**
 * Character passive effects — things that are always on and cost no action:
 *
 *   effects   — summary of structured effects, by group
 *               (resistances, senses, advantages, disadvantages, bonuses…)
 *               sources: race trait grants { type: 'effect' }, class feature
 *               grants { type: 'effect' | 'passive' }, the effects field of feats/invocations
 *   abilities — list of passive features (Evasion, Weapon Mastery,
 *               invocations, fighting styles, feats…) with a description for the tooltip
 *
 * A class feature is considered passive if it has no action card
 * (an entry in the abilities table with the same name), is not a choice container
 * and is not a "service" feature (Spellcasting, Fighting Style…).
 * Can be overridden explicitly with the feature field passive: true | false.
 */
import { DAMAGE_TYPES } from './labels.js';
import { ABILITIES } from './abilities.js';
import { SKILLS } from './skills.js';

// summary groups — in this order
export const EFFECT_GROUPS = [
    { id: 'resistance', title: 'Resistance' },
    { id: 'immunity', title: 'Immunity' },
    { id: 'sense', title: 'Senses' },
    { id: 'advantage', title: 'Advantage' },
    { id: 'disadvantage', title: 'Disadvantage' },
    { id: 'bonus', title: 'Bonuses' },
    { id: 'note', title: 'Other' },
];

// service features: give nothing by themselves (their point is choices, slots, resources)
const SERVICE =
    /^(Spellcasting|Pact Magic|Eldritch Invocations|Metamagic|Mystic Arcanum|Fighting Style|Additional Fighting Style|Ability Score Improvement|Pact Boon|Font of Magic|Sorcery Points|Focus Points)/i;

const SENSES = {
    darkvision: 'Darkvision',
    blindsight: 'Blindsight',
    tremorsense: 'Tremorsense',
    truesight: 'Truesight',
};

const CONDITIONS = {
    charmed: 'the Charmed condition',
    frightened: 'the Frightened condition',
    paralyzed: 'the Paralyzed condition',
    poisoned: 'the Poisoned condition',
    poison: 'poison',
    stunned: 'the Stunned condition',
    magic: 'magic',
};

const TARGETS = {
    savingThrow: 'saving throws',
    skillCheck: 'ability checks',
    attackRoll: 'attack rolls',
    concentration: 'Concentration saving throws',
    initiative: 'Initiative',
};

const ABIL_SHORT = Object.fromEntries(
    Object.entries(ABILITIES ?? {}).map(([k, a]) => [k, a?.short ?? a?.name ?? k]),
);
const skillName = (id) => SKILLS.find((s) => s.id === id)?.name ?? id;
// "resistance: fire" — lowercase noun form (DAMAGE_TYPES holds the capitalized names)
const DMG_NOUN = {
    acid: 'acid', cold: 'cold', fire: 'fire', force: 'force', lightning: 'lightning',
    necrotic: 'necrotic', poison: 'poison', psychic: 'psychic', radiant: 'radiant',
    thunder: 'thunder', bludgeoning: 'bludgeoning', piercing: 'piercing', slashing: 'slashing',
};
const dmgName = (t) => DMG_NOUN[t] ?? DAMAGE_TYPES[t]?.name?.toLowerCase() ?? t;
/** "Lay On Hands (pool)" → "lay on hands" — to match a feature against an action card. */
export const normName = (s) => String(s ?? '').toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').trim();
const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);

/** Substitutes {chaMod}, {level}, {halfLevel}, {rageBonus}, {prof} into text. */
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

/** Effect condition — "against the Charmed condition", "Stealth", "in sunlight". */
function whenText(w = {}) {
    const parts = [];
    if (w.against && ABIL_SHORT[w.against]) parts.push(ABIL_SHORT[w.against]); // "INT saving throws"
    else if (w.against) parts.push(`against ${CONDITIONS[w.against] ?? w.against}`);
    if (w.skill) parts.push(skillName(w.skill));
    if (w.in === 'sunlight') parts.push('in sunlight');
    else if (w.in) parts.push(w.in);
    if (w.weapon === 'ranged') parts.push('ranged weapons');
    if (w.weapon === 'melee') parts.push('melee weapons');
    if (w.armored) parts.push('while wearing armor');
    return parts.join(', ');
}

/**
 * Effect → { group, key, label } for the summary, or null if the effect
 * is not shown in the summary (already accounted for in the sheet or described by the feature itself).
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
            return { group: 'sense', key: `sense:${e.sense}`, label: `${name} ${e.range} ft.`, range: e.range, note: e.note };
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
            if (ABILITIES?.[e.target]) return null; // ability bonuses are already in the scores
            let v = e.value;
            if (e.ability) v = ctx.mods?.[e.ability] ?? 0;
            else if (v === 'prof') v = ctx.prof;
            else if (e.per === 'level') v = Number(v) * ctx.level;
            if (typeof v !== 'number') return null;
            const names = {
                speed: `Speed ${sign(v)} ft.`,
                initiative: `Initiative ${sign(v)}`,
                hpMax: `HP ${sign(v)}`,
                ac: `AC ${sign(v)}`,
                attackRoll: `Attack ${sign(v)}`,
                damage: `Damage ${sign(v)}`,
            };
            const base = names[e.target];
            if (!base) return null;
            const cond = whenText(e.when);
            return { group: 'bonus', key: `bonus:${e.target}:${cond}`, label: cond ? `${base} (${cond})` : base, value: v };
        }
        default:
            // set / reroll / rider… — show the note if there is one
            return e.note ? { group: 'note', key: `note:${e.note}`, label: fillTemplate(e.note, ctx) } : null;
    }
}

/**
 * @param src {
 *   raceTraits, classFeatures, subclassFeatures,  — already filtered by level
 *   raceName, className, subclassName,
 *   feats: [{ ...feat, sourceTitle }]               — chosen feats/styles/invocations
 *   activeNames: Set<string>                        — names of features with an action card
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
        // senses: take the longest range
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

    // --- race: effects go to the summary; text traits without grants go to abilities ---
    for (const t of src.raceTraits ?? []) {
        const grants = t.grants ?? [];
        const source = { name: t.name, desc: t.desc, from: src.raceName };
        grants.filter((g) => g.type === 'effect').forEach((g) => push(g.effect, source));
        if (!grants.length && t.passive !== false) addAbility(t, src.raceName);
    }

    // --- class and subclass ---
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
        // the same feature (Extra Attack / Unarmored Movement at lvl 2 and 6) — once, the latest
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

    // --- feats, fighting styles, invocations ---
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
