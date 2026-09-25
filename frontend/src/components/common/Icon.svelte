<script module>
    // raw SVG text of all icons in the folder (Vite)
    const ICONS = Object.fromEntries(
        Object.entries(
            import.meta.glob("../../assets/icons/*.svg", { eager: true, query: "?raw", import: "default" }),
        ).map(([path, svg]) => [path.split("/").pop().replace(/\.svg$/, ""), svg]),
    );

    /** Whether an SVG exists for the id — to decide between showing the icon or text. */
    export const hasIcon = (name) => !!name && name in ICONS;
</script>

<script>
    /**
     * Icon by id: src/assets/icons/<name>.svg (picked up automatically).
     * No file — a letter badge (short) in the same color.
     *
     * name  — id: 'bonus', 'fire', 'longRest'…
     * kind  — 'act' | 'dmg' | 'rest' | 'meta' | 'school' — sets the color (--color-<kind>-<name>)
     * label — hover tooltip (and aria-label)
     * short — badge text while there's no SVG
     * fallback — show the badge while there's no SVG (false — nothing, if there's text next to it)
     * native — native title tooltip (false — when an outer Tooltip provides it)
     */
    let { name, kind = "act", label = "", short = "", fallback = true, native = true } = $props();

    const svg = $derived(ICONS[name] ?? null);
</script>

{#if svg || fallback}
<span
    class="icon"
    class:badge={!svg}
    style="--icon-color: var(--color-{kind}-{name}, var(--color-text-secondary))"
    title={native ? label : undefined}
    aria-label={label || name}
    role="img"
>
    {#if svg}
        {@html svg}
    {:else}
        {short || (label || name).slice(0, 1)}
    {/if}
</span>
{/if}

<style>
    .icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        flex: 0 0 auto;
        color: var(--icon-color);
    }

    .icon :global(svg) {
        width: 100%;
        height: 100%;
    }

    /* placeholder while there's no SVG */
    .badge {
        border: 1px solid var(--icon-color);
        border-radius: 50%;
        font-family: var(--font-ui);
        font-size: 9px;
        font-weight: var(--font-weight-bold);
        line-height: 1;
        text-transform: uppercase;
    }
</style>
