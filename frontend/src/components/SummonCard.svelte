<script>
    /**
     * A summoned creature on the character sheet (Find Familiar, Summon Beast, Primal Companion):
     * its own Hit Points (CharacterState.summons — the player's app keeps them, the DM asks for
     * changes), AC, speed, abilities, attacks with this caster's numbers, the full stat block on demand.
     *
     * summon  — the CharacterState.summons entry
     * monster — rules/summon.js resolveSummon(...).monster (null while the bestiary loads)
     * note    — the monster's summon note ("acts right after you…")
     * state   — CharacterState
     */
    import MonsterStatBlock from "./bestiary/MonsterStatBlock.svelte";
    import Icon from "./common/Icon.svelte";
    import IconLabel from "./common/IconLabel.svelte";
    import { speedText } from "../rules/wildshape.js";
    import { ABILITIES, ABILITY_KEYS, formatModifier, modifier } from "../rules/abilities.js";
    import { damageName } from "../rules/labels.js";
    import { CREATURE_TYPE_NAMES } from "../rules/summon.js";

    let { summon: s, monster = null, note = "", state: cs } = $props();

    let full = $state(false);
    let amount = $state(1);
    const d = $derived(monster?.data ?? {});
    const hasHp = $derived(s.maxHp != null); // a token (Flaming Sphere) has none
    const hp = $derived(!hasHp ? null : cs ? cs.summonHp(s) : s.maxHp - s.hpLost);
    const pct = $derived(hasHp ? Math.round((hp / s.maxHp) * 100) : 0);
    const attacks = $derived([...(d.actions ?? []), ...(d.bonusActions ?? [])].filter((a) => a.attack));
    const other = $derived((d.actions ?? []).filter((a) => !a.attack));
    const turnText = $derived(s.initiative === "owner" ? "acts right after you" : "own Initiative");
    const run = (op) => cs.changeSummonHp(s.uid, op, amount);
</script>

