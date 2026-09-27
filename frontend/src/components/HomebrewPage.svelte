<script>
    /**
     * “Homebrew” — export the user's own items, spells and monsters to a JSON file
     * and import such a file (see homebrew.js).
     *   Export: tick what goes into the file (all by default) → Export.
     *   Import: pick a file → a preview: what's new, what's the same, what differs
     *           from the version here → Import the ticked records.
     * onBack() — to the menu
     */
    import { onMount } from "svelte";
    import { localHomebrew, exportHomebrew, openHomebrew, applyHomebrew } from "../homebrew.js";
    import { CREATURE_TYPES, crLabel } from "../data/bestiary.js";
    import { SCHOOLS } from "../rules/labels.js";

    let { onBack } = $props();

    const GROUP_TITLES = { equipment: "Items", spells: "Spells & abilities", monsters: "Monsters" };
    const KIND_LABELS = { weapon: "Weapon", armor: "Armor", item: "Gear" };
    const STATUS_LABELS = { new: "New", changed: "Differs from yours", same: "Already here", builtin: "Built-in id — skipped" };

    let local = $state.raw({ equipment: [], spells: [], monsters: [] });
    let picked = $state({}); // id → true (export)
    let loading = $state(true);
    let error = $state("");
    let busy = $state(""); // 'export' | 'open' | 'import'
    let notice = $state(null); // { ok, text }
    let preview = $state(null); // { file, plan, picked: { index → true } }

    // rows for the export list: { id, name, meta, fromDM }
    const rows = $derived({
        equipment: local.equipment.map(({ kind, record }) => ({
            id: record.id,
            name: record.name,
            meta: [KIND_LABELS[kind], record.category].filter(Boolean).join(" · "),
            fromDM: !!record.data?.fromDM,
        })),
        spells: local.spells.map((sp) => ({ id: sp.id, name: sp.name, meta: spellMeta(sp) })),
        monsters: local.monsters.map((m) => ({ id: m.id, name: m.name, meta: monsterMeta(m) })),
    });

    function spellMeta(sp) {
        if (sp.kind && sp.kind !== "spell") return `Ability · level ${sp.level}`;
        const lvl = sp.level ? `Level ${sp.level}` : "Cantrip";
        return [lvl, SCHOOLS[sp.school] ?? sp.school].filter(Boolean).join(" · ");
    }

    const monsterMeta = (m) => [`CR ${crLabel(m.cr)}`, CREATURE_TYPES[m.type] ?? m.type].join(" · ");

    const total = $derived(rows.equipment.length + rows.spells.length + rows.monsters.length);
    const pickedCount = $derived(Object.values(picked).filter(Boolean).length);

    async function reload() {
        local = await localHomebrew();
        // new records are ticked, the ones that are gone are dropped
        const next = {};
        for (const g of Object.values(rows)) for (const r of g) next[r.id] = picked[r.id] ?? true;
        picked = next;
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

    const allPicked = (g) => rows[g].length > 0 && rows[g].every((r) => picked[r.id]);
    function pickGroup(g, on) {
        for (const r of rows[g]) picked[r.id] = on;
    }

    let noticeTimer;
    function say(ok, text, ms = 5000) {
        notice = { ok, text };
        clearTimeout(noticeTimer);
        if (ms) noticeTimer = setTimeout(() => (notice = null), ms);
    }

    async function doExport() {
        if (busy || !pickedCount) return;
        busy = "export";
        try {
            const ids = Object.keys(picked).filter((id) => picked[id]);
            const { path, count } = await exportHomebrew(ids);
            if (path) say(true, `Exported ${count} record${count === 1 ? "" : "s"} to ${path}`);
        } catch (e) {
            say(false, "Export failed: " + (e?.message ?? e), 0);
        } finally {
            busy = "";
        }
    }

    async function doOpen() {
        if (busy) return;
        busy = "open";
        notice = null;
        try {
            const r = await openHomebrew();
            if (!r) return;
            const sel = {};
            r.plan.forEach((e, i) => {
                if (e.status === "new") sel[i] = true;
            });
            preview = { file: r.file, plan: r.plan, picked: sel };
        } catch (e) {
            say(false, e?.message ?? String(e), 0);
        } finally {
            busy = "";
        }
    }

    const importable = (e) => e.status === "new" || e.status === "changed";
    const previewGroups = $derived.by(() => {
        if (!preview) return [];
        return ["equipment", "spells", "monsters"]
            .map((g) => ({ g, list: preview.plan.map((e, i) => ({ e, i })).filter((x) => x.e.group === g) }))
            .filter((x) => x.list.length);
    });
    const counts = $derived.by(() => {
        const c = { new: 0, changed: 0, same: 0, builtin: 0 };
        for (const e of preview?.plan ?? []) c[e.status]++;
        return c;
    });
    const toImport = $derived(preview ? preview.plan.filter((e, i) => preview.picked[i] && importable(e)).length : 0);

    function pickStatus(status, on) {
        preview.plan.forEach((e, i) => {
            if (e.status === status) preview.picked[i] = on;
        });
    }

    function entryMeta(e) {
        if (e.group === "equipment") return [KIND_LABELS[e.kind], e.def.category].filter(Boolean).join(" · ");
        if (e.group === "spells") return spellMeta(e.def);
        return monsterMeta(e.def);
    }

    async function doImport() {
        if (busy || !toImport) return;
        busy = "import";
        try {
            const chosen = preview.plan.filter((e, i) => preview.picked[i] && importable(e));
            const r = await applyHomebrew(chosen);
            preview = null;
            await reload();
            const parts = [];
            if (r.added) parts.push(`added ${r.added}`);
            if (r.updated) parts.push(`updated ${r.updated}`);
            const done = parts.length ? `Imported: ${parts.join(", ")}.` : "Nothing imported.";
            if (r.failed.length) say(false, `${done} Failed: ${r.failed.map((f) => `${f.name} (${f.error})`).join("; ")}`, 0);
            else say(true, done);
        } catch (e) {
            say(false, "Import failed: " + (e?.message ?? e), 0);
        } finally {
            busy = "";
        }
    }

    const onKey = (e) => {
        if (e.key === "Escape" && preview && !busy) preview = null;
    };
</script>

<svelte:window onkeydown={onKey} />

<div class="page">
    <header class="top">
        <button class="ghost" onclick={onBack}>← Menu</button>
        <h1>Homebrew</h1>
        <span class="spacer"></span>
        <button class="ghost" onclick={doOpen} disabled={!!busy || loading}>
            {busy === "open" ? "Opening…" : "Import…"}
        </button>
        <button class="add" onclick={doExport} disabled={!!busy || loading || !pickedCount}>
            {busy === "export" ? "Exporting…" : `Export ${pickedCount || ""}`.trim()}
        </button>
    </header>

    <p class="lead">
        Your own items, spells and monsters in one file — to move them to another computer or share them
        with the table. Records keep their ids: importing the same file twice doesn't duplicate anything.
    </p>

    {#if notice}
        <div class="notice" class:bad={!notice.ok} role="status">
            <span>{notice.text}</span>
            <button class="x" onclick={() => (notice = null)} aria-label="Dismiss">✕</button>
        </div>
    {/if}

    {#if loading}
        <p class="muted">Loading…</p>
    {:else if error}
        <p class="error">Failed to load: {error}</p>
    {:else if !total}
        <p class="muted">
            No homebrew yet. Create items on the Items page, spells on the Spells page and monsters in the
            Bestiary — or import a file.
        </p>
    {:else}
        <div class="groups">
            {#each ["equipment", "spells", "monsters"] as g (g)}
                <section class="group">
                    <header>
                        <label class="check">
                            <input
                                type="checkbox"
                                checked={allPicked(g)}
                                disabled={!rows[g].length}
                                onchange={(e) => pickGroup(g, e.currentTarget.checked)}
                            />
                            <h2>{GROUP_TITLES[g]}</h2>
                        </label>
                        <span class="count">{rows[g].filter((r) => picked[r.id]).length} / {rows[g].length}</span>
                    </header>
                    {#if rows[g].length}
                        <ul>
                            {#each rows[g] as r (r.id)}
                                <li>
                                    <label class="check">
                                        <input type="checkbox" bind:checked={picked[r.id]} />
                                        <span class="name">{r.name}</span>
                                    </label>
                                    <span class="meta">{r.meta}</span>
                                    {#if r.fromDM}<span class="tag" title="Received from the DM">from DM</span>{/if}
                                </li>
                            {/each}
                        </ul>
                    {:else}
                        <p class="muted small">None</p>
                    {/if}
                </section>
            {/each}
        </div>
    {/if}
</div>

{#if preview}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="backdrop" onclick={(e) => e.target === e.currentTarget && !busy && (preview = null)}>
        <div class="dialog" role="dialog" aria-modal="true" aria-label="Import homebrew">
            <header>
                <h2>Import homebrew</h2>
                {#if preview.file.appVersion}<span class="from">from DnD Builder {preview.file.appVersion}</span>{/if}
                <button class="x" onclick={() => (preview = null)} disabled={!!busy} aria-label="Close">✕</button>
            </header>

            <div class="summary">
                {#if counts.new}<span class="st new">{counts.new} new</span>{/if}
                {#if counts.changed}
                    <span class="st changed">{counts.changed} differ from yours</span>
                    <button class="link" onclick={() => pickStatus("changed", true)}>replace all mine</button>
                    <button class="link" onclick={() => pickStatus("changed", false)}>keep all mine</button>
                {/if}
                {#if counts.same}<span class="st same">{counts.same} already here</span>{/if}
                {#if counts.builtin}<span class="st builtin">{counts.builtin} skipped</span>{/if}
            </div>

            <div class="body">
                {#each previewGroups as { g, list } (g)}
                    <section>
                        <h3>{GROUP_TITLES[g]}</h3>
                        <ul>
                            {#each list as { e, i } (i)}
                                <li class:off={!importable(e)}>
                                    <label class="check">
                                        <input type="checkbox" bind:checked={preview.picked[i]} disabled={!importable(e)} />
                                        <span class="name">{e.def.name}</span>
                                    </label>
                                    <span class="meta">{entryMeta(e)}</span>
                                    <span class="st {e.status}">
                                        {e.status === "changed" && preview.picked[i] ? "Replaces yours" : STATUS_LABELS[e.status]}
                                    </span>
                                </li>
                            {/each}
                        </ul>
                    </section>
                {/each}
            </div>

            <footer>
                <button class="ghost" onclick={() => (preview = null)} disabled={!!busy}>Cancel</button>
                <button class="add" onclick={doImport} disabled={!!busy || !toImport}>
                    {busy === "import" ? "Importing…" : toImport ? `Import ${toImport}` : "Nothing to import"}
                </button>
            </footer>
        </div>
    </div>
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
        gap: 12px;
    }

    .spacer {
        flex: 1;
    }

    h1 {
        margin: 0;
        font-family: var(--font-heading);
        font-weight: var(--font-weight-bold);
        color: var(--color-gold);
    }

    .lead {
        margin: 0;
        max-width: 720px;
        color: var(--color-text-secondary);
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

    .add:not(:disabled):hover {
        background: var(--color-gold-hover);
    }

    .ghost {
        padding: 7px 14px;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        cursor: pointer;
    }

    .ghost:not(:disabled):hover {
        border-color: var(--color-gold);
        color: var(--color-gold-hover);
    }

    button:disabled {
        opacity: 0.55;
        cursor: default;
    }

    .notice {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        border: 1px solid var(--color-success);
        border-left-width: 3px;
        border-radius: 8px;
        background: var(--color-card);
        font-family: var(--font-ui);
        font-size: 14px;
        color: var(--color-text-primary);
    }

    .notice span {
        flex: 1;
        word-break: break-word;
    }

    .notice.bad {
        border-color: var(--color-danger);
    }

    .x {
        width: 26px;
        height: 26px;
        padding: 0;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 5px;
        color: var(--color-text-muted);
        cursor: pointer;
    }

    .x:not(:disabled):hover {
        border-color: var(--color-border);
        color: var(--color-text-primary);
    }

    .groups {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 16px;
        align-items: start;
    }

    .group {
        padding: 14px 16px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 10px;
    }

    .group > header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding-bottom: 10px;
        margin-bottom: 6px;
        border-bottom: 1px solid var(--color-border);
    }

    h2 {
        margin: 0;
        font-family: var(--font-heading-alt);
        font-size: 18px;
        color: var(--color-gold);
    }

    .count {
        margin-left: auto;
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-muted);
    }

    ul {
        margin: 0;
        padding: 0;
        list-style: none;
    }

    li {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 5px 0;
        font-family: var(--font-ui);
        font-size: 14px;
    }

    li.off {
        opacity: 0.6;
    }

    .check {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        cursor: pointer;
    }

    .check input {
        accent-color: var(--color-gold);
        flex: none;
    }

    .name {
        color: var(--color-text-primary);
        overflow-wrap: anywhere;
    }

    .meta {
        margin-left: auto;
        flex: none;
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .tag {
        flex: none;
        padding: 1px 6px;
        border: 1px solid var(--color-magic-purple);
        border-radius: 4px;
        font-size: 11px;
        color: var(--color-magic-purple);
    }

    .muted {
        margin: 0;
        color: var(--color-text-muted);
    }

    .muted.small {
        font-size: 13px;
    }

    .error {
        margin: 0;
        color: var(--color-danger);
    }

    /* ---- import preview ---- */

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
        width: min(760px, 100%);
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

    .dialog > header {
        display: flex;
        align-items: baseline;
        gap: 12px;
    }

    .dialog > header .x {
        margin-left: auto;
    }

    .from {
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .summary {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 12px;
        font-family: var(--font-ui);
        font-size: 13px;
    }

    .link {
        padding: 0;
        background: none;
        border: none;
        color: var(--color-text-accent);
        font-family: var(--font-ui);
        font-size: 13px;
        text-decoration: underline;
        cursor: pointer;
    }

    .body {
        min-height: 0;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    h3 {
        margin: 0 0 4px;
        font-family: var(--font-heading-alt);
        font-size: 15px;
        color: var(--color-text-accent);
    }

    .st {
        flex: none;
        padding: 1px 7px;
        border: 1px solid currentColor;
        border-radius: 4px;
        font-family: var(--font-ui);
        font-size: 11px;
    }

    .st.new {
        color: var(--color-success);
    }

    .st.changed {
        color: var(--color-gold);
    }

    .st.same,
    .st.builtin {
        color: var(--color-text-muted);
    }

    .dialog footer {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
    }
</style>
