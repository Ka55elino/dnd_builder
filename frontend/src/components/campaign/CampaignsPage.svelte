<script>
    /**
     * “Campaign” — the list of the DM's campaigns and “+ New campaign”.
     * Opening one shows its own screen (CampaignPage) with the sidebar.
     * onBack() — to the menu
     */
    import { onMount } from "svelte";
    import { loadCampaigns, saveCampaign, deleteCampaign, CAMPAIGN_STATUSES } from "../../data/campaigns.js";
    import CampaignPage from "./CampaignPage.svelte";

    let { onBack } = $props();

    let list = $state([]);
    let loading = $state(true);
    let error = $state("");
    let openId = $state(null); // the campaign shown in CampaignPage

    // "+ New campaign" form
    let creating = $state(false);
    let name = $state("");
    let description = $state("");
    let busy = $state(false);
    let formError = $state("");
    let confirmDelete = $state(null);

    const statusName = (id) => CAMPAIGN_STATUSES.find((s) => s.id === id)?.name ?? id;
    const date = (t) => (t ? new Date(t * 1000).toLocaleDateString() : "");

    async function reload() {
        try {
            list = await loadCampaigns();
            error = "";
        } catch (e) {
            error = e?.message ?? String(e);
        }
    }

    onMount(async () => {
        await reload();
        loading = false;
    });

    async function create(e) {
        e?.preventDefault();
        if (!name.trim() || busy) return;
        busy = true;
        formError = "";
        try {
            const id = await saveCampaign({ name: name.trim(), description: description.trim(), status: "active" });
            creating = false;
            name = description = "";
            await reload();
            openId = id; // straight into the new campaign
        } catch (err) {
            formError = err?.message ?? String(err);
        } finally {
            busy = false;
        }
    }

    async function remove(c) {
        confirmDelete = null;
        try {
            await deleteCampaign(c.id);
            await reload();
        } catch (e) {
            error = e?.message ?? String(e);
        }
    }

    async function closeCampaign() {
        openId = null;
        await reload(); // its name / counts may have changed
    }
</script>

