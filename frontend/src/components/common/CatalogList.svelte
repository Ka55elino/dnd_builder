<script>
    /**
     * Equipment catalog: Items / Armor / Weapons tabs + search by name.
     * Used on the "Items" (reference) and "Give item" pages.
     *
     * catalog — { weapons, armor, items } (refs.catalog)
     * tab     — (bindable) current tab: 'item' | 'armor' | 'weapon'
     * actions — snippet (x, tab) on the right of a row ("Add" buttons etc.)
     * marked  — (x, tab) => bool — highlight a row (e.g. "already in backpack")
     */
    import { damageShort, damageName, damageLabel } from "../../rules/labels.js";
    import IconLabel from "./IconLabel.svelte";
    import { ARMOR_CAT, WEAPON_CAT, WEAPON_PROPS, acText } from "../../rules/equipment.js";

    let { catalog, tab = $bindable("item"), actions = null, marked = null } = $props();

    const TABS = [
        { id: "item", label: "Items", list: "items" },
        { id: "armor", label: "Armor", list: "armor" },
        { id: "weapon", label: "Weapons", list: "weapons" },
    ];

    let query = $state("");

    const norm = (s) => String(s ?? "").toLowerCase().replace(/\u0451/g, "\u0435").trim();
    const match = (x) => !query || norm(x.name).includes(norm(query));
    const current = $derived(TABS.find((t) => t.id === tab) ?? TABS[0]);
    const list = $derived((catalog?.[current.list] ?? []).filter(match));
    const counts = $derived(
        Object.fromEntries(TABS.map((t) => [t.id, (catalog?.[t.list] ?? []).filter(match).length])),
    );

    const fmt = (n) => (n > 0 ? `+${n}` : `${n}`);

    /**
     * Card contents:
     *   sub   — line below the name (category)
     *   stat  — main stat, large (damage / AC / cost)
     *   extra — secondary info next to stat (extra damage, weight…)
     *   tags  — bonuses and properties
     *   warn  — restrictions (Strength, Stealth Disadvantage)
     */
    function weaponCard(w) {
        const d = w.data ?? {};
        return {
            sub: WEAPON_CAT[w.category] ?? w.category,
            stat: w.damage ?? "",
            statType: w.damageType ?? null, // damage type — as an icon (or text if there's no icon)
            statLabel: "damage",
            extra: (d.extraDamage ?? []).map((x) => ({ text: `+${x.dice}`, type: x.type })),
            tags: [
                d.attackBonus ? `${fmt(d.attackBonus)} to hit` : "",
                d.damageBonus ? `${fmt(d.damageBonus)} to damage` : "",
                d.mastery ? `mastery: ${d.mastery}` : "",
                ...(d.properties ?? []).map((p) => WEAPON_PROPS[p] ?? p),
            ].filter(Boolean),
            warn: [],
        };
    }

    function armorCard(a) {
        const d = a.data ?? {};
        const plainClothes = a.category === "clothing" && !a.baseAC;
        const bonus = d.acBonus && a.category !== "shield" && !plainClothes ? ` ${fmt(d.acBonus)}` : "";
        return {
            sub: ARMOR_CAT[a.category] ?? a.category,
            stat: acText(a) + bonus,
            statLabel: "AC",
            extra: [],
            tags: [],
            warn: [d.strengthReq ? `Str ${d.strengthReq}` : "", d.stealthDisadvantage ? "Stealth Disadvantage" : ""].filter(Boolean),
        };
    }

    const itemCard = (i) => ({
        sub: "Gear",
        stat: i.cost ?? "",
        statLabel: i.cost ? "cost" : "",
        extra: i.weight ? [{ text: `${i.weight} lb.` }] : [],
        tags: [],
        warn: [],
    });

    const cardOf = (x) => (tab === "weapon" ? weaponCard(x) : tab === "armor" ? armorCard(x) : itemCard(x));
    const isCustom = (x) => !!x.data?.custom;
    const descOf = (x) => x.desc ?? x.data?.desc ?? "";
    const initials = (name) => String(name ?? "?").trim().slice(0, 1).toUpperCase();
</script>

