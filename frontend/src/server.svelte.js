/**
 * Local-network game state (Go side: package lan, net.go).
 *
 * `server` mirrors lan.Status and is kept current by the "net:status" event:
 *   role:     null | 'host' | 'player'
 *   state:    'disconnected' | 'connecting' | 'connected'
 *   localIp:  this machine's LAN address ('' if offline)
 *   game:     { id, name, host, port, players } | null
 *   playerId: own id in the game (player)
 *   characterId: the character the player joined with (player)
 *   players:  [{ id, characterId, name, className, level, portrait, online }]
 *   error:    why the last session ended, if not by the user
 *
 * `discovered.games` is the list of games found on the network ("net:games"),
 * filled while StartDiscovery() is running.
 */
import { Events } from '@wailsio/runtime';
import { NetStatus } from './api.js';

export const server = $state({
    role: null,
    state: 'disconnected',
    localIp: '',
    game: null,
    playerId: '',
    characterId: '',
    players: [],
    error: '',
});

export const discovered = $state({ games: [] });

export const STATUS_LABELS = {
    disconnected: 'Not connected',
    connecting: 'Connecting…',
    connected: 'Connected',
};

/** Applies a lan.Status object from Go. */
export function applyStatus(st) {
    if (!st) return;
    server.role = st.role || null;
    server.state = st.state || 'disconnected';
    server.localIp = st.localIp || '';
    server.game = st.game ?? null;
    server.playerId = st.playerId || '';
    server.characterId = st.characterId || '';
    server.players = st.players ?? [];
    server.error = st.error || '';
}

/** Address to dictate / type: "ip:port". */
export const gameAddress = (g) => (g ? `${g.host}:${g.port}` : '');

// Go emits one value per event; older runtimes wrap it in an array.
const unwrap = (d) => (Array.isArray(d) && d.length === 1 ? d[0] : d);

const gameEventHandlers = new Set();

/** Subscribes to game events ({ kind, from, to, data }); returns an unsubscribe function. */
export function onGameEvent(fn) {
    gameEventHandlers.add(fn);
    return () => gameEventHandlers.delete(fn);
}

let started = false;

/** Called once at startup (main.js). */
export async function initNet() {
    if (started) return;
    started = true;
    Events.On('net:status', (e) => applyStatus(unwrap(e.data)));
    Events.On('net:games', (e) => (discovered.games = unwrap(e.data)?.games ?? []));
    Events.On('net:event', (e) => {
        const ev = unwrap(e.data);
        for (const fn of gameEventHandlers) {
            try {
                fn(ev);
            } catch (err) {
                console.error('[net:event]', err);
            }
        }
    });
    try {
        applyStatus(await NetStatus());
    } catch (e) {
        console.error('[net]', e);
    }
}
