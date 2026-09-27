<script>
    /**
     * Compact character card: icon, name, class/subclass, species/subspecies, status
     * (HP condition, Temp HP, conditions, Inspiration, Death Saves), then two tabs:
     *   Stats — AC/Init/Speed/Prof, abilities, Saving Throws, Skills (+ Passive Perception, Darkvision);
     *   Bio   — Appearance, Personality.
     *
     * Read-only. Give it either
     *   id                — a character in the local DB, or
     *   build (+ state)   — raw build / state objects, e.g. a snapshot a player sent to the DM.
     * `state` may be a plain object or a CharacterState; updating it updates the card.
     * fallback — { className, level } shown if the build can't be computed (e.g. a lobby row);
     * note — the line under it.
     */
    import { GetCharacter, GetCharacterState } from "../api.js";
    import { loadRefs, EMPTY_REFS } from "../data/refs.js";
    import { Character } from "../models/Character.js";
    import { CharacterBuild, BIO_GROUPS } from "../models/CharacterBuild.svelte.js";
    import { CharacterState } from "../models/CharacterState.svelte.js";
    import { ABILITIES, ABILITY_KEYS, formatModifier } from "../rules/abilities.js";

    let { id = null, build: buildData = null, state: stateData = null, fallback = null, note = "Character sheet unavailable" } = $props();

    let ref = $state(EMPTY_REFS);
    let loaded = $state(null); // { build, state } from the DB when `id` is given
    let error = $state(null);
    let brokenImg = $state(false);
    let tab = $state("stats"); // 'stats' | 'bio'

    const TABS = [
        { id: "stats", label: "Stats" },
        { id: "bio", label: "Bio" },
    ];

    $effect(() => {
        loadRefs().then((r) => (ref = r)).catch((e) => (error = e?.message ?? String(e)));
    });

    $effect(() => {
        if (!id) return;
        let cancelled = false;
        Promise.all([GetCharacter(id), GetCharacterState(id)])
            .then(([b, s]) => !cancelled && (loaded = { build: b, state: s }))
            .catch((e) => !cancelled && (error = e?.message ?? String(e)));
        return () => (cancelled = true);
    });

    const build = $derived.by(() => {
        const raw = id ? loaded?.build : buildData;
        return raw ? CharacterBuild.fromJSON(raw) : null;
    });
    const state = $derived.by(() => {
        const raw = id ? loaded?.state : stateData;
        return raw instanceof CharacterState ? raw : CharacterState.fromJSON(raw ?? {});
    });
    // a snapshot from another app version (or a test tool) may not compute — show what we can
    const calc = $derived.by(() => {
        if (!build || ref === EMPTY_REFS) return { ch: null, err: null };
        if (!build.classId) return { ch: null, err: "no class" };
        try {
            return { ch: new Character(build, ref, state.equipped ?? null), err: null };
        } catch (e) {
            console.warn("[brief]", e);
            return { ch: null, err: e?.message ?? String(e) };
        }
    });
    const ch = $derived(calc.ch);

    // icon: portrait → subspecies/species image → first letter
    const icon = $derived(
        brokenImg ? "" : build?.portrait || ch?.subrace?.image || ch?.race?.image || "",
    );

    const hp = $derived(ch ? state.currentHp(ch) : 0);
    const maxHp = $derived(ch?.maxHp ?? 0);
    const hpPct = $derived(maxHp ? Math.round((hp / maxHp) * 100) : 0);

    // HP condition, like a DM would say it
    const health = $derived.by(() => {
        if (!ch) return null;
        if (hp <= 0) {
            const ds = state.deathSaves ?? {};
            if (ds.fail >= 3) return { key: "dead", label: "Dead" };
            if (ds.success >= 3) return { key: "down", label: "Stable" };
            return { key: "down", label: "Dying" };
        }
        if (hpPct >= 100) return { key: "ok", label: "Healthy" };
        if (hpPct > 50) return { key: "hurt", label: "Wounded" };
        if (hpPct > 25) return { key: "bloodied", label: "Bloodied" };
        return { key: "critical", label: "Critical" };
    });

    const cap = (s) => String(s).replace(/(^|[\s_-])\w/g, (m) => m.toUpperCase()).replace(/[_-]/g, " ");
