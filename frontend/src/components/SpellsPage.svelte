<script>
    /**
     * “Spells” — reference. Two modes:
     *   Spells              — search, filter by level, class and school;
     *   Special abilities   — class and subclass features (maneuvers, shots…)
     *                         and species traits: Rage, Reckless Attack, Lay on Hands…
     * Custom spells: “+ Add spell”; custom ones get “Edit” / delete,
     * reference ones get “Copy” (a custom spell based on them). Stored in the DB.
     * onBack() — to the menu
     */
    import { onMount } from "svelte";
    import { loadRefs, refreshSpells } from "../data/refs.js";
    import { DeleteCustomSpell } from "../../wailsjs/go/main/App.js";
    import SpellEditor from "./SpellEditor.svelte";
    import { SCHOOLS } from "../rules/labels.js";
    import ActionCard from "./common/ActionCard.svelte";
    import { usesMax } from "../models/Character.js";
    import { proficiencyBonus } from "../rules/sheet.js";

    let { onBack } = $props();

    let mode = $state("spells"); // 'spells' | 'abilities'
    let spells = $state([]);
    let abilities = $state([]);
    let classes = $state([]);
    let loading = $state(true);
    let error = $state(null);

    let query = $state("");
    let circle = $state("all"); // 'all' | 0..9
    let cls = $state("");       // class id or '' — all
    let school = $state("");    // school id or '' — all

    // custom spell: open form { initial, copy } | null; id awaiting delete confirmation
    let editor = $state(null);
    let confirmDelete = $state(null);
    let status = $state("");
    const isCustom = (s) => !!s.data?.custom;

    function flash(msg) {
        status = msg;
        setTimeout(() => (status = ""), 2500);
    }

    async function reload() {
        const all = await refreshSpells();
        spells = all.filter((s) => s.kind === "spell");
        abilities = all.filter((s) => s.kind !== "spell");
    }

    async function onSaved(id) {
        const wasEdit = editor?.initial && !editor?.copy;
        editor = null;
        await reload();
        const sp = spells.find((s) => s.id === id);
        // show the new spell's level if a different one is selected
        if (sp && circle !== "all" && circle !== sp.level) circle = sp.level;
        flash(wasEdit ? "Changes saved" : "Spell added");
    }

    async function remove(sp) {
        confirmDelete = null;
        try {
            await DeleteCustomSpell(sp.id);
            await reload();
            flash(`“${sp.name}” deleted`);
        } catch (e) {
            flash("Error: " + (e?.message ?? e));
        }
    }

    onMount(async () => {
        try {
            const refs = await loadRefs();
            spells = refs.spells.filter((s) => s.kind === "spell");
            abilities = refs.spells.filter((s) => s.kind !== "spell");
            classes = refs.classes;
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            loading = false;
        }
    });

    const norm = (s) => String(s ?? "").toLowerCase().trim();
    const baseFilter = (s) =>
        (!query || norm(s.name).includes(norm(query))) &&
        (!cls || (s.data?.classes ?? []).includes(cls)) &&
        (!school || s.school === school);

    const filtered = $derived(spells.filter((s) => baseFilter(s) && (circle === "all" || s.level === circle)));
    // how many spells of each level, given the other filters
    const byCircleCount = $derived(
        spells.filter(baseFilter).reduce((acc, s) => ((acc[s.level] = (acc[s.level] ?? 0) + 1), acc), {}),
    );
    const groups = $derived.by(() => {
        const g = {};
        for (const s of filtered) (g[s.level] ??= []).push(s);
        return Object.keys(g)
            .map(Number)
            .sort((a, b) => a - b)
            .map((lvl) => ({ lvl, title: lvl === 0 ? "Cantrips" : `Level ${lvl}`, items: g[lvl].sort((a, b) => a.name.localeCompare(b.name)) }));
    });

    // ---------- special abilities ----------
    let source = $state(""); // '' — all, a class id, or '__race' — species traits
    let abQuery = $state(""); // separate search — not mixed with the spell search

    /** Whose feature this is: class, subclass (→ class) or species. */
    function ownerOf(a) {
        const d = a.data ?? {};
        if (d.subclass) {
            for (const c of classes) {
                const sub = c.subclasses?.find((x) => x.id === d.subclass);
                if (sub) return { group: `${c.name} · ${sub.name}`, classId: c.id, order: 1 };
            }
            return { group: d.subclass, classId: null, order: 1 };
        }
        if (a.kind === "class") {
            const c = classes.find((x) => (d.classes ?? []).includes(x.id));
            return { group: c?.name ?? "Class", classId: c?.id ?? null, order: 0 };
        }
        return { group: d.source ?? "Species", classId: "__race", order: 2 };
    }

    const abFiltered = $derived(
        abilities.filter((a) => {
            if (abQuery && !norm(a.name).includes(norm(abQuery))) return false;
            if (source && ownerOf(a).classId !== source) return false;
            return true;
        }),
    );

    // groups: class → its subclasses → species
    const abGroups = $derived.by(() => {
        const g = new Map();
        for (const a of abFiltered) {
            const o = ownerOf(a);
            if (!g.has(o.group)) g.set(o.group, { ...o, items: [] });
            g.get(o.group).items.push(a);
        }
        const clsIndex = (id) => {
            const i = classes.findIndex((c) => c.id === id);
            return i === -1 ? 999 : i;
        };
        return [...g.values()]
            .sort((x, y) => (x.classId === "__race") - (y.classId === "__race")
                || clsIndex(x.classId) - clsIndex(y.classId)
                || x.order - y.order
                || x.group.localeCompare(y.group))
            .map((grp) => ({ ...grp, items: grp.items.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)) }));
    });

    // uses at the level the feature is gained (for the “N × rest” chip)
    const usesAt = (a) =>
        a.data?.uses
            ? { max: usesMax(a.data.uses, { level: a.level || 1, prof: proficiencyBonus(a.level || 1), mods: {} }), per: a.data.uses.per }
            : null;

    const classNames = (s) =>
        (s.data?.classes ?? []).map((id) => classes.find((c) => c.id === id)?.name).filter(Boolean).join(", ");
