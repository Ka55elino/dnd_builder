<script>
    /**
     * Page top bar: ← back, the title, the page's actions.
     *
     *   <TopBar title="Spells" {onBack}>
     *       <button class="add">+ Add spell</button>   ← actions (the page's own markup and styles)
     *   </TopBar>
     *
     * Desktop: the actions sit in the bar as before (they are flex items of the bar itself:
     * margin-left: auto, spacers… keep working).
     * Mobile (≤ 640px): the back button is just "←", the actions go into a ☰ menu
     * (closed by a click on an action, outside it, or Escape).
     *
     * title — '' : no heading (the bar holds just the buttons); sub — a smaller line after the title
     * onBack — null: no back button; back — its label ("Menu"; a leading "← " is dropped)
     * children — the actions (into ☰ on phones)
     * pinned — what stays in the bar on phones too, before ☰ (a wizard's Next / Save, a status)
     *
     * A button inside the actions that opens something in place (a confirm, a dropdown) keeps
     * the ☰ menu open: give it data-keep-open.
     */
    let { title = "", sub = "", onBack = null, back = "Menu", children = null, pinned = null } = $props();
    const backText = $derived(String(back).replace(/^←\s*/, ""));

    let open = $state(false);
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && (open = false)} />

<header class="topbar">
    {#if onBack}
        <button class="tb-back" onclick={onBack} title="Back: {backText}" aria-label="Back: {backText}">
            <span aria-hidden="true">←</span><span class="tb-label">{backText}</span>
        </button>
    {/if}
    {#if title}
        <h1>{title}{#if sub}<span class="tb-sub">{sub}</span>{/if}</h1>
    {:else}
        <span class="tb-fill"></span>
    {/if}
    {#if pinned}{@render pinned()}{/if}
    {#if children}
        <button
            class="tb-burger"
            class:open
            onclick={() => (open = !open)}
            aria-label="Actions"
            aria-haspopup="menu"
            aria-expanded={open}>☰</button
        >
        {#if open}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div class="tb-backdrop" onclick={() => (open = false)}></div>
        {/if}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="tb-actions" class:open onclick={(e) => {
            const b = e.target.closest("button:not(:disabled)");
            if (b && !b.hasAttribute("data-keep-open")) open = false;
        }}>
            {@render children()}
        </div>
    {/if}
</header>

<style>
    .topbar {
        position: relative;
        display: flex;
        align-items: center;
        gap: 16px;
        min-width: 0;
    }

    h1 {
        margin: 0;
        min-width: 0;
        font-family: var(--font-heading);
        font-weight: var(--font-weight-bold);
        color: var(--color-gold);
    }

    .tb-sub {
        margin-left: 10px;
        font-family: var(--font-heading-alt);
        font-size: 18px;
        font-weight: var(--font-weight-regular);
        color: var(--color-text-secondary);
    }

    /* no title: the actions go to the right */
    .tb-fill {
        flex: 1;
    }

    .tb-back {
        flex: none;
        padding: 6px 12px;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        cursor: pointer;
    }

    .tb-back:hover {
        border-color: var(--color-gold);
        color: var(--color-gold-hover);
    }

    .tb-label {
        margin-left: 4px;
    }

    /* desktop: the actions are items of the bar itself */
    .tb-actions {
        display: contents;
    }

    .tb-burger,
    .tb-backdrop {
        display: none;
    }

    @media (max-width: 640px) {
        .topbar {
            gap: 10px;
        }

        h1 {
            flex: 1;
            font-size: 24px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .tb-sub {
            margin-left: 8px;
            font-size: 14px;
        }

        .tb-back {
            width: 40px;
            height: 40px;
            padding: 0;
            font-size: 18px;
        }

        .tb-label {
            display: none;
        }

        .tb-burger {
            display: block;
            flex: none;
            width: 40px;
            height: 40px;
            padding: 0;
            background: transparent;
            border: 1px solid var(--color-border);
            border-radius: 6px;
            color: var(--color-text-secondary);
            font-size: 18px;
            cursor: pointer;
        }

        .tb-burger.open {
            border-color: var(--color-gold);
            color: var(--color-gold);
        }

        .tb-backdrop {
            display: block;
            position: fixed;
            inset: 0;
            z-index: 900;
        }

        .tb-actions {
            display: none;
        }

        .tb-actions.open {
            position: absolute;
            top: calc(100% + 6px);
            right: 0;
            z-index: 901;
            width: min(280px, calc(100vw - 24px));
            display: flex;
            flex-direction: column;
            align-items: stretch;
            gap: 10px;
            padding: 12px;
            background: var(--color-card);
            border: 1px solid var(--color-border);
            border-radius: 10px;
            box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
        }

        /* the page's own layout helpers mean nothing in the menu */
        .tb-actions.open > :global(*) {
            margin: 0 !important;
        }

        /* a button inside a wrapper (Download ▾ with its dropdown) — as wide as the others */
        .tb-actions.open > :global(div) > :global(button) {
            width: 100%;
        }

        .tb-actions.open > :global(.spacer) {
            display: none;
        }

        .tb-actions.open > :global(nav),
        .tb-actions.open > :global(.modes) {
            flex-wrap: wrap;
        }
    }
</style>
