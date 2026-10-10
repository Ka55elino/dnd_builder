<script>
    /**
     * Spell / ability / feat card (inspired by dndbuilder-v2).
     *
     *  ┌────────────────────────────── source ┐
     *  │ Name                                  │
     *  │ description…                          │
     *  │ [⚡ bonus] [2d8 🔥] [2 × long] [DC 13]    │
     *  └───────────────────────────────────────┘
     *
     * item      — reference record (spells / feats): name, desc, action,
     *             level, school, concentration, ritual, data.{damage, scaleDie, uses, casting}
     * level     — character level (for damage scaling)
     * source    — top-right label ('Class', 'Level 1', 'Elf'…)
     * uses      — { max, per } — how many times and when it recharges
     * note      — extra line under the description (e.g. species spell: ability, DC, free cast)
     * footer    — optional snippet at the bottom (the sheet's Cast / Use bar); not for selectable cards
     * saveDC    — saving throw DC (shown if the description mentions a saving throw)
     * selectable / selected / onclick — selection mode (level screen)
     */
    import IconLabel from "./IconLabel.svelte";
    import { hasIcon } from "./Icon.svelte";
    import { damageParts, dieAt } from "../../rules/damage.js";
    import {
        ACTION_TYPES, DAMAGE_TYPES, REST_TYPES, SCHOOLS, normAction, damageLabel,
    } from "../../rules/labels.js";

    let {
        item,
        level = 1,
        source = "",
        uses = null,
        saveDC = null,
        note = "",
        selectable = false,
        selected = false,
        onclick = null,
        footer = null,
        boost = null, // { die, base, from } — an active effect changed the die (Symbiotic Entity)
        image = undefined, // picture on the left (subclass choice); "" — empty placeholder
    } = $props();

    const d = $derived(item?.data ?? {});
    const action = $derived(normAction(item?.action ?? d.action));
    const parts = $derived(damageParts(d.damage, level));
    const die = $derived(dieAt(d.scaleDie, level));
    const casting = $derived(d.casting ?? null);
    const isSpell = $derived(item?.kind === "spell");
    const desc = $derived(item?.desc ?? d.desc ?? "");
    const showDC = $derived(saveDC != null && /saving throw|\b(?:strength|dexterity|constitution|intelligence|wisdom|charisma) save\b/i.test(desc));
</script>

<svelte:element
    this={selectable ? "button" : "article"}
    class="card"
    class:selectable
    class:selected
    class:with-img={image !== undefined}
    onclick={selectable ? onclick : undefined}
    type={selectable ? "button" : undefined}
    aria-pressed={selectable ? selected : undefined}
