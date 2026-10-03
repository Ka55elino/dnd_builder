<script>
    /**
     * Campaign → Quests: plot threads (main / side / personal) with status, who gave them,
     * where, the reward and a checklist of objectives. The list is grouped by status
     * (active first); objectives can be ticked right in the list.
     *
     * campaign — the campaign ({ id, … }); onChanged() — after a save/delete
     */
    import { onMount } from "svelte";
    import "./campaign.css";
    import RefHistory from "./RefHistory.svelte";
    import {
        loadQuests, saveQuest, deleteQuest, loadNpcs, loadLocations, locationTree,
        QUEST_KINDS, QUEST_STATUSES,
    } from "../../data/campaigns.js";

    let { campaign, onChanged } = $props();

    let quests = $state([]);
    let npcs = $state([]);
    let locations = $state([]);
    let loading = $state(true);
    let error = $state("");
    let query = $state("");
    let fKind = $state("");
    let showClosed = $state(true);

    let edit = $state(null);
    let saving = $state(false);
    let editError = $state("");
    let confirmDelete = $state(false);

    const name = (list, id) => list.find((x) => x.id === id)?.name ?? "";
    const tree = $derived(locationTree(locations));
    const locName = (id) => tree.find((t) => t.loc.id === id)?.path ?? "";
    const objectives = (q) => q.data?.objectives ?? [];
    const progress = (q) => {
        const o = objectives(q);
        return o.length ? `${o.filter((x) => x.done).length}/${o.length}` : "";
    };

    async function reload() {
        [quests, npcs, locations] = await Promise.all([loadQuests(campaign.id), loadNpcs(campaign.id), loadLocations(campaign.id)]);
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

    const CLOSED = new Set(["completed", "failed", "abandoned"]);
    const groups = $derived.by(() => {
        const q = query.trim().toLowerCase();
        const match = (x) =>
            (!fKind || x.kind === fKind) &&
            (showClosed || !CLOSED.has(x.status)) &&
            (!q || [x.name, x.reward, x.data?.summary, x.data?.notes, name(npcs, x.giverNpcId)].some((v) => String(v ?? "").toLowerCase().includes(q)));
        return QUEST_STATUSES.map((s) => ({ ...s, items: quests.filter((x) => x.status === s.id && match(x)) })).filter((g) => g.items.length);
    });

    function open(q = null) {
        const d = q?.data ?? {};
        edit = {
            id: q?.id ?? "",
            name: q?.name ?? "",
            kind: q?.kind ?? "side",
            status: q?.status ?? "open",
            giverNpcId: q?.giverNpcId ?? "",
            locationId: q?.locationId ?? "",
            reward: q?.reward ?? "",
            visible: !!q?.visible,
            summary: d.summary ?? "",
            objectives: (d.objectives ?? []).map((o) => ({ text: o.text ?? "", done: !!o.done })),
            notes: d.notes ?? "",
            tags: (d.tags ?? []).join(", "),
            rest: d,
        };
        editError = "";
        confirmDelete = false;
    }

    const toData = (f) => ({
        ...f.rest,
        summary: f.summary.trim(),
        objectives: f.objectives.map((o) => ({ text: o.text.trim(), done: !!o.done })).filter((o) => o.text),
        notes: f.notes.trim(),
        tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
    });

    async function save() {
        if (!edit?.name.trim() || saving) return;
        saving = true;
        editError = "";
        const { rest, summary, objectives: obj, notes, tags, ...base } = edit; // eslint-disable-line no-unused-vars
        try {
            await saveQuest({ ...base, campaignId: campaign.id, data: toData(edit) });
            await reload();
            onChanged?.();
            edit = null;
        } catch (e) {
            editError = e?.message ?? String(e);
        } finally {
            saving = false;
        }
    }

    // tick an objective in the list (saves at once)
    async function tick(q, i) {
        const data = { ...q.data, objectives: objectives(q).map((o, j) => (j === i ? { ...o, done: !o.done } : o)) };
        try {
            await saveQuest({ ...q, data });
            await reload();
        } catch (e) {
            error = e?.message ?? String(e);
        }
    }

    async function remove() {
        try {
            await deleteQuest(edit.id);
            await reload();
            onChanged?.();
            edit = null;
        } catch (e) {
            editError = e?.message ?? String(e);
        }
    }

    function onKey(e) {
        if (!edit) return;
        if (e.key === "Escape") edit = null;
        else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            save();
        }
    }
