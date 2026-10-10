<script>
    /**
     * A monster's "head": portrait (its border colored by type), name, size · type · alignment,
     * and the chips CR · XP · PB (+ Legendary / custom). The same look in two places:
     *   the stat block header (MonsterStatBlock) and a row of the bestiary list (compact).
     *
     * monster — a Monster from GetMonsters; compact — the list row size; as — the name's tag
     */
    import { CREATURE_TYPES, SIZES, crLabel, profByCR, fmtMod, fmtXP, cap, isCustomMonster } from "../../data/bestiary.js";

    let { monster: m, compact = false, as = compact ? "span" : "h2" } = $props();

    const d = $derived(m?.data ?? {});
    let broken = $state(false);
    $effect(() => {
        m?.id; // a new monster gets a new chance to show its image
        broken = false;
    });
    const initial = $derived((m?.name ?? "?")[0]);
</script>

<div class="head" class:compact>
    <div class="pic type-{m.type}">
        {#if m.image && !broken}
            <img src={m.image} alt="" loading="lazy" onerror={() => (broken = true)} />
        {:else}
            <span>{initial}</span>
        {/if}
    </div>
    <div class="title">
        <svelte:element this={as} class="name">{m.name}</svelte:element>
        <p class="kind">
            {SIZES[m.size] ?? cap(m.size)} {CREATURE_TYPES[m.type] ?? cap(m.type)}{#if d.subtypes?.length}&nbsp;({d.subtypes.join(", ")}){/if},
            {m.alignment || "unaligned"}
        </p>
        <div class="tags">
            <span class="tag cr">CR {crLabel(m.cr)}</span>
            <span class="tag">{fmtXP(m.xp)} XP</span>
            <span class="tag">PB {fmtMod(profByCR(m.cr))}</span>
            {#if m.legendary}<span class="tag legendary">Legendary</span>{/if}
            {#if isCustomMonster(m)}<span class="tag own">custom</span>{/if}
        </div>
    </div>
</div>

<style>
    .head {
        display: flex;
        gap: 14px;
        align-items: flex-start;
        min-width: 0;
    }

    .pic {
        --tc: var(--color-gold);
        flex: none;
        width: 72px;
        height: 72px;
        border: 2px solid var(--tc);
        border-radius: 12px;
        overflow: hidden;
        display: grid;
        place-items: center;
        background: var(--color-card-elevated);
        font-family: var(--font-heading);
        font-size: 30px;
        color: var(--tc);
    }

    .pic img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .type-undead, .type-fiend { --tc: var(--color-danger); }
    .type-celestial { --tc: var(--color-dmg-radiant); }
    .type-fey, .type-plant, .type-beast { --tc: var(--color-success); }
    .type-aberration, .type-ooze { --tc: var(--color-magic-purple); }
    .type-elemental, .type-dragon { --tc: var(--color-dmg-fire); }
    .type-construct, .type-giant, .type-humanoid, .type-monstrosity { --tc: var(--color-gold); }

    .title {
        flex: 1;
        min-width: 0;
    }

    .name {
        display: block;
        margin: 0;
        font-family: var(--font-heading);
        font-size: 26px;
        font-weight: var(--font-weight-bold);
        line-height: 1.1;
        color: var(--color-gold);
        overflow-wrap: anywhere;
    }

    .kind {
        margin: 3px 0 6px;
        font-family: var(--font-heading-alt);
        font-style: italic;
        font-size: 15px;
        color: var(--color-text-secondary);
    }

    .tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }

    .tag {
        padding: 1px 8px;
        border: 1px solid var(--color-border);
        border-radius: 999px;
        font-family: var(--font-ui);
        font-size: 11px;
        white-space: nowrap;
        color: var(--color-text-secondary);
    }

    .tag.cr {
        border-color: var(--color-gold);
        color: var(--color-gold);
    }

    .tag.legendary {
        border-color: var(--color-magic-purple);
        color: var(--color-meta-concentration);
    }

    .tag.own {
        border-color: var(--color-meta-range);
        color: var(--color-meta-range);
    }

    /* a list row: the same, smaller */
    .compact {
        gap: 10px;
        align-items: center;
    }

    .compact .pic {
        width: 48px;
        height: 48px;
        border-radius: 9px;
        font-size: 20px;
    }

    .compact .name {
        font-size: 17px;
        line-height: 1.15;
    }

    .compact .kind {
        margin: 1px 0 4px;
        font-size: 13px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .compact .tags {
        gap: 4px;
    }

    .compact .tag {
        padding: 0 6px;
        font-size: 10px;
    }
</style>
