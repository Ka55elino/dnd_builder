<script>
    /**
     * Modal: put conditions and effects on a player or a monster (the DM), or on your own
     * character (the character sheet), change or remove them.
     *
     * name     — whose conditions (title)
     * defs     — condition definitions (refs.conditions, with the DM's custom ones)
     * current  — the instances on the target now (rules/conditions.js) — updates live
     * onApply(data) — { op: 'add', id, level?, rounds?, save? } | { op: 'remove', id }
     *                 | { op: 'level', id, level } | { op: 'save', id, success }; may return a promise
     * onClose()
     *
     * The list: search by name / description, each one with its description; a click opens
     * its options. "Save at the end of each turn" is offered only where it makes sense:
     * definitions with data.repeatSave (the usual ability — Frightened: WIS, Poisoned: CON…),
     * custom ones, and an instance that already has a save.
     *
     * Esc closes.
     */
    import { ABILITIES, ABILITY_KEYS } from "../rules/abilities.js";
    import { instanceInfo } from "../rules/conditions.js";
    import { SKILLS } from "../rules/skills.js";
    import { DAMAGE_TYPES } from "../rules/labels.js";
    import { choiceLabel } from "../rules/modifiers.js";

    // what an effect asks for (Guidance: a skill, Hex: an ability)
    const CHOICES = {
        skill: () => SKILLS.map((s) => [s.id, s.name]),
        ability: () => ABILITY_KEYS.map((k) => [k, ABILITIES[k]?.name ?? k]),
        damageType: () => Object.entries(DAMAGE_TYPES).filter(([k]) => k !== "physical" && k !== "weapon").map(([k, v]) => [k, v.name]),
    };
    const choicesOf = (d) => {
        const c = CHOICES[d?.data?.choose]?.() ?? null;
        const only = d?.data?.options;
        return c && Array.isArray(only) && only.length ? c.filter(([k]) => only.includes(k)) : c;
    };

    let { name = "", defs = [], current = [], onApply, onClose } = $props();

    let picked = $state(null); // the definition being set up
    let rounds = $state("");
    let saveOn = $state(false); // "Save at the end of each turn"
    let saveAbility = $state("con");
    let saveDc = $state(13);
    let query = $state("");
    let level = $state(1);
    let choice = $state("");
    let busy = $state(false);
    let error = $state("");

    const short = (k) => ABILITIES[k]?.short ?? k;
    const byId = $derived(new Map(defs.map((d) => [d.id, d])));
    const norm = (t) => String(t ?? "").toLowerCase();
    const matches = (d) => !query.trim() || norm(d.name).includes(norm(query).trim()) || norm(d.desc).includes(norm(query).trim());
    const groups = $derived.by(() => {
        const all = [...defs].filter(matches).sort((a, b) => a.name.localeCompare(b.name));
        return [
            { id: "condition", title: "Conditions", list: all.filter((d) => (d.category ?? "condition") === "condition") },
            { id: "effect", title: "Effects", list: all.filter((d) => d.category === "effect" && !d.data?.spell) },
            { id: "spell", title: "Spell effects", list: all.filter((d) => d.category === "effect" && d.data?.spell) },
        ].filter((g) => g.list.length);
    });
    const on = $derived(new Set((current ?? []).map((e) => e.id)));
    const maxLevel = (d) => Number(d?.data?.levels) || null;
    // can it be ended by repeating a save at the end of each turn?
    const curOf = (d) => (current ?? []).find((e) => e.id === d?.id);
    const canSave = (d) => !!(d?.data?.repeatSave || d?.data?.custom || curOf(d)?.save);

    function pick(d) {
        picked = d;
        const cur = (current ?? []).find((e) => e.id === d.id);
        rounds = cur?.rounds ?? "";
        saveOn = !!cur?.save;
        saveAbility = cur?.save?.ability ?? d.data?.repeatSave ?? "con";
        saveDc = cur?.save?.dc ?? 13;
        level = cur?.level ?? 1;
        choice = cur?.choice ?? choicesOf(d)?.[0]?.[0] ?? "";
        error = "";
    }

    async function run(data) {
        busy = true;
        error = "";
        try {
            await onApply?.(data);
            return true;
        } catch (e) {
            error = e?.message ?? String(e);
            return false;
        } finally {
            busy = false;
        }
    }

    async function apply() {
        if (!picked) return;
        const n = Math.floor(Number(rounds));
        const data = { op: "add", id: picked.id };
        if (maxLevel(picked)) data.level = Math.min(maxLevel(picked), Math.max(1, Math.floor(Number(level)) || 1));
        data.rounds = n > 0 ? n : null;
        data.save =
            canSave(picked) && saveOn && saveAbility && Number(saveDc) > 0
                ? { ability: saveAbility, dc: Math.floor(Number(saveDc)) }
                : null;
        if (choicesOf(picked)) data.choice = choice || null;
        if (await run(data)) picked = null;
    }

    function onKey(e) {
        if (e.key === "Escape") {
            e.preventDefault();
            if (picked) picked = null;
            else onClose?.();
        }
    }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={(e) => e.target === e.currentTarget && onClose?.()}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Conditions: {name}">
        <header>
            <h2>Conditions · {name}</h2>
            <button class="x" onclick={() => onClose?.()} aria-label="Close">✕</button>
        </header>

        <!-- what is on the target now -->
        {#if current?.length}
            <ul class="now">
                {#each current as e (e.id)}
                    {@const d = byId.get(e.id)}
                    <li>
                        <b>{d?.name ?? e.name ?? e.id}{#if e.level}&nbsp;{e.level}{/if}{#if e.choice}&nbsp;({choiceLabel(e.choice)}){/if}</b>
                        <small>{instanceInfo(e, short)}</small>
                        {#if e.savePending}
                            <span class="due">save due:</span>
                            <button class="ghost sm" disabled={busy} onclick={() => run({ op: "save", id: e.id, success: true })}
                                >Saved</button
                            >
                            <button class="ghost sm" disabled={busy} onclick={() => run({ op: "save", id: e.id, success: false })}
                                >Failed</button
                            >
                        {/if}
                        {#if maxLevel(d)}
                            <button class="ghost sm" disabled={busy} onclick={() => run({ op: "level", id: e.id, level: (e.level ?? 1) - 1 })}
                                aria-label="Lower">−</button
                            >
                            <button
                                class="ghost sm"
                                disabled={busy || (e.level ?? 1) >= maxLevel(d)}
                                onclick={() => run({ op: "level", id: e.id, level: (e.level ?? 1) + 1 })}
                                aria-label="Raise">+</button
                            >
                        {/if}
                        <span class="sp"></span>
                        {#if d}<button class="ghost sm" disabled={busy} onclick={() => pick(d)}>Edit</button>{/if}
                        <button class="ghost sm del" disabled={busy} onclick={() => run({ op: "remove", id: e.id })}
                            aria-label="Remove {d?.name ?? e.id}">✕</button
                        >
                    </li>
                {/each}
            </ul>
        {:else}
            <p class="muted">No conditions.</p>
        {/if}

        {#if picked}
            <!-- options for the picked condition -->
            <div class="opts">
                <p class="opts-title"><b>{picked.name}</b> <small>{picked.desc}</small></p>
                <div class="row">
                    {#if choicesOf(picked)}
                        <label
                            >Choice
                            <select bind:value={choice}>
                                {#each choicesOf(picked) as [k, v] (k)}<option value={k}>{v}</option>{/each}
                            </select>
                        </label>
                    {/if}
                    {#if maxLevel(picked)}
                        <label>Level <input type="number" min="1" max={maxLevel(picked)} bind:value={level} /></label>
                    {/if}
                    <label title="Counts down at the end of each of its turns; empty — until removed"
                        >Rounds <input type="number" min="1" bind:value={rounds} placeholder="∞" /></label
                    >
                </div>
                {#if canSave(picked)}
                    <!-- only where a repeated save can end it (data.repeatSave / custom) -->
                    <div class="row">
                        <label class="check"
                            ><input type="checkbox" bind:checked={saveOn} /> Save at the end of each turn ends it</label
                        >
                        {#if saveOn}
                            <label
                                >Ability
                                <select bind:value={saveAbility}>
                                    {#each ABILITY_KEYS as k}<option value={k}>{short(k)}</option>{/each}
                                </select>
                            </label>
                            <label>DC <input type="number" min="1" bind:value={saveDc} /></label>
                        {/if}
                    </div>
                {/if}
                <div class="row end">
                    <button class="ghost" onclick={() => (picked = null)}>Back</button>
                    <button class="primary" disabled={busy} onclick={apply}>{on.has(picked.id) ? "Update" : "Apply"}</button>
                </div>
            </div>
        {:else}
            <!-- svelte-ignore a11y_autofocus -->
            <input class="search" type="search" placeholder="Search conditions and effects…" bind:value={query} autofocus />
            <div class="list">
                {#each groups as g (g.id)}
                    <h3>{g.title}</h3>
                    <ul>
                        {#each g.list as d (d.id)}
                            <li>
                                <button class="item" class:on={on.has(d.id)} onclick={() => pick(d)}>
                                    <span class="i-head">
                                        <b>{d.name}</b>
                                        {#if on.has(d.id)}<span class="i-tag on">on</span>{/if}
                                        {#if d.data?.repeatSave}<span class="i-tag" title="Usually ended by a save at the end of each turn"
                                                >{short(d.data.repeatSave)} save</span
                                            >{/if}
                                        {#if maxLevel(d)}<span class="i-tag">levels 1–{maxLevel(d)}</span>{/if}
                                    </span>
                                    {#if d.desc}<span class="i-desc">{d.desc}</span>{/if}
                                </button>
                            </li>
                        {/each}
                    </ul>
                {:else}
                    <p class="muted">Nothing matches “{query}”.</p>
                {/each}
            </div>
        {/if}

        {#if error}<p class="error">{error}</p>{/if}
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
        padding: 64px 16px;
        background: rgba(0, 0, 0, 0.6);
        overflow-y: auto;
    }

    .dialog {
        width: min(560px, 100%);
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 20px;
        background: var(--color-card);
        border: 1px solid var(--color-danger);
        border-radius: 10px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
        font-family: var(--font-ui);
    }

    header {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    h2 {
        flex: 1;
        margin: 0;
        font-family: var(--font-heading-alt);
        font-size: 20px;
        color: var(--color-text-primary);
    }

    h3 {
        margin: 6px 0 0;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--color-text-muted);
    }

    .x {
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

    .now {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .now li {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        border: 1px solid var(--color-danger);
        border-radius: 8px;
        font-size: 13px;
        color: var(--color-text-primary);
    }

    .now small {
        color: var(--color-text-muted);
        font-size: 11px;
    }

    .due {
        color: var(--color-gold);
        font-size: 12px;
    }

    .sp {
        flex: 1;
    }

    .search {
        width: 100%;
        padding: 7px 10px;
        font-size: 14px;
    }

    .list {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .list ul {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .item {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 7px 10px;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        color: var(--color-text-primary);
        font: inherit;
        text-align: left;
        cursor: pointer;
    }

    .item:hover {
        border-color: var(--color-gold);
    }

    .item.on {
        border-color: var(--color-danger);
        background: color-mix(in srgb, var(--color-danger) 10%, transparent);
    }

    .i-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        font-size: 14px;
    }

    .i-tag {
        padding: 0 6px;
        border: 1px solid var(--color-border);
        border-radius: 999px;
        font-size: 10px;
        color: var(--color-text-muted);
    }

    .i-tag.on {
        border-color: var(--color-danger);
        color: var(--color-danger);
    }

    .i-desc {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        font-family: var(--font-spell);
        font-size: 13px;
        line-height: 1.35;
        color: var(--color-text-secondary);
    }

    label.check {
        flex-direction: row;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    label.check input {
        width: auto;
    }

    .opts {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 10px 12px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
    }

    .opts-title {
        margin: 0;
        font-size: 14px;
        color: var(--color-text-primary);
    }

    .opts-title small {
        display: block;
        margin-top: 4px;
        color: var(--color-text-secondary);
        font-size: 12px;
    }

    .row {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: 10px;
    }

    .row.end {
        justify-content: flex-end;
    }

    label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 12px;
        color: var(--color-text-muted);
    }

    input,
    select {
        padding: 4px 6px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-primary);
        font: inherit;
        font-size: 13px;
    }

    input {
        width: 72px;
    }

    .muted {
        margin: 0;
        color: var(--color-text-muted);
        font-size: 13px;
    }

    .error {
        margin: 0;
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

    .ghost.sm {
        padding: 2px 8px;
        font-size: 12px;
    }

    .ghost:hover:not(:disabled) {
        border-color: var(--color-gold);
        color: var(--color-gold-hover);
    }

    .ghost.del:hover:not(:disabled) {
        border-color: var(--color-danger);
        color: var(--color-danger);
    }

    .primary {
        padding: 6px 16px;
        background: color-mix(in srgb, var(--color-danger) 30%, var(--color-card));
        border: 1px solid var(--color-danger);
        border-radius: 6px;
        color: var(--color-text-primary);
        font: inherit;
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
    }

    button:disabled {
        opacity: 0.5;
        cursor: default;
    }
</style>
