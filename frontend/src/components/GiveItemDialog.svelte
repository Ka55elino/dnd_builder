<script>
    /**
     * Modal for the DM: give a player a named item from the catalog
     * (Items / Armor / Weapons tabs + search — the same list as the "Give Item" page).
     *
     * to              — player name (title)
     * onGive(kind, item) — may return a promise
     * onClose()
     */
    import { loadRefs } from "../data/refs.js";
    import { namedCatalog } from "../game.js";
    import CatalogList from "./common/CatalogList.svelte";

    let { to = "", onGive, onClose } = $props();

    let catalog = $state({ weapons: [], armor: [], items: [] });
    let tab = $state("item");
    let loading = $state(true);
    let error = $state("");
    let status = $state("");
    let given = $state({}); // "kind:id" → how many given while the dialog is open
    let busy = $state(null); // "kind:id" being sent

    $effect(() => {
        loadRefs()
            .then((r) => {
                catalog = namedCatalog(r.catalog);
                // open on the first tab that has something (gear has no named items)
                tab = catalog.weapons.length ? "weapon" : catalog.armor.length ? "armor" : "item";
            })
            .catch((e) => (error = e?.message ?? String(e)))
            .finally(() => (loading = false));
    });

    let statusTimer;
    async function give(kind, x) {
        const key = `${kind}:${x.id}`;
        if (busy) return;
        busy = key;
        status = "";
        try {
            await onGive?.(kind, x);
            given[key] = (given[key] ?? 0) + 1;
            status = `Gave “${x.name}” to ${to}`;
        } catch (e) {
            status = "Error: " + (e?.message ?? e);
        } finally {
            busy = null;
            clearTimeout(statusTimer);
            statusTimer = setTimeout(() => (status = ""), 3000);
        }
    }

    const onKey = (e) => e.key === "Escape" && onClose?.();
    const empty = $derived(!catalog.items.length && !catalog.armor.length && !catalog.weapons.length);
</script>

<svelte:window onkeydown={onKey} />

{#snippet actions(x, kind)}
    {@const key = `${kind}:${x.id}`}
    {#if given[key]}<span class="given">given ×{given[key]}</span>{/if}
    <button class="give" onclick={() => give(kind, x)} disabled={!!busy}>
        {busy === key ? "…" : "Give"}
    </button>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={(e) => e.target === e.currentTarget && onClose?.()}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Give an item to {to}">
        <header>
            <h2>Give an item <span>to {to}</span></h2>
            <span class="status" class:err={status.startsWith("Error")}>{status}</span>
            <button class="x" onclick={() => onClose?.()} aria-label="Close">✕</button>
        </header>

        <div class="body">
            {#if loading}
                <p class="muted">Loading…</p>
            {:else if error}
                <p class="error">Failed to load: {error}</p>
            {:else if empty}
                <p class="muted">There are no named items in the catalog.</p>
            {:else}
                <CatalogList {catalog} bind:tab {actions} marked={(x, kind) => !!given[`${kind}:${x.id}`]} />
            {/if}
        </div>
    </div>
</div>

<style>
    .backdrop {
        position: fixed;
        inset: 0;
        z-index: 950;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 48px 16px;
        background: rgba(0, 0, 0, 0.6);
    }

    .dialog {
        width: min(860px, 100%);
        max-height: calc(100vh - 96px);
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 20px;
        background: var(--color-card);
        border: 1px solid var(--color-gold);
        border-radius: 10px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
    }

    header {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    h2 {
        margin: 0;
        font-family: var(--font-heading-alt);
        font-size: 20px;
        color: var(--color-gold);
    }

    h2 span {
        font-size: 16px;
        color: var(--color-text-secondary);
    }

    .status {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: right;
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-success);
    }

    .status.err {
        color: var(--color-danger);
    }

    .x {
        width: 28px;
        height: 28px;
        padding: 0;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 6px;
        color: var(--color-text-muted);
        cursor: pointer;
    }

    .x:hover {
        border-color: var(--color-border);
        color: var(--color-text-primary);
    }

    .body {
        min-height: 0;
        overflow-y: auto;
    }

    .muted {
        margin: 0;
        color: var(--color-text-muted);
    }

    .error {
        margin: 0;
        color: var(--color-danger);
    }

    .given {
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-gold);
    }

    .give {
        padding: 4px 12px;
        background: var(--color-gold);
        border: 1px solid var(--color-gold);
        border-radius: 6px;
        color: var(--color-bg);
        font-family: var(--font-ui);
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
    }

    .give:not(:disabled):hover {
        background: var(--color-gold-hover);
    }

    .give:disabled {
        opacity: 0.6;
        cursor: default;
    }
</style>
