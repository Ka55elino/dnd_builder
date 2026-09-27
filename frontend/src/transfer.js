/**
 * Character export / import as a JSON file.
 *
 * The file is self-contained, so it opens on another computer or in another
 * copy of the app:
 *
 *   {
 *     "format": "dnd-builder-character", "version": 1,
 *     "appVersion": "0.3.2", "exportedAt": "2026-09-28T12:00:00Z",
 *     "character": { …the build… },          // portrait as a data URL if it was uploaded
 *     "state": { …Hit Points, resources… },   // or null
 *     "custom": {                             // custom records the character uses
 *       "equipment": [{ "kind": "weapon", "def": { … } }],
 *       "spells":    [{ … }]
 *     }
 *   }
 *
 * Import adds the character (a character with the same id already here → the
 * import becomes a copy with a new id), then the custom records it needs that
 * are missing here. Records that already exist here are left as they are.
 */
import {
    GetCharacter,
    GetCharacterState,
    ListCharacters,
    SaveCharacter,
    SaveCharacterState,
    SaveTextFile,
    OpenTextFile,
    NetStatus,
} from './api.js';
import { loadRefs, saveCustomEquipment, saveCustomSpell } from './data/refs.js';
import { findItem, imageData } from './game.js';
import { equipmentDefinition, spellDefinition } from './homebrew.js';

export const CHARACTER_FORMAT = 'dnd-builder-character';
export const CHARACTER_FORMAT_VERSION = 1;

const KINDS = { weapon: 'weapons', armor: 'armor', item: 'items' };

/** Every "custom_…" id the build refers to (equipment, backpack, spell choices…). */
function customIds(build) {
    const ids = new Set();
    const walk = (v) => {
        if (typeof v === 'string') {
            if (v.startsWith('custom_')) ids.add(v);
        } else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(build);
    return ids;
}

/** The export file for a character (an object; see the format above). */
export async function characterFile(id) {
    const [build, state, refs, status] = await Promise.all([
        GetCharacter(id),
        GetCharacterState(id).catch(() => null),
        loadRefs(),
        NetStatus().catch(() => null),
    ]);
    const character = { ...build };
    const portrait = await imageData(character.portrait); // an uploaded portrait exists only in this DB
    if (portrait) character.portrait = portrait;

    const equipment = [];
    const spells = [];
    for (const cid of customIds(build)) {
        let found = false;
        for (const [kind, list] of Object.entries(KINDS)) {
            const x = (refs.catalog?.[list] ?? []).find((r) => r.id === cid && r.data?.custom);
            if (x) {
                equipment.push({ kind, def: await equipmentDefinition(x) });
                found = true;
                break;
            }
        }
        if (found) continue;
        const sp = (refs.spells ?? []).find((s) => s.id === cid && s.data?.custom);
        if (sp) spells.push(spellDefinition(sp));
    }

    return {
        format: CHARACTER_FORMAT,
        version: CHARACTER_FORMAT_VERSION,
        appVersion: status?.appVersion ?? '',
        exportedAt: new Date().toISOString(),
        character,
        state: state ?? null,
        custom: { equipment, spells },
    };
}

/** Export: ask where to save and write the file. Returns the path, or "" if cancelled. */
export async function exportCharacter(id) {
    const file = await characterFile(id);
    const name = `${file.character.name || 'character'} (level ${file.character.level ?? 1})`;
    return SaveTextFile(name, JSON.stringify(file, null, 2));
}

/** Checks an import file; returns the parsed object or throws an understandable error. */
export function parseCharacterFile(text) {
    let f;
    try {
        f = JSON.parse(text);
    } catch {
        throw new Error("This isn't a character file (not valid JSON).");
    }
    if (f?.format !== CHARACTER_FORMAT) throw new Error("This isn't a DnD Builder character file.");
    if (!(f.version >= 1) || f.version > CHARACTER_FORMAT_VERSION) {
        throw new Error(`The file is from a newer app (format ${f.version}) — update DnD Builder to open it.`);
    }
    const c = f.character;
    if (!c || typeof c !== 'object' || !String(c.name ?? '').trim()) throw new Error('The file has no character in it.');
    if (!c.raceId || !c.classId) throw new Error('The character in the file has no species or class.');
    return f;
}

/**
 * Import a file's text. Returns { id, name, copy, added: { equipment, spells },
 * missing: [names of species/class/… this app doesn't know], appVersion }.
 */
export async function importCharacterText(text) {
    const f = parseCharacterFile(text);
    let refs = await loadRefs();

    // 1. custom records the character needs, if missing here
    const added = { equipment: 0, spells: 0 };
    for (const e of f.custom?.equipment ?? []) {
        if (!KINDS[e?.kind] || !e.def?.id || findItem(refs.catalog, e.kind, e.def.id)) continue;
        await saveCustomEquipment(e.kind, e.def);
        added.equipment++;
    }
    for (const def of f.custom?.spells ?? []) {
        if (!def?.id || (refs.spells ?? []).some((s) => s.id === def.id)) continue;
        await saveCustomSpell(def);
        added.spells++;
    }
    refs = await loadRefs();

    // 2. the character: a copy if the same character is already here
    const character = { ...f.character };
    const existing = await ListCharacters();
    const copy = existing.some((c) => c.id === character.id);
    if (copy || !character.id) {
        character.id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        if (copy) character.name = `${character.name} (imported)`;
    }
    const id = await SaveCharacter(JSON.stringify(character));
    if (f.state && typeof f.state === 'object') await SaveCharacterState(id, JSON.stringify(f.state));

    // 3. what this app doesn't know (another version / someone else's homebrew species or class)
    const missing = [];
    const race = refs.races?.find((r) => r.id === character.raceId);
    if (!race) missing.push(`species “${character.raceId}”`);
    else if (character.subraceId && !race.subraces?.some((s) => s.id === character.subraceId)) missing.push(`subspecies “${character.subraceId}”`);
    const cls = refs.classes?.find((c) => c.id === character.classId);
    if (!cls) missing.push(`class “${character.classId}”`);
    else if (character.subclassId && !cls.subclasses?.some((s) => s.id === character.subclassId)) missing.push(`subclass “${character.subclassId}”`);

    return { id, name: character.name, copy, added, missing, appVersion: f.appVersion ?? '' };
}

/** Import: ask for a file and import it. Returns the result (see above), or null if cancelled. */
export async function importCharacter() {
    const text = await OpenTextFile('Import a character');
    if (!text) return null;
    return importCharacterText(text);
}
