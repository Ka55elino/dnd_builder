<script>
    /**
     * Campaign → NPCs: the list (search, filters) and an editor panel (create / edit / delete).
     *
     * campaign — the campaign ({ id, … }); onChanged() — after a save/delete (the counts change)
     */
    import { onMount } from "svelte";
    import "./campaign.css";
    import RefHistory from "./RefHistory.svelte";
    import ImagePick from "./ImagePick.svelte";
    import { loadNpcs, saveNpc, deleteNpc, loadLocations, locationTree, NPC_STATUSES, NPC_ATTITUDES } from "../../data/campaigns.js";
    import { loadMonsters, crLabel } from "../../data/bestiary.js";

    let { campaign, onChanged } = $props();

    let npcs = $state([]);
    let locations = $state([]);
    let monsters = $state([]);
    let loading = $state(true);
    let error = $state("");

    let query = $state("");
    let fStatus = $state("");
    let fAttitude = $state("");
    let fLocation = $state("");

    let edit = $state(null); // the form while the editor is open
    let saving = $state(false);
    let editError = $state("");
    let confirmDelete = $state(false);

    const name = (list, id) => list.find((x) => x.id === id)?.name ?? "";
    const tree = $derived(locationTree(locations));
    const locName = (id) => tree.find((t) => t.loc.id === id)?.path ?? "";

    async function reload() {
        [npcs, locations] = await Promise.all([loadNpcs(campaign.id), loadLocations(campaign.id)]);
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
        return npcs.filter(
            (n) =>
                (!q || [n.name, n.role, n.race, n.data?.notes].some((x) => String(x ?? "").toLowerCase().includes(q))) &&
                (!fStatus || n.status === fStatus) &&
                (!fAttitude || n.attitude === fAttitude) &&
                (!fLocation || n.locationId === fLocation),
        );
    });

    function open(n = null) {
        const d = n?.data ?? {};
        edit = {
            id: n?.id ?? "",
            name: n?.name ?? "",
            portrait: n?.portrait ?? "",
            role: n?.role ?? "",
            race: n?.race ?? "",
            status: n?.status ?? "alive",
            attitude: n?.attitude ?? "neutral",
            locationId: n?.locationId ?? "",
            monsterId: n?.monsterId ?? "",
            visible: !!n?.visible,
            appearance: d.appearance ?? "",
            voice: d.voice ?? "",
            motivation: d.motivation ?? "",
            secret: d.secret ?? "",
            notes: d.notes ?? "",
            tags: (d.tags ?? []).join(", "),
            rest: d, // fields this form doesn't know are kept
        };
        editError = "";
        confirmDelete = false;
    }

    async function save() {
        if (!edit?.name.trim() || saving) return;
        saving = true;
        editError = "";
        const { rest, appearance, voice, motivation, secret, notes, tags, ...base } = edit;
        try {
            const id = await saveNpc({
                ...base,
                campaignId: campaign.id,
                data: {
                    ...rest,
                    appearance: appearance.trim(),
                    voice: voice.trim(),
                    motivation: motivation.trim(),
                    secret: secret.trim(),
                    notes: notes.trim(),
                    tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
                },
            });
            await reload();
            onChanged?.();
            edit = null;
            return id;
        } catch (e) {
            editError = e?.message ?? String(e);
        } finally {
            saving = false;
        }
    }

    async function remove() {
        try {
            await deleteNpc(edit.id);
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
    <input class="cp-input cp-search" type="search" placeholder="Search name, role, notes…" bind:value={query} />
    <select class="cp-select" bind:value={fAttitude} aria-label="Attitude">
        <option value="">Any attitude</option>
        {#each NPC_ATTITUDES as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
    </select>
    <select class="cp-select" bind:value={fStatus} aria-label="Status">
        <option value="">Any status</option>
        {#each NPC_STATUSES as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
    </select>
    {#if locations.length}
        <select class="cp-select" bind:value={fLocation} aria-label="Location">
            <option value="">Anywhere</option>
            {#each tree as t (t.loc.id)}<option value={t.loc.id}>{"  ".repeat(t.depth)}{t.loc.name}</option>{/each}
        </select>
    {/if}
    <span class="cp-grow"></span>
    <span class="cp-muted">{shown.length} of {npcs.length}</span>
    <button class="cp-btn cp-add" onclick={() => open()}>+ New NPC</button>
</div>

{#if loading}
    <p class="cp-muted">Loading…</p>
{:else if error}
    <p class="cp-error">Failed to load: {error}</p>
{:else if !npcs.length}
    <div class="cp-empty">
        <p>No NPCs yet.</p>
        <button class="cp-btn cp-add" onclick={() => open()}>+ Add the first NPC</button>
    </div>
{:else}
    <table class="cp-table">
        <thead>
            <tr>
                <th></th>
                <th>Name</th>
                <th>Role</th>
                <th>Attitude</th>
                <th>Status</th>
                <th>Where</th>
                <th>Statblock</th>
                <th title="The players know them">Known</th>
            </tr>
        </thead>
        <tbody>
            {#each shown as n (n.id)}
                <tr class:cp-sel={edit?.id === n.id} onclick={() => open(n)}>
                    <td>
                        {#if n.portrait}<img class="cp-thumb" src={n.portrait} alt="" />{:else}<span class="cp-thumb">{n.name[0]}</span>{/if}
                    </td>
                    <td class="cp-name" class:cp-st-dead={n.status === "dead"}>{n.name}</td>
                    <td>{[n.role, n.race].filter(Boolean).join(" · ")}</td>
                    <td><span class="cp-chip cp-att-{n.attitude}">{name(NPC_ATTITUDES, n.attitude)}</span></td>
                    <td>{name(NPC_STATUSES, n.status)}</td>
                    <td>{locName(n.locationId)}</td>
                    <td>{name(monsters, n.monsterId)}</td>
                    <td>{n.visible ? "✓" : ""}</td>
                </tr>
            {:else}
                <tr><td colspan="8" class="cp-muted">Nothing matches.</td></tr>
            {/each}
        </tbody>
    </table>
{/if}

{#if edit}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="cp-drawer-back" onclick={() => (edit = null)}></div>
    <div class="cp-drawer" role="dialog" aria-modal="true" aria-label="NPC">
        <header>
            <h2>{edit.id ? edit.name || "NPC" : "New NPC"}</h2>
            <button class="cp-btn cp-sm" onclick={() => (edit = null)} aria-label="Close">✕</button>
        </header>
        <div class="cp-body">
            <ImagePick bind:value={edit.portrait} letter={edit.name?.[0] ?? "?"} round label="Portrait" />
            <label class="cp-field">
                <span>Name</span>
                <!-- svelte-ignore a11y_autofocus -->
                <input class="cp-input" bind:value={edit.name} maxlength="120" autofocus />
            </label>
            <div class="cp-row">
                <label class="cp-field"><span>Role</span><input class="cp-input" bind:value={edit.role} placeholder="innkeeper, cult leader…" /></label>
                <label class="cp-field"><span>Race</span><input class="cp-input" bind:value={edit.race} placeholder="human" /></label>
            </div>
            <div class="cp-row">
                <label class="cp-field">
                    <span>Attitude to the party</span>
                    <select class="cp-select" bind:value={edit.attitude}>
                        {#each NPC_ATTITUDES as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
                    </select>
                </label>
                <label class="cp-field">
                    <span>Status</span>
                    <select class="cp-select" bind:value={edit.status}>
                        {#each NPC_STATUSES as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
                    </select>
                </label>
            </div>
            <div class="cp-row">
                <label class="cp-field">
                    <span>Where they are</span>
                    <select class="cp-select" bind:value={edit.locationId}>
                        <option value="">— nowhere in particular —</option>
                        {#each tree as t (t.loc.id)}<option value={t.loc.id}>{" ".repeat(t.depth * 2)}{t.loc.name}</option>{/each}
                    </select>
                </label>
                <label class="cp-field">
                    <span>Statblock (Bestiary)</span>
                    <select class="cp-select" bind:value={edit.monsterId}>
                        <option value="">— none —</option>
                        {#each monsters as m (m.id)}<option value={m.id}>{m.name} · CR {crLabel(m.cr)}</option>{/each}
                    </select>
                </label>
            </div>
            <label class="cp-check"><input type="checkbox" bind:checked={edit.visible} /> The players know this NPC</label>

            <p class="cp-h">Roleplay</p>
            <label class="cp-field"><span>Appearance</span><textarea class="cp-textarea" rows="2" bind:value={edit.appearance}></textarea></label>
            <label class="cp-field"><span>Voice & mannerisms</span><input class="cp-input" bind:value={edit.voice} placeholder="speaks slowly, always polishing a mug" /></label>
            <label class="cp-field"><span>Motivation</span><textarea class="cp-textarea" rows="2" bind:value={edit.motivation}></textarea></label>

            <p class="cp-h">DM only</p>
            <label class="cp-field"><span>Secret</span><textarea class="cp-textarea cp-secret" rows="2" bind:value={edit.secret}></textarea></label>
            <label class="cp-field"><span>Notes</span><textarea class="cp-textarea" rows="4" bind:value={edit.notes}></textarea></label>
            <label class="cp-field"><span>Tags (comma separated)</span><input class="cp-input" bind:value={edit.tags} placeholder="chapter 1, villain" /></label>
            {#if edit.id}<RefHistory campaignId={campaign.id} refType="npc" refId={edit.id} />{/if}
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
