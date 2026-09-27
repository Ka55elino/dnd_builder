/**
 * Backend calls (Wails bindings) with the query loader.
 *
 * Import backend methods from here, not from wailsjs directly:
 *   import { GetRaces } from '../api.js';
 * Every call shows the loader overlay while the SQL query runs.
 * New methods are picked up automatically after `wails dev` regenerates the bindings;
 * only add their name to the export list below.
 */
import * as App from '../wailsjs/go/main/App.js';
import { track } from './loader.svelte.js';

// no overlay: Ready waits behind the startup loader, state autosave has its own indicator
const SILENT = new Set(['Ready', 'SaveCharacterState']);

const api = {};
for (const [name, fn] of Object.entries(App)) {
    api[name] = SILENT.has(name) ? fn : (...args) => track(fn(...args));
}

export const {
    Ready,
    DeleteCustomEquipment,
    DeleteCustomSpell,
    GetBackgrounds,
    GetCatalog,
    GetCharacter,
    GetCharacterState,
    GetClasses,
    GetEquipment,
    GetFeats,
    GetRaces,
    GetSpells,
    ListCharacters,
    SaveCharacter,
    SaveCharacterState,
    SaveCustomEquipment,
    SaveCustomSpell,
} = api;

export default api;
