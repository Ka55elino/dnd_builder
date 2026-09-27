<script>
    /**
     * A monster's stat block, for reading at the table (nothing is rolled).
     * monster — a Monster from GetMonsters (columns + data)
     * actions — optional snippet rendered in the header (Edit / Copy / Add to encounter…)
     */
    import IconLabel from "../common/IconLabel.svelte";
    import { damageName } from "../../rules/labels.js";
    import { ABILITIES, ABILITY_KEYS } from "../../rules/abilities.js";
    import {
        CREATURE_TYPES, SIZES, HABITATS, SPEEDS, SENSES, ACTION_GROUPS,
        crLabel, profByCR, abilityMod, fmtMod, fmtXP, cap,
    } from "../../data/bestiary.js";

    let { monster: m, actions = null } = $props();

    const d = $derived(m?.data ?? {});
    let broken = $state(false);
    $effect(() => {
        m?.id; // a new monster gets a new chance to show its image
        broken = false;
    });

    const speedText = $derived(
        Object.entries(d.speed ?? {})
            .filter(([k, v]) => k !== "hover" && v)
            .map(([k, v]) => (k === "walk" ? `${v} ft.` : `${SPEEDS[k] ?? cap(k)} ${v} ft.${k === "fly" && d.speed.hover ? " (hover)" : ""}`))
            .join(", ") || "—",
    );

    const saveOf = (k) => d.saves?.[k] ?? abilityMod(d.abilities?.[k]);
    const savesProf = (k) => d.saves && k in d.saves;

    const skillsText = $derived(
        Object.entries(d.skills ?? {})
            .map(([k, v]) => `${cap(k.replace(/([A-Z])/g, " $1"))} ${fmtMod(v)}`)
            .join(", "),
    );

    const sensesText = $derived(
        [
            ...Object.entries(d.senses ?? {})
                .filter(([, v]) => v)
                .map(([k, v]) => `${SENSES[k] ?? cap(k)} ${v} ft.`),
            `Passive Perception ${d.passivePerception ?? 10 + abilityMod(d.abilities?.wis)}`,
        ].join(", "),
    );

    const usesText = (u) =>
        !u ? "" : u.recharge ? `Recharge ${u.recharge.replace("-", "–")}` : u.perDay ? `${u.perDay}/Day` : "";

    const reachText = (a) =>
        a.kind === "ranged" ? `range ${a.range ?? "—"} ft.` : `reach ${a.reach ?? 5} ft.`;

    const groups = $derived(ACTION_GROUPS.filter((g) => d[g.key]?.length));
    const initial = $derived((m?.name ?? "?")[0]);
</script>

