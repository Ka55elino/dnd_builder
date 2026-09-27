<script>
    /**
     * Global status header, shown on every screen:
     * the game server status (host / player / not connected) and, while
     * hosting, the "ip:port" to share — click copies it to the clipboard.
     * While in a game, ✕ ends it (DM) or leaves it (player); the first click
     * asks, the second confirms (in-app, no OS dialog — works the same on every platform).
     */
    import { Clipboard } from '@wailsio/runtime';
    import { StopGame, LeaveGame } from '../api.js';
    import { server, STATUS_LABELS, gameAddress } from '../server.svelte.js';

    let inGame = $derived(!!server.role && !!server.game);
    let confirming = $state(false);
    let confirmTimer;

    function askClose() {
        confirming = true;
        clearTimeout(confirmTimer);
        confirmTimer = setTimeout(() => (confirming = false), 4000); // forget if not confirmed
    }

    async function close() {
        clearTimeout(confirmTimer);
        confirming = false;
        try {
            await (server.role === 'host' ? StopGame() : LeaveGame());
        } catch (e) {
            console.error('[status-bar]', e);
        }
    }

    // a new game shouldn't start in the "confirm" state
    $effect(() => {
        if (!inGame) confirming = false;
    });

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
</script>

<header class="status-bar">
    <span class="app">D&D Builder</span>

    <span class="server {server.state}" {title}>
        <span class="dot" aria-hidden="true"></span>
        {label}
    </span>

    {#if address}
        <button class="ip" class:copied onclick={copy} title="Click to copy — players type this address in “Join Game”">
            {copied ? 'Copied!' : address}
        </button>
    {/if}

    {#if inGame}
        {#if confirming}
            <span class="confirm">
                {server.role === 'host' ? 'End the game for everyone?' : 'Leave the game?'}
                <button class="yes" onclick={close}>{server.role === 'host' ? 'End' : 'Leave'}</button>
                <button class="no" onclick={() => (confirming = false)}>Cancel</button>
            </span>
        {:else}
            <button
                class="close"
                onclick={askClose}
                title={server.role === 'host' ? 'End the game' : 'Leave the game'}
                aria-label={server.role === 'host' ? 'End the game' : 'Leave the game'}>✕</button
            >
        {/if}
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
    }

    .app {
        font-family: var(--font-heading);
        font-weight: var(--font-weight-semibold);
        letter-spacing: 0.04em;
        color: var(--color-text-secondary);
    }

    .ip {
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

    .confirm {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--color-text-secondary);
    }

    .confirm button {
        padding: 2px 8px;
        border-radius: 4px;
        font-family: var(--font-ui);
        font-size: 12px;
        cursor: pointer;
    }

    .confirm .yes {
        background: var(--color-danger);
        border: 1px solid var(--color-danger);
        color: var(--color-text-primary);
    }

    .confirm .no {
        background: transparent;
        border: 1px solid var(--color-border);
        color: var(--color-text-secondary);
    }

    .confirm .no:hover {
        border-color: var(--color-gold);
        color: var(--color-gold-hover);
    }

    .server {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 6px;
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