{#if openId}
    {#key openId}
        <CampaignPage id={openId} onBack={closeCampaign} />
    {/key}
{:else}
    <div class="page">
        <header class="top">
            <button class="ghost" onclick={onBack}>← Menu</button>
            <h1>Campaigns</h1>
            <span class="spacer"></span>
            {#if !creating}
                <button class="add" onclick={() => (creating = true)}>+ New campaign</button>
            {/if}
        </header>

        {#if creating}
            <form class="new" onsubmit={create}>
                <label class="field">
                    <span>Name</span>
                    <!-- svelte-ignore a11y_autofocus -->
                    <input bind:value={name} maxlength="120" placeholder="The Lost Mine" autofocus />
                </label>
                <label class="field">
                    <span>Description</span>
                    <textarea bind:value={description} rows="3" placeholder="Premise, setting, tone…"></textarea>
                </label>
                <div class="row">
                    {#if formError}<span class="error">{formError}</span>{/if}
                    <span class="spacer"></span>
                    <button type="button" class="ghost" onclick={() => (creating = false)}>Cancel</button>
                    <button type="submit" class="primary" disabled={!name.trim() || busy}>{busy ? "Creating…" : "Create"}</button>
                </div>
            </form>
        {/if}

        {#if loading}
            <p class="muted">Loading…</p>
        {:else if error}
            <p class="error">Failed to load: {error}</p>
        {:else if !list.length && !creating}
            <div class="empty">
                <p>No campaigns yet.</p>
                <button class="add" onclick={() => (creating = true)}>+ Create your first campaign</button>
            </div>
        {:else}
            <div class="grid">
                {#each list as c (c.id)}
                    <article class="card">
                        <button class="open" onclick={() => (openId = c.id)}>
                            <span class="title">{c.name}</span>
                            <span class="status s-{c.status}">{statusName(c.status)}</span>
                            {#if c.description}<span class="desc">{c.description}</span>{/if}
                            <span class="meta">
                                {c.npcs} NPC{c.npcs === 1 ? "" : "s"} · {c.locations} location{c.locations === 1 ? "" : "s"}
                                · {c.encounters ?? 0} encounter{c.encounters === 1 ? "" : "s"}
                                · {c.quests ?? 0} quest{c.quests === 1 ? "" : "s"}
                                · updated {date(c.updatedAt)}
                            </span>
                        </button>
                        <div class="actions">
                            {#if confirmDelete === c.id}
                                <span class="ask">Delete with everything in it?</span>
                                <button class="ghost small danger" onclick={() => remove(c)}>Delete</button>
                                <button class="ghost small" onclick={() => (confirmDelete = null)}>No</button>
                            {:else}
                                <button class="ghost small" onclick={() => (confirmDelete = c.id)} title="Delete">✕</button>
                            {/if}
                        </div>
                    </article>
                {/each}
            </div>
        {/if}
    </div>
{/if}

<style>
    .page {
        min-height: 100%;
        padding: 32px;
        display: flex;
        flex-direction: column;
        gap: 20px;
        font-family: var(--font-ui);
    }

    .top {
        display: flex;
        align-items: center;
        gap: 16px;
    }

    h1 {
        margin: 0;
        font-family: var(--font-heading);
        color: var(--color-gold);
    }

    .spacer {
        flex: 1;
    }

    .ghost {
        padding: 6px 12px;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-secondary);
        font: inherit;
        cursor: pointer;
    }

    .ghost:hover {
        border-color: var(--color-gold);
        color: var(--color-gold-hover);
    }

    .ghost.small {
        padding: 2px 8px;
        font-size: 12px;
    }

    .ghost.danger:hover {
        border-color: var(--color-danger);
        color: var(--color-danger);
    }

    .add {
        padding: 6px 14px;
        background: transparent;
        border: 1px solid var(--color-gold);
        border-radius: 6px;
        color: var(--color-gold);
        font: inherit;
        cursor: pointer;
    }

    .add:hover {
        background: color-mix(in srgb, var(--color-gold) 12%, transparent);
    }

    .primary {
        padding: 6px 16px;
        background: var(--color-gold);
        border: 1px solid var(--color-gold);
        border-radius: 6px;
        color: var(--color-bg);
        font: inherit;
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
    }

    .primary:disabled {
        opacity: 0.5;
        cursor: default;
    }

    .new {
        max-width: 640px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 16px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 10px;
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 12px;
        color: var(--color-text-muted);
    }

    input,
    textarea {
        padding: 6px 10px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-primary);
        font: inherit;
        font-size: 14px;
    }

    textarea {
        resize: vertical;
    }

    .row {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 14px;
    }

    .card {
        position: relative;
        display: flex;
        flex-direction: column;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 10px;
        overflow: hidden;
    }

    .card:hover {
        border-color: color-mix(in srgb, var(--color-gold) 60%, var(--color-border));
    }

    .open {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
        padding: 14px 16px 10px;
        background: transparent;
        border: none;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
    }

    .title {
        font-family: var(--font-heading);
        font-size: 20px;
        color: var(--color-text-primary);
    }

    .status {
        padding: 1px 8px;
        border: 1px solid var(--color-border);
        border-radius: 999px;
        font-size: 11px;
        color: var(--color-text-secondary);
    }

    .status.s-active {
        border-color: var(--color-success);
        color: var(--color-success);
    }

    .status.s-planned {
        border-color: var(--color-gold);
        color: var(--color-gold);
    }

    .desc {
        display: -webkit-box;
        -webkit-line-clamp: 3;
        line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        font-size: 13px;
        line-height: 1.4;
        color: var(--color-text-secondary);
    }

    .meta {
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        padding: 0 10px 10px;
    }

    .ask {
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .empty {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
        color: var(--color-text-secondary);
    }

    .muted {
        color: var(--color-text-muted);
    }

    .error {
        color: var(--color-danger);
        font-size: 13px;
    }
</style>
