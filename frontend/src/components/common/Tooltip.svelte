<script>
    /**
     * Tooltip shown on hover (and keyboard focus); on a touch screen — on a tap (info
     * chips, icons) or a long press (buttons and other controls — a tap still presses them).
     * A touch-opened tooltip closes on a tap elsewhere or after a few seconds.
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
        stopOutside?.();
    }

    // ---------- touch ----------
    const CONTROLS = 'button, select, input, textarea, a, label, [role="button"]';
    let touch = false; // the last pointer was a finger / pen: ignore the emulated mouse / focus events
    let press; // long-press timer (controls)
    let pressed = false; // a long press opened it: swallow the click that follows
    let stopOutside = null;

    function openTouch() {
        clearTimeout(timer);
        open = true;
        requestAnimationFrame(place);
        stopOutside?.();
        const outside = (e) => {
            if (!anchor?.contains(e.target) && !panel?.contains(e.target)) hide();
        };
        const t = setTimeout(hide, 5000);
        document.addEventListener("pointerdown", outside, true);
        stopOutside = () => {
            clearTimeout(t);
            document.removeEventListener("pointerdown", outside, true);
            stopOutside = null;
        };
    }

    function onPointerDown(e) {
        touch = e.pointerType !== "mouse";
        if (!touch) return;
        clearTimeout(press);
        if (e.target.closest?.(CONTROLS)) {
            press = setTimeout(() => {
                pressed = true;
                openTouch();
            }, 450);
        }
    }

    function onPointerUp(e) {
        if (e.pointerType === "mouse") return;
        clearTimeout(press);
        if (!e.target.closest?.(CONTROLS)) (open ? hide() : openTouch());
    }

    function onClickCapture(e) {
        if (!pressed) return;
        pressed = false;
        e.preventDefault();
        e.stopPropagation();
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
    onmouseenter={() => !touch && show()}
    onmouseleave={() => !touch && hide()}
    onfocusin={() => !touch && show()}
    onfocusout={() => !touch && hide()}
    onpointerdown={onPointerDown}
    onpointerup={onPointerUp}
    onpointercancel={() => clearTimeout(press)}
    onclickcapture={onClickCapture}
    oncontextmenu={(e) => touch && e.preventDefault()}
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
        -webkit-touch-callout: none; /* long press: our tooltip, not the system menu */
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
