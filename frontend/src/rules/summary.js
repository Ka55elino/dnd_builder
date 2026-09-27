/**
 * The character "summary" — everything the compact card (CharacterBrief) and the
 * DM's initiative line show, as plain numbers and names.
 *
 * In a LAN game the PLAYER's app builds it (with its own reference data, custom
 * items and spells) and sends it to the DM with every state change, so the DM
 * sees the right numbers even if their app doesn't have the player's custom
 * records or their data differ. The DM never recomputes a player's sheet when
 * a summary is available.
 *
 * build — CharacterBuild, ch — Character, state — CharacterState
 */
export const SUMMARY_VERSION = 1;

export function buildSummary(build, ch, state) {
    const ds = state?.deathSaves ?? {};
    return {
        v: SUMMARY_VERSION,
        name: build.name ?? '',
        level: build.level ?? 1,
        className: ch.cls?.name ?? build.classId ?? '',
        subclassName: ch.subclass?.name ?? '',
        raceName: ch.race?.name ?? build.raceId ?? '',
        subraceName: ch.subrace?.name ?? '',
        icon: build.portrait || ch.subrace?.image || ch.race?.image || '',

        ac: ch.ac,
        initiative: ch.initiative,
        speed: ch.speed,
        prof: ch.prof,

        hp: state ? state.currentHp(ch) : ch.maxHp,
        maxHp: ch.maxHp,
        temp: state?.tempHp ?? 0,
        deathSaves: { success: ds.success ?? 0, fail: ds.fail ?? 0 },
        conditions: [...(state?.conditions ?? [])],
        inspiration: !!state?.inspiration,

        mods: { ...ch.mods },
        scores: { ...(build.totalAbilities ?? {}) },
        saves: (ch.saves ?? []).map((s) => ({ key: s.key, value: s.value, proficient: !!s.proficient })),
        skills: (ch.skills ?? []).map((s) => ({
            id: s.id,
            name: s.name,
            ability: s.ability,
            value: s.value,
            proficient: !!s.proficient,
            expertise: !!s.expertise,
        })),
        passivePerception: ch.passivePerception,
        darkvision: ch.darkvision ?? 0,

        bio: { ...(build.bio ?? {}) },
    };
}

/** A summary received over the network is usable (from a compatible app). */
export const isSummary = (s) => !!s && s.v === SUMMARY_VERSION && Number.isFinite(s.maxHp) && Array.isArray(s.saves);
