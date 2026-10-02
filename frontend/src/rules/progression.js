/**
 * Level progression: what a level grants and what must be chosen at it.
 *
 *   levelPlan(build, level, refs) → { level, gains, choices, hp, ... }
 *     gains   — info: new class/subclass/race/background features
 *     choices — what the player must choose at this level
 *
 *   summarizeChoices(build, refs) → what has been chosen across all levels
 *     (skills, expertise, feats, spells…) — for the character sheet.
 *
 * A choice is stored in build.choices[key] = { kind, ids: [...], asi?: {...} }.
 * The key starts with the level: `L<level>:<source>:<what>` — so on
 * level-up it is clear what belongs to which level.
 *
 * Choice kinds (kind):
 *   skills | skill       — skills (class at level 1, race, the "Skilled" feat)
 *   expertise            — expertise (doubled proficiency bonus)
 *   feat                 — feat (race, Ability Score Improvement)
 *   asi                  — +to abilities (for a feat with an asi field)
 *   fightingStyle        — fighting style
 *   cantrips | spells    — cantrips / prepared spells
 *   metamagic | invocations — sorcerer metamagic / warlock invocations
 *   subclass             — subclass
 *   option               — other (Divine Order / Primal Order)
 *   pool                 — "choose N" from a subclass pool (Battle Master maneuvers,
 *                          arcane shots) — the subclass.optionPools field
 *
 * Feats/invocations can carry fixed grants (feat.data.grants):
 *   { type: 'skill', id }                              — skill proficiency (counted here)
 *   { type: 'spell', id, atWill?, ritual?, note? }     — a spell card (models/Character.js)
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

/** Short reference to a reference-data object → choice option. */
// ref — the source record (for a card with description, damage, action type)
const asOption = (x, meta) => ({ id: x.id, name: x.name, desc: x.desc ?? x.data?.desc ?? '', meta, ref: x });
const spellOption = (sp) =>
    asOption(sp, [sp.level === 0 ? 'cantrip' : `Level ${sp.level}`, SCHOOLS[sp.school]].filter(Boolean).join(' · '));

// ---------------------------------------------------------------------------
// reference-data queries

const featsBy = (refs, category, level = 20) =>
    (refs.feats ?? []).filter((f) => f.category === category && lvlOf(f) <= level);

/** Spells on the class list (or another list), spell level ≤ maxLevel. */
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
// what has been chosen (across all levels ≤ upTo)

