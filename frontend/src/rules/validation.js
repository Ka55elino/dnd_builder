/**
 * Character validation before saving.
 *
 * validateBuild(build, { races }) → [{ tab, message }]
 *   tab — builder tab index (see BUILDER_TABS), to highlight it
 *   and navigate on click.
 *
 * The subclass is NOT checked: it is chosen at level 3 and is currently
 * informational only.
 */
import { ABILITY_KEYS, ABILITIES } from './abilities.js';
import { BIO_GROUPS } from '../models/CharacterBuild.svelte.js';

export const BUILDER_TABS = ['Basics', 'Abilities', 'Species', 'Class', 'Equipment'];

export const TAB = { BASICS: 0, ABILITIES: 1, RACE: 2, CLASS: 3, EQUIPMENT: 4 };

const empty = (v) => v == null || String(v).trim() === '';

export function validateBuild(build, { races = [], classes = [] } = {}) {
    const errors = [];
    const add = (tab, message) => errors.push({ tab, message });

    // --- Basics: name + all text fields ---
    if (empty(build.name)) add(TAB.BASICS, 'Name');
    for (const group of BIO_GROUPS) {
        for (const f of group.fields) {
            if (empty(build.bio?.[f.key])) add(TAB.BASICS, `${group.title}: ${f.label}`);
        }
    }

    // --- Abilities: all ability scores assigned ---
    const unset = ABILITY_KEYS.filter((k) => build.abilities?.[k] == null);
    if (unset.length) {
        add(TAB.ABILITIES, `Not assigned: ${unset.map((k) => ABILITIES[k].short).join(', ')}`);
    }

    // --- Background: chosen and bonuses assigned ---
    if (!build.backgroundId) {
        add(TAB.ABILITIES, 'No background chosen');
    } else {
        const vals = Object.values(build.backgroundBonus ?? {});
        const need = build.backgroundBonusMode === '1-1-1' ? [1, 1, 1] : [1, 2];
        const ok = vals.length === need.length && [...vals].sort().join() === need.join();
        if (!ok) {
            add(TAB.ABILITIES, build.backgroundBonusMode === '1-1-1'
                ? 'Background: choose three abilities for +1 each'
                : 'Background: assign +2 and +1');
        }
    }

    // --- Race (+ subrace, if the race has any) ---
    if (!build.raceId) {
        add(TAB.RACE, 'No species chosen');
    } else {
        const race = races.find((r) => r.id === build.raceId);
        if (race?.subraces?.length && !build.subraceId) add(TAB.RACE, 'No subspecies chosen');
    }

    // --- Class (subclass is not checked) ---
    if (!build.classId) add(TAB.CLASS, 'No class chosen');

    // --- Equipment ---
    const eq = build.equipment ?? {};
    // armor is required only if the class is trained in it (wizard, sorcerer, monk — no armor)
    const cls = classes.find((c) => c.id === build.classId);
    const armorless = cls && !(cls.data?.armorTraining ?? []).some((a) => a !== 'shield');
    if (!eq.armorId && !armorless) add(TAB.EQUIPMENT, 'No armor chosen');
    if (!eq.weaponIds?.length) add(TAB.EQUIPMENT, 'No weapon chosen');
    if (!eq.packId) add(TAB.EQUIPMENT, 'No equipment pack chosen');

    return errors;
}
