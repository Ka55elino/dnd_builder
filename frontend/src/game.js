/**
 * Game events between the DM and players (sent over the LAN socket as
 * lan.Event { kind, from, to, data } — see server.svelte.js / net.go).
 *
 *   DM → player   "hp"     { op: 'damage' | 'heal' | 'temp', amount }
 *                          the player's app applies it to its CharacterState
 *   DM → player   "whisper" { text }
 *                          a private message: shown to that player as a popup
 *                          until they close it
 *   DM → player   "give"   { kind: 'item' | 'armor' | 'weapon', id, name, qty, def? }
 *                          a named or the DM's own (custom) item: the player's app adds it to
 *                          the backpack (build.equipment.bag) and saves it in its DB.
 *                          def — for a custom item, its full record (image as a data URL):
 *                          the player's app saves it as its own custom record with the same
 *                          id (marked fromDM), so giving it again updates it, not duplicates
 *   DM → all      "encounter" { active, name, line: [{ id, kind, name, image, type, playerId }] }
 *                          the initiative line (names, icons, order — no HP), see combat.svelte.js
 *   player → DM   "state"  { state: CharacterState JSON, summary }
 *                          sent on join and after every state change (from the DM
 *                          or the player's own sheet), so the DM's card stays current;
 *                          summary — the sheet as the player's app computed it
 *                          (rules/summary.js): the DM shows it as is
 *
 * The player's app owns the character state; the DM only asks for changes.
 */
import { SendGameEvent, GetCharacter, SaveCharacter } from './api.js';
import { loadRefs, saveCustomEquipment } from './data/refs.js';
import { CharacterBuild } from './models/CharacterBuild.svelte.js';

export const EV = {
    HP: 'hp',
    STATE: 'state',
    WHISPER: 'whisper',
    GIVE: 'give',
};

/** catalog list for an item kind (refs.catalog) */
const CATALOG_LIST = { item: 'items', armor: 'armor', weapon: 'weapons' };

/** Named items only: built-in, not the default gear, not custom. */
export const isNamedItem = (x) => x?.isDefault === false && !x?.data?.custom;

/** The DM's own (custom) items: exist only in the DM's DB — the gift carries their definition. */
export const isCustomItem = (x) => !!x?.data?.custom;

/** What the DM can give: named items and their own custom ones (not the default gear). */
export const isGiftable = (x) => isNamedItem(x) || isCustomItem(x);

/** refs.catalog → the same shape with the giftable items only. */
export function giftCatalog(catalog) {
    const out = {};
    for (const list of Object.values(CATALOG_LIST)) out[list] = (catalog?.[list] ?? []).filter(isGiftable);
    return out;
}

/** @deprecated — named items only; use giftCatalog */
export function namedCatalog(catalog) {
    const out = {};
    for (const list of Object.values(CATALOG_LIST)) out[list] = (catalog?.[list] ?? []).filter(isNamedItem);
    return out;
}

/** An image URL as a data URL (images uploaded to the DM's DB don't exist on the player's machine). */
export async function imageData(url) {
    if (!url || url.startsWith('data:') || !url.startsWith('/img/db/')) return url || undefined; // built-in images exist everywhere
    try {
        const blob = await (await fetch(url)).blob();
        return await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => reject(r.error);
            r.readAsDataURL(blob);
        });
    } catch {
        return undefined; // no picture is better than no gift
    }
}

/**
 * A catalog record back in assets/data format (what SaveCustomEquipment takes):
 * the stored data plus the columns kept outside it.
 */
export async function itemDefinition(item) {
    const d = { ...(item.data ?? {}) };
    delete d.custom; // set again when the player's app saves it
    const def = { ...d, id: item.id, name: item.name, fromDM: true };
    for (const k of ['category', 'damage', 'damageType', 'baseAC', 'weight', 'cost', 'desc']) {
        if (item[k] !== undefined && item[k] !== null && item[k] !== '') def[k] = item[k];
    }
    const image = await imageData(item.image);
    if (image) def.image = image;
    else delete def.image;
    return def;
}

