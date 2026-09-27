<script>
    /**
     * "Start encounter" menu for the DM:
     *   Saved    — one of the encounter presets from the bestiary;
     *   Monsters — pick monsters and how many of each.
     * The party's players join the line automatically.
     *
     * onStart({ name, lines: [{ monsterId, count }], monsters }), onClose()
     */
    import { loadMonsters, loadEncounters, encounterTotals, CREATURE_TYPES, crLabel, fmtXP } from "../../data/bestiary.js";

    let { onStart, onClose } = $props();

    let tab = $state("saved"); // 'saved' | 'monsters'
    let monsters = $state([]);
    let encounters = $state([]);
    let loading = $state(true);
    let error = $state("");

    let presetId = $state(null);
    let pick = $state({}); // monsterId → count
    let query = $state("");

    $effect(() => {
        Promise.all([loadMonsters(), loadEncounters()])
            .then(([m, e]) => {
                monsters = m;
                encounters = e;
                presetId = e[0]?.id ?? null;
                if (!e.length) tab = "monsters";
            })
            .catch((e) => (error = e?.message ?? String(e)))
            .finally(() => (loading = false));
    });

    const norm = (s) => String(s ?? "").toLowerCase().trim();
    const listed = $derived(
        monsters
            .filter((m) => !query || norm(m.name).includes(norm(query)))
            .sort((a, b) => a.cr - b.cr || a.name.localeCompare(b.name)),
    );
    const pickLines = $derived(Object.entries(pick).filter(([, n]) => n > 0).map(([monsterId, count]) => ({ monsterId, count })));
    const pickTotals = $derived(encounterTotals({ monsters: pickLines }, monsters));
    const preset = $derived(encounters.find((e) => e.id === presetId) ?? null);

    const canStart = $derived(tab === "saved" ? !!preset?.monsters?.length : pickLines.length > 0);

    function step(id, d) {
        pick[id] = Math.max(0, (pick[id] ?? 0) + d);
    }

    function start() {
        if (!canStart) return;
        if (tab === "saved") onStart?.({ name: preset.name, lines: preset.monsters, monsters });
        else onStart?.({ name: "", lines: pickLines, monsters });
    }

    const onKey = (e) => e.key === "Escape" && onClose?.();
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={(e) => e.target === e.currentTarget && onClose?.()}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Start an encounter">
        <header>
            <h2>Start an encounter</h2>
            <nav class="tabs">
                <button class:active={tab === "saved"} onclick={() => (tab = "saved")}>Saved <small>{encounters.length}</small></button>
                <button class:active={tab === "monsters"} onclick={() => (tab = "monsters")}>Monsters</button>
            </nav>
            <button class="x" onclick={() => onClose?.()} aria-label="Close">✕</button>
        </header>

        <div class="body">
            {#if loading}
                <p class="muted">Loading…</p>
            {:else if error}
                <p class="error">Failed to load: {error}</p>
            {:else if tab === "saved"}
                {#if encounters.length}
                    <ul class="presets">
                        {#each encounters as e (e.id)}
                            {@const t = encounterTotals(e, monsters)}
                            <li>
                                <label class="preset" class:on={presetId === e.id}>
                                    <input type="radio" name="preset" value={e.id} bind:group={presetId} />
                                    <span class="p-name">{e.name}</span>
                                    <span class="p-meta">{t.count} {t.count === 1 ? "monster" : "monsters"} · {fmtXP(t.xp)} XP</span>
                                    <span class="p-list">
                                        {e.monsters.map((l) => `${monsters.find((m) => m.id === l.monsterId)?.name ?? l.monsterId} ×${l.count}`).join(", ") || "empty"}
                                    </span>
                                </label>
                            </li>
                        {/each}
                    </ul>
                {:else}
                    <p class="muted">No saved encounters yet — build one in the Bestiary, or pick monsters here.</p>
                {/if}
            {:else}
                <input class="search" type="search" bind:value={query} placeholder="Search monsters…" aria-label="Search monsters" />
                <ul class="monsters">
                    {#each listed as m (m.id)}
                        <li class:on={pick[m.id] > 0}>
                            <span class="m-name">{m.name}</span>
                            <span class="m-meta">{CREATURE_TYPES[m.type] ?? m.type} · CR {crLabel(m.cr)} · AC {m.ac} · HP {m.hp}</span>
                            <span class="qty">
                                <button onclick={() => step(m.id, -1)} disabled={!pick[m.id]} aria-label="One less">−</button>
                                <b>{pick[m.id] ?? 0}</b>
                                <button onclick={() => step(m.id, 1)} aria-label="One more">+</button>
                            </span>
                        </li>
                    {/each}
                </ul>
            {/if}
        </div>

        <footer>
            <span class="sum">
                {#if tab === "monsters" && pickTotals.count}{pickTotals.count} {pickTotals.count === 1 ? "monster" : "monsters"} · {fmtXP(pickTotals.xp)} XP{/if}
                <small>The party's players join the line too.</small>
            </span>
            <button class="ghost" onclick={() => onClose?.()}>Cancel</button>
            <button class="primary" onclick={start} disabled={!canStart}>Start</button>
        </footer>
    </div>
</div>

<style>
    .backdrop {
        position: fixed;
        inset: 0;
        z-index: 950;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 56px 16px;
        background: rgba(0, 0, 0, 0.6);
    }

    .dialog {
        width: min(640px, 100%);
        max-height: calc(100vh - 112px);
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 20px;
        background: var(--color-card);
        border: 1px solid color-mix(in srgb, var(--color-danger) 50%, var(--color-border));
        border-radius: 10px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
        font-family: var(--font-ui);
    }

    header {
        display: flex;
        align-items: center;
        gap: 14px;
    }

    h2 {
        margin: 0;
        font-family: var(--font-heading-alt);
        font-size: 20px;
        color: var(--color-gold);
    }

    .tabs {
        display: flex;
        gap: 4px;
        border-bottom: 1px solid var(--color-border);
    }

    .tabs button {
        margin-bottom: -1px;
        padding: 5px 12px;
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: 13px;
        cursor: pointer;
    }

    .tabs button.active {
        border-bottom-color: var(--color-gold);
        color: var(--color-gold);
    }

    .tabs small {
        color: var(--color-text-muted);
    }

    .x {
        margin-left: auto;
        width: 28px;
        height: 28px;
        padding: 0;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 6px;
        color: var(--color-text-muted);
        cursor: pointer;
    }

    .x:hover {
        border-color: var(--color-border);
        color: var(--color-text-primary);
    }

    .body {
        min-height: 0;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    ul {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .preset {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 2px 10px;
        align-items: center;
        padding: 8px 12px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        cursor: pointer;
    }

    .preset.on {
        border-color: var(--color-gold);
        background: var(--color-card-elevated);
    }

    .preset input {
        grid-row: 1 / span 2;
        accent-color: var(--color-gold);
    }

    .p-name,
    .m-name {
        font-family: var(--font-heading);
        font-size: 15px;
        color: var(--color-text-primary);
    }

    .p-meta {
        font-size: 12px;
        color: var(--color-gold);
    }

    .p-list,
    .m-meta {
        grid-column: 2 / span 2;
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .search {
        padding: 7px 10px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-primary);
        font-family: var(--font-form);
        font-size: 14px;
    }

    .search:focus {
        outline: none;
        border-color: var(--color-gold);
    }

    .monsters li {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 0 10px;
        align-items: center;
        padding: 6px 12px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 8px;
    }

    .monsters li.on {
        border-color: var(--color-gold);
    }

    .m-meta {
        grid-column: 1;
    }

    .qty {
        grid-column: 2;
        grid-row: 1 / span 2;
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .qty b {
        min-width: 20px;
        text-align: center;
    }

    .qty button {
        width: 26px;
        height: 26px;
        padding: 0;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-secondary);
        cursor: pointer;
    }

    .qty button:not(:disabled):hover {
        border-color: var(--color-gold);
        color: var(--color-gold-hover);
    }

    .qty button:disabled {
        opacity: 0.3;
        cursor: default;
    }

    footer {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .sum {
        flex: 1;
        display: flex;
        flex-direction: column;
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .sum small {
        font-size: 11px;
        color: var(--color-text-muted);
    }

    .muted {
        margin: 0;
        color: var(--color-text-muted);
    }

    .error {
        margin: 0;
        color: var(--color-danger);
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

    .primary {
        padding: 7px 20px;
        background: var(--color-gold);
        border: 1px solid var(--color-gold);
        border-radius: 6px;
        color: var(--color-bg);
        font-family: var(--font-ui);
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
    }

    .primary:disabled {
        opacity: 0.5;
        cursor: default;
    }

    .primary:not(:disabled):hover {
        background: var(--color-gold-hover);
    }
</style>
