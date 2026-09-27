/**
 * Homebrew export / import: the user's own (custom) items, spells and monsters
 * in one JSON file, to move them to another computer or share them with the table.
 *
 *   {
 *     "format": "dnd-builder-homebrew", "version": 1,
 *     "appVersion": "0.3.2", "exportedAt": "2026-09-28T12:00:00Z",
 *     "equipment": [{ "kind": "weapon" | "armor" | "item", "def": { … } }],
 *     "spells":    [{ … }],
 *     "monsters":  [{ … }]
 *   }
 *
 * Every def is in assets/data format (what SaveCustom* takes), pictures as data URLs.
 * Records keep their ids ("custom_…"), so importing the same file again finds them:
 *   new     — not here yet → added;
 *   same    — already here, identical → nothing to do;
 *   changed — here, but different (edited on one side) → replaced only if asked;
 *   builtin — the id is a built-in record here → never touched.
 */
import { NetStatus, SaveTextFile, OpenTextFile } from './api.js';
import { loadRefs, refreshEquipment, refreshSpells, saveCustomEquipment, saveCustomSpell } from './data/refs.js';
import { loadMonsters, saveMonster } from './data/bestiary.js';
import { imageData, itemDefinition } from './game.js';

export const HOMEBREW_FORMAT = 'dnd-builder-homebrew';
export const HOMEBREW_FORMAT_VERSION = 1;

/** Equipment kind → catalog list. */
export const EQUIPMENT_KINDS = { weapon: 'weapons', armor: 'armor', item: 'items' };

export const GROUPS = ['equipment', 'spells', 'monsters'];

const isCustom = (r) => !!r?.data?.custom;

// ---------- definitions (a DB record → assets/data format) ----------

/** A spell record as returned by GetSpells → what SaveCustomSpell takes. */
export function spellDefinition(sp) {
    const def = { ...(sp.data ?? {}), id: sp.id, name: sp.name, kind: sp.kind, level: sp.level };
    delete def.custom;
    if (sp.school) def.school = sp.school;
    if (sp.action) def.action = sp.action;
    if (sp.desc) def.desc = sp.desc;
    return def;
}

/** A monster record as returned by GetMonsters → what SaveCustomMonster takes (picture as a data URL). */
export async function monsterDefinition(m) {
    const def = { ...(m.data ?? {}) }; // data.legendary is the object, not the column's flag
    delete def.custom;
    Object.assign(def, {
        id: m.id,
        name: m.name,
        type: m.type,
        size: m.size,
        cr: m.cr,
        ac: m.ac,
        hp: m.hp,
        habitats: [...(m.habitats ?? [])],
    });
    if (m.alignment) def.alignment = m.alignment;
    if (m.xp) def.xp = m.xp;
    const image = await imageData(m.image);
    if (image) def.image = image;
    else delete def.image;
    return def;
}

/** An equipment record → what SaveCustomEquipment takes. */
export async function equipmentDefinition(x) {
    const def = await itemDefinition(x);
    delete def.fromDM; // in the file it's just a homebrew record
    return def;
}

// ---------- what's here ----------

/**
 * The custom records in this app, for the export list:
 * { equipment: [{ kind, record }], spells: [record], monsters: [record] }
 */
export async function localHomebrew() {
    const [refs, monsters] = await Promise.all([loadRefs(), loadMonsters()]);
    const equipment = [];
    for (const [kind, list] of Object.entries(EQUIPMENT_KINDS)) {
        for (const record of refs.catalog?.[list] ?? []) if (isCustom(record)) equipment.push({ kind, record });
    }
    return {
        equipment,
        spells: (refs.spells ?? []).filter(isCustom),
        monsters: (monsters ?? []).filter(isCustom),
    };
}

// ---------- export ----------

/**
 * The export file for the chosen ids (a Set or array; nothing → everything custom).
 */
export async function homebrewFile(ids = null) {
    const pick = ids ? new Set(ids) : null;
    const want = (r) => !pick || pick.has(r.id);
    const [local, status] = await Promise.all([localHomebrew(), NetStatus().catch(() => null)]);
    const file = {
        format: HOMEBREW_FORMAT,
        version: HOMEBREW_FORMAT_VERSION,
        appVersion: status?.appVersion ?? '',
        exportedAt: new Date().toISOString(),
        equipment: [],
        spells: [],
        monsters: [],
    };
    for (const { kind, record } of local.equipment) {
        if (want(record)) file.equipment.push({ kind, def: await equipmentDefinition(record) });
    }
    for (const sp of local.spells) if (want(sp)) file.spells.push(spellDefinition(sp));
    for (const m of local.monsters) if (want(m)) file.monsters.push(await monsterDefinition(m));
    return file;
}

export const homebrewCount = (f) => (f?.equipment?.length ?? 0) + (f?.spells?.length ?? 0) + (f?.monsters?.length ?? 0);

