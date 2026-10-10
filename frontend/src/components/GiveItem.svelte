<script>
    /**
     * “Give Item”: give the character anything from the catalog —
     * including named and magic items (not only what the builder offers).
     * Given items are stored in build.equipment.bag and saved immediately.
     *
     * id — character; onBack() — back to the character page
     */
    import TopBar from "./common/TopBar.svelte";
    import { onMount } from "svelte";
    import { GetCharacter, SaveCharacter } from "../api.js";
    import { CharacterBuild } from "../models/CharacterBuild.svelte.js";
    import { loadRefs } from "../data/refs.js";
    import CatalogList from "./common/CatalogList.svelte";

    let { id, onBack } = $props();

    let build = $state(null);
    let catalog = $state({ weapons: [], armor: [], items: [] });
    let tab = $state("item");
    let loading = $state(true);
    let error = $state(null);
    let status = $state(""); // “Saved” / save error

    onMount(async () => {
        try {
            const [data, refs] = await Promise.all([GetCharacter(id), loadRefs()]);
            build = CharacterBuild.fromJSON(data);
            catalog = refs.catalog;
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            loading = false;
        }
    });

    let saveTimer;
    function persist() {
        clearTimeout(saveTimer);
        status = "…";
        saveTimer = setTimeout(async () => {
            try {
                await SaveCharacter(JSON.stringify(build));
                status = "Saved";
            } catch (e) {
                status = "Error: " + (e?.message ?? e);
            }
        }, 300);
    }

    function give(kind, x) {
        build.addToBag(kind, x.id, 1);
        persist();
    }

    function take(kind, x) {
        build.removeFromBag(kind, x.id, 1);
        persist();
    }
</script>

{#snippet actions(x, kind)}
    {@const have = build.bagCount(kind, x.id)}
    {#if have}
        <span class="have">in backpack ×{have}</span>
        <button class="ghost small" onclick={() => take(kind, x)} title="Remove one">−</button>
    {/if}
    <button class="give" onclick={() => give(kind, x)}>+ Add</button>
{/snippet}

<div class="page">
    <TopBar title="Give Item" sub={build?.name ?? ""} {onBack} back="To character">
        {#snippet pinned()}<span class="status">{status}</span>{/snippet}
    </TopBar>

    {#if loading}
        <p class="muted">Loading…</p>
    {:else if error}
        <p class="error">Failed to load: {error}</p>
    {:else}
        <CatalogList {catalog} bind:tab {actions} marked={(x, kind) => build.bagCount(kind, x.id) > 0} />
    {/if}
</div>

<style>
    .page {
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
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .have {
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-gold);
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
    }

    .give {
        padding: 6px 14px;
        background: var(--color-gold);
        border: 1px solid var(--color-gold);
        border-radius: 6px;
        color: var(--color-bg);
        font-family: var(--font-ui);
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
    }

    .give:hover {
        background: var(--color-gold-hover);
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
