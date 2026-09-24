<script>
    /**
     * Карточка заклинания / способности / черты (по мотивам dndbuilder-v2).
     *
     *  ┌────────────────────────────── source ┐
     *  │ Название                              │
     *  │ описание…                             │
     *  │ [⚡ бонусное] [2d8 🔥] [2 × долг.] [Сл 13]│
     *  └───────────────────────────────────────┘
     *
     * item      — запись из справочника (spells / feats): name, desc, action,
     *             level, school, concentration, ritual, data.{damage, scaleDie, uses, casting}
     * level     — уровень персонажа (для роста урона)
     * source    — подпись справа сверху ('Класс', '1 круг', 'Эльф'…)
     * uses      — { max, per } — сколько раз и когда восстанавливается
     * saveDC    — сложность спасброска (покажется, если в описании есть спасбросок)
     * selectable / selected / onclick — режим выбора (экран уровня)
     */
    import IconLabel from "./IconLabel.svelte";
    import { hasIcon } from "./Icon.svelte";
    import { damageParts, dieAt } from "../../rules/damage.js";
    import {
        ACTION_TYPES, DAMAGE_TYPES, REST_TYPES, SCHOOLS, normAction, damageLabel,
    } from "../../rules/labels.js";

    let {
        item,
        level = 1,
        source = "",
        uses = null,
        saveDC = null,
        selectable = false,
        selected = false,
        onclick = null,
    } = $props();

    const d = $derived(item?.data ?? {});
    const action = $derived(normAction(item?.action ?? d.action));
    const parts = $derived(damageParts(d.damage, level));
    const die = $derived(dieAt(d.scaleDie, level));
    const casting = $derived(d.casting ?? null);
    const isSpell = $derived(item?.kind === "spell");
    const desc = $derived(item?.desc ?? d.desc ?? "");
    const showDC = $derived(saveDC != null && /спасброс/i.test(desc));
</script>

<svelte:element
    this={selectable ? "button" : "article"}
    class="card"
    class:selectable
    class:selected
    onclick={selectable ? onclick : undefined}
    type={selectable ? "button" : undefined}
    aria-pressed={selectable ? selected : undefined}
>
    <header>
        <b class="name">{item?.name}</b>
        {#if source}<span class="src">{source}</span>{/if}
    </header>

    {#if desc}<p class="desc">{desc}</p>{/if}

    <!-- если у подписи есть SVG — показываем иконку, а текст уходит в подсказку (IconLabel) -->
    <div class="meta">
        {#if action && ACTION_TYPES[action]}
            <span class="chip act" style="--c: var(--color-act-{action})">
                <IconLabel name={action} kind="act" label={ACTION_TYPES[action].name} text={ACTION_TYPES[action].name.toLowerCase()} />
            </span>
        {/if}

        {#each parts as p}
            <span class="chip dmg" style="--c: var(--color-dmg-{p.type ?? 'weapon'})">
                {#if p.dice}<b>{p.dice}</b>{/if}
                {#if p.type}
                    <IconLabel name={p.type} kind="dmg" label={damageLabel(p.type)} text={DAMAGE_TYPES[p.type]?.short ?? p.type} />
                {/if}
            </span>
        {/each}

        {#if die}<span class="chip">кость <b>{die}</b></span>{/if}

        {#if uses?.max}
            <span class="chip rest" style="--c: var(--color-rest-{uses.per})">
                <b>{uses.max}</b> ×
                <IconLabel name={uses.per} kind="rest" label={REST_TYPES[uses.per]?.name ?? ""} text={REST_TYPES[uses.per]?.short ?? ""} />
            </span>
        {/if}

        {#if showDC}
            <span class="chip meta-chip" style="--c: var(--color-meta-dc)">
                <IconLabel name="dc" kind="meta" label="Сложность спасброска" text="Сл" />
                <b>{saveDC}</b>
            </span>
        {/if}

        {#if isSpell}
            {#if casting?.range}
                <span class="chip meta-chip" style="--c: var(--color-meta-range)">
                    <IconLabel name="range" kind="meta" label="Дистанция" text="" />{casting.range}
                </span>
            {/if}
            {#if casting?.duration}
                <span class="chip meta-chip" style="--c: var(--color-meta-duration)">
                    <IconLabel name="duration" kind="meta" label="Длительность" text="" />{casting.duration}
                </span>
            {/if}
            {#if item.concentration && (hasIcon("concentration") || !/конц/i.test(casting?.duration ?? ""))}
                <span class="chip flag" style="--c: var(--color-meta-concentration)">
                    <IconLabel name="concentration" kind="meta" label="Концентрация" text="конц." hint="Эффект длится, пока вы сохраняете концентрацию" />
                </span>
            {/if}
            {#if item.ritual}
                <span class="chip flag" style="--c: var(--color-meta-ritual)">
                    <IconLabel name="ritual" kind="meta" label="Ритуал" text="ритуал" hint="Можно сотворить ритуалом: +10 минут, без ячейки" />
                </span>
            {/if}
            {#if item.school}
                <span class="chip school" style="--c: var(--color-school-{item.school})">
                    <IconLabel name={item.school} kind="school" label={`Школа: ${SCHOOLS[item.school] ?? item.school}`} text={SCHOOLS[item.school] ?? item.school} />
                </span>
            {/if}
        {/if}
    </div>
</svelte:element>

<style>
    .card {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 10px 12px;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        color: var(--color-text-primary);
        text-align: left;
        font: inherit;
        min-width: 0;
    }

    .selectable {
        cursor: pointer;
    }

    .selectable:hover {
        border-color: var(--color-gold);
    }

    .selected {
        background: var(--color-magic-purple-dark);
        border-color: var(--color-magic-purple);
    }

    header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
    }

    .name {
        font-family: var(--font-ui);
        font-size: 14px;
        font-weight: var(--font-weight-semibold);
    }

    .src {
        flex: 0 0 auto;
        font-family: var(--font-ui);
        font-size: 10px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-text-muted);
    }

    .desc {
        margin: 0;
        font-family: var(--font-spell);
        font-size: 14px;
        line-height: 1.35;
        color: var(--color-text-secondary);
    }

    .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }

    .meta:empty {
        display: none;
    }

    .chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        background: var(--color-bg);
        border: 1px solid color-mix(in srgb, var(--c, var(--color-border)) 55%, transparent);
        border-radius: 999px;
        font-family: var(--font-ui);
        font-size: 11px;
        color: var(--color-text-secondary);
        white-space: nowrap;
    }

    .chip b {
        color: var(--color-text-primary);
        font-weight: var(--font-weight-semibold);
    }

    .chip.act,
    .chip.dmg,
    .chip.rest,
    .chip.meta-chip :global(.icon),
    .chip.flag :global(.icon),
    .chip.school :global(.icon) {
        color: var(--c);
    }

    .chip.flag {
        border-style: dashed;
    }

    .chip.school {
        color: var(--color-text-muted);
    }
</style>
