/**
 * Reference data from the DB as one object, cached for the app's lifetime.
 *
 *   const refs = await loadRefs();
 *   refs.races, refs.classes, refs.eq, refs.backgrounds, refs.feats, refs.spells
 *
 * Reference data loads once. Exceptions are equipment and spells:
 * the user can add their own, then refreshCatalog() / refreshSpells().
 */
import {
    GetBackgrounds,
    GetCatalog,
    GetClasses,
    GetEquipment,
    GetFeats,
    GetRaces,
    GetSpells,
} from '../../wailsjs/go/main/App.js';

let cache = null;

export function loadRefs() {
    cache ??= Promise.all([
        GetRaces(),
        GetClasses(),
        GetEquipment(),
        GetBackgrounds(),
        GetFeats(),
        GetSpells(),
        GetCatalog(),
    ])
        .then(([races, classes, eq, backgrounds, feats, spells, catalog]) => ({
            races,
            classes,
            eq,
            backgrounds,
            feats,
            spells,
            catalog, // all equipment, including named items: { weapons, armor, items }
        }))
        .catch((e) => {
            cache = null; // the next attempt reloads
            throw e;
        });
    return cache;
}

/** Re-read the equipment catalog from the DB (after saving/deleting a custom one). */
export async function refreshCatalog() {
    const refs = await loadRefs();
    refs.catalog = await GetCatalog();
    return refs.catalog;
}

/** Re-read spells and abilities from the DB (after saving/deleting a custom one). */
export async function refreshSpells() {
    const refs = await loadRefs();
    refs.spells = await GetSpells();
    return refs.spells;
}

export const EMPTY_REFS = {
    races: [],
    classes: [],
    eq: { armor: [], weapons: [], items: [], packs: [] },
    backgrounds: [],
    feats: [],
    spells: [],
    catalog: { weapons: [], armor: [], items: [] },
};