/** Find an item in refs.catalog by kind + id. */
export const findItem = (catalog, kind, id) =>
    (catalog?.[CATALOG_LIST[kind]] ?? []).find((x) => x.id === id) ?? null;

/** Longest whisper accepted (characters). */
export const WHISPER_MAX = 2000;

export const HP_OPS = ['damage', 'heal', 'temp'];

/** DM: ask a player's app to change Hit Points. */
export function sendHp(playerId, op, amount) {
    return SendGameEvent(EV.HP, playerId, JSON.stringify({ op, amount }));
}

/** DM: whisper a private message to one player. */
export function sendWhisper(playerId, text) {
    return SendGameEvent(EV.WHISPER, playerId, JSON.stringify({ text: String(text).slice(0, WHISPER_MAX) }));
}

/** DM: give a player a catalog item (it lands in their backpack). Custom items carry their definition. */
export async function sendGive(playerId, kind, item, qty = 1) {
    const data = { kind, id: item.id, name: item.name, qty };
    if (isCustomItem(item)) data.def = await itemDefinition(item);
    return SendGameEvent(EV.GIVE, playerId, JSON.stringify(data));
}

/** Player: fired after a gift is stored — { kind, id, qty } (the open sheet shows it in the backpack). */
export const giftEvents = new EventTarget();

/**
 * Player: stores a "give" event in the local DB — adds the item to the
 * character's backpack (the same place the "Give Item" page uses).
 * Checks the item exists in this app's catalog. Returns the catalog item.
 */
let giftQueue = Promise.resolve();

export function storeGift(characterId, data, catalog) {
    // one at a time: each gift reads the build, adds to it and saves it back
    const run = giftQueue.then(() => storeGiftNow(characterId, data, catalog));
    giftQueue = run.catch(() => {});
    return run;
}

async function storeGiftNow(characterId, data, catalog) {
    const kind = data?.kind;
    if (!CATALOG_LIST[kind]) throw new Error(`unknown item kind “${kind}”`);
    const qty = Math.max(1, Math.floor(Number(data?.qty) || 1));
    let item = findItem(catalog, kind, data?.id);

    // the DM's own item: save its definition as a custom record here (same id →
    // a second gift updates it instead of making a copy). Built-in records are never overwritten.
    if (data?.def && (!item || isCustomItem(item))) {
        if (data.def.id !== data.id) throw new Error('the item definition does not match the gift');
        await saveCustomEquipment(kind, { ...data.def, fromDM: true });
        item = findItem((await loadRefs()).catalog, kind, data.id);
    }
    if (!item) throw new Error(`unknown item “${data?.name ?? data?.id}” — update the app?`);

    const build = CharacterBuild.fromJSON(await GetCharacter(characterId));
    build.addToBag(kind, item.id, qty);
    await SaveCharacter(JSON.stringify(build));
    giftEvents.dispatchEvent(new CustomEvent('stored', { detail: { kind, id: item.id, qty } }));
    return { item, qty };
}

/**
 * Player: report the current state to the DM, with the summary this app computed
 * (rules/summary.js) — the DM shows it instead of recomputing the sheet.
 */
export function sendState(state, summary = null) {
    return SendGameEvent(EV.STATE, '', JSON.stringify(summary ? { state, summary } : { state }));
}

/**
 * Player: applies an "hp" event to a CharacterState (same rules as the
 * buttons on the character sheet). Returns true if something was applied.
 */
export function applyHp(state, character, data) {
    const n = Math.floor(Number(data?.amount));
    if (!state || !character || !Number.isFinite(n) || n < 0) return false;
    switch (data?.op) {
        case 'damage':
            state.damage(n, character);
            return true;
        case 'heal':
            state.heal(n, character);
            return true;
        case 'temp':
            state.setTempHp(n);
            return true;
    }
    return false;
}
