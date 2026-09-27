<script>
    /**
     * "Bestiary" — the DM's reference. Two modes:
     *   Monsters   — search + filters (type, CR, habitat) on the left, the stat block on the right;
     *                custom monsters: “+ Add monster”, Edit / Delete; built-in ones: Copy.
     *   Encounters — presets: a named group of monsters with XP and difficulty for the party.
     * onBack() — to the menu
     */
    import { onMount } from "svelte";
    import {
        loadMonsters, deleteMonster, isCustomMonster, loadEncounters, saveEncounter,
        CREATURE_TYPES, HABITATS, CRS, crLabel, fmtXP,
    } from "../../data/bestiary.js";
    import MonsterStatBlock from "./MonsterStatBlock.svelte";
    import MonsterEditor from "./MonsterEditor.svelte";
    import EncountersTab from "./EncountersTab.svelte";

    let { onBack } = $props();

    let mode = $state("monsters"); // 'monsters' | 'encounters'
    let monsters = $state([]);
    let encounters = $state([]);
    let loading = $state(true);
    let error = $state(null);
    let status = $state("");

    // filters
    let query = $state("");
    let type = $state("");
    let habitat = $state("");
    let crMin = $state(0);
    let crMax = $state(30);
    let customOnly = $state(false);

    let selectedId = $state(null);
    let editor = $state(null); // { initial, copy } | null
    let confirmDelete = $state(null);

    let statusTimer;
    function flash(msg) {
        status = msg;
        clearTimeout(statusTimer);
        statusTimer = setTimeout(() => (status = ""), 2500);
    }

    onMount(async () => {
        try {
            [monsters, encounters] = await Promise.all([loadMonsters(), loadEncounters()]);
            selectedId = monsters[0]?.id ?? null;
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            loading = false;
        }
    });

    const norm = (s) => String(s ?? "").toLowerCase().trim();
    const filtered = $derived(
        monsters
            .filter(
                (m) =>
                    (!query || norm(m.name).includes(norm(query))) &&
                    (!type || m.type === type) &&
                    (!habitat || m.habitats?.includes(habitat) || (habitat !== "any" && m.habitats?.includes("any"))) &&
                    m.cr >= crMin &&
                    m.cr <= crMax &&
                    (!customOnly || isCustomMonster(m)),
            )
            .sort((a, b) => a.cr - b.cr || a.name.localeCompare(b.name)),
    );
    const typeCounts = $derived(monsters.reduce((acc, m) => ((acc[m.type] = (acc[m.type] ?? 0) + 1), acc), {}));
    const selected = $derived(monsters.find((m) => m.id === selectedId) ?? filtered[0] ?? null);
    const filtersOn = $derived(!!(query || type || habitat || crMin > 0 || crMax < 30 || customOnly));

    function resetFilters() {
        query = type = habitat = "";
        crMin = 0;
        crMax = 30;
        customOnly = false;
    }

    async function onSaved(id) {
        const wasEdit = editor?.initial && !editor?.copy;
        editor = null;
        monsters = await loadMonsters();
        selectedId = id;
        flash(wasEdit ? "Changes saved" : "Monster added");
    }

    async function remove(m) {
        confirmDelete = null;
        try {
            await deleteMonster(m.id);
            monsters = await loadMonsters();
            if (selectedId === m.id) selectedId = null;
            flash(`“${m.name}” deleted`);
        } catch (e) {
            flash("Error: " + (e?.message ?? e));
        }
    }

    // “Add to encounter” from the stat block: into an existing preset or a new one
    async function addToEncounter(m, encId) {
        try {
            let enc = encounters.find((e) => e.id === encId);
            enc = enc
                ? { ...enc, monsters: [...enc.monsters, { monsterId: m.id, count: 1 }] }
                : { name: `${m.name} encounter`, notes: "", monsters: [{ monsterId: m.id, count: 1 }] };
            await saveEncounter(enc);
            encounters = await loadEncounters();
            flash(`${m.name} added to “${enc.name}”`);
        } catch (e) {
            flash("Error: " + (e?.message ?? e));
        }
    }

    function openMonster(id) {
        mode = "monsters";
        resetFilters();
        selectedId = id;
    }
