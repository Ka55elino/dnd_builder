/**
 * Backend calls (Wails bindings) with the query loader.
 *
 * Import backend methods from here, not from the generated bindings directly:
 *   import { GetRaces } from '../api.js';
 * Every call shows the loader overlay while the SQL query runs.
 * The bindings (frontend/bindings) are generated from the Go App service by
 * `wails3 dev` / `wails3 build` (or `wails3 generate bindings`). New methods are
 * picked up automatically; only add their name to the export list below.
 */
import * as App from '../bindings/dnd-builder-v3/app.js';
import { track } from './loader.svelte.js';

// no overlay: Ready waits behind the startup loader, state autosave has its own indicator
// Network: status/discovery/events are frequent and instant; HostGame/JoinGame keep the overlay.
const SILENT = new Set([
    'Ready',
    'SaveCharacterState',
    'NetStatus',
    'StartDiscovery',
    'StopDiscovery',
    'SendGameEvent',
    'SaveTextFile', // system dialogs: the user takes their time, no loader over them
    'OpenTextFile',
]);

const api = {};
for (const [name, fn] of Object.entries(App)) {
    if (typeof fn !== 'function') continue;
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
    GetConditions,
    SaveCustomCondition,
    DeleteCustomCondition,
    ListCharacters,
    SaveCharacter,
    SaveCharacterState,
    SaveCustomEquipment,
    SaveCustomSpell,
    // files: save / open through the system dialogs (files.go)
    SaveTextFile,
    OpenTextFile,
    // bestiary (bestiary.go)
    GetMonsters,
    SaveCustomMonster,
    DeleteCustomMonster,
    GetEncounters,
    SaveEncounter,
    DeleteEncounter,
    // local-network game (net.go)
    NetStatus,
    HostGame,
    StopGame,
    StartDiscovery,
    StopDiscovery,
    JoinGame,
    LeaveGame,
    SendGameEvent,
    GetPlayerCharacter,
} = api;

export default api;
