<script>
    /**
     * Encounter presets: a named group of monsters (with counts) and the DM's notes.
     * Shows the total XP and where it lands against the party's XP budget
     * (D&D 2024: Low / Moderate / High per character level). Nothing is rolled.
     *
     * The party: the players of the running game (when hosting), or a size + level set by hand.
     *
     * monsters      — the bestiary
     * encounters    — (bindable) presets, reloaded here after save/delete
     * onOpenMonster(id) — show a monster's stat block
     * onStatus(text)    — a short message in the page header
     */
    import {
        saveEncounter, deleteEncounter, loadEncounters, encounterTotals, partyBudget, difficultyOf,
        DIFFICULTY_LABELS, CREATURE_TYPES, crLabel, fmtXP,
    } from "../../data/bestiary.js";
    import { server } from "../../server.svelte.js";

    let { monsters = [], encounters = $bindable([]), onOpenMonster, onStatus } = $props();

    const byId = $derived(new Map(monsters.map((m) => [m.id, m])));

    let selectedId = $state(encounters[0]?.id ?? null);
    let draft = $state(null); // the preset being edited (a copy)
    let dirty = $state(false);
    let saving = $state(false);
    let confirmDelete = $state(false);
    let error = $state("");

    // open a preset (or a new one) for editing
    function open(enc) {
        selectedId = enc?.id ?? null;
        draft = enc
            ? { ...enc, monsters: enc.monsters.map((l) => ({ ...l })) }
            : { id: "", name: "New encounter", notes: "", monsters: [] };
        dirty = !enc;
        confirmDelete = false;
        error = "";
    }
    $effect(() => {
        if (draft === null) open(encounters.find((e) => e.id === selectedId) ?? encounters[0] ?? null);
    });

    const touch = () => (dirty = true);

    function setCount(i, n) {
        n = Math.max(0, Math.floor(Number(n) || 0));
        if (n === 0) draft.monsters.splice(i, 1);
        else draft.monsters[i].count = n;
        touch();
    }

    function addMonster(m) {
        const line = draft.monsters.find((l) => l.monsterId === m.id);
        if (line) line.count += 1;
        else draft.monsters.push({ monsterId: m.id, count: 1 });
        pick = "";
        touch();
    }

    async function save() {
        if (saving) return;
        saving = true;
        error = "";
        try {
            const id = await saveEncounter(draft);
            encounters = await loadEncounters();
            dirty = false;
            open(encounters.find((e) => e.id === id));
            onStatus?.("Encounter saved");
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            saving = false;
        }
    }

    async function remove() {
        confirmDelete = false;
        const name = draft.name;
        try {
            if (draft.id) await deleteEncounter(draft.id);
            encounters = await loadEncounters();
            open(encounters[0] ?? null);
            onStatus?.(`“${name}” deleted`);
        } catch (e) {
            error = e?.message ?? String(e);
        }
    }

    // ---------- monster picker ----------
    let pick = $state("");
    const norm = (s) => String(s ?? "").toLowerCase().trim();
    const suggestions = $derived(
        pick.trim() ? monsters.filter((m) => norm(m.name).includes(norm(pick))).slice(0, 8) : [],
    );

    // ---------- party & difficulty ----------
    const gameParty = $derived(server.role === "host" ? server.players.map((p) => p.level || 1) : []);
    let useGame = $state(true);
    let partySize = $state(4);
    let partyLevel = $state(3);
    const party = $derived(
        useGame && gameParty.length
            ? gameParty
            : Array.from({ length: Math.max(1, Math.min(12, Math.floor(partySize) || 1)) }, () => partyLevel),
    );
    const budget = $derived(partyBudget(party));
    const totals = $derived(draft ? encounterTotals(draft, monsters) : { xp: 0, count: 0 });
    const difficulty = $derived(difficultyOf(totals.xp, budget));
    // position of the total on the bar: 0 … High … a bit beyond
    const barMax = $derived(Math.max(budget.high * 1.25, totals.xp));
    const pct = (v) => `${Math.min(100, (v / barMax) * 100)}%`;

    const listTotals = (enc) => encounterTotals(enc, monsters);
