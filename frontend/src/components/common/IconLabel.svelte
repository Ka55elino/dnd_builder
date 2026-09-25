<script>
    /**
     * Icon label: if an SVG exists, show the icon and move the text into the tooltip;
     * otherwise show the text as before.
     *
     *   <b>2d8</b> <IconLabel name="fire" kind="dmg" label="Fire" text="fire" />
     *
     * name  — icon id (assets/icons/<name>.svg)
     * kind  — color group (--color-<kind>-<name>), see Icon
     * label — full name for the tooltip
     * text  — what to show without an icon (defaults to label); '' — nothing
     * hint  — extra tooltip line (optional)
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
