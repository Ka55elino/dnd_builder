<script>
    /**
     * Wild Shape — the beast form card (variant B: the sheet stays the druid's, the beast's
     * numbers are here). From the bestiary monster + the druid (rules/wildshape.js):
     *   AC (Circle of the Moon: at least 13 + WIS), speeds, STR / DEX / CON of the beast,
     *   INT / WIS / CHA — the druid's, senses, traits and actions; the whole stat block on demand.
     * Hit Points aren't here: the druid keeps their own, the Temporary ones from the form take
     * the damage first (Status).
     *
     * monster — the bestiary's (GetMonsters), form — the link in short (name, cr…),
     * character, state (CharacterState); onRevert()
     */
    import MonsterStatBlock from "./bestiary/MonsterStatBlock.svelte";
    import { formStats, speedText, crText } from "../rules/wildshape.js";
    import { ABILITIES, ABILITY_KEYS, formatModifier } from "../rules/abilities.js";

    let { monster, form, character, state: cs, onRevert } = $props();

    let full = $state(false);
    const d = $derived(monster?.data ?? {});
    const st = $derived(
        formStats(monster, {
            mods: character?.mods ?? {},
            scores: character?.scores ?? character?.build?.totalAbilities ?? {},
            subclass: character?.subclass ?? null,
        }),
    );
    const senses = $derived(
        [
            ...Object.entries(d.senses ?? {})
                .filter(([, v]) => v)
                .map(([k, v]) => `${k[0].toUpperCase() + k.slice(1)} ${v} ft.`),
            `Passive Perception ${d.passivePerception ?? 10}`,
        ].join(" · "),
    );
    const hours = $derived(Math.max(1, Math.floor((character?.level ?? 2) / 2)));
    const sinceText = $derived.by(() => {
        const t = cs?.wildShape?.since;
        if (!t) return "";
        return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    });
    const items = (list) => (Array.isArray(list) ? list : []);
</script>

<section class="card beast">
    <header>
        {#if monster?.image}<img class="face" src={monster.image} alt="" />{/if}
        <div class="title">
            <h2>🐾 {monster?.name ?? form?.name ?? cs?.wildShape?.name}</h2>
            <p class="sub">
                {["Wild Shape", monster ? `CR ${crText(monster.cr)}` : "", monster?.size ?? "", `up to ${hours} h`, sinceText ? `since ${sinceText}` : ""]
                    .filter(Boolean)
                    .join(" · ")}
            </p>
        </div>
        <button class="revert" onclick={() => onRevert?.()} title="Return to your own shape (a Bonus Action)">Revert</button>
    </header>

    {#if !monster}
        <p class="muted">Loading the beast…</p>
    {:else}
        <div class="stats">
            <div class="stat" title={st.acFromCircle ? "Circle Forms: at least 13 + your Wisdom modifier" : "The beast's Armor Class"}>
                <span class="lbl">AC</span><b>{st.ac}</b>{#if st.acFromCircle}<small>Circle</small>{/if}
            </div>
            <div class="stat wide">
                <span class="lbl">Speed</span><b class="sp">{speedText(d.speed) || "—"}</b>
            </div>
            <div class="stat" title="Your own Hit Points; the Temporary ones from the form take damage first">
                <span class="lbl">Temp HP</span><b>{cs?.tempHp ?? 0}</b>
            </div>
        </div>

        <div class="abilities">
            {#each ABILITY_KEYS as k (k)}
                {@const a = st.abilities[k]}
                <div class="ab" class:own={!a.beast} title={a.beast ? "The beast's" : "Yours — it stays in beast form"}>
                    <span class="lbl">{ABILITIES[k].short}</span>
                    <b>{formatModifier(a.mod)}</b>
                    <small>{a.score}{a.beast ? "" : " · yours"}</small>
                </div>
            {/each}
        </div>
        <p class="hint">Saving throws and skills: use your bonus or the beast's, whichever is higher.</p>
        <p class="senses">{senses}</p>

        {#if items(d.traits).length}
            <h3>Traits</h3>
            <ul class="feats">
                {#each items(d.traits) as t (t.name)}
                    <li><b>{t.name}.</b> {t.desc}</li>
                {/each}
            </ul>
        {/if}
        {#if items(d.actions).length}
            <h3>Actions</h3>
            <ul class="feats">
                {#each items(d.actions) as a (a.name)}
                    <li>
                        <b>{a.name}.</b>
                        {#if a.attack}<span class="atk">{formatModifier(a.attack.bonus ?? 0)} to hit</span>{/if}
                        {a.desc}
                    </li>
                {/each}
            </ul>
        {/if}
        {#if items(d.bonusActions).length}
            <h3>Bonus Actions</h3>
            <ul class="feats">
                {#each items(d.bonusActions) as a (a.name)}<li><b>{a.name}.</b> {a.desc}</li>{/each}
            </ul>
        {/if}

        <p class="note">In beast form you can't cast spells (until level 18); Concentration isn't broken. The form ends at 0 Hit Points, when you are Incapacitated or use Wild Shape again.</p>

        <button class="toggle" onclick={() => (full = !full)}>{full ? "Hide" : "Show"} the full stat block</button>
        {#if full}
            <div class="block"><MonsterStatBlock {monster} /></div>
        {/if}
    {/if}
</section>

<style>
    .beast {
        display: flex;
        flex-direction: column;
        gap: 10px;
        border-color: color-mix(in srgb, var(--color-gold) 55%, var(--color-border));
    }

    header {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .face {
        width: 48px;
        height: 48px;
        border: 2px solid var(--color-gold);
        border-radius: 50%;
        object-fit: cover;
        background: var(--color-card-elevated);
    }

    .title {
        flex: 1;
        min-width: 0;
    }

    h2 {
        margin: 0;
        font-family: var(--font-heading);
        font-size: 18px;
        color: var(--color-text-primary);
    }

    .sub {
        margin: 2px 0 0;
        color: var(--color-text-muted);
        font-size: 12px;
        text-transform: none;
    }

    .revert {
        padding: 6px 12px;
        background: transparent;
        border: 1px solid var(--color-gold);
        border-radius: 6px;
        color: var(--color-gold);
        font-family: var(--font-ui);
        font-size: 13px;
        cursor: pointer;
    }

    .revert:hover {
        background: color-mix(in srgb, var(--color-gold) 14%, transparent);
    }

    .stats {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 8px;
    }

    .stat,
    .ab {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1px;
        padding: 6px 10px;
        background: var(--color-card-elevated);
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
        font-size: 18px;
    }

    .stat b.sp {
        font-size: 13px;
        font-weight: 600;
    }

    .stat small,
    .ab small {
        color: var(--color-text-muted);
        font-size: 10px;
    }

    .abilities {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 6px;
    }

    .ab.own {
        border-style: dashed;
        opacity: 0.85;
    }

    .hint,
    .senses,
    .note {
        margin: 0;
        color: var(--color-text-muted);
        font-size: 12px;
        line-height: 1.4;
    }

    .senses {
        color: var(--color-text-secondary);
    }

    h3 {
        margin: 4px 0 0;
        font-size: 11px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-text-accent);
    }

    .feats {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 13px;
        line-height: 1.45;
        color: var(--color-text-secondary);
    }

    .feats b {
        color: var(--color-text-primary);
    }

    .atk {
        margin-right: 4px;
        color: var(--color-gold);
        font-weight: 600;
    }

    .toggle {
        align-self: flex-start;
        padding: 4px 10px;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: 12px;
        cursor: pointer;
    }

    .toggle:hover {
        border-color: var(--color-gold);
        color: var(--color-gold);
    }
</style>
