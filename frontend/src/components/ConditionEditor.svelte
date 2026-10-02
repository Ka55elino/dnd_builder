<script>
    /**
     * Custom condition form (modal). The result is an object in assets/data/conditions
     * format, saved via saveCustomCondition. On the right — what it does, as the sheet will show it.
     *
     * initial — record to edit (or the base for a copy), null — new
     * copy    — true: initial is only a base, save as a new record
     * defs    — all conditions (for "includes": Unconscious → Incapacitated, Prone)
     * onSaved(id) / onCancel()
     *
     * Modifiers — the vocabulary of rules/modifiers.js, one row each.
     */
    import { untrack } from "svelte";
    import { saveCustomCondition } from "../data/refs.js"; // also reloads the cache
    import { modifierText } from "../rules/modifiers.js";
    import { ABILITIES, ABILITY_KEYS } from "../rules/abilities.js";
    import { DAMAGE_TYPES } from "../rules/labels.js";
    import { SKILLS } from "../rules/skills.js";

    let { initial = null, copy = false, defs = [], onSaved, onCancel } = $props();

    const KINDS = [
        { id: "speed", name: "Speed" },
        { id: "ac", name: "AC" },
        { id: "d20", name: "All D20 Tests" },
        { id: "save", name: "Saving throws" },
        { id: "check", name: "Ability checks" },
        { id: "attack", name: "Attack rolls" },
        { id: "initiative", name: "Initiative" },
        { id: "damage", name: "Weapon damage" },
        { id: "dice", name: "A die on rolls (Bless, Guidance…)" },
        { id: "hpMax", name: "HP maximum" },
        { id: "sense", name: "Sense (Darkvision…)" },
        { id: "economy", name: "Extra Action / Bonus Action / Reaction" },
        { id: "flag", name: "Advantage / Disadvantage / can't…" },
        { id: "resistance", name: "Resistance" },
        { id: "immunity", name: "Immunity to a condition" },
        { id: "note", name: "Note (text only)" },
    ];
    const FLAG_MODES = [
        ["advantage", "Advantage"],
        ["disadvantage", "Disadvantage"],
        ["autoFail", "auto-fail"],
        ["autoCrit", "hits are Critical Hits"],
        ["cant", "can't"],
    ];
    const FLAG_ON = [
        ["attacks", "your attack rolls"],
        ["attacksAgainst", "attack rolls against you"],
        ["saves", "saving throws"],
        ["checks", "ability checks"],
        ["initiative", "Initiative"],
        ["actions", "actions"],
        ["bonusActions", "Bonus Actions"],
        ["reactions", "Reactions"],
        ["speech", "speech"],
    ];
    const DMG = Object.entries(DAMAGE_TYPES).filter(([k]) => k !== "physical" && k !== "weapon");
    const short = (k) => ABILITIES[k]?.short ?? k;

    /** A fresh row of a kind, with sensible defaults. */
    function blank(kind) {
        switch (kind) {
            case "speed": return { kind, op: "set", value: 0 };
            case "ac": return { kind, op: "add", value: -2 };
            case "d20": return { kind, value: -2 };
            case "save": return { kind, ability: "", value: -2 };
            case "check": return { kind, ability: "", value: -2 };
            case "attack": return { kind, value: -2 };
            case "initiative": return { kind, value: -2 };
            case "damage": return { kind, dice: "1d4", sign: 1, type: "" };
            case "dice": return { kind, dice: "1d4", sign: 1, on: "attacks", ability: "", skill: "" };
            case "hpMax": return { kind, value: 5 };
            case "sense": return { kind, sense: "darkvision", range: 60 };
            case "economy": return { kind, action: "action", value: 1 };
            case "flag": return { kind, mode: "disadvantage", on: "attacks", ability: "", note: "" };
            case "resistance": return { kind, value: "all" };
            case "immunity": return { kind, value: defs[0]?.id ?? "" };
            default: return { kind: "note", note: "" };
        }
    }

    let f = $state(
        untrack(() => {
            const d = initial?.data ?? {};
            return {
                name: initial ? (copy ? `${initial.name} (copy)` : initial.name) : "",
                category: initial?.category ?? "condition",
                desc: initial?.desc ?? "",
                levels: d.levels ?? "",
                choose: d.choose ?? "",
                implies: [...(d.implies ?? [])],
                breaksConcentration: !!d.breaksConcentration,
                longRest: d.longRest ?? "",
                modifiers: (d.modifiers ?? []).map((m) => ({ ...blank(m.kind), ...m })),
            };
        }),
    );

    let error = $state("");
    let saving = $state(false);

    const others = $derived(defs.filter((d) => d.id !== initial?.id || copy));

    /** The rows → clean modifiers (empty optional fields dropped, numbers as numbers). */
    function cleanModifiers() {
        return f.modifiers.map((m) => {
            const o = { kind: m.kind };
            if ("op" in m && ["speed", "ac"].includes(m.kind)) o.op = m.op;
            if ("value" in m) o.value = ["resistance", "immunity"].includes(m.kind) ? m.value : Number(m.value) || 0;
            if (m.perLevel) o.perLevel = true;
            if (m.ability) o.ability = m.ability;
            if (m.kind === "damage") Object.assign(o, { dice: String(m.dice || "1d4").trim(), sign: Number(m.sign) < 0 ? -1 : 1 });
            if (m.kind === "damage" && m.type) o.type = m.type;
            if (m.kind === "dice") {
                Object.assign(o, { dice: String(m.dice || "1d4").trim(), sign: Number(m.sign) < 0 ? -1 : 1, on: m.on });
                if (m.skill && m.on === "checks") o.skill = m.skill;
                if (!["saves", "checks"].includes(m.on)) delete o.ability;
            }
            if (m.kind === "sense") Object.assign(o, { sense: m.sense, range: Number(m.range) || 0 });
            if (m.kind === "economy") Object.assign(o, { action: m.action, value: Number(m.value) || 1 });
            if (m.kind === "flag") Object.assign(o, { mode: m.mode, on: m.on });
            if (m.kind === "flag" && !["saves", "checks"].includes(m.on)) delete o.ability;
            if (m.note?.trim()) o.note = m.note.trim();
            if (m.kind === "note" && !o.note) return null;
            return o;
        }).filter(Boolean);
    }
    const preview = $derived(cleanModifiers().map(modifierText).filter(Boolean));

    async function save() {
        const name = f.name.trim();
        if (!name) return (error = "Enter a name.");
        if (f.modifiers.some((m) => (m.kind === "damage" || m.kind === "dice") && !/^\d+(d\d+)?$/i.test(String(m.dice).trim())))
            return (error = "Dice must look like 1d4 (or a number).");
        const levels = Math.floor(Number(f.levels));
        const def = {
            ...(initial && !copy ? { id: initial.id } : {}),
            name,
            category: f.category,
            ...(levels > 1 ? { levels } : {}),
            ...(f.choose ? { choose: f.choose } : {}),
            ...(f.implies.length ? { implies: [...f.implies] } : {}),
            ...(f.breaksConcentration ? { breaksConcentration: true } : {}),
            ...(f.longRest ? { longRest: f.longRest } : {}),
            modifiers: cleanModifiers(),
            desc: f.desc.trim(),
        };
        saving = true;
        error = "";
        try {
            const id = await saveCustomCondition(def);
            onSaved?.(id);
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            saving = false;
        }
    }

    function onKey(e) {
        if (e.key === "Escape") {
            e.preventDefault();
            onCancel?.();
        }
    }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={(e) => e.target === e.currentTarget && onCancel?.()}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Condition">
        <header>
            <h2>{initial && !copy ? "Edit condition" : "New condition"}</h2>
            <button class="x" onclick={() => onCancel?.()} aria-label="Close">✕</button>
        </header>

        <div class="cols">
            <div class="form">
                <div class="grid">
                    <label class="field wide"><span>Name</span><input bind:value={f.name} placeholder="Frozen" /></label>
                    <label class="field">
                        <span>Type</span>
                        <select bind:value={f.category}>
                            <option value="condition">Condition</option>
                            <option value="effect">Effect</option>
                        </select>
                    </label>
                    <label class="field" title="Leveled like Exhaustion: modifiers marked “per level” are multiplied">
                        <span>Levels</span><input type="number" min="2" bind:value={f.levels} placeholder="—" />
                    </label>
                    <label class="field" title="Asked when it is put on; use “chosen” in a modifier (Guidance: a skill)">
                        <span>Choice</span>
                        <select bind:value={f.choose}>
                            <option value="">—</option>
                            <option value="skill">a skill</option>
                            <option value="ability">an ability</option>
                            <option value="damageType">a damage type</option>
                        </select>
                    </label>
                    <label class="field">
                        <span>On a Long Rest</span>
                        <select bind:value={f.longRest}>
                            <option value="">stays</option>
                            <option value="remove">ends</option>
                            <option value="level">−1 level</option>
                        </select>
                    </label>
                </div>
                <label class="field"><span>Description</span><textarea rows="3" bind:value={f.desc}></textarea></label>

                <label class="check">
                    <input type="checkbox" bind:checked={f.breaksConcentration} />
                    <span>Breaks Concentration (like Incapacitated)</span>
                </label>

                <details class="implies">
                    <summary>Includes other conditions {#if f.implies.length}<small>({f.implies.length})</small>{/if}</summary>
                    <div class="chips">
                        {#each others as d (d.id)}
                            <label class="chip" class:on={f.implies.includes(d.id)}>
                                <input
                                    type="checkbox"
                                    checked={f.implies.includes(d.id)}
                                    onchange={(e) =>
                                        (f.implies = e.currentTarget.checked
                                            ? [...f.implies, d.id]
                                            : f.implies.filter((x) => x !== d.id))}
                                />{d.name}
                            </label>
                        {/each}
                    </div>
                </details>

                <h3>Modifiers</h3>
                {#each f.modifiers as m, i}
                    <div class="mod">
                        <select
                            value={m.kind}
                            onchange={(e) => (f.modifiers[i] = blank(e.currentTarget.value))}
                            aria-label="Kind"
                        >
                            {#each KINDS as k (k.id)}<option value={k.id}>{k.name}</option>{/each}
                        </select>

                        {#if m.kind === "speed"}
                            <select bind:value={m.op} aria-label="How">
                                <option value="set">becomes</option>
                                <option value="mul">× (multiply)</option>
                                <option value="add">± feet</option>
                            </select>
                            <input type="number" step={m.op === "mul" ? 0.5 : 5} bind:value={m.value} aria-label="Value" />
                        {:else if m.kind === "ac"}
                            <select bind:value={m.op} aria-label="How">
                                <option value="add">±</option>
                                <option value="min">at least</option>
                            </select>
                            <input type="number" bind:value={m.value} aria-label="Value" />
                        {:else if ["d20", "attack", "initiative"].includes(m.kind)}
                            <input type="number" bind:value={m.value} aria-label="Value" />
                        {:else if m.kind === "save" || m.kind === "check"}
                            <select bind:value={m.ability} aria-label="Ability">
                                <option value="">all</option>
                                {#each ABILITY_KEYS as k}<option value={k}>{short(k)}</option>{/each}
                            </select>
                            <input type="number" bind:value={m.value} aria-label="Value" />
                        {:else if m.kind === "damage"}
                            <select bind:value={m.sign} aria-label="Sign">
                                <option value={1}>+</option>
                                <option value={-1}>−</option>
                            </select>
                            <input class="dice" bind:value={m.dice} placeholder="1d4" aria-label="Dice" />
                        {:else if m.kind === "dice"}
                            <select bind:value={m.sign} aria-label="Sign">
                                <option value={1}>+</option>
                                <option value={-1}>−</option>
                            </select>
                            <input class="dice" bind:value={m.dice} placeholder="1d4" aria-label="Dice" />
                            <span class="on">to</span>
                            <select bind:value={m.on} aria-label="Roll">
                                <option value="attacks">your attack rolls</option>
                                <option value="saves">saving throws</option>
                                <option value="checks">ability checks</option>
                                <option value="attacksAgainst">attack rolls against you</option>
                                <option value="damageTaken">damage you take</option>
                            </select>
                            {#if m.on === "saves" || m.on === "checks"}
                                <select bind:value={m.ability} aria-label="Ability">
                                    <option value="">all</option>
                                    {#if f.choose === "ability"}<option value="$choice">chosen</option>{/if}
                                    {#each ABILITY_KEYS as k}<option value={k}>{short(k)}</option>{/each}
                                </select>
                            {/if}
                            {#if m.on === "checks"}
                                <select bind:value={m.skill} aria-label="Skill">
                                    <option value="">any skill</option>
                                    {#if f.choose === "skill"}<option value="$choice">chosen skill</option>{/if}
                                    {#each SKILLS as sk (sk.id)}<option value={sk.id}>{sk.name}</option>{/each}
                                </select>
                            {/if}
                        {:else if m.kind === "hpMax"}
                            <input type="number" bind:value={m.value} aria-label="Value" />
                        {:else if m.kind === "sense"}
                            <select bind:value={m.sense} aria-label="Sense">
                                <option value="darkvision">Darkvision</option>
                                <option value="blindsight">Blindsight</option>
                                <option value="tremorsense">Tremorsense</option>
                                <option value="truesight">Truesight</option>
                            </select>
                            <input type="number" step="5" bind:value={m.range} aria-label="Range" />
                        {:else if m.kind === "economy"}
                            <input type="number" bind:value={m.value} aria-label="How many" />
                            <select bind:value={m.action} aria-label="What">
                                <option value="action">Action</option>
                                <option value="bonus">Bonus Action</option>
                                <option value="reaction">Reaction</option>
                            </select>
                        {:else if m.kind === "flag"}
                            <select bind:value={m.mode} aria-label="What">
                                {#each FLAG_MODES as [k, v]}<option value={k}>{v}</option>{/each}
                            </select>
                            <span class="on">on</span>
                            <select bind:value={m.on} aria-label="On">
                                {#each FLAG_ON as [k, v]}<option value={k}>{v}</option>{/each}
                            </select>
                            {#if m.on === "saves" || m.on === "checks"}
                                <select bind:value={m.ability} aria-label="Ability">
                                    <option value="">all</option>
                                    {#if f.choose === "ability"}<option value="$choice">chosen</option>{/if}
                                    {#each ABILITY_KEYS as k}<option value={k}>{short(k)}</option>{/each}
                                </select>
                            {/if}
                            <input class="note" bind:value={m.note} placeholder="when… (optional)" aria-label="Note" />
                        {:else if m.kind === "resistance"}
                            <select bind:value={m.value} aria-label="Damage type">
                                <option value="all">all damage</option>
                                {#if f.choose === "damageType"}<option value="$choice">chosen type</option>{/if}
                                {#each DMG as [k, v]}<option value={k}>{v.name}</option>{/each}
                            </select>
                        {:else if m.kind === "immunity"}
                            <select bind:value={m.value} aria-label="Condition">
                                {#each defs as d (d.id)}<option value={d.id}>{d.name}</option>{/each}
                            </select>
                        {:else}
                            <input class="note wide" bind:value={m.note} placeholder="What happens…" aria-label="Note" />
                        {/if}

                        {#if f.levels > 1 && ["speed", "d20"].includes(m.kind) && m.op !== "set" && m.op !== "mul"}
                            <label class="check sm"><input type="checkbox" bind:checked={m.perLevel} /> per level</label>
                        {/if}
                        <button class="ghost sm del" onclick={() => f.modifiers.splice(i, 1)} aria-label="Remove">✕</button>
                    </div>
                {/each}
                <button class="link" onclick={() => f.modifiers.push(blank("flag"))}>+ add modifier</button>
            </div>

            <aside class="preview">
                <h3>On the sheet</h3>
                <p class="pv-name">{f.name || "Unnamed"} <small>{f.category}</small></p>
                {#if f.implies.length}
                    <p class="pv-inc">Includes: {f.implies.map((id) => defs.find((d) => d.id === id)?.name ?? id).join(", ")}</p>
                {/if}
                <ul>
                    {#each preview as line}<li>{line}</li>{:else}<li class="muted">No modifiers — text only.</li>{/each}
                    {#if f.breaksConcentration}<li>Breaks Concentration</li>{/if}
                </ul>
            </aside>
        </div>

        <footer>
            <span class="hint">{error}</span>
            <button class="ghost" onclick={() => onCancel?.()}>Cancel</button>
            <button class="primary" onclick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </footer>
    </div>
</div>

<style>
    .backdrop {
        position: fixed;
        inset: 0;
        z-index: 900;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 48px 16px;
        background: rgba(0, 0, 0, 0.6);
        overflow-y: auto;
    }

    .dialog {
        width: min(920px, 100%);
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 20px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 10px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
        font-family: var(--font-ui);
        color: var(--color-text-primary);
    }

    header {
        display: flex;
        align-items: center;
    }

    h2 {
        flex: 1;
        margin: 0;
        font-family: var(--font-heading-alt);
        font-size: 20px;
    }

    h3 {
        margin: 8px 0 4px;
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

    .cols {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 260px;
        gap: 20px;
    }

    @media (max-width: 760px) {
        .cols {
            grid-template-columns: 1fr;
        }
    }

    .form {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
    }

    .grid {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .field.wide {
        flex: 1 1 200px;
    }

    input,
    select,
    textarea {
        padding: 4px 6px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-primary);
        font: inherit;
        font-size: 13px;
    }

    textarea {
        resize: vertical;
    }

    input[type="number"] {
        width: 72px;
    }

    .check {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .check.sm {
        font-size: 12px;
    }

    .implies summary {
        cursor: pointer;
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .chips {
        margin-top: 6px;
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }

    .chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        border: 1px solid var(--color-border);
        border-radius: 999px;
        font-size: 12px;
        cursor: pointer;
    }

    .chip input {
        display: none;
    }

    .chip.on {
        border-color: var(--color-danger);
        background: color-mix(in srgb, var(--color-danger) 15%, transparent);
    }

    .mod {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
    }

    .mod .on {
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .mod .note {
        flex: 1 1 140px;
        min-width: 0;
    }

    .mod .dice {
        width: 64px;
    }

    .preview {
        padding: 10px 12px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        font-size: 13px;
        align-self: start;
    }

    .preview ul {
        margin: 6px 0 0;
        padding-left: 18px;
    }

    .preview li {
        margin: 2px 0;
    }

    .pv-name {
        margin: 0;
        font-weight: var(--font-weight-semibold);
    }

    .pv-name small,
    .pv-inc {
        color: var(--color-text-muted);
        font-weight: normal;
        font-size: 12px;
    }

    .pv-inc {
        margin: 4px 0 0;
    }

    .muted {
        color: var(--color-text-muted);
    }

    footer {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .hint {
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

    .ghost.sm {
        padding: 2px 8px;
        font-size: 12px;
    }

    .ghost.del {
        margin-left: auto;
    }

    .ghost.del:hover {
        border-color: var(--color-danger);
        color: var(--color-danger);
    }

    .link {
        align-self: flex-start;
        padding: 0;
        background: none;
        border: none;
        color: var(--color-gold);
        font: inherit;
        font-size: 13px;
        cursor: pointer;
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
        opacity: 0.5;
        cursor: default;
    }
</style>
