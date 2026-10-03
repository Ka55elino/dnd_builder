<script>
    /**
     * Main menu (start screen) — a plain game-style vertical menu.
     * onNavigate(screen) — 'game' | 'join' | 'campaign' | 'characters' | 'spells' | 'items' | 'bestiary' | 'conditions' | 'homebrew'
     * While in a game (hosting or joined), Start/Join are replaced by
     * "Return to Game" leading to the matching screen.
     * An item with `stub: true` only shows "coming soon".
     * Exit — the last item: quits the app (desktop only; phones close apps themselves).
     */
    import { onMount } from "svelte";
    import { Application, System } from "@wailsio/runtime";
    import { server } from "../server.svelte.js";

    let { onNavigate } = $props();

    const REFERENCE = [
        { id: "campaign", title: "Campaign", divider: true },
        { id: "characters", title: "Characters" },
        { id: "spells", title: "Spells" },
        { id: "items", title: "Items" },
        { id: "bestiary", title: "Bestiary" },
        { id: "conditions", title: "Conditions" },
        { id: "homebrew", title: "Homebrew" },
        ...exitItem(),
    ];

    function exitItem() {
        try {
            if (System.IsMobile()) return [];
        } catch {
            // no desktop shell
        }
        return [{ id: "exit", title: "Exit", divider: true }];
    }

    let ITEMS = $derived.by(() => {
        if (server.role === "host")
            return [{ id: "game", title: "Return to Game" }, ...REFERENCE];
        if (server.role === "player")
            return [{ id: "join", title: "Return to Game" }, ...REFERENCE];
        return [
            { id: "game", title: "Start Game" },
            { id: "join", title: "Join Game" },
            ...REFERENCE,
        ];
    });

    // the list can shrink/grow while the menu is open — keep the cursor in range
    $effect(() => {
        if (active >= ITEMS.length) active = ITEMS.length - 1;
    });

    let active = $state(0);
    let notice = $state("");
    let noticeTimer;
    let buttons = [];

    const choose = (item) => {
        if (item.id === "exit") {
            Application.Quit().catch(() => {});
            return;
        }
        if (item.stub) {
            // TODO: the Campaign screen
            notice = `${item.title} — coming soon`;
            clearTimeout(noticeTimer);
            noticeTimer = setTimeout(() => (notice = ""), 2000);
            return;
        }
        onNavigate(item.id);
    };

    const focus = (i) => {
        active = (i + ITEMS.length) % ITEMS.length;
        buttons[active]?.focus();
    };

    const onKey = (e) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            focus(active + 1);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            focus(active - 1);
        }
    };

    onMount(() => {
        buttons[0]?.focus();
        return () => clearTimeout(noticeTimer);
    });
</script>

<svelte:window onkeydown={onKey} />

<main class="menu">
    <header>
        <h1>D&D Builder</h1>
        <p class="tagline">2024 Edition</p>
    </header>

    <nav>
        {#each ITEMS as item, i (item.id)}
            {#if item.divider}<hr />{/if}
            <button
                bind:this={buttons[i]}
                class:active={active === i}
                onmouseenter={() => (active = i)}
                onfocus={() => (active = i)}
                onclick={() => choose(item)}
            >
                {item.title}
            </button>
        {/each}
    </nav>

    <p class="notice" aria-live="polite">{notice}</p>
</main>

<style>
    .menu {
        min-height: 100%;
        padding: 64px 32px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 56px;
    }

    header {
        text-align: center;
    }

    h1 {
        margin: 0;
        font-family: var(--font-heading);
        font-size: 56px;
        font-weight: var(--font-weight-bold);
        letter-spacing: 0.04em;
        color: var(--color-gold);
    }

    .tagline {
        margin: 6px 0 0;
        font-family: var(--font-heading-alt);
        font-size: 18px;
        color: var(--color-text-secondary);
    }

    nav {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
    }

    hr {
        width: 120px;
        margin: 12px 0;
        border: none;
        border-top: 1px solid var(--color-border);
    }

    button {
        position: relative;
        padding: 8px 40px;
        background: none;
        border: none;
        font-family: var(--font-heading);
        font-size: 26px;
        font-weight: var(--font-weight-semibold);
        letter-spacing: 0.06em;
        color: var(--color-text-secondary);
        cursor: pointer;
        transition: color 0.15s;
    }

    button::before,
    button::after {
        position: absolute;
        top: 50%;
        font-size: 16px;
        color: var(--color-gold);
        opacity: 0;
        transform: translateY(-50%);
        transition: opacity 0.15s;
    }
    button::before {
        content: "◆";
        left: 12px;
    }
    button::after {
        content: "◆";
        right: 12px;
    }

    button.active {
        color: var(--color-gold-hover);
    }
    button.active::before,
    button.active::after {
        opacity: 1;
    }

    button:focus-visible {
        outline: none;
    }

    .notice {
        min-height: 20px;
        margin: 0;
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-muted);
    }
</style>
