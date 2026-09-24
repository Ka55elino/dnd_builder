<script>
    /**
     * Подпись-иконка: если SVG есть — показываем иконку, а текст уходит в подсказку;
     * если нет — показываем текст как раньше.
     *
     *   <b>2d8</b> <IconLabel name="fire" kind="dmg" label="Огнём" text="огонь" />
     *
     * name  — id иконки (assets/icons/<name>.svg)
     * kind  — группа цвета (--color-<kind>-<name>), см. Icon
     * label — полное название для подсказки
     * text  — что показать без иконки (по умолчанию label); '' — ничего
     * hint  — дополнительная строка подсказки (необязательно)
     */
    import Icon, { hasIcon } from "./Icon.svelte";
    import Tooltip from "./Tooltip.svelte";

    let { name, kind = "act", label = "", text = undefined, hint = "" } = $props();

    const shown = $derived(text === undefined ? label : text);
</script>

{#if hasIcon(name)}
    <Tooltip delay={150}>
        <Icon {name} {kind} {label} native={false} />
        {#snippet tip()}
            <b class="il-tip">{label}</b>
            {#if hint}<div class="il-hint">{hint}</div>{/if}
        {/snippet}
    </Tooltip>
{:else if shown}
    <span>{shown}</span>
{/if}

<style>
    .il-tip {
        font-weight: var(--font-weight-semibold);
    }

    .il-hint {
        margin-top: 2px;
        font-size: 12px;
        color: var(--color-text-secondary);
    }
</style>
