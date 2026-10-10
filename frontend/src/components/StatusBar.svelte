<script>
    /**
     * Global status header, shown on every screen:
     * the game server status (host / player / not connected) and, while
     * hosting, the "ip:port" to share — click copies it to the clipboard.
     * While in a game, ✕ ends it (DM) or leaves it (player) after a confirmation popup
     * (in-app, no OS dialog — works the same on every platform; Esc / a click outside cancels).
     * ⛶ next to the app name: full screen on / off (the window; F11 / Esc / the system
     * button work too — the icon follows the window).
     */
    import { onMount } from 'svelte';
    import { Clipboard, Window } from '@wailsio/runtime';
    import { StopGame, LeaveGame } from '../api.js';
    import { server, STATUS_LABELS, gameAddress } from '../server.svelte.js';
    import { isMobileDevice } from '../device.js';
    import { ask } from '../confirm.svelte.js';

    let inGame = $derived(!!server.role && !!server.game);
    async function askClose() {
        const host = server.role === 'host';
        const ok = await ask({
            title: host ? 'End the game?' : 'Leave the game?',
            text: host
                ? `“${server.game?.name ?? ''}” ends for everyone: the players are disconnected.`
                : `You leave “${server.game?.name ?? ''}”. You can join again from “Join Game”.`,
            ok: host ? 'End game' : 'Leave',
        });
        if (ok && inGame) close();
    }

    async function close() {
        try {
            await (server.role === 'host' ? StopGame() : LeaveGame());
        } catch (e) {
            console.error('[status-bar]', e);
        }
    }


    let address = $derived(server.role === 'host' && server.game ? gameAddress(server.game) : '');
    let copied = $state(false);
    let copiedTimer;

    async function copy() {
        try {
            await Clipboard.SetText(address);
        } catch {
            await navigator.clipboard?.writeText(address); // e.g. running in a plain browser
        }
        copied = true;
        clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => (copied = false), 1500);
    }

    const players = (n) => `${n} ${n === 1 ? 'player' : 'players'}`;

    let label = $derived.by(() => {
        const g = server.game;
        if (server.role === 'host' && g) {
            return `Hosting “${g.name}” · ${players(server.players.filter((p) => p.online).length)}`;
        }
        if (server.role === 'player' && g) {
            return server.state === 'connected' ? `Connected to “${g.name}”` : `Reconnecting to “${g.name}”…`;
        }
        return `Server: ${STATUS_LABELS[server.state] ?? STATUS_LABELS.disconnected}`;
    });

    let title = $derived(server.game ? gameAddress(server.game) : '');

    // ---------- full screen ----------
    // phones / tablets (the app or a mobile browser): no full screen button
    const mobile = isMobileDevice();
    let fullscreen = $state(false);

    // the window's state (the app: Wails; a plain browser: the Fullscreen API)
    async function readFullscreen() {
        try {
            fullscreen = !!(await Window.IsFullscreen());
        } catch {
            fullscreen = !!document.fullscreenElement;
        }
    }

    async function toggleFullscreen() {
        try {
            await Window.ToggleFullscreen();
        } catch {
            if (document.fullscreenElement) await document.exitFullscreen?.();
            else await document.documentElement.requestFullscreen?.();
        }
        // macOS animates into full screen: ask again once it is done
        setTimeout(readFullscreen, 150);
        setTimeout(readFullscreen, 900);
    }

    // left full screen another way (Esc, the green button, F11): entering / leaving
    // resizes the page, so check then
    onMount(() => {
        readFullscreen();
        let t;
        const onResize = () => {
            clearTimeout(t);
            t = setTimeout(readFullscreen, 250);
        };
        const onKey = (e) => {
            if (e.key === 'F11') {
                e.preventDefault();
                toggleFullscreen();
            }
        };
        window.addEventListener('resize', onResize);
        window.addEventListener('keydown', onKey);
        document.addEventListener('fullscreenchange', readFullscreen);
        return () => {
            clearTimeout(t);
            window.removeEventListener('resize', onResize);
            window.removeEventListener('keydown', onKey);
            document.removeEventListener('fullscreenchange', readFullscreen);
        };
    });
</script>

<header class="status-bar">
    <span class="app">D&D Builder</span>
    {#if !mobile}
        <button
            class="fs"
            class:on={fullscreen}
            onclick={toggleFullscreen}
            title={fullscreen ? 'Exit full screen (F11)' : 'Full screen (F11)'}
            aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
            aria-pressed={fullscreen}
        >
            {#if fullscreen}
                <!-- arrows in: leave full screen -->
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" /></svg>
            {:else}
                <!-- arrows out: full screen -->
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" /></svg>
            {/if}
        </button>
    {/if}

    <span class="server {server.state}" {title}>
        <span class="dot" aria-hidden="true"></span>
        <!-- its own element: a long game name ends in "…" instead of widening the page -->
        <span class="label">{label}</span>
    </span>

    {#if address}
        <button class="ip" class:copied onclick={copy} title="Click to copy — players type this address in “Join Game”">
            {copied ? 'Copied!' : address}
        </button>
    {/if}

    {#if inGame}
        <button
            class="close"
            onclick={askClose}
            title={server.role === 'host' ? 'End the game' : 'Leave the game'}
            aria-label={server.role === 'host' ? 'End the game' : 'Leave the game'}>✕</button
        >
    {/if}
</header>


<style>
    .status-bar {
        height: 32px;
        padding: 0 16px;
        display: flex;
        align-items: center;
        gap: 16px;
        background: var(--color-sidebar);
        border-bottom: 1px solid var(--color-border);
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-muted);
        user-select: none;
        white-space: nowrap;
        overflow: hidden; /* nothing in the bar may widen the page */
    }

    .app {
        flex: none;
        font-family: var(--font-heading);
        font-weight: var(--font-weight-semibold);
        letter-spacing: 0.04em;
        color: var(--color-text-secondary);
    }

    .fs {
        width: 22px;
        height: 22px;
        margin-left: -10px; /* close to the name */
        padding: 0;
        display: grid;
        place-items: center;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 4px;
        color: var(--color-text-muted);
        cursor: pointer;
    }

    .fs svg {
        width: 13px;
        height: 13px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.6;
        stroke-linecap: round;
        stroke-linejoin: round;
    }

    .fs:hover,
    .fs.on {
        color: var(--color-gold);
    }

    .fs:hover {
        border-color: var(--color-border);
    }

    .ip {
        flex: none; /* the game name shrinks, not this */
        padding: 2px 8px;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 4px;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        cursor: pointer;
        transition: border-color 0.15s, color 0.15s;
    }

    .ip:hover {
        border-color: var(--color-gold);
        color: var(--color-gold-hover);
    }

    .ip.copied {
        border-color: var(--color-success);
        color: var(--color-success);
    }

    .close {
        flex: none; /* the game name shrinks, not this */
        width: 22px;
        height: 22px;
        padding: 0;
        display: grid;
        place-items: center;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 4px;
        color: var(--color-text-muted);
        font-size: 12px;
        line-height: 1;
        cursor: pointer;
    }

    .close:hover {
        border-color: var(--color-danger);
        color: var(--color-danger);
    }

    .server {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
    }

    .label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .dot {
        flex: none;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--color-text-muted);
    }

    .connected {
        color: var(--color-text-secondary);
    }
    .connected .dot {
        background: var(--color-success);
    }

    .connecting .dot {
        background: var(--color-gold);
        animation: pulse 1s ease-in-out infinite;
    }

    .disconnected .dot {
        background: var(--color-danger);
    }

    @keyframes pulse {
        50% {
            opacity: 0.3;
        }
    }
</style>
