<script>
    /**
     * Форма своего снаряжения: предмет, доспех или оружие.
     * Результат — объект в формате db/data (как в JSON сидов),
     * сохраняется через SaveCustomEquipment.
     *
     * kind     — 'item' | 'armor' | 'weapon'
     * initial  — запись каталога для правки (или основа для копии), null — новое
     * copy     — true: initial — только основа, сохраняем как новую запись
     * onSaved(id, kind) / onCancel()
     */
    import { SaveCustomEquipment } from "../../wailsjs/go/main/App.js";
    import { ARMOR_CAT, WEAPON_CAT, WEAPON_PROPS } from "../rules/equipment.js";
    import { DAMAGE_TYPES } from "../rules/labels.js";
    import { untrack } from "svelte";

    let { kind, initial = null, copy = false, onSaved, onCancel } = $props();

    const NEW_TITLE = { item: "Новый предмет", armor: "Новый доспех", weapon: "Новое оружие" };
    const EDIT_TITLE = { item: "Изменить предмет", armor: "Изменить доспех", weapon: "Изменить оружие" };
    const MASTERIES = ["Досада", "Замедление", "Засечка", "Опрокидывание", "Ослабление", "Отталкивание", "Рассекание", "Царапанье"];
    // тип урона оружия: физические первыми
    const DMG = Object.entries(DAMAGE_TYPES).filter(([k]) => k !== "physical" && k !== "weapon");
    const IMAGE_MAX = 256;

    const num = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v));

    // --- состояние формы: снимок initial при открытии (форма пересоздаётся через {#key}) ---
    let f = $state(untrack(() => formFrom(initial, copy)));

    function formFrom(initial, copy) {
        const d = initial?.data ?? {};
        return {
        name: initial ? (copy ? `${initial.name} (копия)` : initial.name) : "",
        image: initial?.image ?? null,
        desc: initial?.desc ?? d.desc ?? "",
        weight: initial?.weight ?? d.weight ?? "",
        cost: initial?.cost ?? d.cost ?? "",
        // оружие
        wCategory: initial?.category ?? "simple",
        damage: initial?.damage ?? "1d6",
        damageType: initial?.damageType ?? "slashing",
        properties: [...(d.properties ?? [])],
        mastery: d.mastery ?? "",
        attackBonus: d.attackBonus ?? "",
        damageBonus: d.damageBonus ?? "",
        extraDamage: (d.extraDamage ?? []).map((x) => ({ ...x })),
        // доспех
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

    // --- картинка ---
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

    // --- сборка объекта в формате db/data ---
    const DICE = /^\d+(d\d+)?$/i;

    function build() {
        const name = f.name.trim();
        if (!name) throw new Error("Укажите название.");
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
            if (!DICE.test(damage)) throw new Error("Урон — кость вида 1d8 или число.");
            const extraDamage = f.extraDamage
                .map((x) => ({ dice: String(x.dice).trim().toLowerCase(), type: x.type }))
                .filter((x) => x.dice);
            if (extraDamage.some((x) => !DICE.test(x.dice))) throw new Error("Доп. урон — кость вида 1d6.");
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

        // доспех: Ловкость — по категории (лёгкий: полностью, средний: до maxDex, тяжёлый: нет)
        if (isShield) {
            return { ...base, category: "shield", acBonus: num(f.acBonus) ?? 2, ...extra };
        }
        const baseAC = num(f.baseAC);
        if (baseAC == null || baseAC < 1) throw new Error("Укажите базовый КД.");
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
            const id = await SaveCustomEquipment(kind, JSON.stringify(obj));
            onSaved?.(id, kind);
        } catch (e) {
            error = "Не удалось сохранить: " + (e?.message ?? e);
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
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Своё снаряжение">
        <h2>{initial && !copy ? EDIT_TITLE[kind] : NEW_TITLE[kind]}</h2>

        <div class="head">
            <button class="image" onclick={() => fileInput.click()} title="Выбрать картинку">
                {#if f.image}<img src={f.image} alt="" />{:else}<span>+ картинка</span>{/if}
            </button>
            <input bind:this={fileInput} type="file" accept="image/*" hidden onchange={pickImage} />
            <div class="head-fields">
                <label class="field">
                    <span>Название *</span>
                    <input type="text" bind:value={f.name} placeholder="Например, Пылающий клинок" />
                </label>
                {#if f.image}<button class="link" onclick={() => (f.image = null)}>Убрать картинку</button>{/if}
            </div>
        </div>

        {#if kind === "weapon"}
            <div class="grid">
                <label class="field">
                    <span>Категория</span>
                    <select bind:value={f.wCategory}>
                        {#each Object.entries(WEAPON_CAT) as [k, v]}<option value={k}>{v}</option>{/each}
                    </select>
                </label>
                <label class="field">
                    <span>Урон</span>
                    <input type="text" bind:value={f.damage} placeholder="1d8" />
                </label>
                <label class="field">
                    <span>Тип урона</span>
                    <select bind:value={f.damageType}>
                        {#each DMG as [k, v]}<option value={k}>{v.short}</option>{/each}
                    </select>
                </label>
                <label class="field">
                    <span>Мастерство</span>
                    <select bind:value={f.mastery}>
                        <option value="">—</option>
                        {#each MASTERIES as m}<option value={m}>{m}</option>{/each}
                    </select>
                </label>
                <label class="field">
                    <span>Бонус к попаданию</span>
                    <input type="number" bind:value={f.attackBonus} placeholder="0" />
                </label>
                <label class="field">
                    <span>Бонус к урону</span>
                    <input type="number" bind:value={f.damageBonus} placeholder="0" />
                </label>
            </div>

            <div class="field">
                <span>Свойства</span>
                <div class="chips">
                    {#each Object.entries(WEAPON_PROPS) as [k, v]}
                        <button class="chip" class:on={f.properties.includes(k)} onclick={() => toggleProp(k)}>{v}</button>
                    {/each}
                </div>
            </div>

            <div class="field">
                <span>Дополнительный урон</span>
                {#each f.extraDamage as x, i}
                    <div class="extra-row">
                        <input type="text" bind:value={x.dice} placeholder="1d6" />
                        <select bind:value={x.type}>
                            {#each DMG as [k, v]}<option value={k}>{v.short}</option>{/each}
                        </select>
                        <button class="ghost small" onclick={() => f.extraDamage.splice(i, 1)} aria-label="Убрать">×</button>
                    </div>
                {/each}
                <button class="link" onclick={() => f.extraDamage.push({ dice: "1d6", type: "fire" })}>+ добавить урон</button>
            </div>
        {:else if kind === "armor"}
            <div class="grid">
                <label class="field">
                    <span>Категория</span>
                    <select bind:value={f.aCategory}>
                        {#each Object.entries(ARMOR_CAT) as [k, v]}<option value={k}>{v}</option>{/each}
                    </select>
                </label>
                {#if !isShield}
                    <label class="field">
                        <span>Базовый КД</span>
                        <input type="number" min="1" bind:value={f.baseAC} />
                    </label>
                    {#if f.aCategory === "medium"}
                        <label class="field">
                            <span>Макс. бонус Лов</span>
                            <input type="number" min="0" bind:value={f.maxDex} />
                        </label>
                    {/if}
                {/if}
                <label class="field">
                    <span>{isShield ? "Бонус КД щита" : "Магический бонус КД"}</span>
                    <input type="number" bind:value={f.acBonus} placeholder={isShield ? "2" : "0"} />
                </label>
                {#if !isShield}
                    <label class="field">
                        <span>Требует Силу</span>
                        <input type="number" min="0" bind:value={f.strengthReq} placeholder="—" />
                    </label>
                    <label class="check">
                        <input type="checkbox" bind:checked={f.stealthDisadvantage} />
                        <span>Помеха Скрытности</span>
                    </label>
                {/if}
            </div>
            <p class="hint">
                {#if f.aCategory === "light"}Лёгкий: КД = база + Лов.
                {:else if f.aCategory === "medium"}Средний: КД = база + Лов (не больше макс. бонуса).
                {:else if f.aCategory === "heavy"}Тяжёлый: Ловкость не добавляется.
                {:else}Щит: прибавляется к КД, занимает руку.{/if}
            </p>
        {/if}

        <div class="grid">
            <label class="field">
                <span>Вес, фнт.</span>
                <input type="number" min="0" step="0.1" bind:value={f.weight} placeholder="—" />
            </label>
            <label class="field">
                <span>Цена</span>
                <input type="text" bind:value={f.cost} placeholder="10 зм" />
            </label>
        </div>

        <label class="field">
            <span>Описание</span>
            <textarea rows="4" bind:value={f.desc} placeholder="Свойства, история, особые эффекты…"></textarea>
        </label>

        {#if error}<p class="error">{error}</p>{/if}

        <div class="actions">
            <button class="ghost" onclick={onCancel}>Отмена</button>
            <button class="primary" onclick={save} disabled={saving}>{saving ? "Сохранение…" : "Сохранить"}</button>
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
