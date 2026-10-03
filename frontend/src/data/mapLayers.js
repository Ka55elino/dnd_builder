/**
 * Campaign map layers — what the editor (MapEditor) and the game view (MapView) share.
 *
 * A layer is the map of a location (key: the location id) or of an encounter
 * (key: "encounter:<id>"). On a location's map stand its direct child locations, its NPCs
 * and its encounters ("one level"); markers are keyed "location:id" | "npc:id" | "encounter:id".
 */
import { NPC_ATTITUDES } from './campaigns.js';

/** A layer key → the owner of its map: { type: 'location' | 'encounter', id }. */
export const layerOwner = (key) =>
    key.startsWith('encounter:') ? { type: 'encounter', id: key.slice(10) } : { type: 'location', id: key };

/** The layer key of a map owner. */
export const layerKey = (ownerType, ownerId) => (ownerType === 'encounter' ? `encounter:${ownerId}` : ownerId);

const TYPE_ICON = {
    region: '⛰', settlement: '🏘', district: '🏘', building: '🏠', room: '🚪',
    dungeon: '🕳', wilderness: '🌲', landmark: '🗿', plane: '🌀',
};
/** A location's icon by its type. */
export const typeIcon = (l) => TYPE_ICON[String(l?.type ?? '').toLowerCase()] ?? '📍';

/** NPC markers: the ring shows the attitude towards the party. */
export const ATTITUDE_RING = { hostile: '#c0392b', unfriendly: '#d68a2e', neutral: '#9a8f80', friendly: '#4f9a4f', ally: '#c9a35a' };
export const ENCOUNTER_RING = '#c0392b';

const attName = (a) => NPC_ATTITUDES.find((x) => x.id === a)?.name ?? '';
export const monsterCount = (e) => (e?.monsters ?? []).reduce((n, m) => n + (Number(m.count) || 0), 0);

const byName = (a, b) => a.name.localeCompare(b.name);

/**
 * What may stand on a location's map: [{ key, type, id, name, icon, image?, ring?, sub? }].
 * An encounter's map (or an unknown layer) — nothing.
 */
export function placeablesOf(layer, { locations = [], npcs = [], encounters = [] }) {
    if (!layer || layer.startsWith('encounter:')) return [];
    return [
        ...locations
            .filter((l) => l.parentId === layer)
            .sort(byName)
            .map((l) => ({ key: `location:${l.id}`, type: 'location', id: l.id, name: l.name, icon: typeIcon(l) })),
        ...npcs
            .filter((n) => n.locationId === layer)
            .sort(byName)
            .map((n) => ({
                key: `npc:${n.id}`,
                type: 'npc',
                id: n.id,
                name: n.name,
                icon: n.status === 'dead' ? '💀' : '🧑',
                image: n.portrait || '',
                ring: ATTITUDE_RING[n.attitude] ?? null,
                sub: [n.role, attName(n.attitude)].filter(Boolean).join(' · '),
            })),
        ...encounters
            .filter((e) => e.locationId === layer)
            .sort(byName)
            .map((e) => ({
                key: `encounter:${e.id}`,
                type: 'encounter',
                id: e.id,
                name: e.name,
                icon: '⚔',
                ring: ENCOUNTER_RING,
                sub: `${monsterCount(e)} creature${monsterCount(e) === 1 ? '' : 's'}`,
            })),
    ];
}

/** The canvas markers of the placed things: placed — { "type:id": "x,y" }. */
export function markersOf(placeables, placed) {
    return placeables
        .filter((t) => placed?.[t.key])
        .map((t) => {
            const [x, y] = placed[t.key].split(',').map(Number);
            return { id: t.key, kind: t.type, x, y, icon: t.icon, image: t.image, ring: t.ring, label: t.name };
        });
}

/** A map from the database (GetMapLayer) → { "type:id": "x,y" }. */
export const placedOf = (layer) =>
    Object.fromEntries((layer?.markers ?? []).map((k) => [`${k.refType}:${k.refId}`, `${k.x},${k.y}`]));

/** The chain of locations from the top down to `loc`: Region › City › Building. */
export function pathTo(loc, byId) {
    const out = [];
    for (let l = loc; l && !out.includes(l); l = byId.get(l.parentId)) out.unshift(l);
    return out;
}