export function summarizeChoices(build, refs, upTo = build.level ?? 1) {
    const out = {
        skills: new Set(),
        expertise: new Set(),
        feats: [],          // feat ids (including the background feat)
        fightingStyles: [],
        metamagic: [],
        invocations: [],
        cantrips: [],
        spells: [],
        options: [],
        pool: [],           // picks from subclass pools (maneuvers, shots)
    };

    const bg = findBg(build, refs);
    for (const s of bg?.data?.skills ?? []) out.skills.add(s);
    if (bg?.feat) out.feats.push(bg.feat);

    // by level; within a level "forget" before "learn" (invocation replacement)
    const lvlKey = (k) => Number(/^L(\d+):/.exec(k)?.[1] ?? 0);
    const entries = Object.entries(build.choices ?? {}).sort(
        ([a, ca], [b, cb]) =>
            lvlKey(a) - lvlKey(b) || (cb?.kind === 'invocationForget') - (ca?.kind === 'invocationForget'),
    );
    for (const [key, c] of entries) {
        const m = /^L(\d+):/.exec(key);
        if (m && Number(m[1]) > upTo) continue;
        // a replacement invocation counts only if the old one was forgotten
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

    // fixed race skills
    const race = findRace(build, refs);
    const sub = race?.subraces?.find((s) => s.id === build.subraceId);
    for (const t of [...(race?.data?.traits ?? []), ...(sub?.data?.traits ?? [])]) {
        if (lvlOf(t) > upTo) continue;
        for (const g of t.grants ?? []) if (g.type === 'skill' && g.id) out.skills.add(g.id);
    }
    // fixed skills from chosen feats / fighting styles / invocations
    // (feat data: "grants": [{ "type": "skill", "id": "deception" }] — e.g. Beguiling Influence)
    for (const id of [...out.feats, ...out.fightingStyles, ...out.invocations]) {
        for (const g of findFeat(refs, id)?.data?.grants ?? []) if (g.type === 'skill' && g.id) out.skills.add(g.id);
    }
    return out;
}

// ---------------------------------------------------------------------------
// level plan

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

    // --- hit points and proficiency ---
    const con = modifier(build.totalAbilities?.con ?? build.abilities?.con) ?? 0;
    const die = cls?.hitDie ?? 8;
    const hp =
        level === 1
            ? { gain: Math.max(1, die + con), formula: `d${die} (max) ${fmt(con)} Con` }
            : { gain: Math.max(1, Math.floor(die / 2) + 1 + con), formula: `${Math.floor(die / 2) + 1} (average d${die}) ${fmt(con)} Con` };
    const prof = proficiencyBonus(level);
    const profChanged = level === 1 || prof !== proficiencyBonus(level - 1);

    // --- slots ---
    // class or subclass spellcasting (Eldritch Knight / Arcane Trickster — from level 3)
    const sc = spellcastingOf(cls, subclass);
    const scOwner = cls?.data?.spellcasting ? cls : subclass;
    const progression = sc?.progression ?? cls?.caster ?? 'none';
    const scOn = (lvl) => !!sc && lvl >= (sc.startLevel ?? 1);
    const slots = scOn(level) ? spellSlots(progression, level) : [];
    const prevSlots = level > 1 && scOn(level - 1) ? spellSlots(progression, level - 1) : [];
    const slotsChanged = JSON.stringify(slots) !== JSON.stringify(prevSlots);

    // ================= class =================
    const clsFeatures = (cls?.data?.features ?? []).filter((f) => lvlOf(f) === level);
    addGain(
        cls ? `${cls.name} · Level ${level}` : 'Class',
        clsFeatures.map((f) => ({ name: f.name, desc: f.desc })),
    );

    // class skills — at level 1
    if (level === 1 && cls?.data?.skills?.length) {
        add({
            key: 'L1:class:skills',
            kind: 'skills',
            title: `Class Skills (${cls.name})`,
            desc: `Choose ${cls.data.skillCount ?? 2} from the class list.`,
            pick: cls.data.skillCount ?? 2,
            options: cls.data.skills.filter((s) => !done.skills.has(s)).map(skillOption),
        });
    }

    for (const f of clsFeatures) featureChoices(f, 'class', level, done, refs, add);

    // subclass
    if (cls && level === (cls.subclassLevel ?? 3) && cls.subclasses?.length) {
        choices.push({
            key: `L${level}:class:subclass`,
            kind: 'subclass',
            title: `Subclass (${cls.name})`,
            pick: 1,
            options: cls.subclasses.map((s) => asOption(s)),
            value: build.subclassId ? { kind: 'subclass', ids: [build.subclassId] } : null,
        });
    }

    // subclass features
    if (subclass) {
        const subFeatures = (subclass.data?.features ?? []).filter((f) => lvlOf(f) === level);
        addGain(subclass.name, subFeatures.map((f) => ({ name: f.name, desc: f.desc })));
        for (const f of subFeatures) featureChoices(f, 'subclass', level, done, refs, add);

        // "choose N" pools: Battle Master maneuvers, arcane shots…
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

    // class abilities (from the spells table) — what unlocks at this level
    const powers = (refs.spells ?? []).filter((sp) => {
        if (sp.kind === 'spell' || sp.level !== level) return false;
        const d = sp.data ?? {};
        if (d.pool) return false; // pool options are chosen separately
        if (d.subclass) return !!subclass && d.subclass === subclass.id;
        return sp.kind === 'class' && (d.classes ?? []).includes(cls?.id);
    });
    // don't duplicate what a class/subclass feature with the same name already describes
    const shown = new Set(gains.flatMap((g) => g.items.map((it) => norm(it.name))));
    addGain(
        'Abilities',
        powers
            .filter((sp) => !shown.has(norm(sp.name)))
            .map((sp) => ({ name: sp.name, desc: sp.desc, ref: sp })),
    );

    // Ability Score Improvement / feat
    if ((cls?.data?.asiLevels ?? []).includes(level)) {
        const key = `L${level}:class:feat`;
        add({
            key,
            kind: 'feat',
            title: 'Ability Score Improvement or Feat',
            desc: 'The Ability Score Improvement feat grants +2 to one ability or +1 to two abilities.',
            pick: 1,
            options: featsBy(refs, 'general', level)
                .filter((f) => f.data?.repeatable || !done.feats.includes(f.id))
                .map((f) => asOption(f, f.data?.asi ? 'with ability score increase' : '')),
        });
        featFollowUps(value(key)?.ids?.[0], key, level, done, refs, add);
    }

    // metamagic / invocations — how many new at this level
    const newCount = (table) => byLevelPairs(table ?? [], level) - (level > 1 ? byLevelPairs(table ?? [], level - 1) : 0);
    const mmNew = newCount(cls?.data?.metamagicKnown);
    if (mmNew > 0) {
        add({
            key: `L${level}:class:metamagic`,
            kind: 'metamagic',
            title: 'Metamagic',
            pick: mmNew,
            options: featsBy(refs, 'metamagic').filter((f) => !done.metamagic.includes(f.id)).map((f) => asOption(f)),
        });
    }
    const invNew = newCount(cls?.data?.invocationsKnown);
    if (invNew > 0) {
        add({
            key: `L${level}:class:invocations`,
            kind: 'invocations',
            title: 'Eldritch Invocations',
            pick: invNew,
            options: featsBy(refs, 'invocation', level).filter((f) => !done.invocations.includes(f.id)).map((f) => asOption(f)),
        });
    }
    // PHB 2024: on each level-up a warlock may replace one known invocation
    if (level > 1 && cls?.data?.invocationsKnown?.length && done.invocations.length) {
        const forgetKey = `L${level}:class:invocationForget`;
        const forgotten = value(forgetKey)?.ids ?? [];
        add({
            key: forgetKey,
            kind: 'invocationForget',
            title: 'Replace an invocation — forget',
            desc: 'Optional: choose a known invocation you want to replace with another.',
            pick: 1,
            optional: true,
            options: featsBy(refs, 'invocation').filter((f) => done.invocations.includes(f.id)).map((f) => asOption(f)),
        });
        if (forgotten.length) {
            add({
                key: `L${level}:class:invocationSwap`,
                kind: 'invocations',
                title: 'Replace an invocation — new',
                pick: 1,
                options: featsBy(refs, 'invocation', level)
                    .filter((f) => !done.invocations.includes(f.id))
                    .map((f) => asOption(f)),
            });
        }
    }

    // class (or subclass) spells
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
                title: `Cantrips (${who})`,
                pick: cNew,
                options: spellList(refs, list, { maxLevel: 0 }).filter((sp) => !done.cantrips.includes(sp.id)).map(spellOption),
            });
        }
        if (pNew > 0 && maxCircle > 0) {
            add({
                key: `L${level}:class:spells`,
                kind: 'spells',
                title: `Spells (${who})`,
                desc: `Spell level — up to ${maxCircle}.`,
                pick: pNew,
                options: spellList(refs, list, { minLevel: 1, maxLevel: maxCircle })
                    .filter((sp) => !done.spells.includes(sp.id))
                    .map(spellOption),
            });
        }
    }

    // ================= race =================
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
                    key, kind: 'skill', title: `${t.name}: skill`, pick: g.choose,
                    options: (g.options ?? SKILLS.map((s) => s.id)).filter((s) => !done.skills.has(s)).map(skillOption),
                });
            } else if (g.type === 'feat') {
                add({
                    key, kind: 'feat', title: `${t.name}: origin feat`, pick: g.choose,
                    options: featsBy(refs, 'origin').filter((f) => !done.feats.includes(f.id)).map((f) => asOption(f)),
                });
                featFollowUps(value(key)?.ids?.[0], key, level, done, refs, add);
            } else if (g.type === 'pool') {
                // "choose N" from an option pool granted by the species (e.g. Battle Master maneuvers)
                add({
                    key, kind: 'pool', title: `${t.name}: ${g.pool === 'maneuver' ? 'maneuvers' : g.pool}`, pick: g.choose,
                    options: (refs.spells ?? [])
                        .filter((sp) => sp.data?.pool === g.pool && !done.pool.includes(sp.id))
                        .map((sp) => asOption(sp)),
                });
            } else if (g.type === 'spell') {
                add({
                    key, kind: g.level === 0 ? 'cantrips' : 'spells',
                    title: `${t.name}: ${g.level === 0 ? 'cantrip' : 'spell'}`,
                    pick: g.choose,
                    options: spellList(refs, g.from, { minLevel: g.level ?? 0, maxLevel: g.level ?? 0 })
                        .filter((sp) => !done.cantrips.includes(sp.id))
                        .map(spellOption),
                });
            }
        }
    }

    // spellcasting ability for species spells: chosen once at level 1 if the species
    // (or subspecies) grants spells at any level and doesn't fix the ability (data.spellAbility)
    if (level === 1) {
        const allTraits = [...(race?.data?.traits ?? []), ...(sub?.data?.traits ?? [])];
        const hasSpells = allTraits.some((t) => (t.grants ?? []).some((g) => g.type === 'spell'));
        const def = sub?.data?.spellAbility ?? race?.data?.spellAbility;
        if (hasSpells && typeof def !== 'string') {
            const from = Array.isArray(def) && def.length ? def : ['int', 'wis', 'cha'];
            add({
                key: 'L1:race:spellAbility',
                kind: 'spellAbility',
                title: `${sub?.name ?? race?.name}: spellcasting ability`,
                desc: 'Used for the spells your species grants (spell save DC and attack).',
                pick: 1,
                options: from.map((id) => ({ id, name: ABILITIES[id]?.name ?? id })),
            });
        }
    }

    // ================= background (level 1) =================
    if (level === 1 && bg) {
        const feat = findFeat(refs, bg.feat);
        addGain(`Background: ${bg.name}`, [
            { name: 'Skills', desc: (bg.data?.skills ?? []).map((s) => SKILL_BY_ID[s]?.name ?? s).join(', ') },
            ...(bg.data?.tool ? [{ name: 'Tools', desc: bg.data.tool }] : []),
            ...(feat ? [{ name: `Feat: ${feat.name}`, desc: feat.desc }] : []),
        ]);
        featFollowUps(bg.feat, 'L1:background:feat', level, done, refs, add);
    }

    return { level, prof, profChanged, hp, slots, slotsChanged, gains, choices };
}