<article class="summon">
    <header>
        {#if s.image}<img class="face" src={s.image} alt="" />{:else}<span class="face ph">{s.icon || s.name[0]}</span>{/if}
        <div class="title">
            <h3>{s.name}</h3>
            <p class="sub">
                {[s.creatureType ? CREATURE_TYPE_NAMES[s.creatureType] ?? s.creatureType : "", s.sourceName, s.slot ? `level ${s.slot} slot` : "", s.conc ? "Concentration" : "", s.token ? "moves on your turn" : turnText]
                    .filter(Boolean)
                    .join(" · ")}
            </p>
        </div>
        <button class="dismiss" onclick={() => cs.removeSummon(s.uid)} title="It disappears (dismissed, or the spell ended)">Dismiss</button>
    </header>

    {#if s.token}
        <!-- not a creature: what it does, its numbers if it has any (Bigby's Hand: AC 20, your HP max) -->
        {#if s.ac != null || hasHp}
            <div class="stats">
                {#if s.ac != null}<div class="stat"><span class="lbl">AC</span><b>{s.ac}</b></div>{/if}
                {#if hasHp}
                    <div class="stat hp">
                        <span class="lbl">Hit Points</span>
                        <b>{hp}<small>/{s.maxHp}</small></b>
                        <span class="bar"><span style="width: {pct}%" class:low={pct <= 30}></span></span>
                    </div>
                {/if}
            </div>
        {/if}
    {:else}
    <div class="stats">
        <div class="stat"><span class="lbl">AC</span><b>{s.ac}</b></div>
        <div class="stat hp">
            <span class="lbl">Hit Points</span>
            <b>{hp}<small>/{s.maxHp}</small>{#if s.tempHp}<small class="temp"> +{s.tempHp}</small>{/if}</b>
            <span class="bar"><span style="width: {pct}%" class:low={pct <= 30}></span></span>
        </div>
        <div class="stat wide"><span class="lbl">Speed</span><b class="sp">{speedText(d.speed) || "—"}</b></div>
    </div>
    {/if}

    {#if hasHp}

    <div class="hp-row">
        <input type="number" min="0" bind:value={amount} aria-label="Amount" />
        <button onclick={() => run("damage")} title="Damage (Temporary Hit Points first; at 0 it disappears)"
            ><Icon name="hpDamage" kind="meta" label="Damage" native={false} /> Damage</button>
        <button onclick={() => run("heal")} title="Heal"><Icon name="hpHeal" kind="meta" label="Heal" native={false} /> Heal</button>
        <button onclick={() => run("temp")} title="Temporary Hit Points (they don't stack)"
            ><Icon name="hpTemp" kind="meta" label="Temp HP" native={false} /> Temp</button>
    </div>
    {/if}

    {#if s.token}
        {#if note}<p class="note">{note}</p>{/if}
    {:else if monster}
        <div class="abilities">
            {#each ABILITY_KEYS as k (k)}
                {@const v = d.abilities?.[k] ?? 10}
                <div class="ab"><span class="lbl">{ABILITIES[k].short}</span><b>{formatModifier(modifier(v))}</b><small>{v}</small></div>
            {/each}
        </div>

        {#if attacks.length}
            <ul class="atks">
                {#each attacks as a (a.name)}
                    <li>
                        <b>{a.name}</b>
                        <span class="hit">{formatModifier(a.attack.bonus ?? 0)}</span>
                        {#each a.damage ?? [] as dm}
                            <span class="dmg">{dm.dice}
                                <IconLabel name={dm.type} kind="dmg" label={damageName(dm.type)} text={damageName(dm.type)} /></span>
                        {/each}
                        <small>{a.attack.kind === "ranged" ? `range ${a.attack.range ?? "—"} ft.` : `reach ${a.attack.reach ?? 5} ft.`}</small>
                    </li>
                {/each}
            </ul>
        {/if}
        {#if other.length}
            <p class="other">{#each other as a, i (a.name)}{i ? " · " : ""}<b>{a.name}.</b> {a.desc}{/each}</p>
        {/if}
        {#if note}<p class="note">{note}</p>{/if}

        <button class="toggle" onclick={() => (full = !full)}>{full ? "Hide" : "Show"} the full stat block</button>
        {#if full}<div class="block"><MonsterStatBlock {monster} /></div>{/if}
    {:else}
        <p class="note">Loading the stat block…</p>
    {/if}
</article>

<style>
    .summon {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        background: var(--color-card-elevated);
        border: 1px solid color-mix(in srgb, var(--color-act-action) 45%, var(--color-border));
        border-radius: 10px;
    }

    header {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .face {
        flex: none;
        width: 40px;
        height: 40px;
        border: 2px dashed var(--color-act-action);
        border-radius: 50%;
        object-fit: cover;
        background: var(--color-card);
    }

    .face.ph {
        display: grid;
        place-items: center;
        font-size: 20px;
        color: var(--color-text-secondary);
    }

    .title {
        flex: 1;
        min-width: 0;
    }

    h3 {
        margin: 0;
        font-family: var(--font-heading);
        font-size: 16px;
        color: var(--color-text-primary);
    }

    .sub {
        margin: 2px 0 0;
        color: var(--color-text-muted);
        font-size: 12px;
    }

    .dismiss,
    .toggle,
    .hp-row button {
        padding: 4px 10px;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: 12px;
        cursor: pointer;
    }

    .dismiss:hover,
    .toggle:hover,
    .hp-row button:hover {
        border-color: var(--color-gold);
        color: var(--color-gold);
    }

    .stats {
        display: grid;
        grid-template-columns: auto minmax(110px, auto) 1fr;
        gap: 6px;
    }

    .stat,
    .ab {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1px;
        padding: 5px 9px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 8px;
    }

    .stat.wide {
        align-items: flex-start;
    }

    .lbl {
        color: var(--color-text-muted);
        font-size: 10px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
    }

    .stat b,
    .ab b {
        color: var(--color-text-primary);
        font-size: 17px;
    }

    .stat b small {
        color: var(--color-text-muted);
        font-size: 12px;
    }

    .stat b small.temp {
        color: var(--color-gold);
    }

    .stat b.sp {
        font-size: 13px;
        font-weight: 600;
    }

    .bar {
        width: 100%;
        height: 4px;
        background: var(--color-border);
        border-radius: 2px;
        overflow: hidden;
    }

    .bar span {
        display: block;
        height: 100%;
        background: var(--color-success);
    }

    .bar span.low {
        background: var(--color-danger);
    }

    .hp-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
    }

    .hp-row input {
        width: 56px;
        padding: 4px 6px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-primary);
    }

    .hp-row button {
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }

    .abilities {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 4px;
    }

    .ab small {
        color: var(--color-text-muted);
        font-size: 10px;
    }

    .atks {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .atks li {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
    }

    .atks b {
        color: var(--color-text-primary);
    }

    .hit {
        color: var(--color-gold);
        font-weight: 600;
    }

    .dmg {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        color: var(--color-text-primary);
    }

    .atks small {
        color: var(--color-text-muted);
    }

    .other,
    .note {
        margin: 0;
        color: var(--color-text-muted);
        font-size: 12px;
        line-height: 1.4;
    }

    .other b {
        color: var(--color-text-secondary);
    }

    .toggle {
        align-self: flex-start;
    }
</style>
