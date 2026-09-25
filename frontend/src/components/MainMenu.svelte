<script>
    /**
     * Main menu (start page): Characters · Spells · Items.
     * onNavigate(screen) — 'characters' | 'spells' | 'items'
     */
    import { onMount } from "svelte";
    import { ListCharacters } from "../../wailsjs/go/main/App.js";
    import { loadRefs } from "../data/refs.js";

    let { onNavigate } = $props();

    let counts = $state({ characters: null, spells: null, items: null });

    onMount(async () => {
        try {
            const [chars, refs] = await Promise.all([ListCharacters(), loadRefs()]);
            const c = refs.catalog ?? {};
            counts = {
                characters: chars.length,
                spells: refs.spells.filter((s) => s.kind === "spell").length,
                items: (c.items?.length ?? 0) + (c.armor?.length ?? 0) + (c.weapons?.length ?? 0),
            };
        } catch (e) {
            console.error("[menu]", e);
        }
    });

    const SECTIONS = [
        { id: "characters", title: "Characters", sub: "Creation, sheets and leveling up", glyph: "⚔" },
        { id: "spells", title: "Spells", sub: "Spell reference by level and class", glyph: "✦" },
        { id: "items", title: "Items", sub: "Weapons, armor and gear", glyph: "⚜" },
    ];

    const plural = (n, one, few, many) => {
        if (n === 1) return one;
        return many;
    };
    const countText = (id) => {
        const n = counts[id];
        if (n == null) return "";
        if (id === "characters") return `${n} ${plural(n, "character", "characters", "characters")}`;
        if (id === "spells") return `${n} ${plural(n, "spell", "spells", "spells")}`;
        return `${n} ${plural(n, "item", "items", "items")}`;
    };
</script>

<main class="menu">
    <header>
        <h1>D&D Builder</h1>
        <p class="tagline">2024 Edition</p>
    </header>

    <nav class="sections">
        {#each SECTIONS as s (s.id)}
            <button class="section" onclick={() => onNavigate(s.id)}>
                <span class="glyph" aria-hidden="true">{s.glyph}</span>
                <span class="title">{s.title}</span>
                <span class="sub">{s.sub}</span>
                <span class="count">{countText(s.id)}</span>
            </button>
        {/each}
    </nav>
</main>

<style>
    .menu {
        min-height: 100%;
        padding: 64px 32px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 48px;
    }

    header {
        text-align: center;
    }

    h1 {
        margin: 0;
        font-family: var(--font-heading);
        font-size: 48px;
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

    .sections {
        width: 100%;
        max-width: 960px;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 20px;
    }

    .section {
        min-height: 220px;
        padding: 28px 24px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 12px;
        color: var(--color-text-primary);
        text-align: center;
        cursor: pointer;
        transition:
            border-color 0.15s,
            background 0.15s,
            transform 0.15s;
    }

    .section:hover {
        background: var(--color-card-elevated);
        border-color: var(--color-gold);
        transform: translateY(-2px);
    }

    .section:focus-visible {
        outline: 2px solid var(--color-gold);
        outline-offset: 3px;
    }

    .glyph {
        font-size: 40px;
        line-height: 1;
        color: var(--color-gold);
    }

    .title {
        font-family: var(--font-heading);
        font-size: 24px;
        font-weight: var(--font-weight-bold);
        color: var(--color-gold);
    }

    .sub {
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .count {
        min-height: 16px;
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-muted);
    }
</style>
