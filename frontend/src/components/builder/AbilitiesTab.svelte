<script>
    /**
     * Вкладка «Атрибуты»: выбор метода и распределение характеристик.
     * build — экземпляр CharacterBuild.
     */
    import {
        ABILITY_KEYS,
        ABILITIES,
        ABILITY_METHODS,
        POINT_BUY_BUDGET,
        POINT_BUY_MIN,
        POINT_BUY_MAX,
        pointBuyStepCost,
        modifier,
        formatModifier,
    } from "../../rules/abilities.js";
    import OriginPicker from "./OriginPicker.svelte";

    let { build } = $props();

    const method = $derived(build.abilityMethod);
    const isPool = $derived(method === "array" || method === "roll");

    /** Какой характеристике назначен индекс пула (для подписи). */
    const ownerOf = (i) => ABILITY_KEYS.find((k) => build.abilityAssign[k] === i);

    /** Индекс откинутого (наименьшего) кубика в броске. */
    const droppedIndex = (dice) => dice.indexOf(Math.min(...dice));

    function onAssign(key, e) {
        const v = e.currentTarget.value;
        build.assignAbility(key, v === "" ? null : Number(v));
    }
</script>

<div class="abilities">
    <OriginPicker {build} />

    <!-- метод -->
    <div class="methods">
        {#each Object.entries(ABILITY_METHODS) as [id, m]}
            <button
                class="method"
                class:active={method === id}
                onclick={() => build.setAbilityMethod(id)}
            >
                <b>{m.name}</b>
                <small>{m.hint}</small>
            </button>
        {/each}
    </div>

    <!-- панель метода -->
    <div class="toolbar">
        {#if method === "pointbuy"}
            <div class="points" class:empty={build.pointsLeft === 0}>
                Осталось очков: <b>{build.pointsLeft}</b> / {POINT_BUY_BUDGET}
            </div>
            <button class="ghost" onclick={() => build.resetPointBuy()}>Сбросить</button>
        {:else}
            <div class="pool">
                {#each build.abilityPool as value, i}
                    {@const owner = ownerOf(i)}
                    <div class="token" class:used={owner} title={owner ? ABILITIES[owner].name : "Свободно"}>
                        <span class="token-value">{value}</span>
                        {#if method === "roll" && build.abilityRolls?.[i]}
                            {@const dice = build.abilityRolls[i].dice}
                            {@const drop = droppedIndex(dice)}
                            <span class="dice">
                                {#each dice as d, di}
                                    <span class:dropped={di === drop}>{d}</span>
                                {/each}
                            </span>
                        {/if}
                        <span class="token-owner">{owner ? ABILITIES[owner].short : "—"}</span>
                    </div>
                {/each}
            </div>
            <div class="actions">
                {#if method === "roll"}
                    <button class="ghost" onclick={() => build.reroll()}>Перебросить</button>
                {/if}
                <button class="ghost" onclick={() => build.clearAssign()}>Сбросить</button>
            </div>
        {/if}
    </div>

    <!-- характеристики -->
    <div class="grid">
        {#each ABILITY_KEYS as key (key)}
            {@const score = build.abilities[key]}
            {@const bonus = build.backgroundBonus[key] ?? 0}
            {@const total = build.totalAbilities[key]}
            <div class="card" class:unset={score == null}>
                <div class="head">
                    <span class="short">{ABILITIES[key].short}</span>
                    <span class="name">{ABILITIES[key].name}</span>
                </div>

                <div class="score">{total ?? "—"}</div>
                <div class="mod">{formatModifier(modifier(total))}</div>
                <div class="calc" class:boosted={bonus}>
                    {#if score != null}
                        {score}{#if bonus} <b>+{bonus}</b> происх.{/if}
                    {:else}&nbsp;{/if}
                </div>

                {#if method === "pointbuy"}
                    {@const up = pointBuyStepCost(score)}
                    <div class="stepper">
                        <button
                            onclick={() => build.pointBuyStep(key, -1)}
                            disabled={score <= POINT_BUY_MIN}
                            aria-label="Уменьшить">−</button>
                        <span class="cost">{up == null ? "макс" : `+1: ${up} оч.`}</span>
                        <button
                            onclick={() => build.pointBuyStep(key, +1)}
                            disabled={score >= POINT_BUY_MAX || up > build.pointsLeft}
                            aria-label="Увеличить">+</button>
                    </div>
                {:else if isPool}
                    <select value={build.abilityAssign[key] ?? ""} onchange={(e) => onAssign(key, e)}>
                        <option value="">— выбрать —</option>
                        {#each build.abilityPool as value, i}
                            {@const owner = ownerOf(i)}
                            <option value={i}>
                                {value}{owner && owner !== key ? ` (сейчас ${ABILITIES[owner].short})` : ""}
                            </option>
                        {/each}
                    </select>
                {/if}
            </div>
        {/each}
    </div>

    <p class="note">
        Итоговое значение = база + бонус происхождения. Повышения за уровни добавятся на экране уровня.
    </p>
</div>

<style>
    .abilities {
        display: flex;
        flex-direction: column;
        gap: 20px;
    }

    /* --- методы --- */
    .methods {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
    }

    .method {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 4px;
        padding: 12px 14px;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        text-align: left;
        cursor: pointer;
    }

    .method:hover {
        border-color: var(--color-gold);
    }

    .method.active {
        background: var(--color-magic-purple-dark);
        border-color: var(--color-magic-purple);
    }

    .method b {
        font-weight: var(--font-weight-semibold);
    }

    .method small {
        color: var(--color-text-secondary);
        font-size: 12px;
    }

    /* --- панель --- */
    .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: 40px;
    }

    .points {
        font-family: var(--font-ui);
        color: var(--color-text-secondary);
    }

    .points b {
        color: var(--color-gold);
        font-size: 18px;
    }

    .points.empty b {
        color: var(--color-success);
    }

    .pool {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }

    .token {
        min-width: 52px;
        padding: 6px 8px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-gold);
        border-radius: 6px;
        font-family: var(--font-ui);
    }

    .token.used {
        border-color: var(--color-border);
        opacity: 0.55;
    }

    .token-value {
        font-size: 18px;
        font-weight: var(--font-weight-bold);
        color: var(--color-text-primary);
    }

    .token-owner {
        font-size: 10px;
        color: var(--color-text-muted);
        letter-spacing: 0.05em;
    }

    .dice {
        display: flex;
        gap: 3px;
        font-size: 10px;
        color: var(--color-text-secondary);
    }

    .dice .dropped {
        color: var(--color-text-muted);
        text-decoration: line-through;
    }

    .actions {
        display: flex;
        gap: 8px;
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

    /* --- карточки характеристик --- */
    .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 12px;
    }

    .card {
        padding: 14px 12px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-border);
        border-radius: 8px;
    }

    .head {
        display: flex;
        flex-direction: column;
        align-items: center;
    }

    .short {
        font-family: var(--font-heading);
        font-weight: var(--font-weight-bold);
        font-size: 16px;
        color: var(--color-gold);
        letter-spacing: 0.08em;
    }

    .name {
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .score {
        font-family: var(--font-heading);
        font-size: 36px;
        line-height: 1;
        color: var(--color-text-primary);
    }

    .mod {
        padding: 2px 10px;
        border: 1px solid var(--color-border);
        border-radius: 999px;
        font-family: var(--font-ui);
        font-size: 14px;
        color: var(--color-text-primary);
    }

    .card.unset .score,
    .card.unset .mod {
        color: var(--color-text-muted);
    }

    .stepper {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
    }

    .stepper button {
        width: 28px;
        height: 28px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-primary);
        font-size: 16px;
        cursor: pointer;
    }

    .stepper button:hover:not(:disabled) {
        border-color: var(--color-gold);
        color: var(--color-gold-hover);
    }

    .stepper button:disabled {
        opacity: 0.35;
        cursor: default;
    }

    .cost {
        font-family: var(--font-ui);
        font-size: 11px;
        color: var(--color-text-muted);
    }

    select {
        width: 100%;
        padding: 6px 8px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-primary);
        font-family: var(--font-form);
        font-size: 14px;
    }

    select:focus {
        outline: none;
        border-color: var(--color-gold);
    }

    .calc {
        font-family: var(--font-ui);
        font-size: 11px;
        color: var(--color-text-muted);
    }

    .calc b {
        color: var(--color-gold);
        font-weight: var(--font-weight-semibold);
    }

    .note {
        margin: 0;
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-muted);
    }
</style>