/** Export: ask where to save, write the file. Returns { path, count }; path "" — cancelled. */
export async function exportHomebrew(ids = null) {
    const file = await homebrewFile(ids);
    const count = homebrewCount(file);
    if (!count) throw new Error('Nothing to export.');
    const date = file.exportedAt.slice(0, 10);
    const path = await SaveTextFile(`DnD homebrew ${date} (${count})`, JSON.stringify(file, null, 2));
    return { path, count };
}

// ---------- import ----------

/** Checks an import file; returns the parsed object or throws an understandable error. */
export function parseHomebrewFile(text) {
    let f;
    try {
        f = JSON.parse(text);
    } catch {
        throw new Error("This isn't a homebrew file (not valid JSON).");
    }
    if (f?.format === 'dnd-builder-character') {
        throw new Error('This is a character file — import it on the Characters page.');
    }
    if (f?.format !== HOMEBREW_FORMAT) throw new Error("This isn't a DnD Builder homebrew file.");
    if (!(f.version >= 1) || f.version > HOMEBREW_FORMAT_VERSION) {
        throw new Error(`The file is from a newer app (format ${f.version}) — update DnD Builder to open it.`);
    }
    const list = (x) => (Array.isArray(x) ? x : []);
    const ok = (d) => d && typeof d === 'object' && typeof d.id === 'string' && d.id && String(d.name ?? '').trim();
    const out = {
        ...f,
        equipment: list(f.equipment).filter((e) => EQUIPMENT_KINDS[e?.kind] && ok(e.def)),
        spells: list(f.spells).filter(ok),
        monsters: list(f.monsters).filter(ok),
    };
    if (!homebrewCount(out)) throw new Error('The file has no items, spells or monsters in it.');
    return out;
}

/** JSON with sorted keys, without the fields that differ only by where a record lives. */
function fingerprint(def) {
    const norm = (v) => {
        if (Array.isArray(v)) return v.map(norm);
        if (v && typeof v === 'object') {
            const o = {};
            for (const k of Object.keys(v).sort()) {
                if (v[k] === undefined || v[k] === null || v[k] === '') continue;
                o[k] = norm(v[k]);
            }
            return o;
        }
        return v;
    };
    const d = { ...def };
    for (const k of ['custom', 'fromDM', 'isDefault', 'kind']) delete d[k];
    return JSON.stringify(norm(d));
}

/**
 * What importing the file would do, record by record:
 * [{ group, kind?, def, status: 'new' | 'same' | 'changed' | 'builtin', local? }]
 * (local — this app's record with the same id)
 */
export async function planHomebrew(file) {
    const [refs, monsters] = await Promise.all([loadRefs(), loadMonsters()]);
    const plan = [];
    const status = async (local, def, toDef) => {
        if (!local) return 'new';
        if (!isCustom(local)) return 'builtin';
        return fingerprint(await toDef(local)) === fingerprint(def) ? 'same' : 'changed';
    };
    for (const { kind, def } of file.equipment) {
        const local = (refs.catalog?.[EQUIPMENT_KINDS[kind]] ?? []).find((x) => x.id === def.id);
        plan.push({ group: 'equipment', kind, def, local, status: await status(local, def, equipmentDefinition) });
    }
    for (const def of file.spells) {
        const local = (refs.spells ?? []).find((x) => x.id === def.id);
        plan.push({ group: 'spells', def, local, status: await status(local, def, spellDefinition) });
    }
    for (const def of file.monsters) {
        const local = (monsters ?? []).find((x) => x.id === def.id);
        plan.push({ group: 'monsters', def, local, status: await status(local, def, monsterDefinition) });
    }
    return plan;
}

/**
 * Save the chosen plan entries (only 'new' and 'changed' ones are saved).
 * Returns { added, updated, failed: [{ name, error }] }.
 */
export async function applyHomebrew(entries) {
    const out = { added: 0, updated: 0, failed: [] };
    let equipment = false;
    let spells = false;
    for (const e of entries) {
        if (e.status !== 'new' && e.status !== 'changed') continue;
        try {
            if (e.group === 'equipment') {
                await saveCustomEquipment(e.kind, e.def);
                equipment = true;
            } else if (e.group === 'spells') {
                await saveCustomSpell(e.def);
                spells = true;
            } else if (e.group === 'monsters') {
                await saveMonster(e.def);
            }
            if (e.status === 'new') out.added++;
            else out.updated++;
        } catch (err) {
            out.failed.push({ name: e.def.name, error: err?.message ?? String(err) });
        }
    }
    // the saves above refresh their caches already; this keeps them right if one failed midway
    if (equipment) await refreshEquipment().catch(() => {});
    if (spells) await refreshSpells().catch(() => {});
    return out;
}

/** Import step 1: ask for a file. Returns { file, plan }, or null if cancelled. */
export async function openHomebrew() {
    const text = await OpenTextFile('Import homebrew');
    if (!text) return null;
    const file = parseHomebrewFile(text);
    return { file, plan: await planHomebrew(file) };
}
