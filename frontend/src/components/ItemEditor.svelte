<script>
    /**
     * Custom equipment form: item, armor or weapon.
     * The result is an object in assets/data format (as in the seed JSON),
     * saved via saveCustomEquipment.
     *
     * kind     — 'item' | 'armor' | 'weapon'
     * initial  — catalog record to edit (or the base for a copy), null — new
     * copy     — true: initial is only a base, save as a new record
     * onSaved(id, kind) / onCancel()
     */
    import { saveCustomEquipment } from "../data/refs.js"; // also reloads the equipment cache
    import { ARMOR_CAT, WEAPON_CAT, WEAPON_PROPS } from "../rules/equipment.js";
    import { DAMAGE_TYPES } from "../rules/labels.js";
    import { untrack } from "svelte";

    let { kind, initial = null, copy = false, onSaved, onCancel } = $props();

    const NEW_TITLE = { item: "New item", armor: "New armor", weapon: "New weapon" };
    const EDIT_TITLE = { item: "Edit item", armor: "Edit armor", weapon: "Edit weapon" };
    const MASTERIES = ["Cleave", "Graze", "Nick", "Push", "Sap", "Slow", "Topple", "Vex"];
    // weapon damage type: physical first
    const DMG = Object.entries(DAMAGE_TYPES).filter(([k]) => k !== "physical" && k !== "weapon");
    const IMAGE_MAX = 256;

    const num = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v));

    // --- form state: snapshot of initial on open (the form is recreated via {#key}) ---
    let f = $state(untrack(() => formFrom(initial, copy)));

    function formFrom(initial, copy) {
        const d = initial?.data ?? {};
        return {
        name: initial ? (copy ? `${initial.name} (copy)` : initial.name) : "",
        image: initial?.image ?? null,
        desc: initial?.desc ?? d.desc ?? "",
        weight: initial?.weight ?? d.weight ?? "",
        cost: initial?.cost ?? d.cost ?? "",
        // weapon
        wCategory: initial?.category ?? "simple",
        damage: initial?.damage ?? "1d6",
        damageType: initial?.damageType ?? "slashing",
        properties: [...(d.properties ?? [])],
        mastery: d.mastery ?? "",
        attackBonus: d.attackBonus ?? "",
        damageBonus: d.damageBonus ?? "",
        extraDamage: (d.extraDamage ?? []).map((x) => ({ ...x })),
        // armor
        aCategory: initial?.category ?? "light",
        baseAC: initial?.baseAC ?? 11,
        maxDex: d.maxDex ?? 2,
        acBonus: d.acBonus ?? "",
        strengthReq: d.strengthReq ?? "",
        stealthDisadvantage: !!d.stealthDisadvantage,
        };
    }

    let error = $state("");
    let saving = $state(false);

    const isShield = $derived(f.aCategory === "shield");

    // --- image ---
    let fileInput;
    function pickImage(e) {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = "";
        if (!file || !file.type.startsWith("image/")) return;
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, IMAGE_MAX / Math.max(img.width, img.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            f.image = canvas.toDataURL("image/png");
            URL.revokeObjectURL(url);
        };
        img.src = url;
    }

    function toggleProp(p) {
        const i = f.properties.indexOf(p);
        if (i >= 0) f.properties.splice(i, 1);
        else f.properties.push(p);
    }

    // --- build the object in assets/data format ---
    const DICE = /^\d+(d\d+)?$/i;

    function build() {
        const name = f.name.trim();
        if (!name) throw new Error("Enter a name.");
        const base = {
            ...(initial && !copy ? { id: initial.id } : {}),
            name,
            ...(f.image ? { image: f.image } : {}),
        };
        const desc = f.desc.trim();
        const extra = {
            ...(num(f.weight) != null ? { weight: num(f.weight) } : {}),
            ...(String(f.cost).trim() ? { cost: String(f.cost).trim() } : {}),
            ...(desc ? { desc } : {}),
        };

        if (kind === "item") return { ...base, ...extra };

        if (kind === "weapon") {
            const damage = f.damage.trim().toLowerCase();
            if (!DICE.test(damage)) throw new Error("Damage must be a die like 1d8 or a number.");
            const extraDamage = f.extraDamage
                .map((x) => ({ dice: String(x.dice).trim().toLowerCase(), type: x.type }))
                .filter((x) => x.dice);
            if (extraDamage.some((x) => !DICE.test(x.dice))) throw new Error("Extra damage must be a die like 1d6.");
            return {
                ...base,
                category: f.wCategory,
                damage,
                damageType: f.damageType,
                properties: [...f.properties],
                ...(f.mastery ? { mastery: f.mastery } : {}),
                ...(num(f.attackBonus) ? { attackBonus: num(f.attackBonus) } : {}),
                ...(num(f.damageBonus) ? { damageBonus: num(f.damageBonus) } : {}),
                ...(extraDamage.length ? { extraDamage } : {}),
                ...extra,
            };
        }

        // armor: Dexterity by category (light: full, medium: up to maxDex, heavy: none)
        if (isShield) {
            return { ...base, category: "shield", acBonus: num(f.acBonus) ?? 2, ...extra };
        }
        const baseAC = num(f.baseAC);
        if (baseAC == null || baseAC < 1) throw new Error("Enter the base AC.");
        const dex =
            f.aCategory === "light"
                ? { addDex: true }
                : f.aCategory === "medium"
                  ? { addDex: true, maxDex: num(f.maxDex) ?? 2 }
                  : { addDex: false, maxDex: 0 };
        return {
            ...base,
            category: f.aCategory,
            baseAC,
            ...dex,
            ...(num(f.acBonus) ? { acBonus: num(f.acBonus) } : {}),
            ...(num(f.strengthReq) ? { strengthReq: num(f.strengthReq) } : {}),
            ...(f.stealthDisadvantage ? { stealthDisadvantage: true } : {}),
            ...extra,
        };
    }

    async function save() {
        error = "";
        let obj;
        try {
            obj = build();
        } catch (e) {
            error = e.message;
            return;
        }
        saving = true;
        try {
            const id = await saveCustomEquipment(kind, JSON.stringify(obj));
            onSaved?.(id, kind);
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
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Custom equipment">
        <h2>{initial && !copy ? EDIT_TITLE[kind] : NEW_TITLE[kind]}</h2>

        <div class="head">
            <button class="image" onclick={() => fileInput.click()} title="Choose image">
                {#if f.image}<img src={f.image} alt="" />{:else}<span>+ image</span>{/if}
            </button>
            <input bind:this={fileInput} type="file" accept="image/*" hidden onchange={pickImage} />
            <div class="head-fields">
                <label class="field">
                    <span>Name *</span>
                    <input type="text" bind:value={f.name} placeholder="E.g. Flame Tongue" />
                </label>
                {#if f.image}<button class="link" onclick={() => (f.image = null)}>Remove image</button>{/if}
            </div>
        </div>

        {#if kind === "weapon"}
            <div class="grid">
                <label class="field">
                    <span>Category</span>
                    <select bind:value={f.wCategory}>
                        {#each Object.entries(WEAPON_CAT) as [k, v]}<option value={k}>{v}</option>{/each}
                    </select>
                </label>
                <label class="field">
                    <span>Damage</span>
                    <input type="text" bind:value={f.damage} placeholder="1d8" />
                </label>
                <label class="field">
                    <span>Damage type</span>
                    <select bind:value={f.damageType}>
                        {#each DMG as [k, v]}<option value={k}>{v.short}</option>{/each}
                    </select>
                </label>
                <label class="field">
                    <span>Mastery</span>
                    <select bind:value={f.mastery}>
                        <option value="">—</option>
                        {#each MASTERIES as m}<option value={m}>{m}</option>{/each}
                    </select>
                </label>
                <label class="field">
                    <span>Attack bonus</span>
                    <input type="number" bind:value={f.attackBonus} placeholder="0" />
                </label>
                <label class="field">
                    <span>Damage bonus</span>
                    <input type="number" bind:value={f.damageBonus} placeholder="0" />
                </label>
            </div>

            <div class="field">
                <span>Properties</span>
                <div class="chips">
                    {#each Object.entries(WEAPON_PROPS) as [k, v]}
                        <button class="chip" class:on={f.properties.includes(k)} onclick={() => toggleProp(k)}>{v}</button>
                    {/each}
                </div>
            </div>

            <div class="field">
                <span>Extra damage</span>
                {#each f.extraDamage as x, i}
                    <div class="extra-row">
                        <input type="text" bind:value={x.dice} placeholder="1d6" />
                        <select bind:value={x.type}>
                            {#each DMG as [k, v]}<option value={k}>{v.short}</option>{/each}
                        </select>
                        <button class="ghost small" onclick={() => f.extraDamage.splice(i, 1)} aria-label="Remove">×</button>
                    </div>
                {/each}
                <button class="link" onclick={() => f.extraDamage.push({ dice: "1d6", type: "fire" })}>+ add damage</button>
            </div>
        {:else if kind === "armor"}
            <div class="grid">
                <label class="field">
                    <span>Category</span>
                    <select bind:value={f.aCategory}>
                        {#each Object.entries(ARMOR_CAT) as [k, v]}<option value={k}>{v}</option>{/each}
                    </select>
                </label>
                {#if !isShield}
                    <label class="field">
                        <span>Base AC</span>
                        <input type="number" min="1" bind:value={f.baseAC} />
                    </label>
                    {#if f.aCategory === "medium"}
                        <label class="field">
                            <span>Max Dex bonus</span>
                            <input type="number" min="0" bind:value={f.maxDex} />
                        </label>
                    {/if}
                {/if}
                <label class="field">
                    <span>{isShield ? "Shield AC bonus" : "Magic AC bonus"}</span>
                    <input type="number" bind:value={f.acBonus} placeholder={isShield ? "2" : "0"} />
                </label>
                {#if !isShield}
                    <label class="field">
                        <span>Strength required</span>
                        <input type="number" min="0" bind:value={f.strengthReq} placeholder="—" />
                    </label>
                    <label class="check">
                        <input type="checkbox" bind:checked={f.stealthDisadvantage} />
                        <span>Stealth Disadvantage</span>
                    </label>
                {/if}
            </div>
            <p class="hint">
                {#if f.aCategory === "light"}Light: AC = base + Dex.
                {:else if f.aCategory === "medium"}Medium: AC = base + Dex (up to the max bonus).
                {:else if f.aCategory === "heavy"}Heavy: Dexterity is not added.
                {:else}Shield: adds to AC, occupies a hand.{/if}
            </p>
        {/if}

        <div class="grid">
            <label class="field">
                <span>Weight, lb.</span>
                <input type="number" min="0" step="0.1" bind:value={f.weight} placeholder="—" />
            </label>
            <label class="field">
                <span>Cost</span>
                <input type="text" bind:value={f.cost} placeholder="10 GP" />
            </label>
        </div>

        <label class="field">
            <span>Description</span>
            <textarea rows="4" bind:value={f.desc} placeholder="Properties, history, special effects…"></textarea>
        </label>

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
        padding: 48px 16px;
        overflow-y: auto;
        background: rgba(0, 0, 0, 0.6);
    }

    .dialog {
        width: min(640px, 100%);
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

    .head {
        display: flex;
        gap: 16px;
        align-items: flex-start;
    }

    .head-fields {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
    }

    .head-fields .field {
        width: 100%;
    }

    .image {
        width: 72px;
        height: 72px;
        flex: 0 0 72px;
        padding: 0;
        display: grid;
        place-items: center;
        overflow: hidden;
        background: var(--color-bg);
        border: 1px dashed var(--color-border);
        border-radius: 8px;
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: 11px;
        cursor: pointer;
    }

    .image:hover {
        border-color: var(--color-gold);
    }

    .image img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
        gap: 12px;
        align-items: end;
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .field > span,
    .check span {
        font-family: var(--font-form);
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .check {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-bottom: 8px;
    }

    input[type="text"],
    input[type="number"],
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

    .extra-row {
        display: grid;
        grid-template-columns: 120px 1fr auto;
        gap: 8px;
        margin-bottom: 6px;
    }

    .hint {
        margin: -4px 0 0;
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .link {
        align-self: flex-start;
        padding: 0;
        background: none;
        border: none;
        color: var(--color-gold);
        font-family: var(--font-ui);
        font-size: 13px;
        cursor: pointer;
    }

    .link:hover {
        color: var(--color-gold-hover);
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

    .ghost.small {
        padding: 4px 10px;
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