</script>

{#snippet blockActions(m)}
    <select
        class="to-enc"
        value=""
        onchange={(e) => {
            const v = e.currentTarget.value;
            e.currentTarget.value = "";
            if (v) addToEncounter(m, v === "__new" ? null : v);
        }}
        title="Add this monster to an encounter preset"
    >
        <option value="">+ To encounter…</option>
        {#each encounters as enc (enc.id)}<option value={enc.id}>{enc.name}</option>{/each}
        <option value="__new">New encounter</option>
    </select>
    {#if isCustomMonster(m)}
        {#if confirmDelete === m.id}
            <span class="ask">Delete?</span>
            <button class="ghost small danger" onclick={() => remove(m)}>Yes</button>
            <button class="ghost small" onclick={() => (confirmDelete = null)}>No</button>
        {:else}
            <button class="ghost small" onclick={() => (editor = { initial: m, copy: false })}>Edit</button>
            <button class="ghost small" onclick={() => (confirmDelete = m.id)} title="Delete">✕</button>
        {/if}
    {:else}
        <button class="ghost small" onclick={() => (editor = { initial: m, copy: true })} title="Create your own monster based on this one">Copy</button>
    {/if}
{/snippet}

<div class="page">
    <header class="top">
        <button class="ghost" onclick={onBack}>← Menu</button>
        <h1>Bestiary</h1>
        <nav class="modes">
            <button class="chip" class:active={mode === "monsters"} onclick={() => (mode = "monsters")}>
                Monsters <small>{monsters.length}</small>
            </button>
            <button class="chip" class:active={mode === "encounters"} onclick={() => (mode = "encounters")}>
                Encounters <small>{encounters.length}</small>
            </button>
        </nav>
        <span class="status">{status}</span>
        {#if mode === "monsters" && !loading && !error}
            <button class="add" onclick={() => (editor = { initial: null, copy: false })}>+ Add monster</button>
        {/if}
    </header>

    {#if loading}
        <p class="muted">Loading…</p>
    {:else if error}
        <p class="error">Failed to load: {error}</p>
    {:else if mode === "encounters"}
        <EncountersTab {monsters} bind:encounters onOpenMonster={openMonster} onStatus={flash} />
    {:else}
        <div class="split">
            <aside class="list">
                <div class="filters">
                    <input class="search" type="search" placeholder="Search by name…" bind:value={query} />
                    <select bind:value={type} aria-label="Creature type">
                        <option value="">All types</option>
                        {#each Object.entries(CREATURE_TYPES) as [k, v]}
                            <option value={k}>{v} ({typeCounts[k] ?? 0})</option>
                        {/each}
                    </select>
                    <select bind:value={habitat} aria-label="Habitat">
                        <option value="">Any habitat</option>
                        {#each Object.entries(HABITATS).filter(([k]) => k !== "any") as [k, v]}<option value={k}>{v}</option>{/each}
                    </select>
                    <div class="cr-range">
                        <span>CR</span>
                        <select bind:value={crMin} aria-label="Minimum CR">
                            {#each CRS as c}<option value={c}>{crLabel(c)}</option>{/each}
                        </select>
                        <span>–</span>
                        <select bind:value={crMax} aria-label="Maximum CR">
                            {#each CRS as c}<option value={c}>{crLabel(c)}</option>{/each}
                        </select>
                    </div>
                    <label class="check"><input type="checkbox" bind:checked={customOnly} /> Custom only</label>
                    {#if filtersOn}<button class="link" onclick={resetFilters}>Reset</button>{/if}
                </div>

                <p class="count">{filtered.length} of {monsters.length}</p>

                <ul>
                    {#each filtered as m (m.id)}
                        <li>
                            <button class="row" class:active={selected?.id === m.id} onclick={() => (selectedId = m.id)}>
                                <span class="name">
                                    {m.name}
                                    {#if m.legendary}<span class="leg" title="Legendary">★</span>{/if}
                                    {#if isCustomMonster(m)}<span class="own">custom</span>{/if}
                                </span>
                                <span class="meta">{CREATURE_TYPES[m.type] ?? m.type}</span>
                                <span class="cr">CR {crLabel(m.cr)}</span>
                                <span class="xp">{fmtXP(m.xp)} XP</span>
                            </button>
                        </li>
                    {:else}
                        <li class="none">Nothing matches the filters.</li>
                    {/each}
                </ul>
            </aside>

            <main class="view">
                {#if selected}
                    {#key selected.id}
                        <MonsterStatBlock monster={selected} actions={blockActions} />
                    {/key}
                {:else}
                    <p class="muted">Choose a monster on the left.</p>
                {/if}
            </main>
        </div>
    {/if}
</div>

{#if editor}
    {#key editor}
        <MonsterEditor initial={editor.initial} copy={editor.copy} {onSaved} onCancel={() => (editor = null)} />
    {/key}
{/if}

<style>
    .page {
        height: 100%;
        padding: 24px 32px;
        display: flex;
        flex-direction: column;
        gap: 18px;
        min-height: 0;
    }

    .top {
        display: flex;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
    }

    h1 {
        margin: 0;
        font-family: var(--font-heading);
        font-weight: var(--font-weight-bold);
        color: var(--color-gold);
    }

    .modes {
        display: flex;
        gap: 6px;
    }

    .status {
        margin-left: auto;
        font-size: 13px;
        color: var(--color-text-muted);
    }

    .split {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
        gap: 20px;
    }

    .list {
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .filters {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
    }

    .search {
        flex: 1 1 100%;
    }

    .search,
    select {
        padding: 7px 10px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-primary);
        font-family: var(--font-form);
        font-size: 14px;
    }

    .search:focus,
    select:focus {
        outline: none;
        border-color: var(--color-gold);
    }

    .cr-range {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .check {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .link {
        padding: 0;
        background: none;
        border: none;
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-gold);
        cursor: pointer;
    }

    .count {
        margin: 0;
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .list ul {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        margin: 0;
        padding: 0 4px 0 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .row {
        width: 100%;
        padding: 8px 12px;
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 2px 10px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        color: var(--color-text-primary);
        text-align: left;
        cursor: pointer;
    }

    .row:hover {
        border-color: color-mix(in srgb, var(--color-gold) 60%, var(--color-border));
    }

    .row.active {
        background: var(--color-card-elevated);
        border-color: var(--color-gold);
    }

    .row .name {
        font-family: var(--font-heading);
        font-size: 15px;
    }

    .leg {
        color: var(--color-meta-concentration);
    }

    .own {
        margin-left: 4px;
        font-family: var(--font-ui);
        font-size: 10px;
        color: var(--color-meta-range);
    }

    .row .meta,
    .row .xp {
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .row .cr {
        font-family: var(--font-ui);
        font-size: 13px;
        font-weight: var(--font-weight-semibold);
        color: var(--color-gold);
        text-align: right;
    }

    .row .xp {
        text-align: right;
    }

    .none {
        padding: 12px;
        font-size: 13px;
        color: var(--color-text-muted);
    }

    .view {
        min-height: 0;
        overflow-y: auto;
        padding-right: 4px;
    }

    .to-enc {
        padding: 4px 8px;
        font-family: var(--font-ui);
        font-size: 13px;
    }

    .ask {
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .muted {
        margin: 0;
        color: var(--color-text-muted);
    }

    .error {
        margin: 0;
        color: var(--color-danger);
    }

    .chip {
        padding: 5px 12px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 999px;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: 13px;
        cursor: pointer;
    }

    .chip small {
        margin-left: 4px;
        color: var(--color-text-muted);
    }

    .chip.active {
        background: var(--color-magic-purple-dark);
        border-color: var(--color-magic-purple);
        color: var(--color-text-primary);
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

    .ghost.danger:hover {
        border-color: var(--color-danger);
        color: var(--color-danger);
    }

    @media (max-width: 760px) {
        .split {
            grid-template-columns: 1fr;
        }
    }
</style>
