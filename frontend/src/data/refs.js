/**
 * Справочники из БД одним объектом, с кэшем на время работы приложения.
 *
 *   const refs = await loadRefs();
 *   refs.races, refs.classes, refs.eq, refs.backgrounds, refs.feats, refs.spells
 *
 * Справочники грузятся один раз. Исключение — снаряжение и заклинания:
 * пользователь может добавлять своё, тогда refreshCatalog() / refreshSpells().
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
            catalog, // всё снаряжение, включая именное: { weapons, armor, items }
        }))
        .catch((e) => {
            cache = null; // следующая попытка загрузит заново
            throw e;
        });
    return cache;
}

/** Перечитать каталог снаряжения из БД (после сохранения/удаления своего). */
export async function refreshCatalog() {
    const refs = await loadRefs();
    refs.catalog = await GetCatalog();
    return refs.catalog;
}

/** Перечитать заклинания и способности из БД (после сохранения/удаления своего). */
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
