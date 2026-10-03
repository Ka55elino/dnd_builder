<script>
    /**
     * Phones: a sticky row of section tabs (scrolls sideways) that jumps through a long page.
     * Hidden above 640px — the desktop layout shows everything side by side.
     *
     *   <SectionNav items={[{ id: 'cs-status', label: 'Status' }, …]} />
     *
     * items — [{ id, label }] — the ids of elements on the page (missing ones are skipped);
     * the tab of the section in view lights up (IntersectionObserver). Targets get
     * scroll-margin-top so the tab row doesn't cover their heading.
     */
    import { onMount, tick } from "svelte";

    let { items = [] } = $props();

    let present = $state([]);
    let active = $state("");
    let bar = $state(null);
    let io = null;

    // which sections are on the page now; watch them for the active tab
    function refresh() {
        present = items.filter((it) => document.getElementById(it.id));
        io?.disconnect();
        if (typeof IntersectionObserver === "undefined") return;
        io ??= new IntersectionObserver(
            (entries) => {
                const seen = entries
                    .filter((e) => e.isIntersecting)
                    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
                if (seen[0]) active = seen[0].target.id;
            },
            { rootMargin: "-56px 0px -60% 0px" },
        );
        for (const it of present) io.observe(document.getElementById(it.id));
    }

    function go(id) {
        const el = document.getElementById(id);
        if (!el) return;
        active = id;
        el.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    // the active tab stays visible in the row
    $effect(() => {
        if (!active || !bar) return;
        bar.querySelector(`[data-id="${active}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });

    // sections that appear later (the sheet loads, a card shows up) — re-check when items change
    $effect(() => {
        items;
        tick().then(refresh);
    });

    onMount(() => () => io?.disconnect());
</script>

{#if present.length > 1}
    <nav class="section-nav" bind:this={bar} aria-label="Sections">
        {#each present as it (it.id)}
            <button class:on={active === it.id} data-id={it.id} onclick={() => go(it.id)}>{it.label}</button>
        {/each}
    </nav>
{/if}

<style>
    .section-nav {
        display: none;
    }

    @media (max-width: 640px) {
        .section-nav {
            position: sticky;
            top: 0;
            z-index: 20;
            display: flex;
            gap: 6px;
            margin: 0 -12px; /* edge to edge inside the page padding */
            padding: 8px 12px;
            overflow-x: auto;
            scrollbar-width: none;
            background: color-mix(in srgb, var(--color-bg) 92%, transparent);
            backdrop-filter: blur(6px);
            border-bottom: 1px solid var(--color-border);
        }

        .section-nav::-webkit-scrollbar {
            display: none;
        }

        button {
            flex: none;
            padding: 7px 12px;
            background: var(--color-card);
            border: 1px solid var(--color-border);
            border-radius: 999px;
            color: var(--color-text-secondary);
            font-family: var(--font-ui);
            font-size: 13px;
            white-space: nowrap;
            cursor: pointer;
        }

        button.on {
            border-color: var(--color-gold);
            color: var(--color-gold);
        }

        /* the targets: below the sticky row when jumped to */
        :global([data-section]) {
            scroll-margin-top: 56px;
        }
    }
</style>