{#snippet damageList(list)}
    {#each list as dm, i}
        {#if i}<span class="plus"> plus </span>{/if}
        <span class="dmg">
            <b>{dm.avg}</b>{#if dm.dice}&nbsp;({dm.dice}){/if}
            <IconLabel name={dm.type} kind="dmg" label={damageName(dm.type)} text={damageName(dm.type)} />
        </span>
    {/each}
{/snippet}

{#snippet actionItem(a)}
    <li>
        <p>
            <b class="a-name">{a.name}</b>{#if usesText(a.uses)}<span class="uses"> ({usesText(a.uses)})</span>{/if}.
            {#if a.attack}
                <i>{a.attack.kind === "ranged" ? "Ranged" : "Melee"} Attack Roll:</i> <b>{fmtMod(a.attack.bonus ?? 0)}</b>, {reachText(a.attack)}
                {#if a.damage?.length}<i>Hit:</i> {@render damageList(a.damage)}.{/if}
            {:else if a.save}
                <i>{ABILITIES[a.save.ability]?.name ?? cap(a.save.ability)} Saving Throw:</i> <b>DC {a.save.dc}</b>.
                {#if a.damage?.length}<i>Failure:</i> {@render damageList(a.damage)}.{/if}
            {:else if a.damage?.length}
                {@render damageList(a.damage)}.
            {/if}
            {#if a.desc}<span class="desc">{a.desc}</span>{/if}
        </p>
    </li>
{/snippet}

<article class="block">
    <header>
        <div class="pic type-{m.type}">
            {#if m.image && !broken}
                <img src={m.image} alt="" onerror={() => (broken = true)} />
            {:else}
                <span>{initial}</span>
            {/if}
        </div>
        <div class="title">
            <h2>{m.name}</h2>
            <p class="kind">
                {SIZES[m.size] ?? cap(m.size)} {CREATURE_TYPES[m.type] ?? cap(m.type)}{#if d.subtypes?.length}&nbsp;({d.subtypes.join(", ")}){/if},
                {m.alignment || "unaligned"}
            </p>
            <div class="tags">
                <span class="tag cr">CR {crLabel(m.cr)}</span>
                <span class="tag">{fmtXP(m.xp)} XP</span>
                <span class="tag">PB {fmtMod(profByCR(m.cr))}</span>
                {#if m.legendary}<span class="tag legendary">Legendary</span>{/if}
                {#if m.data?.custom}<span class="tag own">custom</span>{/if}
            </div>
        </div>
        {#if actions}<div class="head-actions">{@render actions(m)}</div>{/if}
    </header>

    <div class="combat">
        <div class="stat"><span class="k">AC</span><span class="v">{m.ac}</span>{#if d.acNote}<small>{d.acNote}</small>{/if}</div>
        <div class="stat hp"><span class="k">HP</span><span class="v">{m.hp}</span>{#if d.hpFormula}<small>{d.hpFormula}</small>{/if}</div>
        <div class="stat"><span class="k">Initiative</span><span class="v">{fmtMod(d.initiative ?? abilityMod(d.abilities?.dex))}</span></div>
        <div class="stat wide"><span class="k">Speed</span><span class="v small">{speedText}</span></div>
    </div>

    <div class="abilities">
        {#each ABILITY_KEYS as k}
            <div class="ab" class:prof={savesProf(k)}>
                <span class="k">{ABILITIES[k].short}</span>
                <span class="score">{d.abilities?.[k] ?? 10}</span>
                <span class="mod">{fmtMod(abilityMod(d.abilities?.[k]))}</span>
                <span class="save" title="Saving throw">save {fmtMod(saveOf(k))}</span>
            </div>
        {/each}
    </div>

    <dl class="details">
        {#if skillsText}<dt>Skills</dt><dd>{skillsText}</dd>{/if}
        {#if d.vulnerabilities?.length}<dt>Vulnerabilities</dt><dd>{d.vulnerabilities.map(damageName).join(", ")}</dd>{/if}
        {#if d.resistances?.length}<dt>Resistances</dt><dd>{d.resistances.map(damageName).join(", ")}</dd>{/if}
        {#if d.immunities?.length || d.conditionImmunities?.length}
            <dt>Immunities</dt>
            <dd>{[...(d.immunities ?? []).map(damageName), ...(d.conditionImmunities ?? []).map(cap)].join(", ")}</dd>
        {/if}
        <dt>Senses</dt><dd>{sensesText}</dd>
        <dt>Languages</dt><dd>{d.languages || "—"}</dd>
        {#if m.habitats?.length}<dt>Habitat</dt><dd>{m.habitats.map((h) => HABITATS[h] ?? cap(h)).join(", ")}</dd>{/if}
    </dl>

    {#each groups as g (g.key)}
        <section>
            <h3>{g.title}</h3>
            <ul>
                {#each d[g.key] as a, i (i)}{@render actionItem(a)}{/each}
            </ul>
        </section>
    {/each}

    {#if d.legendary?.actions?.length}
        <section class="legendary">
            <h3>Legendary Actions</h3>
            <p class="note">
                {d.legendary.perRound ?? 3} per round: one at a time, right after another creature's turn.
                Spent uses come back at the start of {m.name}'s turn.
            </p>
            <ul>
                {#each d.legendary.actions as a, i (i)}{@render actionItem(a)}{/each}
            </ul>
        </section>
    {/if}

    {#if d.desc || d.treasure}
        <section class="lore">
            {#if d.desc}<p>{d.desc}</p>{/if}
            {#if d.treasure}<p class="treasure"><b>Treasure.</b> {d.treasure}</p>{/if}
        </section>
    {/if}
</article>

<style>
    .block {
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 18px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 12px;
        font-family: var(--font-ui);
        color: var(--color-text-primary);
    }

    header {
        display: flex;
        gap: 14px;
        align-items: flex-start;
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

    h2 {
        margin: 0;
        font-family: var(--font-heading);
        font-size: 26px;
        line-height: 1.1;
        color: var(--color-gold);
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
        font-size: 11px;
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

    .head-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 6px;
    }

    .combat {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 2fr);
        gap: 8px;
    }

    .stat {
        padding: 8px 6px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        text-align: center;
    }

    .stat.hp {
        border-color: var(--color-danger);
    }

    .k {
        font-size: 10px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-text-muted);
    }

    .v {
        font-family: var(--font-heading);
        font-size: 22px;
        line-height: 1.1;
    }

    .v.small {
        font-family: var(--font-ui);
        font-size: 14px;
        line-height: 1.6;
    }

    .stat small {
        font-size: 11px;
        color: var(--color-text-muted);
    }

    .abilities {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 6px;
    }

    .ab {
        padding: 6px 4px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1px;
        background: var(--color-card-elevated);
        border: 1px solid color-mix(in srgb, var(--color-gold) 40%, var(--color-border));
        border-radius: 8px;
    }

    .ab .score {
        font-family: var(--font-heading);
        font-size: 20px;
    }

    .ab .mod {
        font-size: 13px;
        font-weight: var(--font-weight-semibold);
        color: var(--color-gold);
    }

    .ab .save {
        font-size: 10px;
        color: var(--color-text-muted);
    }

    .ab.prof .save {
        color: var(--color-text-primary);
    }

    .details {
        margin: 0;
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 4px 14px;
        font-size: 13px;
    }

    dt {
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-secondary);
    }

    dd {
        margin: 0;
    }

    section h3 {
        margin: 0 0 6px;
        padding-bottom: 4px;
        border-bottom: 1px solid color-mix(in srgb, var(--color-gold) 50%, transparent);
        font-family: var(--font-heading);
        font-size: 14px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-gold);
    }

    ul {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    li p {
        margin: 0;
        font-size: 14px;
        line-height: 1.5;
    }

    .a-name {
        font-family: var(--font-heading-alt);
        font-style: italic;
        font-size: 15px;
    }

    .uses {
        color: var(--color-text-secondary);
    }

    .dmg {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        white-space: nowrap;
    }

    .dmg :global(.icon) {
        width: 15px;
        height: 15px;
    }

    .desc {
        font-family: var(--font-spell);
        font-size: 15px;
        color: var(--color-text-secondary);
    }

    .legendary .note {
        margin: 0 0 8px;
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .lore p {
        margin: 0;
        font-family: var(--font-lore);
        font-size: 15px;
        line-height: 1.45;
        color: var(--color-text-secondary);
    }

    .lore .treasure {
        margin-top: 6px;
    }
</style>
