<script>
    /**
     * Global status header, shown on every screen:
     * the game server status (host / player / not connected) and, while
     * hosting, the "ip:port" to share — click copies it to the clipboard.
     */
    import { Clipboard } from '@wailsio/runtime';
    import { server, STATUS_LABELS, gameAddress } from '../server.svelte.js';

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