</script>

<svelte:window onkeydown={onKey} />

<div class="cp-toolbar">
    <input class="cp-input cp-search" type="search" placeholder="Search name, giver, reward…" bind:value={query} />
    <select class="cp-select" bind:value={fKind} aria-label="Kind">
        <option value="">All kinds</option>
        {#each QUEST_KINDS as k (k.id)}<option value={k.id}>{k.name}</option>{/each}
    </select>
    <label class="cp-check"><input type="checkbox" bind:checked={showClosed} /> Show finished</label>
    <span class="cp-grow"></span>
    <span class="cp-muted">{quests.length} quest{quests.length === 1 ? "" : "s"}</span>
    <button class="cp-btn cp-add" onclick={() => open()}>+ New quest</button>
</div>

{#if loading}
    <p class="cp-muted">Loading…</p>
{:else if error}
    <p class="cp-error">{error}</p>
{:else if !quests.length}
    <div class="cp-empty">
        <p>No quests yet.</p>
        <button class="cp-btn cp-add" onclick={() => open()}>+ Add the first quest</button>
    </div>
{:else}
    {#each groups as g (g.id)}
        <p class="cp-h">{g.name} <span class="cp-muted">{g.items.length}</span></p>
        <div class="quests">
            {#each g.items as q (q.id)}
                <article class="quest st-{q.status}" class:sel={edit?.id === q.id}>
                    <button class="q-head" onclick={() => open(q)}>
                        <span class="q-name">{q.name}</span>
                        <span class="cp-chip k-{q.kind}">{name(QUEST_KINDS, q.kind)}</span>
                        {#if progress(q)}<span class="q-prog">{progress(q)}</span>{/if}
                    </button>
                    {#if q.data?.summary}<p class="q-sum">{q.data.summary}</p>{/if}
                    {#if objectives(q).length}
                        <ul class="q-obj">
                            {#each objectives(q) as o, i}
                                <li class:done={o.done}>
                                    <label><input type="checkbox" checked={o.done} onchange={() => tick(q, i)} /> {o.text}</label>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                    <p class="q-meta">
                        {#if q.giverNpcId}<span>from <b>{name(npcs, q.giverNpcId)}</b></span>{/if}
                        {#if q.locationId}<span>at <b>{locName(q.locationId)}</b></span>{/if}
                        {#if q.reward}<span>reward: {q.reward}</span>{/if}
                        {#if q.visible}<span title="The players know it">known</span>{/if}
                    </p>
                </article>
            {/each}
        </div>
    {:else}
        <p class="cp-muted">Nothing matches.</p>
    {/each}
{/if}

{#if edit}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="cp-drawer-back" onclick={() => (edit = null)}></div>
    <div class="cp-drawer" role="dialog" aria-modal="true" aria-label="Quest">
        <header>
            <h2>{edit.id ? edit.name || "Quest" : "New quest"}</h2>
            <button class="cp-btn cp-sm" onclick={() => (edit = null)} aria-label="Close">✕</button>
        </header>
        <div class="cp-body">
            <label class="cp-field">
                <span>Name</span>
                <!-- svelte-ignore a11y_autofocus -->
                <input class="cp-input" bind:value={edit.name} maxlength="120" autofocus />
            </label>
            <div class="cp-row">
                <label class="cp-field">
                    <span>Kind</span>
                    <select class="cp-select" bind:value={edit.kind}>
                        {#each QUEST_KINDS as k (k.id)}<option value={k.id}>{k.name}</option>{/each}
                    </select>
                </label>
                <label class="cp-field">
                    <span>Status</span>
                    <select class="cp-select" bind:value={edit.status}>
                        {#each QUEST_STATUSES as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
                    </select>
                </label>
            </div>
            <div class="cp-row">
                <label class="cp-field">
                    <span>Given by</span>
                    <select class="cp-select" bind:value={edit.giverNpcId}>
                        <option value="">— nobody —</option>
                        {#each npcs as n (n.id)}<option value={n.id}>{n.name}</option>{/each}
                    </select>
                </label>
                <label class="cp-field">
                    <span>Where</span>
                    <select class="cp-select" bind:value={edit.locationId}>
                        <option value="">— anywhere —</option>
                        {#each tree as t (t.loc.id)}<option value={t.loc.id}>{" ".repeat(t.depth * 2)}{t.loc.name}</option>{/each}
                    </select>
                </label>
            </div>
            <label class="cp-field"><span>Reward</span><input class="cp-input" bind:value={edit.reward} placeholder="50 gp, a favour, a magic sword…" /></label>
            <label class="cp-check"><input type="checkbox" bind:checked={edit.visible} /> The players know about this quest</label>

            <label class="cp-field"><span>Summary</span><textarea class="cp-textarea" rows="3" bind:value={edit.summary}></textarea></label>

            <p class="cp-h">Objectives</p>
            {#each edit.objectives as o, i}
                <div class="obj-row">
                    <input type="checkbox" bind:checked={o.done} aria-label="Done" />
                    <input class="cp-input grow" bind:value={o.text} placeholder="Find the missing caravan…" />
                    <button class="cp-btn cp-sm" disabled={i === 0} onclick={() => ([edit.objectives[i - 1], edit.objectives[i]] = [edit.objectives[i], edit.objectives[i - 1]])}
                        aria-label="Up">↑</button
                    >
                    <button class="cp-btn cp-sm cp-danger" onclick={() => edit.objectives.splice(i, 1)} aria-label="Remove">✕</button>
                </div>
            {/each}
            <button class="cp-btn cp-sm add-line" onclick={() => edit.objectives.push({ text: "", done: false })}>+ Objective</button>

            <p class="cp-h">DM only</p>
            <label class="cp-field"><span>Notes, clues, twists</span><textarea class="cp-textarea cp-secret" rows="4" bind:value={edit.notes}></textarea></label>
            <label class="cp-field"><span>Tags (comma separated)</span><input class="cp-input" bind:value={edit.tags} placeholder="chapter 1" /></label>
            {#if edit.id}<RefHistory campaignId={campaign.id} refType="quest" refId={edit.id} />{/if}
        </div>
        <footer>
            {#if edit.id}
                {#if confirmDelete}
                    <span class="cp-muted">Delete {edit.name}?</span>
                    <button class="cp-btn cp-sm cp-danger" onclick={remove}>Delete</button>
                    <button class="cp-btn cp-sm" onclick={() => (confirmDelete = false)}>No</button>
                {:else}
                    <button class="cp-btn cp-sm cp-danger" onclick={() => (confirmDelete = true)}>Delete</button>
                {/if}
            {/if}
            <span class="cp-grow cp-error">{editError}</span>
            <button class="cp-btn" onclick={() => (edit = null)}>Cancel</button>
            <button class="cp-btn cp-primary" onclick={save} disabled={!edit.name.trim() || saving} title="Save (Ctrl/Cmd+S)"
                >{saving ? "Saving…" : "Save"}</button
            >
        </footer>
    </div>
{/if}

<style>
    .quests {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 12px;
    }

    .quest {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 10px 14px 12px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-left: 3px solid var(--color-border);
        border-radius: 10px;
        font-size: 13px;
    }

    .quest.st-active {
        border-left-color: var(--color-gold);
    }

    .quest.st-completed {
        border-left-color: var(--color-success);
        opacity: 0.8;
    }

    .quest.st-failed,
    .quest.st-abandoned {
        border-left-color: var(--color-danger);
        opacity: 0.7;
    }

    .quest.sel {
        border-color: var(--color-gold);
    }

    .q-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0;
        background: none;
        border: none;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
    }

    .q-name {
        flex: 1;
        font-family: var(--font-heading);
        font-size: 17px;
        color: var(--color-text-primary);
    }

    .q-head:hover .q-name {
        color: var(--color-gold-hover);
    }

    .k-main {
        border-color: var(--color-gold);
        color: var(--color-gold);
    }

    .q-prog {
        font-size: 12px;
        color: var(--color-text-accent);
    }

    .q-sum {
        margin: 0;
        color: var(--color-text-secondary);
        line-height: 1.4;
    }

    .q-obj {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 3px;
    }

    .q-obj label {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        color: var(--color-text-secondary);
        cursor: pointer;
    }

    .q-obj li.done label {
        color: var(--color-text-muted);
        text-decoration: line-through;
    }

    .q-meta {
        margin: 2px 0 0;
        display: flex;
        flex-wrap: wrap;
        gap: 4px 12px;
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .q-meta b {
        color: var(--color-text-secondary);
        font-weight: 600;
    }

    .obj-row {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .grow {
        flex: 1;
        min-width: 0;
    }

    .add-line {
        align-self: flex-start;
    }
</style>
