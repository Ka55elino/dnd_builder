<script>
    /**
     * One campaign — its own layout (not the usual page with a header):
     *
     *   ┌──────────── sidebar ────────────┬──────────────── content ────────────────┐
     *   │ ← Campaigns                     │ the chosen section                       │
     *   │ campaign name · status          │                                          │
     *   │ Overview                        │                                          │
     *   │ WORLD     NPCs · Locations      │                                          │
     *   │ OTHER     Encounters · Quests…  │                                          │
     *   └─────────────────────────────────┴──────────────────────────────────────────┘
     *
     * Overview: the campaign's name with ✎ (a popup edits name, short description, status),
     * the counts; the overview itself is a work in progress.
     *
     * id — campaign id; onBack() — to the list
     */
    import { onMount } from "svelte";
    import { loadCampaign, saveCampaign, loadLocations, CAMPAIGN_STATUSES } from "../../data/campaigns.js";
    import NpcsSection from "./NpcsSection.svelte";
    import LocationsSection from "./LocationsSection.svelte";
    import EncountersSection from "./EncountersSection.svelte";
    import QuestsSection from "./QuestsSection.svelte";
    import FactionsSection from "./FactionsSection.svelte";
    import SessionsSection from "./SessionsSection.svelte";

    let { id, onBack } = $props();

    // sidebar: groups of sections; soon — not built yet
    const NAV = [
        { items: [{ id: "overview", title: "Overview", icon: "◈" }] },
        {
            title: "World",
            items: [
                { id: "npcs", title: "NPCs", icon: "☺", count: "npcs" },
                { id: "locations", title: "Locations", icon: "⌂", count: "locations" },
            ],
        },
        {
            title: "Other",
            items: [
                { id: "encounters", title: "Encounters", icon: "⚔", count: "encounters" },
                { id: "quests", title: "Quests", icon: "✦", count: "quests" },
                { id: "factions", title: "Factions", icon: "⚑", count: "factions" },
                // sessions = the session log and the DM's notes (one section)
                { id: "sessions", title: "Sessions", icon: "☰", count: "sessions" },
            ],
        },
    ];
    const ALL = NAV.flatMap((g) => g.items);

    let campaign = $state(null);
    let loading = $state(true);
    let error = $state("");
    let section = $state("overview");

    // the ✎ popup: name, short description, status
    let form = $state(null); // null — closed
    let saving = $state(false);
    let saveError = $state("");
    const dirty = $derived(
        !!campaign && !!form &&
            (form.name.trim() !== campaign.name || form.description.trim() !== campaign.description || form.status !== campaign.status),
    );
    const openEdit = () => {
        form = { name: campaign.name, description: campaign.description, status: campaign.status };
        saveError = "";
    };

    onMount(async () => {
        try {
            campaign = await loadCampaign(id);
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            loading = false;
        }
    });

    async function save() {
        if (!form || saving || !form.name.trim()) return;
        if (!dirty) return void (form = null); // nothing changed
        saving = true;
        saveError = "";
        try {
            await saveCampaign({ ...campaign, name: form.name.trim(), description: form.description.trim(), status: form.status });
            campaign = await loadCampaign(id);
            form = null;
        } catch (e) {
            saveError = e?.message ?? String(e);
        } finally {
            saving = false;
        }
    }

    // NPCs / locations changed: fresh counts for the sidebar
    async function refreshCounts() {
        try {
            const c = await loadCampaign(id);
            campaign = { ...campaign, data: c.data, npcs: c.npcs, locations: c.locations, encounters: c.encounters, quests: c.quests, factions: c.factions, sessions: c.sessions, updatedAt: c.updatedAt };
        } catch {
            // the list just keeps the old numbers
        }
    }

    function back() {
        onBack?.();
    }

    function onKey(e) {
        if (!form) return;
        if (e.key === "Escape") form = null;
        else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            save();
        }
    }

    const current = $derived(ALL.find((x) => x.id === section) ?? ALL[0]);

    // the starting location's name (loaded with the Overview)
    let startName = $state("");
    $effect(() => {
        const sid = campaign?.data?.startLocationId;
        if (!sid) return void (startName = "");
        loadLocations(id)
            .then((ls) => (startName = ls.find((l) => l.id === sid)?.name ?? ""))
            .catch(() => (startName = ""));
    });
    const statusName = (s) => CAMPAIGN_STATUSES.find((x) => x.id === s)?.name ?? s;
</script>

<svelte:window onkeydown={onKey} />

