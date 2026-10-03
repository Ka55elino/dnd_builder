<script>
    /**
     * Campaign → Locations: the tree (region → city → tavern) and an editor panel.
     * “+ Inside” on a row adds a sub-location. Deleting one moves what was inside it up
     * a level, and its NPCs lose the location (campaigns.go).
     *
     * campaign — the campaign ({ id, … }); onChanged() — after a save/delete
     */
    import { onMount } from "svelte";
    import "./campaign.css";
    import RefHistory from "./RefHistory.svelte";
    import ImagePick from "./ImagePick.svelte";
    import {
        loadLocations, saveLocation, deleteLocation, loadNpcs, saveCampaign,
        locationTree, locationAndDescendants, LOCATION_TYPES,
    } from "../../data/campaigns.js";

    let { campaign, onChanged } = $props();

    // the campaign's starting location (campaign.data.startLocationId)
    const startId = $derived(campaign?.data?.startLocationId ?? "");
    async function setStart(locId) {
        const data = { ...(campaign.data ?? {}) };
        if (locId) data.startLocationId = locId;
        else delete data.startLocationId;
        await saveCampaign({ ...campaign, data });
    }

    let locations = $state([]);
    let npcs = $state([]);
    let loading = $state(true);
    let error = $state("");
    let query = $state("");
    let collapsed = $state({}); // id → true: its children are hidden

    let edit = $state(null);
    let saving = $state(false);
    let editError = $state("");
    let confirmDelete = $state(false);

    async function reload() {
        [locations, npcs] = await Promise.all([loadLocations(campaign.id), loadNpcs(campaign.id)]);
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

    const tree = $derived(locationTree(locations));
    const kids = $derived(new Set(locations.map((l) => l.parentId).filter(Boolean)));
    const npcsAt = (id) => npcs.filter((n) => n.locationId === id);

    // search: flat matches with their path; otherwise the tree, minus collapsed branches
    const rows = $derived.by(() => {
        const q = query.trim().toLowerCase();
        if (q) return tree.filter((t) => [t.loc.name, t.loc.type, t.loc.data?.notes].some((x) => String(x ?? "").toLowerCase().includes(q)));
        const hidden = new Set();
        for (const t of tree) {
            if (t.loc.parentId && (hidden.has(t.loc.parentId) || collapsed[t.loc.parentId])) hidden.add(t.loc.id);
        }
        return tree.filter((t) => !hidden.has(t.loc.id));
    });

    function open(l = null, parentId = "") {
        const d = l?.data ?? {};
        edit = {
            id: l?.id ?? "",
            name: l?.name ?? "",
            type: l?.type ?? "",
            parentId: l?.parentId ?? parentId,
            image: l?.image ?? "",
            visible: !!l?.visible,
            start: !!l && l.id === startId,
            readAloud: d.readAloud ?? "",
            notes: d.notes ?? "",
            tags: (d.tags ?? []).join(", "),
            rest: d,
        };
        editError = "";
        confirmDelete = false;
    }

    // where it can go: not inside itself or its own sub-locations
    const parentOptions = $derived.by(() => {
        if (!edit) return [];
        const bad = edit.id ? locationAndDescendants(locations, edit.id) : new Set();
        return tree.filter((t) => !bad.has(t.loc.id));
    });

    async function save() {
        if (!edit?.name.trim() || saving) return;
        saving = true;
        editError = "";
        const { rest, readAloud, notes, tags, start, ...base } = edit;
        try {
            const id = await saveLocation({
                ...base,
                campaignId: campaign.id,
                data: {
                    ...rest,
                    readAloud: readAloud.trim(),
                    notes: notes.trim(),
                    tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
                },
            });
            if (start && id !== startId) await setStart(id);
            else if (!start && base.id && base.id === startId) await setStart("");
            if (base.parentId) collapsed[base.parentId] = false; // show where it went
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
            await deleteLocation(edit.id);
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
    <input class="cp-input cp-search" type="search" placeholder="Search name, type, notes…" bind:value={query} />
    <span class="cp-grow"></span>
    <span class="cp-muted">{locations.length} location{locations.length === 1 ? "" : "s"}</span>
    <button class="cp-btn cp-add" onclick={() => open()}>+ New location</button>
</div>

{#if loading}
    <p class="cp-muted">Loading…</p>
{:else if error}
    <p class="cp-error">Failed to load: {error}</p>
{:else if !locations.length}
    <div class="cp-empty">
        <p>No locations yet. Start with a region or the town where the adventure begins.</p>
        <button class="cp-btn cp-add" onclick={() => open()}>+ Add the first location</button>
    </div>
{:else}
    <table class="cp-table">
        <thead>
            <tr>
                <th>Name</th>
                <th>Type</th>
                <th>NPCs here</th>
                <th title="The players know it">Known</th>
                <th></th>
            </tr>
        </thead>
        <tbody>
            {#each rows as t (t.loc.id)}
                {@const l = t.loc}
                {@const here = npcsAt(l.id)}
                <tr class:cp-sel={edit?.id === l.id} onclick={() => open(l)}>
                    <td>
                        <span class="tree" style:padding-left="{query ? 0 : t.depth * 20}px">
                            {#if !query && kids.has(l.id)}
                                <button
                                    class="tog"
                                    onclick={(e) => {
                                        e.stopPropagation();
                                        collapsed[l.id] = !collapsed[l.id];
                                    }}
                                    aria-label={collapsed[l.id] ? "Expand" : "Collapse"}>{collapsed[l.id] ? "▸" : "▾"}</button
                                >
                            {:else}
                                <span class="tog-sp"></span>
                            {/if}
                            {#if l.image}<img class="cp-thumb sq" src={l.image} alt="" />{/if}
                            <span class="cp-name">{l.name}</span>
                            {#if l.id === startId}<span class="start" title="The adventure begins here">★ start</span>{/if}
                            {#if query && t.depth}<small class="cp-muted">{t.path}</small>{/if}
                        </span>
                    </td>
                    <td>{l.type}</td>
                    <td>
                        {#if here.length}<span title={here.map((n) => n.name).join(", ")}>{here.length}</span>{/if}
                    </td>
                    <td>{l.visible ? "✓" : ""}</td>
                    <td class="act">
                        <button
                            class="cp-btn cp-sm"
                            onclick={(e) => {
                                e.stopPropagation();
                                open(null, l.id);
                            }}
                            title="Add a location inside {l.name}">+ Inside</button
                        >
                    </td>
                </tr>
            {:else}
                <tr><td colspan="5" class="cp-muted">Nothing matches.</td></tr>
            {/each}
        </tbody>
    </table>
{/if}

{#if edit}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="cp-drawer-back" onclick={() => (edit = null)}></div>
    <div class="cp-drawer" role="dialog" aria-modal="true" aria-label="Location">
        <header>
            <h2>{edit.id ? edit.name || "Location" : "New location"}</h2>
            <button class="cp-btn cp-sm" onclick={() => (edit = null)} aria-label="Close">✕</button>
        </header>
        <div class="cp-body">
            <ImagePick bind:value={edit.image} letter={edit.name?.[0] ?? "?"} max={1024} label="Picture or map" />
            <label class="cp-field">
                <span>Name</span>
                <!-- svelte-ignore a11y_autofocus -->
                <input class="cp-input" bind:value={edit.name} maxlength="120" autofocus />
            </label>
            <div class="cp-row">
                <label class="cp-field">
                    <span>Type</span>
                    <input class="cp-input" bind:value={edit.type} list="loc-types" placeholder="Settlement" />
                    <datalist id="loc-types">{#each LOCATION_TYPES as x}<option value={x}></option>{/each}</datalist>
                </label>
                <label class="cp-field">
                    <span>Inside</span>
                    <select class="cp-select" bind:value={edit.parentId}>
                        <option value="">— top level —</option>
                        {#each parentOptions as t (t.loc.id)}<option value={t.loc.id}>{" ".repeat(t.depth * 2)}{t.loc.name}</option>{/each}
                    </select>
                </label>
            </div>
            <label class="cp-check"><input type="checkbox" bind:checked={edit.visible} /> The players know this place</label>
            <label class="cp-check" title="Only one per campaign: ticking it here moves the star from the old one">
                <input type="checkbox" bind:checked={edit.start} /> ★ Starting location — the adventure begins here</label
            >

            <p class="cp-h">For the players</p>
            <label class="cp-field"><span>Read aloud</span><textarea class="cp-textarea" rows="4" bind:value={edit.readAloud}
                    placeholder="What the party sees, hears and smells when they arrive…"></textarea></label>

            <p class="cp-h">DM only</p>
            <label class="cp-field"><span>Notes</span><textarea class="cp-textarea cp-secret" rows="5" bind:value={edit.notes}></textarea></label>
            <label class="cp-field"><span>Tags (comma separated)</span><input class="cp-input" bind:value={edit.tags} placeholder="chapter 1" /></label>

            {#if edit.id && npcsAt(edit.id).length}
                <p class="cp-h">NPCs here</p>
                <p class="here">{npcsAt(edit.id).map((n) => n.name).join(", ")}</p>
            {/if}
            {#if edit.id}<RefHistory campaignId={campaign.id} refType="location" refId={edit.id} />{/if}
        </div>
        <footer>
            {#if edit.id}
                {#if confirmDelete}
                    <span class="cp-muted">Delete {edit.name}?{kids.has(edit.id) ? " What's inside moves up." : ""}</span>
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
    .start {
        padding: 0 6px;
        border: 1px solid var(--color-gold);
        border-radius: 999px;
        font-size: 11px;
        color: var(--color-gold);
    }

    .tree {
        display: inline-flex;
        align-items: center;
        gap: 6px;
    }

    .tog,
    .tog-sp {
        width: 18px;
        flex: none;
    }

    .tog {
        padding: 0;
        background: none;
        border: none;
        color: var(--color-text-muted);
        font-size: 12px;
        cursor: pointer;
    }

    .tog:hover {
        color: var(--color-gold);
    }

    .sq {
        border-radius: 4px;
        width: 24px;
        height: 24px;
    }

    .act {
        text-align: right;
        white-space: nowrap;
    }

    .here {
        margin: 0;
        font-size: 13px;
        color: var(--color-text-secondary);
    }
</style>
