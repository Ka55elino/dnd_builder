<script module>
    // сырой SVG-текст всех иконок папки (Vite)
    const ICONS = Object.fromEntries(
        Object.entries(
            import.meta.glob("../../assets/icons/*.svg", { eager: true, query: "?raw", import: "default" }),
        ).map(([path, svg]) => [path.split("/").pop().replace(/\.svg$/, ""), svg]),
    );

    /** Есть ли SVG для id — чтобы решать, показывать иконку или текст. */
    export const hasIcon = (name) => !!name && name in ICONS;
</script>

<script>
    /**
     * Иконка по id: src/assets/icons/<name>.svg (подхватывается автоматически).
     * Нет файла — буквенный бейдж (short) того же цвета.
     *
     * name  — id: 'bonus', 'fire', 'longRest'…
     * kind  — 'act' | 'dmg' | 'rest' | 'meta' | 'school' — задаёт цвет (--color-<kind>-<name>)
     * label — подсказка при наведении (и aria-label)
     * short — текст бейджа, пока нет SVG
     * fallback — показывать бейдж, пока нет SVG (false — ничего, если рядом есть текст)
     * native — системная подсказка title (false — когда подсказку даёт Tooltip снаружи)
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

    /* заглушка, пока нет SVG */
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
