<script>
    /**
     * Экран уровня: что даёт уровень и что на нём нужно выбрать.
     * Используется в билдере (любой уровень при редактировании) и при повышении.
     *
     * build    — CharacterBuild (выборы пишутся в build.choices)
     * level    — какой уровень показываем
     * refs     — справочники (data/refs.js)
     * complete — (bindable) все ли выборы сделаны
     */
    import { levelPlan, evaluatePlan } from "../rules/progression.js";
    import { formatModifier } from "../rules/abilities.js";
    import ActionCard from "./common/ActionCard.svelte";

    // эти выборы показываем карточками с описанием; навыки — компактными чипами
    const CARD_KINDS = new Set([
        "cantrips", "spells", "feat", "fightingStyle", "metamagic", "invocations", "option", "subclass", "pool", "invocationForget",
    ]);

    let { build, level, refs, complete = $bindable(false) } = $props();

    const plan = $derived(levelPlan(build, level, refs));
    // visible / valid / count / need / done для каждого выбора
    const ev = $derived(evaluatePlan(plan, build, refs));

    // недопустимые значения убираем из build, чтобы они не занимали место
    $effect(() => {
        for (const c of ev.choices) {
            if (c.kind === "asi" || c.kind === "subclass" || !c.value?.ids) continue;
            if (c.valid.length !== c.value.ids.length) {
                build.setChoice(c.key, c.valid.length ? { kind: c.kind, ids: [...c.valid] } : null);
            }
        }
    });

    $effect(() => {
        complete = ev.complete;
    });

    // --- изменение выбора ---
    function toggle(choice, id) {
        const ids = [...choice.valid];
        const i = ids.indexOf(id);
        if (i >= 0) ids.splice(i, 1);
        else if (choice.pick === 1) ids.splice(0, ids.length, id);
        else if (ids.length < choice.pick) ids.push(id);
        else return;

        if (choice.kind === "subclass") build.setSubclass(ids[0] ?? null);
        build.setChoice(choice.key, ids.length ? { kind: choice.kind, ids } : null);

        // отменили замену воззвания — убрать и выбранное взамен
        if (choice.kind === "invocationForget" && !ids.length) {
            build.setChoice(choice.key.replace(/Forget$/, "Swap"), null);
        }

        // смена черты — сбросить зависящие от неё выборы (…:asi, …:skills)
        if (choice.kind === "feat") {
            for (const k of Object.keys(build.choices)) {
                if (k.startsWith(choice.key + ":")) build.setChoice(k, null);
            }
        }
    }

    function bumpAsi(choice, ability, delta) {
        const asi = { ...(choice.value?.asi ?? {}) };
        const used = Object.values(asi).reduce((s, v) => s + v, 0);
        const max = choice.pick * choice.amount;
        const next = (asi[ability] ?? 0) + delta * choice.amount;
        if (next < 0) return;
        if (delta > 0 && used + choice.amount > max) return;
        if (!choice.repeatable && delta > 0 && (asi[ability] ?? 0) > 0) return;
        if (next === 0) delete asi[ability];
        else asi[ability] = next;
        build.setChoice(choice.key, Object.keys(asi).length ? { kind: "asi", asi } : null);
    }
</script>

