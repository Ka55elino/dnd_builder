<script>
    /**
     * Global footer, on every screen: the app version. A player can only join a
     * DM with the same version (see lan/host.go), so it's worth seeing at a glance.
     */
    import { server } from "../server.svelte.js";
</script>

<footer class="app-footer">
    <span>DnD Builder</span>
    <span class="v" title="App version — players and the DM need the same one">v{server.appVersion || "—"}</span>
</footer>

<style>
    .app-footer {
        height: 22px;
        padding: 0 16px;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        background: var(--color-sidebar);
        border-top: 1px solid var(--color-border);
        font-family: var(--font-ui);
        font-size: 11px;
        color: var(--color-text-muted);
        user-select: none;
    }

    .v {
        font-variant-numeric: tabular-nums;
        color: var(--color-text-secondary);
        user-select: text;
    }

    @media print {
        .app-footer {
            display: none;
        }
    }
</style>
