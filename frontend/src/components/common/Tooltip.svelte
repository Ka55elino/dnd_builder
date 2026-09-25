<script>
    /**
     * Tooltip shown on hover (and keyboard focus).
     *
     *   <Tooltip>
     *       Chain Mail                     ← the hovered element (children)
     *       {#snippet tip()}…{/snippet}    ← tooltip content
     *   </Tooltip>
     *
     * The panel is position: fixed relative to the viewport, so it isn't clipped
     * by cards with overflow and flips up/left near the window edge.
     */
    let { children, tip, delay = 250 } = $props();

    let anchor;
    let panel = $state(null);
    let open = $state(false);
    let pos = $state({ x: 0, y: 0 });
    let timer;

    function show() {
        clearTimeout(timer);
        timer = setTimeout(() => {
            open = true;
            requestAnimationFrame(place);
        }, delay);
    }

    function hide() {
        clearTimeout(timer);
        open = false;
    }

    // below the element; if it doesn't fit — above it; horizontally stays within the window
    function place() {
        if (!anchor || !panel) return;
        const a = anchor.getBoundingClientRect();
        const p = panel.getBoundingClientRect();
        const gap = 8;
        let y = a.bottom + gap;
        if (y + p.height > window.innerHeight - gap) y = Math.max(gap, a.top - gap - p.height);
        let x = a.left;
        if (x + p.width > window.innerWidth - gap) x = Math.max(gap, window.innerWidth - gap - p.width);
        pos = { x, y };
    }
</script>

<span
    class="anchor"
    bind:this={anchor}
    onmouseenter={show}
    onmouseleave={hide}
    onfocusin={show}
    onfocusout={hide}
    role="note"
>
    {@render children?.()}
</span>

{#if open && tip}
    <div class="tooltip" bind:this={panel} style="left: {pos.x}px; top: {pos.y}px" role="tooltip">
        {@render tip()}
    </div>
{/if}

<style>
    .anchor {
        display: inline;
        cursor: help;
    }

    .tooltip {
        position: fixed;
        z-index: 1000;
        max-width: 340px;
        padding: 10px 12px;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-gold);
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
        pointer-events: none;
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-primary);
    }
</style>
