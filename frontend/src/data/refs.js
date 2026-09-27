/**
 * Reference data from the DB as one object, cached for the app's lifetime.
 *
 *   const refs = await loadRefs();
 *   refs.races, refs.classes, refs.eq, refs.backgrounds, refs.feats, refs.spells
 *
 * Reference data loads once. Exceptions are equipment and spells: the user can
 * add their own. Save/delete them only through saveCustom… / deleteCustom… below —
 * they write to the DB and reload the matching part of the cache right away,
 * so every screen (builder, character sheet, reference pages) sees the change.
 */
import {
    DeleteCustomEquipment,
    DeleteCustomSpell,
    GetBackgrounds,
    GetCatalog,
    GetClasses,
    GetEquipment,
    GetFeats,
    GetRaces,
    GetSpells,
    SaveCustomEquipment,
    SaveCustomSpell,
} from '../api.js';

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

/** Re-read equipment from the DB: the catalog (all) and the builder list (eq, defaults only). */
export async function refreshEquipment() {
    const refs = await loadRefs();
    const [catalog, eq] = await Promise.all([GetCatalog(), GetEquipment()]);
    refs.catalog = catalog;
    refs.eq = eq;
    return refs.catalog;
}

/** @deprecated use refreshEquipment */
export const refreshCatalog = refreshEquipment;

/** Re-read spells and abilities from the DB. */
export async function refreshSpells() {
    const refs = await loadRefs();
    refs.spells = await GetSpells();
    return refs.spells;
}

/** Create/update custom equipment (kind: weapon | armor | item) and reload the equipment cache. Returns the id. */
export async function saveCustomEquipment(kind, json) {
    const id = await SaveCustomEquipment(kind, typeof json === 'string' ? json : JSON.stringify(json));
    await refreshEquipment();
    return id;
}

/** Delete custom equipment and reload the equipment cache. */
export async function deleteCustomEquipment(kind, id) {
    await DeleteCustomEquipment(kind, id);
    await refreshEquipment();
}

/** Create/update a custom spell and reload the spell cache. Returns the id. */
export async function saveCustomSpell(json) {
    const id = await SaveCustomSpell(typeof json === 'string' ? json : JSON.stringify(json));
    await refreshSpells();
    return id;
}

/** Delete a custom spell and reload the spell cache. */
export async function deleteCustomSpell(id) {
    await DeleteCustomSpell(id);
    await refreshSpells();
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