<div class="level">
    <!-- итог уровня -->
    <section class="summary">
        <div class="big">
            <span class="lbl">Уровень</span>
            <span class="val">{level}</span>
        </div>
        <div class="stat">
            <span class="lbl">Хиты</span>
            <span class="val">+{plan.hp.gain}</span>
            <small>{plan.hp.formula}</small>
        </div>
        <div class="stat" class:dim={!plan.profChanged}>
            <span class="lbl">Мастерство</span>
            <span class="val">{formatModifier(plan.prof)}</span>
            <small>{plan.profChanged ? (level === 1 ? "начальный" : "вырос") : "без изменений"}</small>
        </div>
        {#if plan.slots.length}
            <div class="stat" class:dim={!plan.slotsChanged}>
                <span class="lbl">Ячейки</span>
                <span class="val slots">
                    {#each plan.slots as s}<span>{s.level}<sup>{s.pact ? "дог" : "кр"}</sup>×{s.max}</span>{/each}
                </span>
                <small>{plan.slotsChanged ? "обновлены" : "без изменений"}</small>
            </div>
        {/if}
    </section>

    <div class="cols">
        <!-- что даёт уровень -->
        <section class="gains">
            <h3>Что даёт уровень</h3>
            {#each plan.gains as g}
                <div class="gain-group">
                    <h4>{g.title}</h4>
                    {#if g.items.some((it) => it.ref)}
                        <div class="gain-cards">
                            {#each g.items as it}
                                <ActionCard item={it.ref ?? { name: it.name, desc: it.desc }} {level} />
                            {/each}
                        </div>
                    {:else}
                    <ul>
                        {#each g.items as it}
                            <li>
                                <b>{it.name}{#if it.tag}<small class="tag">{it.tag}</small>{/if}</b>
                                {#if it.desc}<span>{it.desc}</span>{/if}
                            </li>
                        {/each}
                    </ul>
                    {/if}
                </div>
            {:else}
                <p class="muted">На этом уровне новых умений нет.</p>
            {/each}
        </section>

        <!-- выборы -->
        <section class="choices">
            <h3>Выбор</h3>
            {#each ev.choices as c (c.key)}
                {@const n = c.count}
                {@const opts = c.visible}
                {@const sel = new Set(c.valid)}
                <div class="choice" class:done={c.done}>
                    <div class="c-head">
                        <b>{c.title}</b>
                        <span class="count">{#if c.optional}по желанию · {/if}{n} / {c.pick}</span>
                    </div>
                    {#if c.desc}<p class="c-desc">{c.desc}</p>{/if}

                    {#if c.kind === "asi"}
                        <div class="asi">
                            {#each c.options as o}
                                {@const v = c.value?.asi?.[o.id] ?? 0}
                                <div class="asi-row" class:on={v}>
                                    <span>{o.name}</span>
                                    <span class="asi-ctl">
                                        <button onclick={() => bumpAsi(c, o.id, -1)} disabled={!v}>−</button>
                                        <b>+{v}</b>
                                        <button onclick={() => bumpAsi(c, o.id, +1)}>+</button>
                                    </span>
                                </div>
                            {/each}
                        </div>
                    {:else}
                        {#if CARD_KINDS.has(c.kind)}
                            <div class="option-cards">
                                {#each opts as o (o.id)}
                                    <ActionCard
                                        item={o.ref ?? { name: o.name, desc: o.desc }}
                                        {level}
                                        source={o.meta ?? ""}
                                        selectable
                                        selected={sel.has(o.id)}
                                        onclick={() => toggle(c, o.id)}
                                    />
                                {:else}
                                    <p class="muted">Нет доступных вариантов.</p>
                                {/each}
                            </div>
                        {:else}
                            <div class="chips">
                                {#each opts as o (o.id)}
                                    <button class="chip" class:on={sel.has(o.id)} onclick={() => toggle(c, o.id)} title={o.desc}>
                                        {o.name}
                                        {#if o.meta}<small>{o.meta}</small>{/if}
                                    </button>
                                {:else}
                                    <p class="muted">Нет доступных вариантов.</p>
                                {/each}
                            </div>
                        {/if}
                    {/if}
                </div>
            {:else}
                <p class="muted">На этом уровне выбирать нечего.</p>
            {/each}
        </section>
    </div>
</div>

<style>
    .level {
        display: flex;
        flex-direction: column;
        gap: 20px;
    }

    /* --- итог --- */
    .summary {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
    }

    .big,
    .stat {
        padding: 10px 16px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-border);
        border-radius: 8px;
    }

    .big {
        border-color: var(--color-gold);
    }

    .stat.dim {
        opacity: 0.6;
    }

    .lbl {
        font-family: var(--font-ui);
        font-size: 10px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-text-muted);
    }

    .val {
        font-family: var(--font-heading);
        font-size: 26px;
        color: var(--color-text-primary);
    }

    .big .val {
        color: var(--color-gold);
    }

    .val.slots {
        display: flex;
        gap: 8px;
        font-size: 16px;
    }

    .val.slots sup {
        font-size: 9px;
        color: var(--color-text-muted);
    }

    .stat small {
        font-family: var(--font-ui);
        font-size: 11px;
        color: var(--color-text-muted);
    }

    /* --- колонки --- */
    .cols {
        display: grid;
        grid-template-columns: 2fr 3fr;
        gap: 20px;
        align-items: start;
    }

    @media (max-width: 1000px) {
        .cols {
            grid-template-columns: 1fr;
        }
    }

    h3 {
        margin: 0 0 10px;
        font-family: var(--font-heading);
        font-size: 14px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-gold);
    }

    h4 {
        margin: 0 0 6px;
        font-family: var(--font-heading-alt);
        font-size: 16px;
        color: var(--color-text-accent);
    }

    .gains,
    .choices {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .gain-group ul,
    .picked {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .gain-group li {
        display: flex;
        flex-direction: column;
    }

    .gain-group b {
        font-family: var(--font-ui);
        font-size: 13px;
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
    }

    .gain-group span,
    .picked li {
        font-family: var(--font-spell);
        font-size: 15px;
        color: var(--color-text-secondary);
    }

    .tag {
        margin-left: 6px;
        padding: 0 6px;
        border: 1px solid var(--color-border);
        border-radius: 999px;
        font-family: var(--font-ui);
        font-size: 10px;
        font-weight: var(--font-weight-regular);
        color: var(--color-text-muted);
    }

    /* --- выбор --- */
    .choice {
        padding: 12px 14px;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-danger);
        border-radius: 8px;
    }

    .choice.done {
        border-color: var(--color-success);
    }

    .c-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        font-family: var(--font-ui);
        font-size: 14px;
        color: var(--color-text-primary);
    }

    .count {
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .c-desc {
        margin: 4px 0 0;
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .chips {
        margin-top: 10px;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }

    .chip {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        padding: 5px 10px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: 13px;
        text-align: left;
        cursor: pointer;
    }

    .chip small {
        font-size: 10px;
        color: var(--color-text-muted);
    }

    .chip:hover {
        border-color: var(--color-gold);
        color: var(--color-text-primary);
    }

    .chip.on {
        background: var(--color-magic-purple-dark);
        border-color: var(--color-magic-purple);
        color: var(--color-text-primary);
    }

    .gain-cards {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .option-cards {
        margin-top: 10px;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 8px;
    }

    .picked {
        margin-top: 10px;
    }

    .picked b {
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-primary);
    }

    .asi {
        margin-top: 10px;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 6px 14px;
    }

    .asi-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .asi-row.on {
        color: var(--color-text-primary);
    }

    .asi-ctl {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .asi-ctl b {
        min-width: 22px;
        text-align: center;
        color: var(--color-gold);
    }

    .asi-ctl button {
        width: 24px;
        height: 24px;
        padding: 0;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 4px;
        color: var(--color-text-primary);
        cursor: pointer;
    }

    .asi-ctl button:disabled {
        opacity: 0.35;
        cursor: default;
    }

    .muted {
        margin: 0;
        color: var(--color-text-muted);
    }
</style>