</script>

<article class="brief">
    {#if error}
        <p class="error">Failed to load: {error}</p>
    {:else if build && calc.err}
        <header>
            <div class="icon"><span>{build.name?.[0] ?? "?"}</span></div>
            <div class="who">
                <h3>{build.name ?? "Unknown"}</h3>
                {#if fallback}
                    <p class="class-line">
                        {fallback.className || "—"}
                        {#if fallback.level}<span class="lvl">Level {fallback.level}</span>{/if}
                    </p>
                {/if}
                <p class="sub-line">{note}</p>
            </div>
        </header>
    {:else if !build || !ch}
        <p class="muted">Loading…</p>
    {:else}
        <header>
            <div class="icon">
                {#if icon}
                    <img src={icon} alt="" onerror={() => (brokenImg = true)} />
                {:else}
                    <span>{build.name?.[0] ?? "?"}</span>
                {/if}
            </div>
            <div class="who">
                <h3>{build.name}</h3>
                <p class="class-line">
                    {ch.cls?.name ?? build.classId}{ch.subclass ? ` · ${ch.subclass.name}` : ""}
                    <span class="lvl">Level {build.level}</span>
                </p>
                <p class="sub-line">
                    {ch.race?.name ?? build.raceId}{ch.subrace ? ` · ${ch.subrace.name}` : ""}
                </p>
            </div>
        </header>

        <!-- status -->
        <section class="status {health.key}">
            <div class="hp-row">
                <span class="hp-label">{health.label}</span>
                <span class="hp-num">
                    {hp}<small>/{maxHp}</small>
                    {#if state.tempHp > 0}<span class="temp">+{state.tempHp} temp</span>{/if}
                </span>
            </div>
            <div class="bar" role="meter" aria-valuenow={hp} aria-valuemin="0" aria-valuemax={maxHp} aria-label="Hit Points">
                <span class="fill" style:width="{hpPct}%"></span>
            </div>
            {#if hp <= 0 && health.key !== "dead"}
                <div class="death">
                    Death saves
                    <span class="ds ok">{"●".repeat(state.deathSaves?.success ?? 0)}{"○".repeat(3 - (state.deathSaves?.success ?? 0))}</span>
                    <span class="ds bad">{"●".repeat(state.deathSaves?.fail ?? 0)}{"○".repeat(3 - (state.deathSaves?.fail ?? 0))}</span>
                </div>
            {/if}
            {#if state.conditions?.length || state.inspiration}
                <ul class="chips">
                    {#if state.inspiration}<li class="insp">Inspiration</li>{/if}
                    {#each state.conditions as c (c)}<li>{cap(c)}</li>{/each}
                </ul>
            {/if}
        </section>

        <!-- tabs -->
        <div class="tabs" role="tablist">
            {#each TABS as t (t.id)}
                <button
                    role="tab"
                    aria-selected={tab === t.id}
                    class:active={tab === t.id}
                    onclick={() => (tab = t.id)}>{t.label}</button
                >
            {/each}
        </div>

        {#if tab === "stats"}
            <!-- main stats -->
            <section class="combat">
                <div class="stat ac"><span class="k">AC</span><span class="v">{ch.ac}</span></div>
                <div class="stat"><span class="k">Init</span><span class="v">{formatModifier(ch.initiative)}</span></div>
                <div class="stat"><span class="k">Speed</span><span class="v">{ch.speed}<small> ft</small></span></div>
                <div class="stat"><span class="k">Prof</span><span class="v">{formatModifier(ch.prof)}</span></div>
            </section>

            <section class="abilities">
                {#each ABILITY_KEYS as k}
                    <div class="ability" title={ABILITIES[k].name}>
                        <span class="k">{ABILITIES[k].short}</span>
                        <span class="v">{formatModifier(ch.mods[k])}</span>
                        <span class="score">{build.totalAbilities[k] ?? "—"}</span>
                    </div>
                {/each}
            </section>

            <section class="block" role="tabpanel">
                <h4>Saving Throws</h4>
                <ul class="checklist">
                    {#each ch.saves as sv (sv.key)}
                        <li class:prof={sv.proficient}>
                            <span class="dot"></span>
                            <span class="val">{formatModifier(sv.value)}</span>
                            <span>{ABILITIES[sv.key].name}</span>
                        </li>
                    {/each}
                </ul>
            </section>

            <section class="block" role="tabpanel">
                <h4>Skills</h4>
                <ul class="checklist">
                    {#each ch.skills as sk (sk.id)}
                        <li class:prof={sk.proficient} class:expert={sk.expertise}>
                            <span class="dot"></span>
                            <span class="val">{formatModifier(sk.value)}</span>
                            <span>{sk.name} <small>{ABILITIES[sk.ability].short}</small></span>
                        </li>
                    {/each}
                </ul>
                <p class="passive">
                    Passive Perception <b>{ch.passivePerception}</b>
                    {#if ch.darkvision}· Darkvision <b>{ch.darkvision} ft</b>{/if}
                </p>
            </section>
        {:else}
            {#each BIO_GROUPS as g (g.title)}
                {@const filled = g.fields.filter((f) => build.bio?.[f.key])}
                <section class="block" role="tabpanel">
                    <h4>{g.title}</h4>
                    {#if filled.length}
                        <dl class:wide={g.fields.some((f) => f.wide)}>
                            {#each filled as f (f.key)}
                                <dt>{f.label}</dt>
                                <dd>{build.bio[f.key]}</dd>
                            {/each}
                        </dl>
                    {:else}
                        <p class="empty">Nothing written yet.</p>
                    {/if}
                </section>
            {/each}
        {/if}
    {/if}
</article>

<style>
    .brief {
        box-sizing: border-box;
        width: 100%;
        max-width: 420px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 12px;
        font-family: var(--font-ui);
        color: var(--color-text-primary);
    }

    .muted {
        margin: 0;
        color: var(--color-text-muted);
    }
    .error {
        margin: 0;
        color: var(--color-danger);
    }

    /* ---------- identity ---------- */
    header {
        display: flex;
        align-items: center;
        gap: 14px;
        min-width: 0;
    }

    .icon {
        flex: none;
        width: 64px;
        height: 64px;
        border: 2px solid var(--color-gold);
        border-radius: 50%;
        overflow: hidden;
        display: grid;
        place-items: center;
        background: var(--color-card-elevated);
        font-family: var(--font-heading);
        font-size: 28px;
        color: var(--color-gold);
    }

    .icon img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .who {
        min-width: 0;
    }

    h3 {
        margin: 0;
        font-family: var(--font-heading);
        font-size: 22px;
        line-height: 1.15;
        color: var(--color-gold);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .class-line {
        margin: 2px 0 0;
        font-family: var(--font-heading-alt);
        font-size: 16px;
    }

    .lvl {
        margin-left: 4px;
        padding: 0 8px;
        border: 1px solid var(--color-magic-purple);
        border-radius: 999px;
        font-family: var(--font-ui);
        font-size: 11px;
        color: var(--color-text-secondary);
        vertical-align: middle;
    }

    .sub-line {
        margin: 2px 0 0;
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    /* ---------- status ---------- */
    .status {
        --hp-color: var(--color-success);
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .status.hurt {
        --hp-color: var(--color-gold);
    }
    .status.bloodied {
        --hp-color: var(--color-act-bonus);
    }
    .status.critical,
    .status.down,
    .status.dead {
        --hp-color: var(--color-danger);
    }

    .hp-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
    }

    .hp-label {
        font-size: 11px;
        font-weight: var(--font-weight-semibold);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--hp-color);
    }

    .hp-num {
        font-family: var(--font-heading);
        font-size: 20px;
    }
    .hp-num small {
        font-size: 12px;
        color: var(--color-text-muted);
    }
    .temp {
        margin-left: 6px;
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-meta-range);
    }

    .bar {
        height: 6px;
        background: var(--color-card-elevated);
        border-radius: 999px;
        overflow: hidden;
    }
    .fill {
        display: block;
        height: 100%;
        background: var(--hp-color);
        border-radius: inherit;
        transition: width 0.3s ease, background 0.3s;
    }

    .death {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 12px;
        color: var(--color-text-secondary);
    }
    .ds {
        letter-spacing: 2px;
    }
    .ds.ok {
        color: var(--color-success);
    }
    .ds.bad {
        color: var(--color-danger);
    }

    .chips {
        margin: 2px 0 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .chips li {
        padding: 2px 8px;
        border: 1px solid var(--color-danger);
        border-radius: 999px;
        font-size: 11px;
        color: var(--color-text-primary);
    }
    .chips li.insp {
        border-color: var(--color-gold);
        color: var(--color-gold);
    }

    /* ---------- stats ---------- */
    .combat {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 6px;
    }

    .stat,
    .ability {
        padding: 6px 4px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-border);
        border-radius: 8px;
    }

    .stat.ac {
        border-color: var(--color-gold);
        border-radius: 8px 8px 40% 40%;
    }

    .k {
        font-size: 9px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-text-muted);
    }

    .v {
        font-family: var(--font-heading);
        font-size: 18px;
        line-height: 1.1;
        white-space: nowrap;
    }
    .v small {
        font-family: var(--font-ui);
        font-size: 10px;
        color: var(--color-text-muted);
    }

    .abilities {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 6px;
    }

    .ability {
        border-color: color-mix(in srgb, var(--color-gold) 50%, var(--color-border));
    }

    /* ---------- tabs ---------- */
    .tabs {
        display: flex;
        gap: 4px;
        border-bottom: 1px solid var(--color-border);
    }

    .tabs button {
        margin-bottom: -1px;
        padding: 6px 14px;
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        font-family: var(--font-heading);
        font-size: 13px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-text-muted);
        cursor: pointer;
    }

    .tabs button:hover {
        color: var(--color-text-secondary);
    }

    .tabs button.active {
        border-bottom-color: var(--color-gold);
        color: var(--color-gold);
    }

    .block {
        padding: 10px 12px;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-border);
        border-radius: 8px;
    }

    h4 {
        margin: 0 0 8px;
        font-family: var(--font-heading);
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-gold);
    }

    /* list with a proficiency circle, as on the full sheet */
    .checklist {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 3px 12px;
    }

    .checklist li {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        font-size: 12px;
        color: var(--color-text-secondary);
        white-space: nowrap;
    }

    .checklist li > span:last-child {
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .checklist li.prof {
        color: var(--color-text-primary);
    }

    .checklist small {
        font-size: 10px;
        color: var(--color-text-muted);
    }

    .dot {
        flex: 0 0 8px;
        height: 8px;
        border: 1px solid var(--color-text-muted);
        border-radius: 50%;
    }

    .prof .dot {
        background: var(--color-gold);
        border-color: var(--color-gold);
    }

    /* expertise: filled circle with a ring */
    .expert .dot {
        box-shadow: 0 0 0 2px var(--color-card-elevated), 0 0 0 3px var(--color-gold);
    }

    .val {
        flex: 0 0 22px;
        font-weight: var(--font-weight-semibold);
        text-align: right;
        color: var(--color-text-primary);
    }

    .passive {
        margin: 8px 0 0;
        padding-top: 6px;
        border-top: 1px solid var(--color-border);
        font-size: 11px;
        color: var(--color-text-secondary);
    }

    .passive b {
        color: var(--color-text-primary);
    }

    /* bio */
    dl {
        margin: 0;
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 4px 12px;
        font-size: 12px;
    }

    dl.wide {
        grid-template-columns: 1fr;
        gap: 2px;
    }

    dl.wide dd {
        margin-bottom: 6px;
    }

    dt {
        color: var(--color-text-muted);
    }

    dl.wide dt {
        font-size: 10px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
    }

    dd {
        margin: 0;
        color: var(--color-text-primary);
        font-family: var(--font-lore);
        font-size: 14px;
        line-height: 1.3;
    }

    .empty {
        margin: 0;
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .score {
        font-size: 11px;
        font-weight: var(--font-weight-semibold);
        color: var(--color-gold);
    }
</style>
