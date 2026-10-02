<script>
    /**
     * “Conditions” — reference: the conditions (Prone, Grappled, Exhaustion…) and named
     * effects (Slowed, Enlarged…) with what each does on the sheet (rules/modifiers.js).
     * Custom ones: “+ Add condition”; custom ones get “Edit” / delete, built-in ones “Copy”.
     * Stored in the DB (the conditions table), exported with the rest of the homebrew.
     * onBack() — to the menu
     */
    import { onMount } from "svelte";
    import { loadRefs, deleteCustomCondition } from "../data/refs.js";
    import { modifierText } from "../rules/modifiers.js";
    import ConditionEditor from "./ConditionEditor.svelte";

    let { onBack } = $props();

    let defs = $state([]);
    let loading = $state(true);
    let error = $state(null);
    let query = $state("");
    let editor = $state(null); // { initial, copy } | null
    let confirmDelete = $state(null);
    let status = $state("");

    const isCustom = (d) => !!d.data?.custom;

    async function reload() {
        defs = [...((await loadRefs()).conditions ?? [])];
    }

    onMount(async () => {
        try {
            await reload();
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            loading = false;
        }
    });

    function flash(msg) {
        status = msg;
        setTimeout(() => (status = ""), 2500);
    }

    async function onSaved() {
        const wasEdit = editor?.initial && !editor?.copy;
        editor = null;
        await reload();
        flash(wasEdit ? "Changes saved" : "Condition added");
    }

    async function remove(d) {
        confirmDelete = null;
        try {
            await deleteCustomCondition(d.id);
            await reload();
            flash("Deleted");
        } catch (e) {
            flash(e?.message ?? String(e));
        }
    }

    const nameOf = (id) => defs.find((d) => d.id === id)?.name ?? id;
    const groups = $derived.by(() => {
        const q = query.trim().toLowerCase();
        const list = defs
            .filter((d) => !q || d.name.toLowerCase().includes(q) || (d.desc ?? "").toLowerCase().includes(q))
            .sort((a, b) => a.name.localeCompare(b.name));
        return [
            { id: "condition", title: "Conditions", items: list.filter((d) => (d.category ?? "condition") === "condition") },
            { id: "effect", title: "Effects", items: list.filter((d) => d.category === "effect" && !d.data?.spell) },
            { id: "spell", title: "Spell effects", items: list.filter((d) => d.category === "effect" && d.data?.spell) },
        ].filter((g) => g.items.length);
    });
</script>

<div class="page">
    <header class="top">
        <button class="ghost" onclick={onBack}>← Menu</button>
        <h1>Conditions</h1>
        <span class="total">{#if status}<span class="status">{status}</span>{/if}{defs.length}</span>
        {#if !loading && !error}
            <button class="add" onclick={() => (editor = { initial: null, copy: false })}>+ Add condition</button>
        {/if}
    </header>

    {#if loading}
        <p class="muted">Loading…</p>
    {:else if error}
        <p class="error">Failed to load: {error}</p>
    {:else}
        <input class="search" type="search" placeholder="Search…" bind:value={query} />
        {#each groups as g (g.id)}
            <section>
                <h2>{g.title} <small>{g.items.length}</small></h2>
                <div class="cards">
                    {#each g.items as d (d.id)}
                        <article class="card" class:custom={isCustom(d)}>
                            <header>
                                <b>{d.name}</b>
                                <span class="tags">
                                    {#if d.data?.levels}<span>levels 1–{d.data.levels}</span>{/if}
                                    {#if isCustom(d)}<span class="c">custom</span>{/if}
                                </span>
                            </header>
                            {#if d.desc}<p class="desc">{d.desc}</p>{/if}
                            {#if d.data?.implies?.length}
                                <p class="inc">Includes: {d.data.implies.map(nameOf).join(", ")}</p>
                            {/if}
                            <ul class="mods">
                                {#each d.data?.modifiers ?? [] as m}<li>{modifierText(m)}</li>{/each}
                                {#if d.data?.breaksConcentration}<li>Breaks Concentration</li>{/if}
                            </ul>
                            <div class="actions">
                                {#if isCustom(d)}
                                    {#if confirmDelete === d.id}
                                        <span class="ask">Delete?</span>
                                        <button class="ghost small danger" onclick={() => remove(d)}>Yes</button>
                                        <button class="ghost small" onclick={() => (confirmDelete = null)}>No</button>
                                    {:else}
                                        <button class="ghost small" onclick={() => (editor = { initial: d, copy: false })}>Edit</button>
                                        <button class="ghost small" onclick={() => (confirmDelete = d.id)} title="Delete">✕</button>
                                    {/if}
                                {:else}
                                    <button class="ghost small" onclick={() => (editor = { initial: d, copy: true })}
                                        title="Create your own based on this one">Copy</button>
                                {/if}
                            </div>
                        </article>
                    {/each}
                </div>
            </section>
        {:else}
            <p class="muted">Nothing found.</p>
        {/each}
    {/if}
</div>

{#if editor}
    {#key editor}
        <ConditionEditor initial={editor.initial} copy={editor.copy} {defs} {onSaved} onCancel={() => (editor = null)} />
    {/key}
{/if}

<style>
    .page {
        min-height: 100%;
        padding: 32px;
        display: flex;
        flex-direction: column;
        gap: 16px;
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

    .total {
        margin-left: auto;
        color: var(--color-text-muted);
        font-size: 13px;
    }

    .status {
        margin-right: 10px;
        color: var(--color-success);
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

    .search {
        max-width: 360px;
        padding: 6px 10px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-primary);
        font: inherit;
    }

    h2 {
        margin: 0 0 10px;
        font-family: var(--font-heading);
        font-size: 18px;
        color: var(--color-text-primary);
    }

    h2 small {
        color: var(--color-text-muted);
        font-size: 13px;
    }

    .cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 12px;
    }

    .card {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 10px 12px;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        color: var(--color-text-primary);
        font-size: 13px;
    }

    .card.custom {
        border-color: color-mix(in srgb, var(--color-gold) 50%, var(--color-border));
    }

    .card header {
        display: flex;
        align-items: baseline;
        gap: 8px;
    }

    .tags {
        margin-left: auto;
        display: flex;
        gap: 6px;
        font-size: 11px;
        color: var(--color-text-muted);
    }

    .tags .c {
        color: var(--color-gold);
    }

    .desc {
        margin: 0;
        color: var(--color-text-secondary);
        line-height: 1.4;
    }

    .inc {
        margin: 0;
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .mods {
        margin: 0;
        padding-left: 18px;
        font-size: 12px;
        color: var(--color-text-accent);
    }

    .actions {
        margin-top: auto;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
    }

    .ask {
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .muted {
        color: var(--color-text-muted);
    }

    .error {
        color: var(--color-danger);
    }
</style>
