/**
 * Multiclassing: which classes a build has and at what levels.
 *
 * A build stores:
 *   classes      — [{ classId, subclassId }] in the order they were taken; [0] is the
 *                  primary (starting) class: saving throws, full level-1 proficiencies.
 *   levelClasses — the class taken at each character level: levelClasses[n-1] is the
 *                  class gained at character level n. Its length is the character level.
 *
 * Every function takes either a CharacterBuild or its plain JSON (LAN snapshots, files).
 */

/** [{ classId, subclassId }] (never null). */
export const buildClasses = (b) => (Array.isArray(b?.classes) ? b.classes : []);

/** The class gained at each character level: [classId, …] (index 0 — level 1). */
export const levelClassList = (b) => (Array.isArray(b?.levelClasses) ? b.levelClasses : []);

/** Character level (total of all class levels; 1 before a class is chosen). */
export const totalLevel = (b) => Math.max(1, levelClassList(b).length);

/** The primary (first) class id, or null. */
export const primaryClassId = (b) => buildClasses(b)[0]?.classId ?? null;

/** The subclass id chosen for a class (null — none yet). */
export const subclassOf = (b, classId) =>
    buildClasses(b).find((c) => c.classId === classId)?.subclassId ?? null;

/** Levels in a class (up to character level upTo, default — all). */
export function classLevel(b, classId, upTo = Infinity) {
    let n = 0;
    const list = levelClassList(b);
    for (let i = 0; i < list.length && i < upTo; i++) if (list[i] === classId) n++;
    return n;
}

/** The class gained at character level n (1-based), or null. */
export const classAt = (b, n) => levelClassList(b)[n - 1] ?? null;

/** The class level reached in the class gained at character level n (e.g. 2 for "Wizard 2"). */
export function classLevelAt(b, n) {
    const id = classAt(b, n);
    return id ? classLevel(b, id, n) : 0;
}

/**
 * Classes with their levels (at character level upTo, default — current):
 * [{ classId, subclassId, level }], in the order taken; classes with 0 levels are skipped.
 */
export function classEntries(b, upTo = Infinity) {
    return buildClasses(b)
        .map((c) => ({ classId: c.classId, subclassId: c.subclassId ?? null, level: classLevel(b, c.classId, upTo) }))
        .filter((c) => c.level > 0);
}

/** True if the build has more than one class. */
export const isMulticlass = (b) => classEntries(b).length > 1;

/**
 * "Fighter 3 / Wizard 2" (a single class — just its name: "Fighter").
 * refs — reference data with classes[] (null — use the ids).
 */
export function classSummary(b, refs = null, { withSubclass = false } = {}) {
    const list = classEntries(b);
    const label = (c) => {
        const cls = refs?.classes?.find((x) => x.id === c.classId);
        const name = list.length > 1 ? `${cls?.name ?? c.classId} ${c.level}` : (cls?.name ?? c.classId);
        if (!withSubclass || !c.subclassId) return name;
        const sub = cls?.subclasses?.find((s) => s.id === c.subclassId);
        return `${name} (${sub?.name ?? c.subclassId})`;
    };
    return list.map(label).join(' / ');
}

// --- prerequisites and proficiencies (class data: cls.data.multiclass) ---

export const MULTICLASS_MIN_SCORE = 13;

const ABILITY_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };

/**
 * A class's multiclass rules: { prerequisites: { allOf?|anyOf?: [ability], min },
 * proficiencies: { armor: [], weapons: [], tools: [], skills: n } }.
 * A class without the block (homebrew) — its primary abilities, all required; no proficiencies.
 */
export function multiclassInfo(cls) {
    const d = cls?.data ?? cls ?? {};
    const mc = d.multiclass ?? {};
    const pre = mc.prerequisites ?? { allOf: d.primaryAbility ?? [] };
    const prof = mc.proficiencies ?? {};
    return {
        prerequisites: { allOf: pre.allOf ?? [], anyOf: pre.anyOf ?? [], min: pre.min ?? MULTICLASS_MIN_SCORE },
        proficiencies: {
            armor: prof.armor ?? [],
            weapons: prof.weapons ?? [],
            tools: prof.tools ?? [],
            skills: Number(prof.skills) || 0,
        },
    };
}

/** "Strength 13 and Charisma 13" / "Strength 13 or Dexterity 13". */
export function prerequisitesText(cls) {
    const { allOf, anyOf, min } = multiclassInfo(cls).prerequisites;
    const part = (list, word) => list.map((k) => `${ABILITY_NAMES[k] ?? k} ${min}`).join(` ${word} `);
    return [part(allOf, 'and'), anyOf.length ? part(anyOf, 'or') : ''].filter(Boolean).join(', and ');
}

/** Does a class's prerequisite hold for these ability scores ({ str: 15, … })? */
export function meetsPrerequisites(cls, abilities) {
    const { allOf, anyOf, min } = multiclassInfo(cls).prerequisites;
    const ok = (k) => (abilities?.[k] ?? 0) >= min;
    return allOf.every(ok) && (!anyOf.length || anyOf.some(ok));
}

/**
 * Can the character gain a level in a class? A class it already has — always.
 * A new class — the scores must meet the prerequisites of the new class AND of
 * every class it already has (PHB 2024). abilities — final scores (build.totalAbilities).
 * Returns { ok, isNew, reasons: ["Wizard: needs Intelligence 13", …] }.
 */
export function canTakeClass(build, refs, classId, abilities = build?.totalAbilities) {
    const has = buildClasses(build).some((c) => c.classId === classId);
    if (has) return { ok: true, isNew: false, reasons: [] };
    const find = (id) => refs?.classes?.find((c) => c.id === id);
    const reasons = [];
    for (const id of [classId, ...buildClasses(build).map((c) => c.classId)]) {
        const cls = find(id);
        if (cls && !meetsPrerequisites(cls, abilities)) reasons.push(`${cls.name}: needs ${prerequisitesText(cls)}`);
    }
    return { ok: reasons.length === 0, isNew: true, reasons };
}
