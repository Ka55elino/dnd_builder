<script>
    /**
     * Custom spell form. The result is an object in assets/data/spells format,
     * saved via saveCustomSpell. On the right is a live card preview.
     *
     * initial — reference record to edit (or the base for a copy), null — new
     * copy    — true: initial is only a base, save as a new record
     * classes — classes (refs.classes) for choosing spell lists
     * onSaved(id) / onCancel()
     */
    import { untrack } from "svelte";
    import { saveCustomSpell } from "../data/refs.js"; // also reloads the spell cache
    import { ACTION_TYPES, DAMAGE_TYPES, SCHOOLS } from "../rules/labels.js";
    import ActionCard from "./common/ActionCard.svelte";

    let { initial = null, copy = false, classes = [], onSaved, onCancel } = $props();

    // default casting time for the action type
    const TIME_BY_ACTION = { action: "1 action", bonus: "1 bonus action", reaction: "1 reaction", free: "" };
    const DMG = Object.entries(DAMAGE_TYPES).filter(([k]) => k !== "physical" && k !== "weapon");
    const DICE = /^\d+(d\d+)?$/i;

    let f = $state(untrack(() => formFrom(initial, copy)));

    // fields of the source record the form doesn't edit (complex multi-part damage,
    // weaponAttack, scaleDie…) — kept as is so an edit/copy doesn't lose them
    const MANAGED = ["id", "name", "kind", "level", "school", "action", "classes", "casting", "damage", "custom", "desc"];
    const kept = untrack(() => {
        const d = initial?.data ?? {};
        const rest = Object.fromEntries(Object.entries(d).filter(([k]) => !MANAGED.includes(k)));
        const complex = d.damage && !("dice" in d.damage || "type" in d.damage) ? d.damage : null;
        return { rest, complexDamage: complex };
    });

    function formFrom(initial, copy) {
        const d = initial?.data ?? {};
        const c = d.casting ?? {};
        const comp = String(c.components ?? "V, S");
        const material = /\bM\s*\((.*)\)/.exec(comp)?.[1] ?? "";
        const dmg = d.damage && ("dice" in d.damage || "type" in d.damage) ? d.damage : null;
        const action = initial?.action ?? d.action ?? "action";
        return {
            name: initial ? (copy ? `${initial.name} (copy)` : initial.name) : "",
            level: initial?.level ?? 1,
            school: initial?.school ?? "evocation",
            classes: [...(d.classes ?? [])],
            action,
            time: c.time ?? TIME_BY_ACTION[action] ?? "",
            range: c.range ?? "",
            duration: c.duration ?? "Instantaneous",
            v: /\bV\b/.test(comp),
            s: /\bS\b/.test(comp),
            m: /\bM\b/.test(comp),
            material,
            concentration: !!(c.concentration ?? initial?.concentration),
            ritual: !!(c.ritual ?? initial?.ritual),
            hasDamage: !!dmg?.dice,
            dice: dmg?.dice ?? "1d10",
            dmgType: dmg?.type ?? "fire",
            cantripScaling: dmg ? dmg.scaling === "cantrip" : true, // a new cantrip's damage scales by default
            desc: initial?.desc ?? d.desc ?? "",
        };
    }

    // changing the action type fills in the time unless it was edited manually
    function setAction(a) {
        if (f.time === (TIME_BY_ACTION[f.action] ?? "")) f.time = TIME_BY_ACTION[a] ?? "";
        f.action = a;
    }

    function toggleClass(id) {
        const i = f.classes.indexOf(id);
        if (i >= 0) f.classes.splice(i, 1);
        else f.classes.push(id);
    }

    const components = $derived(
        [f.v && "V", f.s && "S", f.m && (f.material.trim() ? `M (${f.material.trim()})` : "M")].filter(Boolean).join(", "),
    );

    /** Object in assets/data/spells format (no validation — for the preview). */
    function toSpell() {
        const level = Number(f.level) || 0;
        const casting = {
            ...(f.time.trim() ? { time: f.time.trim() } : {}),
            ...(f.range.trim() ? { range: f.range.trim() } : {}),
            ...(components ? { components } : {}),
            ...(f.duration.trim() ? { duration: f.duration.trim() } : {}),
            ...(f.concentration ? { concentration: true } : {}),
            ...(f.ritual ? { ritual: true } : {}),
        };
        const damage = f.hasDamage
            ? {
                  dice: f.dice.trim().toLowerCase(),
                  type: f.dmgType,
                  ...(level === 0 && f.cantripScaling ? { scaling: "cantrip" } : {}),
              }
            : null;
        return {
            ...kept.rest,
            ...(initial && !copy ? { id: initial.id } : {}),
            name: f.name.trim(),
            kind: "spell",
            level,
            school: f.school,
            action: f.action || null,
            classes: [...f.classes],
            desc: f.desc.trim(),
            casting,
            ...(damage ? { damage } : kept.complexDamage ? { damage: kept.complexDamage } : {}),
        };
    }

    // preview — shaped like a reference record (as returned by GetSpells)
    const preview = $derived.by(() => {
        const sp = toSpell();
        const { desc, ...data } = sp;
        return {
            ...sp,
            name: sp.name || "Name",
            concentration: f.concentration,
            ritual: f.ritual,
            desc: desc || "Spell description…",
            data,
        };
    });
    const previewSource = $derived(
        f.classes.map((id) => classes.find((c) => c.id === id)?.name).filter(Boolean).join(", "),
    );

    let error = $state("");
    let saving = $state(false);

    async function save() {
        error = "";
        const sp = toSpell();
        if (!sp.name) return (error = "Enter a name.");
        if (!sp.desc) return (error = "Add a description.");
        if (f.hasDamage && !DICE.test(sp.damage.dice)) return (error = "Damage must be a die like 2d6 or a number.");
        saving = true;
        try {
            const id = await saveCustomSpell(JSON.stringify(sp));
            onSaved?.(id);
        } catch (e) {
            error = "Failed to save: " + (e?.message ?? e);
        } finally {
            saving = false;
        }
    }

    function onKey(e) {
        if (e.key === "Escape") onCancel?.();
    }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={(e) => e.target === e.currentTarget && onCancel?.()}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Custom spell">
        <h2>{initial && !copy ? "Edit spell" : "New spell"}</h2>

        <div class="layout">
            <div class="form">
                <label class="field">
                    <span>Name *</span>
                    <input type="text" bind:value={f.name} placeholder="E.g. Ice Knife" />
                </label>

                <div class="grid">
                    <label class="field">
                        <span>Level</span>
                        <select bind:value={f.level}>
                            {#each Array.from({ length: 10 }, (_, i) => i) as l}
                                <option value={l}>{l === 0 ? "Cantrip" : `Level ${l}`}</option>
                            {/each}
                        </select>
                    </label>
                    <label class="field">
                        <span>School</span>
                        <select bind:value={f.school}>
                            {#each Object.entries(SCHOOLS) as [k, v]}<option value={k}>{v}</option>{/each}
                        </select>
                    </label>
                    <label class="field">
                        <span>Action type</span>
                        <select value={f.action} onchange={(e) => setAction(e.currentTarget.value)}>
                            {#each Object.entries(ACTION_TYPES) as [k, v]}<option value={k}>{v.name}</option>{/each}
                            <option value="">— other —</option>
                        </select>
                    </label>
                    <label class="field">
                        <span>Casting time</span>
                        <input type="text" bind:value={f.time} placeholder="1 minute" />
                    </label>
                    <label class="field">
                        <span>Range</span>
                        <input type="text" bind:value={f.range} placeholder="60 feet / Self / Touch" />
                    </label>
                    <label class="field">
                        <span>Duration</span>
                        <input type="text" bind:value={f.duration} placeholder="Instantaneous" />
                    </label>
                </div>

                <div class="field">
                    <span>Components and flags</span>
                    <div class="checks">
                        <label class="check"><input type="checkbox" bind:checked={f.v} /> V</label>
                        <label class="check"><input type="checkbox" bind:checked={f.s} /> S</label>
                        <label class="check"><input type="checkbox" bind:checked={f.m} /> M</label>
                        <label class="check"><input type="checkbox" bind:checked={f.concentration} /> Concentration</label>
                        <label class="check"><input type="checkbox" bind:checked={f.ritual} /> Ritual</label>
                    </div>
                    {#if f.m}
                        <input type="text" bind:value={f.material} placeholder="material component (optional)" />
                    {/if}
                </div>

                <div class="field">
                    <span>Damage</span>
                    {#if kept.complexDamage && !f.hasDamage}
                        <small class="hint">Multi-part damage will be kept as in the original spell.</small>
                    {/if}
                    <label class="check"><input type="checkbox" bind:checked={f.hasDamage} /> {kept.complexDamage ? "Replace with simple damage" : "Deals damage"}</label>
                    {#if f.hasDamage}
                        <div class="dmg-row">
                            <input type="text" bind:value={f.dice} placeholder="2d6" />
                            <select bind:value={f.dmgType}>
                                {#each DMG as [k, v]}<option value={k}>{v.short}</option>{/each}
                            </select>
                            {#if Number(f.level) === 0}
                                <label class="check"><input type="checkbox" bind:checked={f.cantripScaling} /> scales at levels 5/11/17</label>
                            {/if}
                        </div>
                    {/if}
                </div>

                <div class="field">
                    <span>Class spell lists</span>
                    <div class="chips">
                        {#each classes as c (c.id)}
                            <button class="chip" class:on={f.classes.includes(c.id)} onclick={() => toggleClass(c.id)}>{c.name}</button>
                        {/each}
                    </div>
                    <small class="hint">Checked classes can choose this spell at character creation and on level up.</small>
                </div>

                <label class="field">
                    <span>Description *</span>
                    <textarea rows="5" bind:value={f.desc} placeholder="What the spell does, saving throw, effect at higher levels…"></textarea>
                </label>
            </div>

            <aside class="preview">
                <span class="p-label">Preview</span>
                <ActionCard item={preview} source={previewSource} />
            </aside>
        </div>

        {#if error}<p class="error">{error}</p>{/if}

        <div class="actions">
            <button class="ghost" onclick={onCancel}>Cancel</button>
            <button class="primary" onclick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
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
        padding: 40px 16px;
        overflow-y: auto;
        background: rgba(0, 0, 0, 0.6);
    }

    .dialog {
        width: min(920px, 100%);
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 24px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 10px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
    }

    h2 {
        margin: 0;
        font-family: var(--font-heading-alt);
        font-size: 22px;
        color: var(--color-gold);
    }

    .layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 300px;
        gap: 20px;
        align-items: start;
    }

    @media (max-width: 760px) {
        .layout {
            grid-template-columns: 1fr;
        }
    }

    .form {
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    .preview {
        position: sticky;
        top: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .p-label {
        font-family: var(--font-ui);
        font-size: 11px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-text-muted);
    }

    .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
        gap: 12px;
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .field > span {
        font-family: var(--font-form);
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .checks {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 16px;
    }

    .check {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-primary);
    }

    .dmg-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
    }

    .dmg-row input {
        width: 110px;
    }

    .dmg-row select {
        width: auto;
    }

    input[type="text"],
    select,
    textarea {
        width: 100%;
        padding: 8px 10px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-primary);
        font-family: var(--font-form);
        font-size: 14px;
        outline: none;
    }

    textarea {
        resize: vertical;
        font-family: var(--font-spell);
        font-size: 15px;
    }

    input:focus,
    select:focus,
    textarea:focus {
        border-color: var(--color-gold);
    }

    .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }

    .chip {
        padding: 4px 12px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 999px;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: 13px;
        cursor: pointer;
    }

    .chip.on {
        background: var(--color-magic-purple-dark);
        border-color: var(--color-magic-purple);
        color: var(--color-text-primary);
    }

    .hint {
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
    }

    .ghost {
        padding: 8px 14px;
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
        padding: 8px 18px;
        background: var(--color-gold);
        border: 1px solid var(--color-gold);
        border-radius: 6px;
        color: var(--color-bg);
        font-family: var(--font-ui);
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
    }

    .primary:hover {
        background: var(--color-gold-hover);
    }

    .primary:disabled {
        opacity: 0.6;
        cursor: default;
    }

    .error {
        margin: 0;
        color: var(--color-danger);
        font-family: var(--font-ui);
        font-size: 13px;
    }
</style>