</script>

<div class="page">
    <header class="top">
        <button class="ghost" onclick={onBack}>← Menu</button>
        <h1>Spells</h1>
        <nav class="modes">
            <button class="chip" class:active={mode === "spells"} onclick={() => (mode = "spells")}>
                Spells <small>{spells.length}</small>
            </button>
            <button class="chip" class:active={mode === "abilities"} onclick={() => (mode = "abilities")}>
                Special abilities <small>{abilities.length}</small>
            </button>
        </nav>
        <span class="total">
            {#if status}<span class="status">{status}</span>{/if}
            {mode === "spells" ? `${filtered.length} of ${spells.length}` : `${abFiltered.length} of ${abilities.length}`}
        </span>
        {#if mode === "spells" && !loading && !error}
            <button class="add" onclick={() => (editor = { initial: null, copy: false })}>+ Add spell</button>
        {/if}
    </header>

    {#if loading}
        <p class="muted">Loading…</p>
    {:else if error}
        <p class="error">Failed to load: {error}</p>
    {:else if mode === "abilities"}
        <div class="filters">
            <input class="search" type="search" placeholder="Search by name…" bind:value={abQuery} />
            <select bind:value={source}>
                <option value="">All sources</option>
                {#each classes as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
                <option value="__race">Species traits</option>
            </select>
        </div>

        {#each abGroups as g (g.group)}
            <section>
                <h2>{g.group} <small>{g.items.length}</small></h2>
                <div class="cards">
                    {#each g.items as a (a.id)}
                        <ActionCard
                            item={a}
                            level={a.level || 1}
                            source={a.level ? `Level ${a.level}` : ""}
                            uses={usesAt(a)}
                        />
                    {/each}
                </div>
            </section>
        {:else}
            <p class="muted">Nothing found.</p>
        {/each}
    {:else}
        <div class="filters">
            <input class="search" type="search" placeholder="Search by name…" bind:value={query} />
            <select bind:value={cls}>
                <option value="">All classes</option>
                {#each classes as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
            </select>
            <select bind:value={school}>
                <option value="">All schools</option>
                {#each Object.entries(SCHOOLS) as [id, name]}<option value={id}>{name}</option>{/each}
            </select>
        </div>

        <nav class="circles">
            <button class="chip" class:active={circle === "all"} onclick={() => (circle = "all")}>All</button>
            {#each Array.from({ length: 10 }, (_, i) => i) as lvl}
                {#if byCircleCount[lvl]}
                    <button class="chip" class:active={circle === lvl} onclick={() => (circle = lvl)}>
                        {lvl === 0 ? "Cantrips" : `Level ${lvl}`} <small>{byCircleCount[lvl]}</small>
                    </button>
                {/if}
            {/each}
        </nav>

        {#each groups as g (g.lvl)}
            <section>
                <h2>{g.title} <small>{g.items.length}</small></h2>
                <div class="cards">
                    {#each g.items as s (s.id)}
                        <div class="spell" class:custom={isCustom(s)}>
                            <ActionCard item={s} source={[isCustom(s) ? "custom" : "", classNames(s)].filter(Boolean).join(" · ")} />
                            <div class="spell-actions">
                                {#if isCustom(s)}
                                    {#if confirmDelete === s.id}
                                        <span class="ask">Delete?</span>
                                        <button class="ghost small danger" onclick={() => remove(s)}>Yes</button>
                                        <button class="ghost small" onclick={() => (confirmDelete = null)}>No</button>
                                    {:else}
                                        <button class="ghost small" onclick={() => (editor = { initial: s, copy: false })}>Edit</button>
                                        <button class="ghost small" onclick={() => (confirmDelete = s.id)} title="Delete">✕</button>
                                    {/if}
                                {:else}
                                    <button class="ghost small" onclick={() => (editor = { initial: s, copy: true })} title="Create your own based on this one">Copy</button>
                                {/if}
                            </div>
                        </div>
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
        <SpellEditor initial={editor.initial} copy={editor.copy} {classes} {onSaved} onCancel={() => (editor = null)} />
    {/key}
{/if}

<style>
    .page {
        min-height: 100%;
        padding: 32px;
        display: flex;
        flex-direction: column;
        gap: 20px;
    }

    .top {
        display: flex;
        align-items: center;
        gap: 16px;
    }

    h1 {
        margin: 0;
        font-family: var(--font-heading);
        font-weight: var(--font-weight-bold);
        color: var(--color-gold);
    }

    .total {
        margin-left: auto;
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .modes {
        display: flex;
        gap: 6px;
        margin-left: 12px;
    }

    .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
    }

    .search {
        flex: 1 1 280px;
    }

    .search,
    select {
        padding: 8px 12px;
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

    .circles {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
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

    section {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    h2 {
        margin: 0;
        padding-bottom: 6px;
        border-bottom: 1px solid var(--color-border);
        font-family: var(--font-heading);
        font-size: 16px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-gold);
    }

    h2 small {
        margin-left: 6px;
        font-family: var(--font-ui);
        font-size: 12px;
        letter-spacing: 0;
        color: var(--color-text-muted);
    }

    .cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 10px;
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
        padding: 3px 10px;
        font-size: 12px;
    }

    .ghost.danger:hover {
        border-color: var(--color-danger);
        color: var(--color-danger);
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

    .status {
        margin-right: 12px;
        color: var(--color-text-accent);
    }

    /* spell card + buttons: on reference spells they appear on hover */
    .spell {
        position: relative;
        display: flex;
        flex-direction: column;
    }

    .spell > :global(.card) {
        flex: 1;
    }

    .spell.custom > :global(.card) {
        border-color: color-mix(in srgb, var(--color-magic-purple) 60%, var(--color-border));
    }

    .spell-actions {
        position: absolute;
        right: 8px;
        bottom: 8px;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 3px;
        background: var(--color-card-elevated);
        border-radius: 8px;
        opacity: 0;
        transition: opacity 0.15s;
    }

    .spell:hover .spell-actions,
    .spell:focus-within .spell-actions,
    .spell.custom .spell-actions {
        opacity: 1;
    }

    .spell.custom > :global(.card) {
        padding-bottom: 40px; /* room for the custom spell buttons */
    }

    .ask {
        font-family: var(--font-ui);
        font-size: 12px;
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
</style>
