/**
 * Game events between the DM and players (sent over the LAN socket as
 * lan.Event { kind, from, to, data } — see server.svelte.js / net.go).
 *
 *   DM → player   "hp"     { op: 'damage' | 'heal' | 'temp', amount }
 *                          the player's app applies it to its CharacterState
 *   DM → player   "whisper" { text }
 *                          a private message: shown to that player as a popup
 *                          until they close it
 *   DM → player   "give"   { kind: 'item' | 'armor' | 'weapon', id, name, qty }
 *                          a named item from the catalog: the player's app adds it to
 *                          the backpack (build.equipment.bag) and saves it in its DB
 *   DM → all      "encounter" { active, name, line: [{ id, kind, name, image, type, playerId }] }
 *                          the initiative line (names, icons, order — no HP), see combat.svelte.js
 *   player → DM   "state"  { state: CharacterState JSON }
 *                          sent on join and after every state change (from the DM
 *                          or the player's own sheet), so the DM's card stays current
 *
 * The player's app owns the character state; the DM only asks for changes.
 */
import { SendGameEvent, GetCharacter, SaveCharacter } from './api.js';
import { CharacterBuild } from './models/CharacterBuild.svelte.js';

export const EV = {
    HP: 'hp',
    STATE: 'state',
    WHISPER: 'whisper',
    GIVE: 'give',
};

/** catalog list for an item kind (refs.catalog) */
const CATALOG_LIST = { item: 'items', armor: 'armor', weapon: 'weapons' };

/** Named items only: built-in, not the default gear, not custom (custom ones exist only on the DM's machine). */
export const isNamedItem = (x) => x?.isDefault === false && !x?.data?.custom;

/** refs.catalog → the same shape with named items only. */
export function namedCatalog(catalog) {
    const out = {};
    for (const list of Object.values(CATALOG_LIST)) out[list] = (catalog?.[list] ?? []).filter(isNamedItem);
    return out;
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

/** DM: give a player a catalog item (it lands in their backpack). */
export function sendGive(playerId, kind, item, qty = 1) {
    return SendGameEvent(EV.GIVE, playerId, JSON.stringify({ kind, id: item.id, name: item.name, qty }));
}

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
    const qty = Math.max(1, Math.floor(Number(data?.qty) || 1));
    const item = findItem(catalog, kind, data?.id);
    if (!item) throw new Error(`unknown item “${data?.name ?? data?.id}” — update the app?`);
    const build = CharacterBuild.fromJSON(await GetCharacter(characterId));
    build.addToBag(kind, item.id, qty);
    await SaveCharacter(JSON.stringify(build));
    return { item, qty };
}

/** Player: report the current state to the DM. */
export function sendState(state) {
    return SendGameEvent(EV.STATE, '', JSON.stringify({ state }));
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
