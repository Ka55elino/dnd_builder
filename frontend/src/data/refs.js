/**
 * Reference data from the DB as one object, cached for the app's lifetime.
 *
 *   const refs = await loadRefs();
 *   refs.races, refs.classes, refs.eq, refs.backgrounds, refs.feats, refs.spells, refs.conditions
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
    GetConditions,
    SaveCustomCondition,
    DeleteCustomCondition,
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
        // conditions (Prone, Exhaustion…): an app built before the binding existed has no method
        GetConditions ? GetConditions().catch(() => []) : Promise.resolve([]),
    ])
        .then(([races, classes, eq, backgrounds, feats, spells, catalog, conditions]) => ({
            races,
            classes,
            eq,
            backgrounds,
            feats,
            spells,
            catalog, // all equipment, including named items: { weapons, armor, items }
            conditions: conditions ?? [], // conditions and named effects (rules/modifiers.js)
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

/** Re-read conditions from the DB. */
export async function refreshConditions() {
    const refs = await loadRefs();
    refs.conditions = GetConditions ? await GetConditions() : [];
    return refs.conditions;
}

/** Create/update a custom condition (assets/data/conditions format) and reload the cache. Returns the id. */
export async function saveCustomCondition(json) {
    if (!SaveCustomCondition) throw new Error('Update the app: this version cannot save conditions.');
    const id = await SaveCustomCondition(typeof json === 'string' ? json : JSON.stringify(json));
    await refreshConditions();
    return id;
}

/** Delete a custom condition and reload the cache. */
export async function deleteCustomCondition(id) {
    await DeleteCustomCondition(id);
    await refreshConditions();
}

export const EMPTY_REFS = {
    races: [],
    classes: [],
    eq: { armor: [], weapons: [], items: [], packs: [] },
    backgrounds: [],
    feats: [],
    spells: [],
    catalog: { weapons: [], armor: [], items: [] },
    conditions: [],
};
