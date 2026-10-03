<script>
    /**
     * Campaign → Factions: guilds, cults, houses… with their attitude to the party, the party's
     * reputation (-10…10), leader, headquarters and members. Members are NPCs linked to the
     * faction (npc → faction "member_of"; the link's note is their rank) — the same links the
     * campaign board will draw.
     *
     * campaign — the campaign ({ id, … }); onChanged() — after a save/delete
     */
    import { onMount } from "svelte";
    import "./campaign.css";
    import RefHistory from "./RefHistory.svelte";
    import ImagePick from "./ImagePick.svelte";
    import {
        loadFactions, saveFaction, deleteFaction, loadNpcs, loadLocations, locationTree,
        loadLinks, saveLink, deleteLink, NPC_ATTITUDES, FACTION_TYPES,
    } from "../../data/campaigns.js";

    let { campaign, onChanged } = $props();

    let factions = $state([]);
    let npcs = $state([]);
    let locations = $state([]);
    let links = $state([]);
    let loading = $state(true);
    let error = $state("");
    let query = $state("");

    let edit = $state(null);
    let saving = $state(false);
    let editError = $state("");
    let confirmDelete = $state(false);

    const name = (list, id) => list.find((x) => x.id === id)?.name ?? "";
    const tree = $derived(locationTree(locations));
    const locName = (id) => tree.find((t) => t.loc.id === id)?.path ?? "";
    const memberLinks = (fid) => links.filter((l) => l.kind === "member_of" && l.toType === "faction" && l.toId === fid && l.fromType === "npc");

    async function reload() {
        [factions, npcs, locations, links] = await Promise.all([
            loadFactions(campaign.id), loadNpcs(campaign.id), loadLocations(campaign.id), loadLinks(campaign.id),
        ]);
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

    const shown = $derived.by(() => {
        const q = query.trim().toLowerCase();
        return factions.filter((f) => !q || [f.name, f.type, f.data?.description, f.data?.goals].some((v) => String(v ?? "").toLowerCase().includes(q)));
    });

    function open(f = null) {
        const d = f?.data ?? {};
        // one entry per NPC (ticked = member), filled here — not while rendering
        const members = Object.fromEntries(npcs.map((n) => [n.id, { on: false, rank: "", linkId: "" }]));
        if (f) for (const l of memberLinks(f.id)) members[l.fromId] = { on: true, rank: l.note, linkId: l.id };
        edit = {
            id: f?.id ?? "",
            name: f?.name ?? "",
            type: f?.type ?? "",
            emblem: f?.emblem ?? "",
            attitude: f?.attitude ?? "neutral",
            reputation: f?.reputation ?? 0,
            leaderNpcId: f?.leaderNpcId ?? "",
            hqLocationId: f?.hqLocationId ?? "",
            visible: !!f?.visible,
            description: d.description ?? "",
            goals: d.goals ?? "",
            secret: d.secret ?? "",
            notes: d.notes ?? "",
            tags: (d.tags ?? []).join(", "),
            rest: d,
            members,
        };
        editError = "";
        confirmDelete = false;
    }

    async function save() {
        if (!edit?.name.trim() || saving) return;
        saving = true;
        editError = "";
        const { rest, description, goals, secret, notes, tags, members, ...base } = edit;
        try {
            const id = await saveFaction({
                ...base,
                reputation: Math.round(Number(base.reputation) || 0),
                campaignId: campaign.id,
                data: {
                    ...rest,
                    description: description.trim(),
                    goals: goals.trim(),
                    secret: secret.trim(),
                    notes: notes.trim(),
                    tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
                },
            });
            // members: add / update rank / remove links (the leader is added as a member too)
            const want = { ...members };
            if (base.leaderNpcId && !want[base.leaderNpcId]?.on) want[base.leaderNpcId] = { on: true, rank: "leader", linkId: want[base.leaderNpcId]?.linkId ?? "" };
            for (const [nid, m] of Object.entries(want)) {
                if (m.on) {
                    await saveLink({ campaignId: campaign.id, fromType: "npc", fromId: nid, toType: "faction", toId: id, kind: "member_of", note: m.rank ?? "" });
                } else if (m.linkId) {
                    await deleteLink(m.linkId);
                }
            }
            await reload();
            onChanged?.();
            edit = null;
        } catch (e) {
            editError = e?.message ?? String(e);
        } finally {
            saving = false;
        }
    }

    async function remove() {
        try {
            await deleteFaction(edit.id);
            await reload();
            onChanged?.();
            edit = null;
        } catch (e) {
            editError = e?.message ?? String(e);
        }
    }

    const repLabel = (r) => (r >= 6 ? "Honoured" : r >= 2 ? "Friendly" : r > -2 ? "Neutral" : r > -6 ? "Distrusted" : "Hated");

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
    <input class="cp-input cp-search" type="search" placeholder="Search name, type, goals…" bind:value={query} />
    <span class="cp-grow"></span>
    <span class="cp-muted">{factions.length} faction{factions.length === 1 ? "" : "s"}</span>
    <button class="cp-btn cp-add" onclick={() => open()}>+ New faction</button>
</div>

{#if loading}
    <p class="cp-muted">Loading…</p>
{:else if error}
    <p class="cp-error">{error}</p>
{:else if !factions.length}
    <div class="cp-empty">
        <p>No factions yet.</p>
        <button class="cp-btn cp-add" onclick={() => open()}>+ Add the first faction</button>
    </div>
{:else}
    <div class="factions">
        {#each shown as f (f.id)}
            {@const mem = memberLinks(f.id)}
            <button class="faction" class:sel={edit?.id === f.id} onclick={() => open(f)}>
                <span class="f-top">
                    {#if f.emblem}<img class="emb" src={f.emblem} alt="" />{:else}<span class="emb">{f.name[0]}</span>{/if}
                    <span class="f-title">
                        <span class="f-name">{f.name}</span>
                        <span class="f-type">{f.type}</span>
                    </span>
                    <span class="cp-chip cp-att-{f.attitude}">{name(NPC_ATTITUDES, f.attitude)}</span>
                </span>
                {#if f.data?.description}<span class="f-desc">{f.data.description}</span>{/if}
                <span class="rep" title="Reputation {f.reputation} — {repLabel(f.reputation)}">
                    <span class="rep-bar"><span class="rep-fill" class:neg={f.reputation < 0}
                            style:left="{f.reputation < 0 ? 50 + f.reputation * 5 : 50}%"
                            style:width="{Math.abs(f.reputation) * 5}%"></span></span>
                    <span class="rep-n">{f.reputation > 0 ? "+" : ""}{f.reputation} · {repLabel(f.reputation)}</span>
                </span>
                <span class="f-meta">
                    {#if f.leaderNpcId}<span>led by <b>{name(npcs, f.leaderNpcId)}</b></span>{/if}
                    {#if f.hqLocationId}<span>based at <b>{locName(f.hqLocationId)}</b></span>{/if}
                    {#if mem.length}<span title={mem.map((l) => name(npcs, l.fromId)).join(", ")}>{mem.length} member{mem.length === 1 ? "" : "s"}</span>{/if}
                </span>
            </button>
        {:else}
            <p class="cp-muted">Nothing matches.</p>
        {/each}
    </div>
{/if}

{#if edit}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="cp-drawer-back" onclick={() => (edit = null)}></div>
    <div class="cp-drawer" role="dialog" aria-modal="true" aria-label="Faction">
        <header>
            <h2>{edit.id ? edit.name || "Faction" : "New faction"}</h2>
            <button class="cp-btn cp-sm" onclick={() => (edit = null)} aria-label="Close">✕</button>
        </header>
        <div class="cp-body">
            <ImagePick bind:value={edit.emblem} letter={edit.name?.[0] ?? "?"} label="Emblem" />
            <label class="cp-field">
                <span>Name</span>
                <!-- svelte-ignore a11y_autofocus -->
                <input class="cp-input" bind:value={edit.name} maxlength="120" autofocus />
            </label>
            <div class="cp-row">
                <label class="cp-field">
                    <span>Type</span>
                    <input class="cp-input" bind:value={edit.type} list="faction-types" placeholder="Guild" />
                    <datalist id="faction-types">{#each FACTION_TYPES as x}<option value={x}></option>{/each}</datalist>
                </label>
                <label class="cp-field">
                    <span>Attitude to the party</span>
                    <select class="cp-select" bind:value={edit.attitude}>
                        {#each NPC_ATTITUDES as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
                    </select>
                </label>
            </div>
            <label class="cp-field">
                <span>The party's reputation: <b class="rep-val">{edit.reputation > 0 ? "+" : ""}{edit.reputation} · {repLabel(edit.reputation)}</b></span>
                <input type="range" min="-10" max="10" step="1" bind:value={edit.reputation} />
            </label>
            <div class="cp-row">
                <label class="cp-field">
                    <span>Leader</span>
                    <select class="cp-select" bind:value={edit.leaderNpcId}>
                        <option value="">— none —</option>
                        {#each npcs as n (n.id)}<option value={n.id}>{n.name}</option>{/each}
                    </select>
                </label>
                <label class="cp-field">
                    <span>Headquarters</span>
                    <select class="cp-select" bind:value={edit.hqLocationId}>
                        <option value="">— none —</option>
                        {#each tree as t (t.loc.id)}<option value={t.loc.id}>{" ".repeat(t.depth * 2)}{t.loc.name}</option>{/each}
                    </select>
                </label>
            </div>
            <label class="cp-check"><input type="checkbox" bind:checked={edit.visible} /> The players know this faction</label>

            <label class="cp-field"><span>Description</span><textarea class="cp-textarea" rows="3" bind:value={edit.description}></textarea></label>
            <label class="cp-field"><span>Goals</span><textarea class="cp-textarea" rows="2" bind:value={edit.goals}></textarea></label>

            <p class="cp-h">Members</p>
            {#if npcs.length}
                <ul class="members">
                    {#each npcs as n (n.id)}
                        {@const m = edit.members[n.id]}
                        <li class:on={m.on || edit.leaderNpcId === n.id}>
                            <label class="cp-check"><input type="checkbox" bind:checked={m.on} /> {n.name}</label>
                            {#if m.on}<input class="cp-input rank" bind:value={m.rank} placeholder="rank / role" aria-label="Rank of {n.name}" />{/if}
                            {#if edit.leaderNpcId === n.id}<span class="cp-chip">leader</span>{/if}
                        </li>
                    {/each}
                </ul>
            {:else}
                <p class="cp-muted">Add NPCs first — then pick the members here.</p>
            {/if}

            <p class="cp-h">DM only</p>
            <label class="cp-field"><span>Secret</span><textarea class="cp-textarea cp-secret" rows="2" bind:value={edit.secret}></textarea></label>
            <label class="cp-field"><span>Notes</span><textarea class="cp-textarea" rows="3" bind:value={edit.notes}></textarea></label>
            <label class="cp-field"><span>Tags (comma separated)</span><input class="cp-input" bind:value={edit.tags} /></label>
            {#if edit.id}<RefHistory campaignId={campaign.id} refType="faction" refId={edit.id} />{/if}
        </div>
        <footer>
            {#if edit.id}
                {#if confirmDelete}
                    <span class="cp-muted">Delete {edit.name}? Its members stay.</span>
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
    .factions {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 12px;
    }

    .faction {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px 14px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 10px;
        color: inherit;
        font: inherit;
        font-size: 13px;
        text-align: left;
        cursor: pointer;
    }

    .faction:hover,
    .faction.sel {
        border-color: var(--color-gold);
    }

    .f-top {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .emb {
        width: 40px;
        height: 40px;
        flex: none;
        display: grid;
        place-items: center;
        object-fit: cover;
        border-radius: 8px;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-border);
        font-family: var(--font-heading);
        font-size: 18px;
        color: var(--color-text-muted);
    }

    .f-title {
        flex: 1;
        display: flex;
        flex-direction: column;
    }

    .f-name {
        font-family: var(--font-heading);
        font-size: 17px;
        color: var(--color-text-primary);
    }

    .f-type {
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .f-desc {
        color: var(--color-text-secondary);
        line-height: 1.4;
    }

    .rep {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .rep-bar {
        position: relative;
        flex: 1;
        height: 6px;
        border-radius: 3px;
        background: var(--color-bg);
        overflow: hidden;
    }

    .rep-bar::after {
        content: "";
        position: absolute;
        left: 50%;
        top: 0;
        bottom: 0;
        width: 1px;
        background: var(--color-border);
    }

    .rep-fill {
        position: absolute;
        top: 0;
        bottom: 0;
        background: var(--color-success);
    }

    .rep-fill.neg {
        background: var(--color-danger);
    }

    .rep-n {
        font-size: 12px;
        color: var(--color-text-secondary);
        white-space: nowrap;
    }

    .rep-val {
        color: var(--color-text-accent);
        font-weight: 600;
    }

    .f-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 12px;
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .f-meta b {
        color: var(--color-text-secondary);
        font-weight: 600;
    }

    .members {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .members li {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 3px 8px;
        border: 1px solid transparent;
        border-radius: 6px;
    }

    .members li.on {
        border-color: var(--color-border);
        background: var(--color-bg);
    }

    .rank {
        flex: 1;
        min-width: 0;
        padding: 3px 8px;
    }
</style>