</script>

<div class="split">
    <aside class="list">
        <button class="add" onclick={() => open(null)}>+ New encounter</button>
        <ul>
            {#each encounters as enc (enc.id)}
                {@const t = listTotals(enc)}
                <li>
                    <button class="row" class:active={draft?.id === enc.id} onclick={() => open(enc)}>
                        <span class="name">{enc.name}</span>
                        <span class="meta">{t.count} {t.count === 1 ? "monster" : "monsters"} · {fmtXP(t.xp)} XP</span>
                        <span class="diff {difficultyOf(t.xp, budget)}">{DIFFICULTY_LABELS[difficultyOf(t.xp, budget)]}</span>
                    </button>
                </li>
            {:else}
                <li class="none">No presets yet. Build one from monsters in the bestiary.</li>
            {/each}
        </ul>
    </aside>

    {#if draft}
        <main class="edit">
            <div class="head">
                <input class="title" bind:value={draft.name} oninput={touch} aria-label="Encounter name" />
                <span class="dirty">{dirty ? "Unsaved changes" : ""}</span>
                {#if confirmDelete}
                    <span class="ask">Delete this preset?</span>
                    <button class="ghost small danger" onclick={remove}>Yes</button>
                    <button class="ghost small" onclick={() => (confirmDelete = false)}>No</button>
                {:else if draft.id}
                    <button class="ghost small" onclick={() => (confirmDelete = true)} title="Delete">✕</button>
                {/if}
                <button class="primary" onclick={save} disabled={saving || !dirty || !draft.name.trim()}>
                    {saving ? "Saving…" : "Save"}
                </button>
            </div>
            {#if error}<p class="error">{error}</p>{/if}

            <!-- difficulty -->
            <section class="card diffcard">
                <div class="sum">
                    <span class="big">{fmtXP(totals.xp)} XP</span>
                    <span class="diff {difficulty}">{DIFFICULTY_LABELS[difficulty]}</span>
                    <span class="party">
                        {#if gameParty.length}
                            <label class="check">
                                <input type="checkbox" bind:checked={useGame} /> Game party ({gameParty.length}: levels {gameParty.join(", ")})
                            </label>
                        {/if}
                        {#if !useGame || !gameParty.length}
                            Party of
                            <input type="number" min="1" max="12" bind:value={partySize} aria-label="Party size" />
                            level
                            <input type="number" min="1" max="20" bind:value={partyLevel} aria-label="Party level" />
                        {/if}
                    </span>
                </div>
                <div class="bar" aria-hidden="true">
                    <span class="zone low" style:width={pct(budget.low)}></span>
                    <span class="zone moderate" style:left={pct(budget.low)} style:width="calc({pct(budget.moderate)} - {pct(budget.low)})"></span>
                    <span class="zone high" style:left={pct(budget.moderate)} style:width="calc({pct(budget.high)} - {pct(budget.moderate)})"></span>
                    <span class="marker" style:left={pct(totals.xp)}></span>
                </div>
                <div class="budget">
                    <span>Low ≤ {fmtXP(budget.low)}</span>
                    <span>Moderate ≤ {fmtXP(budget.moderate)}</span>
                    <span>High ≤ {fmtXP(budget.high)}</span>
                </div>
            </section>

            <!-- monsters -->
            <section class="card">
                <h3>Monsters <small>{totals.count}</small></h3>
                {#if draft.monsters.length}
                    <ul class="lines">
                        {#each draft.monsters as line, i (line.monsterId)}
                            {@const m = byId.get(line.monsterId)}
                            <li>
                                {#if m}
                                    <button class="link name" onclick={() => onOpenMonster?.(m.id)} title="Open the stat block">{m.name}</button>
                                    <span class="meta">{CREATURE_TYPES[m.type] ?? m.type} · CR {crLabel(m.cr)} · AC {m.ac} · HP {m.hp}</span>
                                {:else}
                                    <span class="name missing">{line.monsterId}</span>
                                    <span class="meta">not in the bestiary any more</span>
                                {/if}
                                <span class="qty">
                                    <button class="step" onclick={() => setCount(i, line.count - 1)} aria-label="One less">−</button>
                                    <input type="number" min="0" value={line.count} onchange={(e) => setCount(i, e.currentTarget.value)} aria-label="Count" />
                                    <button class="step" onclick={() => setCount(i, line.count + 1)} aria-label="One more">+</button>
                                </span>
                                <span class="xp">{m ? fmtXP(m.xp * line.count) : "—"} XP</span>
                                <button class="x" onclick={() => setCount(i, 0)} aria-label="Remove">✕</button>
                            </li>
                        {/each}
                    </ul>
                {:else}
                    <p class="muted">Add monsters below, or use “+ To encounter” on a stat block.</p>
                {/if}

                <div class="picker">
                    <input type="search" bind:value={pick} placeholder="Add a monster: type a name…" aria-label="Add a monster" />
                    {#if suggestions.length}
                        <ul class="suggest">
                            {#each suggestions as m (m.id)}
                                <li>
                                    <button onclick={() => addMonster(m)}>
                                        <span>{m.name}</span>
                                        <small>CR {crLabel(m.cr)} · {fmtXP(m.xp)} XP</small>
                                    </button>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                </div>
            </section>

            <!-- notes -->
            <section class="card">
                <h3>Notes</h3>
                <textarea rows="5" bind:value={draft.notes} oninput={touch} placeholder="Terrain, tactics, what the monsters want, loot…"></textarea>
            </section>
        </main>
    {/if}
</div>

<style>
    .split {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
        gap: 20px;
    }

    .list {
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .list ul {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        margin: 0;
        padding: 0;
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
        align-items: center;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        color: var(--color-text-primary);
        text-align: left;
        cursor: pointer;
    }

    .row.active {
        background: var(--color-card-elevated);
        border-color: var(--color-gold);
    }

    .row .name {
        font-family: var(--font-heading);
        font-size: 15px;
    }

    .row .meta {
        grid-column: 1;
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .row .diff {
        grid-column: 2;
        grid-row: 1 / span 2;
    }

    .none {
        padding: 12px;
        font-size: 13px;
        color: var(--color-text-muted);
    }

    .edit {
        min-height: 0;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding-right: 4px;
    }

    .head {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .title {
        flex: 1;
        min-width: 0;
        padding: 6px 10px;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 6px;
        color: var(--color-gold);
        font-family: var(--font-heading);
        font-size: 24px;
    }

    .title:hover,
    .title:focus {
        outline: none;
        border-color: var(--color-border);
        background: var(--color-bg);
    }

    .dirty {
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .card {
        padding: 14px 16px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 10px;
    }

    h3 {
        margin: 0 0 10px;
        font-family: var(--font-heading);
        font-size: 14px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-gold);
    }

    h3 small {
        margin-left: 4px;
        font-family: var(--font-ui);
        color: var(--color-text-muted);
    }

    /* difficulty */
    .sum {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
    }

    .big {
        font-family: var(--font-heading);
        font-size: 26px;
    }

    .party {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .party input[type="number"] {
        width: 52px;
    }

    .diff {
        padding: 2px 10px;
        border: 1px solid var(--color-border);
        border-radius: 999px;
        font-size: 12px;
        white-space: nowrap;
        color: var(--color-text-secondary);
    }

    .diff.trivial { color: var(--color-text-muted); }
    .diff.low { border-color: var(--color-success); color: var(--color-success); }
    .diff.moderate { border-color: var(--color-gold); color: var(--color-gold); }
    .diff.high { border-color: var(--color-act-bonus); color: var(--color-act-bonus); }
    .diff.deadly { border-color: var(--color-danger); color: var(--color-danger); background: color-mix(in srgb, var(--color-danger) 15%, transparent); }

    .bar {
        position: relative;
        height: 10px;
        margin: 12px 0 6px;
        background: var(--color-card-elevated);
        border-radius: 999px;
        overflow: hidden;
    }

    .zone {
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
    }

    .zone.low { background: color-mix(in srgb, var(--color-success) 45%, transparent); }
    .zone.moderate { background: color-mix(in srgb, var(--color-gold) 45%, transparent); }
    .zone.high { background: color-mix(in srgb, var(--color-act-bonus) 45%, transparent); }

    .marker {
        position: absolute;
        top: -2px;
        bottom: -2px;
        width: 3px;
        margin-left: -1px;
        background: var(--color-text-primary);
        border-radius: 2px;
    }

    .budget {
        display: flex;
        justify-content: space-between;
        font-size: 12px;
        color: var(--color-text-muted);
    }

    /* monster lines */
    .lines {
        margin: 0 0 12px;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .lines li {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto auto;
        grid-template-rows: auto auto;
        align-items: center;
        gap: 0 12px;
        padding: 6px 10px;
        background: var(--color-card-elevated);
        border-radius: 8px;
    }

    .lines .name {
        grid-column: 1;
        justify-self: start;
        font-family: var(--font-heading);
        font-size: 15px;
        text-align: left;
    }

    .lines .missing {
        color: var(--color-danger);
    }

    .lines .meta {
        grid-column: 1;
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .qty,
    .lines .xp,
    .lines .x {
        grid-row: 1 / span 2;
    }

    .qty {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .qty input {
        width: 48px;
        text-align: center;
    }

    .step {
        width: 26px;
        height: 26px;
        padding: 0;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-secondary);
        cursor: pointer;
    }

    .step:hover {
        border-color: var(--color-gold);
        color: var(--color-gold-hover);
    }

    .lines .xp {
        min-width: 80px;
        font-size: 13px;
        text-align: right;
        color: var(--color-text-secondary);
    }

    .x {
        width: 24px;
        height: 24px;
        padding: 0;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 4px;
        color: var(--color-text-muted);
        cursor: pointer;
    }

    .x:hover {
        border-color: var(--color-danger);
        color: var(--color-danger);
    }

    .picker {
        position: relative;
    }

    .picker input {
        width: 100%;
        box-sizing: border-box;
    }

    .suggest {
        position: absolute;
        z-index: 5;
        left: 0;
        right: 0;
        top: calc(100% + 4px);
        margin: 0;
        padding: 4px;
        list-style: none;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.4);
    }

    .suggest button {
        width: 100%;
        padding: 6px 10px;
        display: flex;
        justify-content: space-between;
        gap: 10px;
        background: transparent;
        border: none;
        border-radius: 6px;
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: 14px;
        text-align: left;
        cursor: pointer;
    }

    .suggest button:hover {
        background: var(--color-card);
    }

    .suggest small {
        color: var(--color-text-muted);
    }

    input,
    textarea {
        padding: 7px 10px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-primary);
        font-family: var(--font-form);
        font-size: 14px;
    }

    textarea {
        width: 100%;
        box-sizing: border-box;
        resize: vertical;
        font-family: var(--font-lore);
        font-size: 15px;
    }

    input:focus,
    textarea:focus {
        outline: none;
        border-color: var(--color-gold);
    }

    .check {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .link {
        padding: 0;
        background: none;
        border: none;
        color: var(--color-text-primary);
        cursor: pointer;
    }

    .link:hover {
        color: var(--color-gold-hover);
    }

    .muted {
        margin: 0 0 12px;
        font-size: 13px;
        color: var(--color-text-muted);
    }

    .error {
        margin: 0;
        color: var(--color-danger);
    }

    .ask {
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .add,
    .primary {
        padding: 8px 16px;
        background: var(--color-gold);
        border: 1px solid var(--color-gold);
        border-radius: 6px;
        color: var(--color-bg);
        font-family: var(--font-ui);
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
    }

    .add:hover,
    .primary:not(:disabled):hover {
        background: var(--color-gold-hover);
    }

    .primary:disabled {
        opacity: 0.5;
        cursor: default;
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

    .ghost.small {
        padding: 4px 10px;
        font-size: 13px;
    }

    .ghost:hover {
        border-color: var(--color-gold);
        color: var(--color-gold-hover);
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
