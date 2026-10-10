<script>
    /**
     * “Items” — reference of all equipment (including named items)
     * and custom equipment: create, edit, copy, delete (stored in the DB).
     * onBack() — to the menu
     */
    import { ask } from "../confirm.svelte.js";
    import TopBar from "./common/TopBar.svelte";
    import { onMount } from "svelte";
    import { loadRefs, deleteCustomEquipment } from "../data/refs.js";
    import CatalogList from "./common/CatalogList.svelte";
    import ItemEditor from "./ItemEditor.svelte";

    let { onBack } = $props();

    let catalog = $state({ weapons: [], armor: [], items: [] });
    let tab = $state("weapon");
    let loading = $state(true);
    let error = $state(null);
    let status = $state("");

    // open form: { kind, initial, copy } | null
    let editor = $state(null);

    const KIND_ADD = { item: "item", armor: "armor", weapon: "weapon" };

    onMount(async () => {
        try {
            catalog = (await loadRefs()).catalog;
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            loading = false;
        }
    });

    // save/delete already reloaded the cache — take the fresh catalog from it
    async function reload() {
        catalog = (await loadRefs()).catalog;
    }

    async function onSaved(id, kind) {
        const wasEdit = editor?.initial && !editor?.copy;
        editor = null;
        await reload();
        tab = kind;
        status = wasEdit ? "Changes saved" : "Added";
        setTimeout(() => (status = ""), 2500);
    }

    async function remove(kind, x) {
        if (!(await ask({ title: `Delete “${x.name}”?`, text: "Your custom item is removed from the catalog." }))) return;
        try {
            await deleteCustomEquipment(kind, x.id);
            await reload();
            status = `“${x.name}” deleted`;
        } catch (e) {
            status = "Error: " + (e?.message ?? e);
        }
        setTimeout(() => (status = ""), 2500);
    }
</script>

{#snippet actions(x, kind)}
    {#if x.data?.custom}
        <button class="ghost small" onclick={() => (editor = { kind, initial: x, copy: false })}>Edit</button>
        <button class="ghost small" onclick={() => remove(kind, x)} title="Delete">✕</button>
    {:else}
        <button class="ghost small" onclick={() => (editor = { kind, initial: x, copy: true })} title="Create your own based on this one">Copy</button>
    {/if}
{/snippet}

<div class="page">
    <TopBar title="Items" {onBack}>
        <span class="status">{status}</span>
        {#if !loading && !error}
            <button class="add" onclick={() => (editor = { kind: tab, initial: null, copy: false })}>
                + Add {KIND_ADD[tab]}
            </button>
        {/if}
    </TopBar>

    {#if loading}
        <p class="muted">Loading…</p>
    {:else if error}
        <p class="error">Failed to load: {error}</p>
    {:else}
        <CatalogList {catalog} bind:tab {actions} />
    {/if}
</div>

{#if editor}
    {#key editor}
        <ItemEditor
            kind={editor.kind}
            initial={editor.initial}
            copy={editor.copy}
            {onSaved}
            onCancel={() => (editor = null)}
        />
    {/key}
{/if}

<style>
    .page {
        width: 100%;
        max-width: var(--page-max-width); /* big screens: centered, not stretched */
        margin: 0 auto;
        min-height: 100%;
        padding: 32px;
        display: flex;
        flex-direction: column;
        gap: 20px;
    }

    /* phones: the page uses the whole width */
    @media (max-width: 640px) {
        .page {
            padding: 12px 12px 24px;
            gap: 14px;
        }
    }

    .status {
        margin-left: auto;
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-muted);
    }

    .add {
        padding: 8px 16px;
        background: var(--color-gold);
        border: 1px solid var(--color-gold);
        border-radius: 6px;
        color: var(--color-bg);
        font-family: var(--font-ui);
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
    }

    .add:hover {
        background: var(--color-gold-hover);
    }

    .ghost {
        padding: 6px 12px;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        cursor: pointer;
    }

    .ghost:hover {
        border-color: var(--color-gold);
        color: var(--color-gold-hover);
    }

    .ghost.small {
        padding: 4px 10px;
        font-size: 13px;
    }

    .muted {
        margin: 0;
        color: var(--color-text-muted);
    }

    .error {
        margin: 0;
        color: var(--color-danger);
    }
</style>