<div class="toolbar">
    <nav class="tabs">
        {#each TABS as t}
            <button class="chip" class:active={t.id === tab} onclick={() => (tab = t.id)}>
                {t.label} <small>{counts[t.id]}</small>
            </button>
        {/each}
    </nav>
    <input class="search" type="search" placeholder="Search by name…" bind:value={query} />
</div>

<div class="grid">
    {#each list as x (x.id)}
        {@const c = cardOf(x)}
        <article
            class="card"
            class:named={x.isDefault === false && !isCustom(x)}
            class:custom={isCustom(x)}
            class:marked={marked?.(x, tab)}
        >
            <header class="c-head">
                <div class="pic">
                    {#if x.image}<img src={x.image} alt="" />{:else}<span>{initials(x.name)}</span>{/if}
                </div>
                <div class="title">
                    <b>{x.name}</b>
                    <span class="sub">
                        {c.sub}
                        {#if isCustom(x)}<span class="badge own">custom</span>{:else if x.isDefault === false}<span class="badge">named</span>{/if}
                    </span>
                </div>
            </header>

            {#if c.stat || c.extra.length}
                <div class="stat-row">
                    {#if c.stat}
                        <div class="stat">
                            {#if c.statLabel}<small>{c.statLabel}</small>{/if}
                            <strong>{c.stat}</strong>
                            {#if c.statType}
                                <span class="dtype"><IconLabel name={c.statType} kind="dmg" label={damageLabel(c.statType)} text={damageShort(c.statType)} /></span>
                            {/if}
                        </div>
                    {/if}
                    {#each c.extra as e}
                        <span class="extra">
                            {e.text}
                            {#if e.type}<IconLabel name={e.type} kind="dmg" label={damageLabel(e.type)} text={damageShort(e.type)} />{/if}
                        </span>
                    {/each}
                </div>
            {/if}

            {#if c.tags.length || c.warn.length}
                <div class="tags">
                    {#each c.tags as t}<span class="tag">{t}</span>{/each}
                    {#each c.warn as t}<span class="tag warn">{t}</span>{/each}
                </div>
            {/if}

            {#if descOf(x)}<p class="desc" title={descOf(x)}>{descOf(x)}</p>{/if}

            {#if actions}
                <footer class="actions">{@render actions(x, tab)}</footer>
            {/if}
        </article>
    {:else}
        <p class="muted">Nothing found.</p>
    {/each}
</div>

<style>
    .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }

    .tabs {
        display: flex;
        gap: 8px;
    }

    .chip {
        padding: 6px 14px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 999px;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: 13px;
        cursor: pointer;
    }

    .chip small {
        margin-left: 4px;
        color: var(--color-text-muted);
    }

    .chip.active {
        background: var(--color-magic-purple-dark);
        border-color: var(--color-magic-purple);
        color: var(--color-text-primary);
    }

    .search {
        flex: 0 1 320px;
        padding: 8px 12px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-primary);
        font-family: var(--font-form);
        font-size: 14px;
    }

    .search:focus {
        outline: none;
        border-color: var(--color-gold);
    }

    /* --- cards --- */
    .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 14px;
        align-items: stretch;
    }

    .card {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 14px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 10px;
        transition: border-color 0.15s, background 0.15s;
    }

    .card:hover {
        border-color: color-mix(in srgb, var(--color-gold) 50%, var(--color-border));
    }

    .card.named {
        border-color: color-mix(in srgb, var(--color-gold) 45%, var(--color-border));
    }

    .card.custom {
        border-color: color-mix(in srgb, var(--color-magic-purple) 55%, var(--color-border));
    }

    .card.marked {
        background: var(--color-card-elevated);
        box-shadow: inset 0 0 0 1px var(--color-gold);
    }

    .c-head {
        display: flex;
        gap: 12px;
        align-items: center;
    }

    .pic {
        width: 104px;
        height: 104px;
        flex: 0 0 104px;
        display: grid;
        place-items: center;
        overflow: hidden;
        border-radius: 10px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
    }

    .pic img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .pic span {
        font-family: var(--font-heading);
        font-size: 44px;
        color: var(--color-text-muted);
    }

    .title {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
    }

    .title b {
        font-family: var(--font-ui);
        font-size: 15px;
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
        line-height: 1.25;
    }

    .sub {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .badge {
        padding: 0 7px;
        border: 1px solid var(--color-gold);
        border-radius: 999px;
        font-size: 10px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-gold);
    }

    .badge.own {
        border-color: var(--color-magic-purple);
        color: var(--color-act-reaction);
    }

    .stat-row {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 6px 12px;
        padding: 8px 10px;
        background: var(--color-bg);
        border-radius: 8px;
    }

    .stat {
        display: flex;
        align-items: baseline;
        gap: 6px;
    }

    .stat small {
        font-family: var(--font-ui);
        font-size: 11px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--color-text-muted);
    }

    .stat strong {
        font-family: var(--font-heading-alt);
        font-size: 20px;
        font-weight: var(--font-weight-bold);
        color: var(--color-text-accent);
    }

    .dtype {
        display: inline-flex;
        align-items: center;
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .dtype :global(.icon) {
        width: 20px;
        height: 20px;
    }

    .extra {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .tags {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
    }

    .tag {
        padding: 1px 8px;
        border: 1px solid var(--color-border);
        border-radius: 999px;
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .tag.warn {
        border-color: color-mix(in srgb, var(--color-danger) 60%, transparent);
        color: color-mix(in srgb, var(--color-danger) 60%, var(--color-text-primary));
    }

    .desc {
        margin: 0;
        display: -webkit-box;
        -webkit-line-clamp: 4;
        line-clamp: 4;
        -webkit-box-orient: vertical;
        overflow: hidden;
        font-family: var(--font-spell);
        font-size: 14px;
        line-height: 1.4;
        color: var(--color-text-secondary);
    }

    .actions {
        margin-top: auto;
        padding-top: 10px;
        border-top: 1px solid var(--color-border);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
    }

    .muted {
        grid-column: 1 / -1;
        margin: 0;
        color: var(--color-text-muted);
    }
</style>