/** The class's spellcasting, otherwise the subclass's. */
export const spellcastingOf = (cls, subclass) =>
    cls?.data?.spellcasting ?? subclass?.data?.spellcasting ?? null;

/** Feature choices: the choice field (one) or choices (several). */
function featureChoices(f, src, level, done, refs, add) {
    const list = f.choices ?? (f.choice ? [f.choice] : []);
    list.forEach((ch, i) => classChoice(f, ch, list.length > 1 ? i : null, src, level, done, refs, add));
}

/** A single class/subclass feature choice. */
function classChoice(f, ch, idx, src, level, done, refs, add) {
    const key = `L${level}:${src}:${ch.type}:${f.name}` + (idx != null ? `:${idx}` : '');
    if (ch.type === 'fightingStyle') {
        add({
            key, kind: 'fightingStyle', title: f.name, desc: f.desc, pick: ch.pick ?? 1,
            options: featsBy(refs, 'fightingStyle').filter((x) => !done.fightingStyles.includes(x.id)).map((x) => asOption(x)),
        });
    } else if (ch.type === 'expertise') {
        add({
            key, kind: 'expertise', title: f.name, desc: 'Choose skills you are proficient in: your proficiency bonus is doubled.',
            pick: ch.pick ?? 1,
            // proficiency gained at this same level (level 1 class skills) also counts
            options: SKILLS.map((s) => s.id).filter((s) => !done.expertise.has(s)).map(skillOption),
            needsProficiency: true,
        });
    } else if (ch.type === 'skill') {
        add({
            key, kind: 'skill', title: f.name, pick: ch.pick ?? 1,
            options: (ch.options ?? SKILLS.map((s) => s.id)).filter((s) => !done.skills.has(s)).map(skillOption),
        });
    } else if (ch.type === 'cantrip' || ch.type === 'spell') {
        // a specific list of spells by id (e.g. "Prestidigitation" or "Druidcraft")
        const byId = new Map((refs.spells ?? []).map((sp) => [sp.id, sp]));
        add({
            key, kind: ch.type === 'cantrip' ? 'cantrips' : 'spells', title: `${f.name}: ${ch.type === 'cantrip' ? 'cantrip' : 'spell'}`,
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

/** Choices the feat itself requires: +abilities, skills, spells. */
function featFollowUps(featId, key, level, done, refs, add) {
    const feat = featId ? findFeat(refs, featId) : null;
    if (!feat) return;
    const d = feat.data ?? {};

    // +to abilities
    if (d.asi) {
        const opts = Array.isArray(d.asi) ? d.asi : d.asi.options ?? ABILITY_KEYS;
        const amount = Array.isArray(d.asi) ? 1 : d.asi.amount ?? 1;
        const pick = Array.isArray(d.asi) ? 1 : d.asi.pick ?? 1;
        add({
            key: `${key}:asi`,
            kind: 'asi',
            title: `${feat.name}: +${amount} to an ability`,
            desc: pick > 1 ? `Assign +${pick * amount}: +${pick * amount} to one or +${amount} to several.` : '',
            pick,
            amount,
            repeatable: pick > 1, // the same ability may be chosen twice
            options: opts.map((k) => ({ id: k, name: ABILITIES[k]?.name ?? k })),
        });
    }
    // skills ("Skilled")
    if (d.skillChoice) {
        add({
            key: `${key}:skills`,
            kind: 'skills',
            title: `${feat.name}: skills`,
            pick: d.skillChoice.choose ?? 1,
            options: SKILLS.map((s) => s.id).filter((s) => !done.skills.has(s)).map(skillOption),
        });
    }
    // "Magic Initiate" — 2 cantrips and 1 level 1 spell from a list
    const mi = /^magicInitiate(\w+)$/.exec(feat.id);
    if (mi) {
        const list = mi[1].toLowerCase();
        add({
            key: `${key}:cantrips`, kind: 'cantrips', title: `${feat.name}: cantrips`, pick: 2,
            options: spellList(refs, list, { maxLevel: 0 }).filter((sp) => !done.cantrips.includes(sp.id)).map(spellOption),
        });
        add({
            key: `${key}:spells`, kind: 'spells', title: `${feat.name}: level 1 spell`, pick: 1,
            options: spellList(refs, list, { minLevel: 1, maxLevel: 1 }).filter((sp) => !done.spells.includes(sp.id)).map(spellOption),
        });
    }
}

// ---------------------------------------------------------------------------
// plan evaluation: what is visible, what is validly chosen, whether everything is done

// the same skill/spell cannot be picked in two choices of the same level
const FAMILY = { skills: 'skill', skill: 'skill', cantrips: 'cantrip', spells: 'spell', pool: 'pool', invocations: 'invocation' };

/**
 * Augments the plan's choices:
 *   visible — options that can be chosen now
 *   valid   — chosen items that are allowed (the rest don't count)
 *   count / need / done
 * and returns { choices, complete }.
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

/** Whether all of the plan's choices are made. */
export function planComplete(plan) {
    return plan.choices.every((c) => c.optional || choiceCount(c) >= Math.min(c.pick, c.options.length || c.pick));
}

/** How many are chosen in a choice. */
export function choiceCount(c) {
    if (c.kind === 'asi') return Object.values(c.value?.asi ?? {}).reduce((s, v) => s + v, 0) / (c.amount ?? 1);
    return c.value?.ids?.length ?? 0;
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s*\(.*?\)\s*/g, '').trim();
const fmt = (n) => (n >= 0 ? `+ ${n}` : `− ${-n}`);
const actionTag = (a) => ({ action: 'action', bonus: 'bonus', reaction: 'reaction', free: 'free' })[a] ?? '';