{#if form}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="dlg-back" onclick={(e) => e.target === e.currentTarget && (form = null)}>
        <div class="dlg" role="dialog" aria-modal="true" aria-label="Edit campaign">
            <header>
                <h2>Edit campaign</h2>
                <button class="x" onclick={() => (form = null)} aria-label="Close">✕</button>
            </header>
            <label class="field">
                <span>Name</span>
                <!-- svelte-ignore a11y_autofocus -->
                <input bind:value={form.name} maxlength="120" autofocus />
            </label>
            <label class="field">
                <span>Short description</span>
                <textarea bind:value={form.description} rows="3" maxlength="400" placeholder="One or two lines: premise, setting, tone"></textarea>
            </label>
            <label class="field narrow">
                <span>Status</span>
                <select bind:value={form.status}>
                    {#each CAMPAIGN_STATUSES as st (st.id)}<option value={st.id}>{st.name}</option>{/each}
                </select>
            </label>
            <footer>
                <span class="err">{saveError}</span>
                <button class="ghost" onclick={() => (form = null)}>Cancel</button>
                <button class="primary" onclick={save} disabled={saving || !form.name.trim()} title="Save (Ctrl/Cmd+S)"
                    >{saving ? "Saving…" : "Save"}</button
                >
            </footer>
        </div>
    </div>
{/if}

<div class="campaign">
    <!-- ================= sidebar ================= -->
    <aside class="side">
        <button class="back" onclick={back}>← Campaigns</button>

        {#if campaign}
            <div class="who">
                <span class="c-name" title={campaign.name}>{campaign.name}</span>
                <span class="c-status s-{campaign.status}">{statusName(campaign.status)}</span>
            </div>
        {/if}

        <nav>
            {#each NAV as g, gi (gi)}
                {#if g.title}<h3>{g.title}</h3>{/if}
                <ul>
                    {#each g.items as it (it.id)}
                        <li>
                            <button class="nav-item" class:active={section === it.id} class:soon={it.soon} onclick={() => (section = it.id)}>
                                <span class="ico" aria-hidden="true">{it.icon}</span>
                                <span class="lbl">{it.title}</span>
                                {#if it.count && campaign}<span class="cnt">{campaign[it.count]}</span>{/if}
                                {#if it.soon}<span class="soon-tag">soon</span>{/if}
                            </button>
                        </li>
                    {/each}
                </ul>
            {/each}
        </nav>
    </aside>

    <!-- ================= content ================= -->
    <main class="content">
        {#if loading}
            <p class="muted">Loading…</p>
        {:else if error}
            <p class="error">Failed to load: {error}</p>
        {:else if section === "overview"}
            <header class="ov-head">
                <div class="ov-title">
                    <h1>{campaign.name}</h1>
                    <button class="edit" onclick={openEdit} title="Edit name and description" aria-label="Edit name and description">✎</button>
                </div>
                {#if campaign.description}<p class="ov-desc">{campaign.description}</p>{/if}
                <p class="ov-meta">
                    <span class="c-status s-{campaign.status}">{statusName(campaign.status)}</span>
                    {#each ALL.filter((x) => x.count) as it (it.id)}
                        <button class="ov-count" onclick={() => (section = it.id)}>{campaign[it.count]} {it.title}</button>
                    {/each}
                    {#if startName}<button class="ov-count start" onclick={() => (section = "locations")} title="Where the adventure begins"
                            >★ Starts in {startName}</button
                        >{/if}
                </p>
            </header>

            <section class="panel placeholder">
                <span class="big-ico" aria-hidden="true">◈</span>
                <p><b>Overview</b> — work in progress.</p>
            </section>
        {:else if section === "npcs"}
            <header class="sec-head"><h1>NPCs</h1></header>
            <NpcsSection {campaign} onChanged={refreshCounts} />
        {:else if section === "locations"}
            <header class="sec-head"><h1>Locations</h1></header>
            <LocationsSection {campaign} onChanged={refreshCounts} />
        {:else if section === "encounters"}
            <header class="sec-head"><h1>Encounters</h1></header>
            <EncountersSection {campaign} onChanged={refreshCounts} />
        {:else if section === "quests"}
            <header class="sec-head"><h1>Quests</h1></header>
            <QuestsSection {campaign} onChanged={refreshCounts} />
        {:else if section === "factions"}
            <header class="sec-head"><h1>Factions</h1></header>
            <FactionsSection {campaign} onChanged={refreshCounts} />
        {:else if section === "sessions"}
            <SessionsSection {campaign} onChanged={refreshCounts} />
        {:else}
            <header class="sec-head">
                <h1>{current.title}</h1>
            </header>
            <section class="panel placeholder">
                <span class="big-ico" aria-hidden="true">{current.icon}</span>
                <p><b>{current.title}</b> — coming soon.</p>
            </section>
        {/if}
    </main>
</div>

<style>
    /* the whole screen: sidebar + content, each scrolls on its own */
    .campaign {
        height: 100%;
        min-height: 0;
        display: grid;
        grid-template-columns: 240px minmax(0, 1fr);
        font-family: var(--font-ui);
    }

    @media (max-width: 720px) {
        .campaign {
            grid-template-columns: 1fr;
            grid-template-rows: auto 1fr;
        }
    }

    .side {
        min-height: 0;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 18px 12px;
        background: var(--color-sidebar);
        border-right: 1px solid var(--color-border);
    }

    .back {
        align-self: flex-start;
        padding: 4px 10px;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-secondary);
        font: inherit;
        font-size: 13px;
        cursor: pointer;
    }

    .back:hover {
        border-color: var(--color-gold);
        color: var(--color-gold-hover);
    }

    .who {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 0 6px;
    }

    .c-name {
        font-family: var(--font-heading);
        font-size: 20px;
        line-height: 1.2;
        color: var(--color-gold);
        overflow-wrap: anywhere;
    }

    .c-status {
        align-self: flex-start;
        padding: 1px 8px;
        border: 1px solid var(--color-border);
        border-radius: 999px;
        font-size: 11px;
        color: var(--color-text-secondary);
    }

    .c-status.s-active {
        border-color: var(--color-success);
        color: var(--color-success);
    }

    .c-status.s-planned {
        border-color: var(--color-gold);
        color: var(--color-gold);
    }

    nav h3 {
        margin: 14px 6px 4px;
        font-size: 11px;
        font-weight: var(--font-weight-semibold);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-text-muted);
    }

    nav ul {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .nav-item {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 7px 10px;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 8px;
        color: var(--color-text-secondary);
        font: inherit;
        font-size: 14px;
        text-align: left;
        cursor: pointer;
    }

    .nav-item:hover {
        background: var(--color-card);
        color: var(--color-text-primary);
    }

    .nav-item.active {
        background: var(--color-card-elevated);
        border-color: color-mix(in srgb, var(--color-gold) 50%, var(--color-border));
        color: var(--color-text-primary);
    }

    .nav-item.soon {
        opacity: 0.6;
    }

    .ico {
        width: 18px;
        text-align: center;
        color: var(--color-gold);
    }

    .lbl {
        flex: 1;
    }

    .cnt {
        min-width: 20px;
        padding: 0 6px;
        border-radius: 999px;
        background: var(--color-bg);
        font-size: 11px;
        text-align: center;
        color: var(--color-text-muted);
    }

    .soon-tag {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--color-text-muted);
    }

    .content {
        min-height: 0;
        overflow-y: auto;
        padding: 28px 32px;
        display: flex;
        flex-direction: column;
        gap: 18px;
    }

    .sec-head {
        display: flex;
        align-items: center;
        gap: 14px;
    }

    .sec-head h1 {
        flex: 1;
        margin: 0;
        font-family: var(--font-heading);
        font-size: 28px;
        color: var(--color-text-primary);
    }

    .ov-head {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .ov-title {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .ov-title h1 {
        margin: 0;
        font-family: var(--font-heading);
        font-size: 30px;
        color: var(--color-text-primary);
        overflow-wrap: anywhere;
    }

    .edit {
        width: 32px;
        height: 32px;
        flex: none;
        padding: 0;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 8px;
        color: var(--color-text-muted);
        font-size: 18px;
        cursor: pointer;
    }

    .edit:hover {
        border-color: var(--color-gold);
        color: var(--color-gold);
    }

    .ov-desc {
        margin: 0;
        max-width: 860px;
        color: var(--color-text-secondary);
        line-height: 1.5;
        white-space: pre-line;
    }

    .ov-meta {
        margin: 2px 0 0;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
    }

    .ov-count {
        padding: 1px 8px;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 999px;
        color: var(--color-text-secondary);
        font: inherit;
        font-size: 12px;
        cursor: pointer;
    }

    .ov-count.start {
        border-color: var(--color-gold);
        color: var(--color-gold);
    }

    .ov-count:hover {
        border-color: var(--color-gold);
        color: var(--color-gold);
    }



    /* the ✎ popup */
    .dlg-back {
        position: fixed;
        inset: 0;
        z-index: 950;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 96px 16px;
        background: rgba(0, 0, 0, 0.6);
    }

    .dlg {
        width: min(520px, 100%);
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 20px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 10px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
        font-family: var(--font-ui);
    }

    .dlg header {
        display: flex;
        align-items: center;
    }

    .dlg h2 {
        flex: 1;
        margin: 0;
        font-family: var(--font-heading-alt);
        font-size: 20px;
        color: var(--color-text-primary);
    }

    .dlg .x {
        width: 28px;
        height: 28px;
        padding: 0;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 6px;
        color: var(--color-text-muted);
        cursor: pointer;
    }

    .dlg .x:hover {
        border-color: var(--color-border);
        color: var(--color-text-primary);
    }

    .field.narrow {
        align-self: flex-start;
    }

    .dlg footer {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .dlg .err {
        flex: 1;
        color: var(--color-danger);
        font-size: 12px;
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



    .panel {
        padding: 18px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 10px;
    }


    .row {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 12px;
        color: var(--color-text-muted);
    }


    input,
    select,
    textarea {
        padding: 7px 10px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-primary);
        font: inherit;
        font-size: 14px;
    }

    input:focus,
    select:focus,
    textarea:focus {
        outline: none;
        border-color: var(--color-gold);
    }

    textarea {
        resize: vertical;
        line-height: 1.5;
    }






    .placeholder {
        display: flex;
        align-items: center;
        gap: 18px;
        max-width: 860px;
        color: var(--color-text-secondary);
        line-height: 1.5;
    }

    .placeholder p {
        margin: 0;
    }

    .big-ico {
        font-size: 40px;
        color: var(--color-gold);
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
        opacity: 0.4;
        cursor: default;
    }

    .muted {
        color: var(--color-text-muted);
    }

    .error {
        color: var(--color-danger);
    }
</style>