>
    {#if image !== undefined}
        <div class="thumb">
            {#if image}<img src={image} alt="" loading="lazy" />{/if}
        </div>
    {/if}
    <div class="body">
    <header>
        <b class="name">{item?.name}</b>
        {#if source}<span class="src">{source}</span>{/if}
    </header>

    {#if desc}<p class="desc">{desc}</p>{/if}
    {#if note}<p class="note">{note}</p>{/if}

    <!-- if the label has an SVG, show the icon and move the text into the tooltip (IconLabel) -->
    <div class="meta">
        {#if action && ACTION_TYPES[action]}
            <span class="chip act" style="--c: var(--color-act-{action})">
                <IconLabel name={action} kind="act" label={ACTION_TYPES[action].name} text={ACTION_TYPES[action].name.toLowerCase()} />
            </span>
        {/if}

        {#each parts as p}
            <span class="chip dmg" style="--c: var(--color-dmg-{p.type ?? 'weapon'})">
                {#if p.dice}<b>{p.dice}</b>{/if}
                {#if p.type}
                    <IconLabel name={p.type} kind="dmg" label={damageLabel(p.type)} text={DAMAGE_TYPES[p.type]?.short ?? p.type} />
                {/if}
            </span>
        {/each}

        {#if boost}
            <span class="chip boost" title="{boost.from}: {boost.base} → {boost.die}">die <b>{boost.die}</b> <s>{boost.base}</s></span>
        {:else if die}<span class="chip">die <b>{die}</b></span>{/if}

        {#if uses?.max}
            <span class="chip rest" style="--c: var(--color-rest-{uses.per})">
                <b>{uses.max}</b> ×
                <IconLabel name={uses.per} kind="rest" label={REST_TYPES[uses.per]?.name ?? ""} text={REST_TYPES[uses.per]?.short ?? ""} />
            </span>
        {/if}

        {#if showDC}
            <span class="chip meta-chip" style="--c: var(--color-meta-dc)">
                <IconLabel name="dc" kind="meta" label="Saving throw DC" text="DC" />
                <b>{saveDC}</b>
            </span>
        {/if}

        {#if isSpell}
            {#if casting?.range}
                <span class="chip meta-chip" style="--c: var(--color-meta-range)">
                    <IconLabel name="range" kind="meta" label="Range" text="" />{casting.range}
                </span>
            {/if}
            {#if casting?.duration}
                <span class="chip meta-chip" style="--c: var(--color-meta-duration)">
                    <IconLabel name="duration" kind="meta" label="Duration" text="" />{casting.duration}
                </span>
            {/if}
            {#if item.concentration && (hasIcon("concentration") || !/conc/i.test(casting?.duration ?? ""))}
                <span class="chip flag" style="--c: var(--color-meta-concentration)">
                    <IconLabel name="concentration" kind="meta" label="Concentration" text="conc." hint="The effect lasts as long as you maintain Concentration" />
                </span>
            {/if}
            {#if item.ritual}
                <span class="chip flag" style="--c: var(--color-meta-ritual)">
                    <IconLabel name="ritual" kind="meta" label="Ritual" text="ritual" hint="Can be cast as a Ritual: +10 minutes, no spell slot" />
                </span>
            {/if}
            {#if item.school}
                <span class="chip school" style="--c: var(--color-school-{item.school})">
                    <IconLabel name={item.school} kind="school" label={`School: ${SCHOOLS[item.school] ?? item.school}`} text={SCHOOLS[item.school] ?? item.school} />
                </span>
            {/if}
        {/if}
    </div>

    <!-- the snippet brings its own wrapper (put margin-top: auto on it to sit at the bottom) -->
    {#if footer && !selectable}{@render footer()}{/if}
    </div>
</svelte:element>

<style>
    .chip.boost {
        border-color: var(--color-text-accent);
        color: var(--color-text-accent);
    }

    .chip.boost s {
        opacity: 0.6;
        font-size: 0.9em;
    }

    .card {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 10px 12px;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        color: var(--color-text-primary);
        text-align: left;
        font: inherit;
        min-width: 0;
    }

    .body {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .card.with-img {
        align-items: center;
        gap: 10px;
    }

    .card.with-img .body {
        align-self: stretch;
    }

    .card.with-img header {
        justify-content: center;
    }

    .thumb {
        flex: 0 0 auto;
        width: 120px;
        height: 120px;
        border-radius: 6px;
        overflow: hidden;
        background: var(--color-card);
    }

    .thumb img {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: cover;
    }

    @media (max-width: 640px) {
        .thumb {
            width: 88px;
            height: 88px;
        }
    }

    .selectable {
        cursor: pointer;
    }

    .selectable:hover {
        border-color: var(--color-gold);
    }

    .selected {
        background: var(--color-magic-purple-dark);
        border-color: var(--color-magic-purple);
    }

    header {
        display: flex;
        flex-wrap: wrap; /* a long source ("BARD, CLERIC, DRUID…") goes to its own line */
        align-items: baseline;
        justify-content: space-between;
        gap: 2px 8px;
        min-width: 0;
    }

    .name {
        font-family: var(--font-ui);
        font-size: 14px;
        font-weight: var(--font-weight-semibold);
    }

    .src {
        flex: 0 1 auto;
        min-width: 0;
        overflow-wrap: anywhere;
        text-align: right;
        font-family: var(--font-ui);
        font-size: 10px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-text-muted);
    }

    .desc {
        margin: 0;
        overflow-wrap: anywhere;
        font-family: var(--font-spell);
        font-size: 14px;
        line-height: 1.35;
        color: var(--color-text-secondary);
    }

    .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }

    .meta:empty {
        display: none;
    }

    .chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        background: var(--color-bg);
        border: 1px solid color-mix(in srgb, var(--c, var(--color-border)) 55%, transparent);
        border-radius: 999px;
        font-family: var(--font-ui);
        font-size: 11px;
        color: var(--color-text-secondary);
        white-space: nowrap;
    }

    .chip b {
        color: var(--color-text-primary);
        font-weight: var(--font-weight-semibold);
    }

    .chip.act,
    .chip.dmg,
    .chip.rest,
    .chip.meta-chip :global(.icon),
    .chip.flag :global(.icon),
    .chip.school :global(.icon) {
        color: var(--c);
    }

    .chip.flag {
        border-style: dashed;
    }

    .chip.school {
        color: var(--color-text-muted);
    }
    .note {
        margin: 0;
        font-family: var(--font-ui);
        font-size: 11px;
        color: var(--color-text-accent);
    }
</style>
