<script>
    /**
     * Campaign → Encounters: the encounters the campaign uses (presets — the same ones as in
     * the Bestiary), where each happens, and an editor panel.
     *   + New encounter      — a new preset, put in this campaign
     *   + From Bestiary      — pick a ready preset: use it as is (the same preset) or copy it
     *                          as a new encounter to change
     *   Remove               — out of this campaign (the preset stays in the Bestiary)
     *   Delete preset        — gone everywhere (Bestiary and every campaign)
     *
     * campaign — the campaign ({ id, … }); onChanged() — after a change (the counts)
     */
    import { onMount } from "svelte";
    import "./campaign.css";
    import RefHistory from "./RefHistory.svelte";
    import {
        loadCampaignEncounters, saveCampaignEncounter, addCampaignEncounter, removeCampaignEncounter,
        loadLocations, locationTree,
    } from "../../data/campaigns.js";
    import { loadMonsters, loadEncounters, encounterTotals, crLabel } from "../../data/bestiary.js";

    let { campaign, onChanged } = $props();

    let encounters = $state([]);
    let presets = $state([]); // every preset (for "Add from Bestiary")
    let locations = $state([]);
    let monsters = $state([]);
    let loading = $state(true);
    let error = $state("");
    let query = $state("");

    let edit = $state(null);
    let saving = $state(false);
    let editError = $state("");
    let confirm = $state(""); // '' | 'remove' | 'delete'

    // the "From Bestiary" picker
    let picking = $state(false);
    let pickQuery = $state("");
    let pickId = $state("");
    let addLoc = $state("");

    const tree = $derived(locationTree(locations));
    const locName = (id) => tree.find((t) => t.loc.id === id)?.path ?? "";
    const monsterById = $derived(new Map(monsters.map((m) => [m.id, m])));
    const lineup = (e) =>
        (e.monsters ?? []).map((l) => `${l.count}× ${monsterById.get(l.monsterId)?.name ?? l.monsterId}`).join(", ");
    const inCampaign = (id) => encounters.some((e) => e.id === id);
    const pickList = $derived.by(() => {
        const q = pickQuery.trim().toLowerCase();
        return presets.filter((p) => !q || [p.name, p.notes, lineup(p)].some((x) => String(x ?? "").toLowerCase().includes(q)));
    });
    const picked = $derived(presets.find((p) => p.id === pickId) ?? null);
    const openPicker = () => {
        picking = true;
        pickQuery = "";
        pickId = "";
        addLoc = "";
    };

    async function reload() {
        [encounters, locations, presets] = await Promise.all([
            loadCampaignEncounters(campaign.id),
            loadLocations(campaign.id),
            loadEncounters().catch(() => []),
        ]);
    }

    onMount(async () => {
        try {
            await reload();
            monsters = await loadMonsters().catch(() => []);
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            loading = false;
        }
    });

    const shown = $derived.by(() => {
        const q = query.trim().toLowerCase();
        if (!q) return encounters;
        return encounters.filter((e) => [e.name, e.notes, lineup(e), locName(e.locationId)].some((x) => String(x ?? "").toLowerCase().includes(q)));
    });

    function open(e = null) {
        edit = {
            id: e?.id ?? "",
            name: e?.name ?? "",
            notes: e?.notes ?? "",
            locationId: e?.locationId ?? "",
            monsters: (e?.monsters ?? []).map((l) => ({ ...l })),
        };
        if (!edit.monsters.length) edit.monsters.push({ monsterId: "", count: 1 });
        editError = "";
        confirm = "";
    }

    async function save() {
        if (!edit?.name.trim() || saving) return;
        saving = true;
        editError = "";
        try {
            const { locationId, ...enc } = edit;
            enc.monsters = enc.monsters.filter((l) => l.monsterId && Number(l.count) > 0).map((l) => ({ monsterId: l.monsterId, count: Math.floor(Number(l.count)) }));
            await saveCampaignEncounter(campaign.id, enc, locationId);
            await reload();
            onChanged?.();
            edit = null;
        } catch (e) {
            editError = e?.message ?? String(e);
        } finally {
            saving = false;
        }
    }

    async function remove(deletePreset) {
        try {
            await removeCampaignEncounter(campaign.id, edit.id, deletePreset);
            await reload();
            onChanged?.();
            edit = null;
        } catch (e) {
            editError = e?.message ?? String(e);
        }
    }

    // use the preset itself (edits to it show in the Bestiary and every campaign)
    async function usePreset() {
        if (!picked) return;
        try {
            await addCampaignEncounter(campaign.id, picked.id, addLoc);
            picking = false;
            await reload();
            onChanged?.();
        } catch (e) {
            error = e?.message ?? String(e);
        }
    }

    // a copy: a new preset with the same monsters and notes, opened in the editor to change
    function copyPreset() {
        if (!picked) return;
        open({ ...picked, id: "", name: `${picked.name} (copy)`, locationId: addLoc });
        picking = false;
    }

    const totals = $derived(edit ? encounterTotals(edit, monsters) : { xp: 0, count: 0 });

    function onKey(e) {
        if (picking && e.key === "Escape") return void (picking = false);
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
    <input class="cp-input cp-search" type="search" placeholder="Search name, monsters, place…" bind:value={query} />
    <span class="cp-grow"></span>
    <span class="cp-muted">{encounters.length} encounter{encounters.length === 1 ? "" : "s"}</span>
    <button class="cp-btn" onclick={openPicker} title="Pick a ready encounter from the Bestiary">+ From Bestiary</button>
    <button class="cp-btn cp-add" onclick={() => open()}>+ New encounter</button>
</div>

{#if picking}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="cp-drawer-back" onclick={() => (picking = false)}></div>
    <div class="cp-drawer" role="dialog" aria-modal="true" aria-label="Encounters from the Bestiary">
        <header>
            <h2>From the Bestiary</h2>
            <button class="cp-btn cp-sm" onclick={() => (picking = false)} aria-label="Close">✕</button>
        </header>
        <div class="cp-body">
            <!-- svelte-ignore a11y_autofocus -->
            <input class="cp-input" type="search" placeholder="Search presets, monsters…" bind:value={pickQuery} autofocus />
            {#if !presets.length}
                <p class="cp-muted">No encounter presets yet — make them in the Bestiary (Encounters tab) or here with “+ New encounter”.</p>
            {:else}
                <ul class="presets">
                    {#each pickList as p (p.id)}
                        <li>
                            <button class="preset" class:on={pickId === p.id} onclick={() => (pickId = p.id)}>
                                <span class="p-top">
                                    <b>{p.name}</b>
                                    {#if inCampaign(p.id)}<span class="cp-chip">in this campaign</span>{/if}
                                    <span class="p-xp">{encounterTotals(p, monsters).xp} XP</span>
                                </span>
                                <span class="p-line">{lineup(p) || "no monsters"}</span>
                                {#if p.notes}<span class="p-notes">{p.notes}</span>{/if}
                            </button>
                        </li>
                    {:else}
                        <li class="cp-muted">Nothing matches.</li>
                    {/each}
                </ul>
            {/if}
        </div>
        <footer>
            {#if picked}
                <select class="cp-select" bind:value={addLoc} aria-label="Where it happens">
                    <option value="">— nowhere in particular —</option>
                    {#each tree as t (t.loc.id)}<option value={t.loc.id}>{" ".repeat(t.depth * 2)}{t.loc.name}</option>{/each}
                </select>
            {/if}
            <span class="cp-grow"></span>
            <button class="cp-btn" disabled={!picked} onclick={copyPreset} title="A new encounter with the same monsters, to change">Copy as new</button>
            <button
                class="cp-btn cp-primary"
                disabled={!picked}
                onclick={usePreset}
                title="The same preset: changes to it show in the Bestiary and every campaign"
                >{picked && inCampaign(picked.id) ? "Move here" : "Use"}</button
            >
        </footer>
    </div>
{/if}

{#if loading}
    <p class="cp-muted">Loading…</p>
{:else if error}
    <p class="cp-error">{error}</p>
{:else if !encounters.length}
    <div class="cp-empty">
        <p>No encounters in this campaign yet.</p>
        <button class="cp-btn cp-add" onclick={() => open()}>+ Create one</button>
    </div>
{:else}
    <table class="cp-table">
        <thead>
            <tr>
                <th>Name</th>
                <th>Monsters</th>
                <th>XP</th>
                <th>Where</th>
                <th>Notes</th>
            </tr>
        </thead>
        <tbody>
            {#each shown as e (e.id)}
                <tr class:cp-sel={edit?.id === e.id} onclick={() => open(e)}>
                    <td class="cp-name">{e.name}</td>
                    <td>{lineup(e)}</td>
                    <td>{encounterTotals(e, monsters).xp || ""}</td>
                    <td>{locName(e.locationId)}</td>
                    <td class="notes">{e.notes}</td>
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
    <div class="cp-drawer" role="dialog" aria-modal="true" aria-label="Encounter">
        <header>
            <h2>{edit.id ? edit.name || "Encounter" : "New encounter"}</h2>
            <button class="cp-btn cp-sm" onclick={() => (edit = null)} aria-label="Close">✕</button>
        </header>
        <div class="cp-body">
            <label class="cp-field">
                <span>Name</span>
                <!-- svelte-ignore a11y_autofocus -->
                <input class="cp-input" bind:value={edit.name} maxlength="120" autofocus />
            </label>
            <label class="cp-field">
                <span>Where it happens</span>
                <select class="cp-select" bind:value={edit.locationId}>
                    <option value="">— nowhere in particular —</option>
                    {#each tree as t (t.loc.id)}<option value={t.loc.id}>{" ".repeat(t.depth * 2)}{t.loc.name}</option>{/each}
                </select>
            </label>

            <p class="cp-h">Monsters <span class="tot">{totals.count} · {totals.xp} XP</span></p>
            {#each edit.monsters as line, i}
                <div class="mline">
                    <input class="cp-input cnt" type="number" min="1" bind:value={line.count} aria-label="How many" />
                    <select class="cp-select grow" bind:value={line.monsterId} aria-label="Monster">
                        <option value="">— monster —</option>
                        {#each monsters as m (m.id)}<option value={m.id}>{m.name} · CR {crLabel(m.cr)}</option>{/each}
                    </select>
                    <button class="cp-btn cp-sm cp-danger" onclick={() => edit.monsters.splice(i, 1)} aria-label="Remove line">✕</button>
                </div>
            {/each}
            <button class="cp-btn cp-sm add-line" onclick={() => edit.monsters.push({ monsterId: "", count: 1 })}>+ Monster</button>

            <label class="cp-field"><span>Notes (tactics, terrain, loot)</span><textarea class="cp-textarea" rows="5" bind:value={edit.notes}></textarea></label>
            {#if edit.id}
                <p class="cp-muted hint">This preset is also in the Bestiary: changes show there and in every campaign that uses it.</p>
            {/if}
            {#if edit.id}<RefHistory campaignId={campaign.id} refType="encounter" refId={edit.id} />{/if}
        </div>
        <footer>
            {#if edit.id}
                {#if confirm === "remove"}
                    <span class="cp-muted">Remove from this campaign?</span>
                    <button class="cp-btn cp-sm cp-danger" onclick={() => remove(false)}>Remove</button>
                    <button class="cp-btn cp-sm" onclick={() => (confirm = "")}>No</button>
                {:else if confirm === "delete"}
                    <span class="cp-muted">Delete the preset everywhere?</span>
                    <button class="cp-btn cp-sm cp-danger" onclick={() => remove(true)}>Delete</button>
                    <button class="cp-btn cp-sm" onclick={() => (confirm = "")}>No</button>
                {:else}
                    <button class="cp-btn cp-sm" onclick={() => (confirm = "remove")} title="The preset stays in the Bestiary">Remove</button>
                    <button class="cp-btn cp-sm cp-danger" onclick={() => (confirm = "delete")}>Delete preset</button>
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
    .presets {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .preset {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 8px 10px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        color: var(--color-text-secondary);
        font: inherit;
        font-size: 13px;
        text-align: left;
        cursor: pointer;
    }

    .preset:hover {
        border-color: color-mix(in srgb, var(--color-gold) 60%, var(--color-border));
    }

    .preset.on {
        border-color: var(--color-gold);
        background: color-mix(in srgb, var(--color-gold) 10%, var(--color-bg));
    }

    .p-top {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .p-top b {
        color: var(--color-text-primary);
    }

    .p-xp {
        margin-left: auto;
        color: var(--color-text-accent);
        font-size: 12px;
    }

    .p-line {
        font-size: 12px;
    }

    .p-notes {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .notes {
        max-width: 320px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .tot {
        margin-left: 6px;
        text-transform: none;
        letter-spacing: 0;
        color: var(--color-text-accent);
    }

    .mline {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .cnt {
        width: 64px;
    }

    .grow {
        flex: 1;
        min-width: 0;
    }

    .add-line {
        align-self: flex-start;
    }

    .hint {
        margin: 0;
        font-size: 12px;
    }
</style>
