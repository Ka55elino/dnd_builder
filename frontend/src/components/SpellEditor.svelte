<script>
    /**
     * Форма своего заклинания. Результат — объект в формате db/data/spells,
     * сохраняется через SaveCustomSpell. Справа — живой предпросмотр карточки.
     *
     * initial — запись справочника для правки (или основа для копии), null — новое
     * copy    — true: initial — только основа, сохраняем как новую запись
     * classes — классы (refs.classes) для выбора списков
     * onSaved(id) / onCancel()
     */
    import { untrack } from "svelte";
    import { SaveCustomSpell } from "../../wailsjs/go/main/App.js";
    import { ACTION_TYPES, DAMAGE_TYPES, SCHOOLS } from "../rules/labels.js";
    import ActionCard from "./common/ActionCard.svelte";

    let { initial = null, copy = false, classes = [], onSaved, onCancel } = $props();

    // время накладывания по умолчанию для типа действия
    const TIME_BY_ACTION = { action: "1 действие", bonus: "1 бонусное действие", reaction: "1 реакция", free: "" };
    const DMG = Object.entries(DAMAGE_TYPES).filter(([k]) => k !== "physical" && k !== "weapon");
    const DICE = /^\d+(d\d+)?$/i;

    let f = $state(untrack(() => formFrom(initial, copy)));

    // поля исходной записи, которые форма не редактирует (сложный урон из нескольких частей,
    // weaponAttack, scaleDie…) — сохраняем как есть, чтобы правка/копия их не теряла
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
        const comp = String(c.components ?? "В, С");
        const material = /М\s*\((.*)\)/.exec(comp)?.[1] ?? "";
        const dmg = d.damage && ("dice" in d.damage || "type" in d.damage) ? d.damage : null;
        const action = initial?.action ?? d.action ?? "action";
        return {
            name: initial ? (copy ? `${initial.name} (копия)` : initial.name) : "",
            level: initial?.level ?? 1,
            school: initial?.school ?? "evocation",
            classes: [...(d.classes ?? [])],
            action,
            time: c.time ?? TIME_BY_ACTION[action] ?? "",
            range: c.range ?? "",
            duration: c.duration ?? "Мгновенно",
            v: /В/.test(comp),
            s: /С/.test(comp),
            m: /М/.test(comp),
            material,
            concentration: !!(c.concentration ?? initial?.concentration),
            ritual: !!(c.ritual ?? initial?.ritual),
            hasDamage: !!dmg?.dice,
            dice: dmg?.dice ?? "1d10",
            dmgType: dmg?.type ?? "fire",
            cantripScaling: dmg ? dmg.scaling === "cantrip" : true, // у нового заговора урон растёт по умолчанию
            desc: initial?.desc ?? d.desc ?? "",
        };
    }

    // смена типа действия подставляет время, если его не меняли вручную
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
        [f.v && "В", f.s && "С", f.m && (f.material.trim() ? `М (${f.material.trim()})` : "М")].filter(Boolean).join(", "),
    );

    /** Объект в формате db/data/spells (без проверок — для предпросмотра). */
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

    // предпросмотр — в форме записи справочника (как приходит из GetSpells)
    const preview = $derived.by(() => {
        const sp = toSpell();
        const { desc, ...data } = sp;
        return {
            ...sp,
            name: sp.name || "Название",
            concentration: f.concentration,
            ritual: f.ritual,
            desc: desc || "Описание заклинания…",
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
        if (!sp.name) return (error = "Укажите название.");
        if (!sp.desc) return (error = "Добавьте описание.");
        if (f.hasDamage && !DICE.test(sp.damage.dice)) return (error = "Урон — кость вида 2d6 или число.");
        saving = true;
        try {
            const id = await SaveCustomSpell(JSON.stringify(sp));
            onSaved?.(id);
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
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Своё заклинание">
        <h2>{initial && !copy ? "Изменить заклинание" : "Новое заклинание"}</h2>

        <div class="layout">
            <div class="form">
                <label class="field">
                    <span>Название *</span>
                    <input type="text" bind:value={f.name} placeholder="Например, Ледяной шип" />
                </label>

                <div class="grid">
                    <label class="field">
                        <span>Круг</span>
                        <select bind:value={f.level}>
                            {#each Array.from({ length: 10 }, (_, i) => i) as l}
                                <option value={l}>{l === 0 ? "Заговор" : `${l} круг`}</option>
                            {/each}
                        </select>
                    </label>
                    <label class="field">
                        <span>Школа</span>
                        <select bind:value={f.school}>
                            {#each Object.entries(SCHOOLS) as [k, v]}<option value={k}>{v}</option>{/each}
                        </select>
                    </label>
                    <label class="field">
                        <span>Тип действия</span>
                        <select value={f.action} onchange={(e) => setAction(e.currentTarget.value)}>
                            {#each Object.entries(ACTION_TYPES) as [k, v]}<option value={k}>{v.name}</option>{/each}
                            <option value="">— другое —</option>
                        </select>
                    </label>
                    <label class="field">
                        <span>Время накладывания</span>
                        <input type="text" bind:value={f.time} placeholder="1 минута" />
                    </label>
                    <label class="field">
                        <span>Дистанция</span>
                        <input type="text" bind:value={f.range} placeholder="18 м / на себя / касание" />
                    </label>
                    <label class="field">
                        <span>Длительность</span>
                        <input type="text" bind:value={f.duration} placeholder="Мгновенно" />
                    </label>
                </div>

                <div class="field">
                    <span>Компоненты и флаги</span>
                    <div class="checks">
                        <label class="check"><input type="checkbox" bind:checked={f.v} /> В</label>
                        <label class="check"><input type="checkbox" bind:checked={f.s} /> С</label>
                        <label class="check"><input type="checkbox" bind:checked={f.m} /> М</label>
                        <label class="check"><input type="checkbox" bind:checked={f.concentration} /> Концентрация</label>
                        <label class="check"><input type="checkbox" bind:checked={f.ritual} /> Ритуал</label>
                    </div>
                    {#if f.m}
                        <input type="text" bind:value={f.material} placeholder="материальный компонент (необязательно)" />
                    {/if}
                </div>

                <div class="field">
                    <span>Урон</span>
                    {#if kept.complexDamage && !f.hasDamage}
                        <small class="hint">Урон из нескольких частей сохранится как в исходном заклинании.</small>
                    {/if}
                    <label class="check"><input type="checkbox" bind:checked={f.hasDamage} /> {kept.complexDamage ? "Заменить урон на простой" : "Наносит урон"}</label>
                    {#if f.hasDamage}
                        <div class="dmg-row">
                            <input type="text" bind:value={f.dice} placeholder="2d6" />
                            <select bind:value={f.dmgType}>
                                {#each DMG as [k, v]}<option value={k}>{v.short}</option>{/each}
                            </select>
                            {#if Number(f.level) === 0}
                                <label class="check"><input type="checkbox" bind:checked={f.cantripScaling} /> растёт на 5/11/17 ур.</label>
                            {/if}
                        </div>
                    {/if}
                </div>

                <div class="field">
                    <span>Списки классов</span>
                    <div class="chips">
                        {#each classes as c (c.id)}
                            <button class="chip" class:on={f.classes.includes(c.id)} onclick={() => toggleClass(c.id)}>{c.name}</button>
                        {/each}
                    </div>
                    <small class="hint">Отмеченные классы смогут выбирать это заклинание при создании и повышении уровня.</small>
                </div>

                <label class="field">
                    <span>Описание *</span>
                    <textarea rows="5" bind:value={f.desc} placeholder="Что делает заклинание, спасбросок, эффект на больших кругах…"></textarea>
                </label>
            </div>

            <aside class="preview">
                <span class="p-label">Предпросмотр</span>
                <ActionCard item={preview} source={previewSource} />
            </aside>
        </div>

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
