<script>
    /**
     * Level screen: what the level grants and what must be chosen at it.
     * Used in the builder (any level when editing) and when leveling up.
     *
     * build    — CharacterBuild (choices are written to build.choices)
     * level    — which level to show
     * refs     — reference data (data/refs.js)
     * complete — (bindable) whether all choices are made
     */
    import { levelPlan, evaluatePlan } from "../rules/progression.js";
    import { formatModifier } from "../rules/abilities.js";
    import ActionCard from "./common/ActionCard.svelte";
    import ChoiceCard from "./builder/common/ChoiceCard.svelte";

    // these choices are shown as cards with a description; skills as compact chips
    const CARD_KINDS = new Set([
        "cantrips", "spells", "feat", "fightingStyle", "metamagic", "invocations", "option", "subclass", "pool", "invocationForget",
    ]);

    let { build, level, refs, complete = $bindable(false) } = $props();

    const plan = $derived(levelPlan(build, level, refs));
    // visible / valid / count / need / done for each choice
    const ev = $derived(evaluatePlan(plan, build, refs));

    // remove invalid values from build so they don't take up slots
    $effect(() => {
        for (const c of ev.choices) {
            if (c.kind === "asi" || c.kind === "subclass" || !c.value?.ids) continue;
            if (c.valid.length !== c.value.ids.length) {
                if (c.kind === "invocations")
                    for (const old of c.value.ids) if (!c.valid.includes(old)) build.dropInvocationFollowUps(old, c.key);
                build.setChoice(c.key, c.valid.length ? { kind: c.kind, ids: [...c.valid] } : null);
            }
        }
    });

    $effect(() => {
        complete = ev.complete;
    });

    // --- tabs: "gains" (what the level grants) + one per choice group ---
    // a group = a choice + the choices that depend on it (feat → its "<key>:asi", "<key>:skills"…)
    const groups = $derived.by(() => {
        const roots = ev.choices.filter((c) => !ev.choices.some((p) => p !== c && c.key.startsWith(p.key + ":")));
        return roots.map((root) => {
            const items = [root, ...ev.choices.filter((c) => c.key.startsWith(root.key + ":"))];
            return {
                key: root.key,
                root,
                items,
                done: items.every((c) => c.done),
                optional: root.optional,
            };
        });
    });

    let tab = $state("gains");
    // the tab disappeared — back to the overview
    const current = $derived(groups.find((g) => g.key === tab) ?? null);
    $effect(() => {
        if (tab !== "gains" && !current) tab = "gains";
    });
    // another level shown — start from the overview
    $effect(() => {
        level;
        tab = "gains";
    });

    const order = $derived(["gains", ...groups.map((g) => g.key)]);
    const nextTab = $derived(order[order.indexOf(tab) + 1] ?? null);
    const nextTitle = $derived(groups.find((g) => g.key === nextTab)?.root.title ?? "");

    // wild shape forms: grouped by CR (ascending), names alphabetical inside a group
    function crGroups(opts) {
        const map = new Map();
        const sorted = [...opts].sort((a, b) => (a.cr ?? 0) - (b.cr ?? 0) || a.name.localeCompare(b.name));
        for (const o of sorted) {
            const label = o.crLabel ?? o.meta ?? "";
            if (!map.has(label)) map.set(label, []);
            map.get(label).push(o);
        }
        return [...map].map(([label, items]) => ({ label, items }));
    }

    // a single-pick feat that is already chosen: show only it (with × to undo)
    const collapses = (c) => (c.kind === "feat" || c.kind === "subclass") && c.pick === 1 && c.valid.length > 0;

    // subclass features, by level
    const subFeatures = (ref) =>
        [...(ref?.data?.features ?? [])].sort((a, b) => (a.level ?? 1) - (b.level ?? 1));

    // --- changing a choice ---
    function toggle(choice, id) {
        const ids = [...choice.valid];
        const i = ids.indexOf(id);
        if (i >= 0) ids.splice(i, 1);
        else if (choice.pick === 1) ids.splice(0, ids.length, id);
        else if (ids.length < choice.pick) ids.push(id);
        else return;

        if (choice.kind === "subclass") build.setSubclassFor(choice.classId, ids[0] ?? null);
        build.setChoice(choice.key, ids.length ? { kind: choice.kind, ids } : null);

        // an invocation unticked — what it brought goes too (Lessons of the First Ones: its Origin feat)
        if (choice.kind === "invocations") {
            for (const old of choice.valid) if (!ids.includes(old)) build.dropInvocationFollowUps(old, choice.key);
        }
        // an invocation forgotten (replaced on a level-up) — its picks from the level it was learned on
        if (choice.kind === "invocationForget") {
            for (const id of ids) if (!choice.valid.includes(id)) build.dropInvocationFollowUps(id);
        }

        // invocation replacement cancelled — remove the replacement pick too (and what it brought)
        if (choice.kind === "invocationForget" && !ids.length) {
            const swapKey = choice.key.replace(/Forget$/, "Swap");
            for (const old of build.choices[swapKey]?.ids ?? []) build.dropInvocationFollowUps(old, swapKey);
            build.setChoice(swapKey, null);
        }

        // feat changed — reset the choices that depend on it (…:asi, …:skills)
        if (choice.kind === "feat") {
            for (const k of Object.keys(build.choices)) {
                if (k.startsWith(choice.key + ":")) build.setChoice(k, null);
            }
        }
    }

    function bumpAsi(choice, ability, delta) {
        const asi = { ...(choice.value?.asi ?? {}) };
        const used = Object.values(asi).reduce((s, v) => s + v, 0);
        const max = choice.pick * choice.amount;
        const next = (asi[ability] ?? 0) + delta * choice.amount;
        if (next < 0) return;
        if (delta > 0 && used + choice.amount > max) return;
        if (!choice.repeatable && delta > 0 && (asi[ability] ?? 0) > 0) return;
        if (next === 0) delete asi[ability];
        else asi[ability] = next;
        build.setChoice(choice.key, Object.keys(asi).length ? { kind: "asi", asi } : null);
    }
</script>

<div class="level">
    <!-- level summary -->
    <section class="summary">
        <div class="big">
            <span class="lbl">Level</span>
            <span class="val">{level}</span>
            {#if plan.classId && plan.classLevel !== level}
                <small>{refs.classes?.find((c) => c.id === plan.classId)?.name ?? plan.classId} {plan.classLevel}</small>
            {/if}
        </div>
        <div class="stat">
            <span class="lbl">Hit Points</span>
            <span class="val">+{plan.hp.gain}</span>
            <small>{plan.hp.formula}</small>
        </div>
        <div class="stat" class:dim={!plan.profChanged}>
            <span class="lbl">Proficiency</span>
            <span class="val">{formatModifier(plan.prof)}</span>
            <small>{plan.profChanged ? (level === 1 ? "starting" : "increased") : "no change"}</small>
        </div>
        {#if plan.slots.length}
            <div class="stat" class:dim={!plan.slotsChanged}>
                <span class="lbl">Spell Slots</span>
                <span class="val slots">
                    {#each plan.slots as s}<span>{s.level}<sup>{s.pact ? "pact" : "lvl"}</sup>×{s.max}</span>{/each}
                </span>
                <small>{plan.slotsChanged ? "updated" : "no change"}</small>
            </div>
        {/if}
    </section>

    <!-- tabs -->
    <div class="tabs" role="tablist">
        <button role="tab" class:on={tab === "gains"} aria-selected={tab === "gains"} onclick={() => (tab = "gains")}>
            What this level grants
        </button>
        {#each groups as g (g.key)}
            <button role="tab" class:on={tab === g.key} aria-selected={tab === g.key} onclick={() => (tab = g.key)}>
                <span class="dot" class:done={g.done} class:opt={g.optional && !g.done}></span>
                {g.root.title}
                <span class="t-count">{g.root.count}/{g.root.pick}</span>
            </button>
        {/each}
    </div>

    {#if tab === "gains"}
        <!-- what the level grants -->
        <section class="gains">
            {#each plan.gains as g}
                <div class="gain-group">
                    <h4>{g.title}</h4>
                    <ul>
                        {#each g.items as it}
                            {@const desc = it.desc || it.ref?.desc || it.ref?.data?.desc || ""}
                            <li>
                                <b>{it.ref?.name ?? it.name}{#if it.tag}<small class="tag">{it.tag}</small>{/if}</b>
                                {#if desc}<span>{desc}</span>{/if}
                            </li>
                        {/each}
                    </ul>
                </div>
            {:else}
                <p class="muted">No new features at this level.</p>
            {/each}
            {#if groups.length}
                <div class="todo">
                    <h4>Choices at this level</h4>
                    <ul>
                        {#each groups as g (g.key)}
                            <li>
                                <button class="todo-row" onclick={() => (tab = g.key)}>
                                    <span class="dot" class:done={g.done} class:opt={g.optional && !g.done}></span>
                                    <span>{g.root.title}</span>
                                    <span class="t-count">{g.optional ? "optional · " : ""}{g.root.count}/{g.root.pick}</span>
                                </button>
                            </li>
                        {/each}
                    </ul>
                </div>
            {:else}
                <p class="muted">Nothing to choose at this level.</p>
            {/if}
        </section>
    {:else if current}
        <!-- one choice group: the choice and what it requires -->
        <section class="choices">
            {#each current.items as c (c.key)}
                {@render choiceBlock(c)}
            {/each}
        </section>
    {/if}

    {#if nextTab}
        <div class="next">
            <button onclick={() => (tab = nextTab)}>Next: {nextTitle} →</button>
        </div>
    {/if}
</div>

{#snippet choiceBlock(c)}
    {@const opts = collapses(c) ? c.visible.filter((o) => c.valid.includes(o.id)) : c.visible}
    {@const sel = new Set(c.valid)}
    <div class="choice" class:done={c.done}>
        <div class="c-head">
            <b>{c.title}</b>
            <span class="count">{#if c.optional}optional · {/if}{c.count} / {c.pick}</span>
        </div>
        {#if c.desc}<p class="c-desc">{c.desc}</p>{/if}

        {#if c.kind === "asi"}
            <div class="asi">
                {#each c.options as o}
                    {@const v = c.value?.asi?.[o.id] ?? 0}
                    <div class="asi-row" class:on={v}>
                        <span>{o.name}</span>
                        <span class="asi-ctl">
                            <button onclick={() => bumpAsi(c, o.id, -1)} disabled={!v}>−</button>
                            <b>+{v}</b>
                            <button onclick={() => bumpAsi(c, o.id, +1)}>+</button>
                        </span>
                    </div>
                {/each}
            </div>
        {:else if c.kind === "subclass" && collapses(c)}
            <!-- chosen subclass: picture + what it grants; × — choose again -->
            {#each opts as o (o.id)}
                {@const desc = o.ref?.desc ?? o.ref?.data?.desc ?? o.desc}
                <div class="sub-picked">
                    <ChoiceCard item={o.ref ?? o} badge="Subclass" sub onclear={() => toggle(c, o.id)}>
                        {#if desc}<p class="sub-desc">{desc}</p>{/if}
                        <ul class="sub-feats">
                            {#each subFeatures(o.ref) as f}
                                <li class:now={(f.level ?? 1) === plan.classLevel} class:later={(f.level ?? 1) > plan.classLevel}>
                                    <span class="f-lvl">Level {f.level ?? 1}</span>
                                    <b>{f.name}</b>
                                    {#if f.desc}<span class="f-desc">{f.desc}</span>{/if}
                                </li>
                            {:else}
                                <li class="muted">No features listed.</li>
                            {/each}
                        </ul>
                    </ChoiceCard>
                </div>
            {/each}
        {:else if collapses(c)}
            <div class="picked-cards">
                {#each opts as o (o.id)}
                    <div class="picked-card">
                        <ActionCard item={o.ref ?? { name: o.name, desc: o.desc }} {level} source={o.meta ?? ""} />
                        <button class="clear" onclick={() => toggle(c, o.id)} title="Clear selection" aria-label="Clear selection">×</button>
                    </div>
                {/each}
            </div>
        {:else if c.kind === "wildShapeForms"}
            <!-- beasts grouped by CR: picture, name, AC / HP / speed -->
            {#each crGroups(opts) as grp (grp.label)}
                <div class="cr-group">
                    <h5>{grp.label}</h5>
                    <div class="beasts">
                        {#each grp.items as o (o.id)}
                            {@const on = sel.has(o.id)}
                            <button
                                class="beast"
                                class:on
                                class:full={!on && c.valid.length >= c.pick}
                                onclick={() => toggle(c, o.id)}
                                aria-pressed={on}
                            >
                                <span class="b-img">{#if o.image}<img src={o.image} alt="" loading="lazy" />{/if}</span>
                                <span class="b-body">
                                    <b>{o.name}{#if o.circle}<small class="tag">Circle</small>{/if}</b>
                                    {#if o.stats}
                                        <small>AC {o.stats.ac} · HP {o.stats.hp} · {o.stats.speed}</small>
                                    {:else if o.desc}
                                        <small>{o.desc}</small>
                                    {/if}
                                </span>
                            </button>
                        {/each}
                    </div>
                </div>
            {:else}
                <p class="muted">No options available.</p>
            {/each}
        {:else if CARD_KINDS.has(c.kind)}
            <div class="option-cards">
                {#each opts as o (o.id)}
                    <ActionCard
                        item={o.ref ?? { name: o.name, desc: o.desc }}
                        {level}
                        source={o.meta ?? ""}
                        image={c.kind === "subclass" ? (o.ref?.image ?? "") : undefined}
                        selectable
                        selected={sel.has(o.id)}
                        onclick={() => toggle(c, o.id)}
                    />
                {:else}
                    <p class="muted">No options available.</p>
                {/each}
            </div>
        {:else}
            <div class="chips">
                {#each opts as o (o.id)}
                    <button class="chip" class:on={sel.has(o.id)} onclick={() => toggle(c, o.id)} title={o.desc}>
                        {o.name}
                        {#if o.meta}<small>{o.meta}</small>{/if}
                    </button>
                {:else}
                    <p class="muted">No options available.</p>
                {/each}
            </div>
        {/if}
    </div>
{/snippet}

<style>
    .level {
        display: flex;
        flex-direction: column;
        gap: 20px;
    }

    /* --- summary --- */
    .summary {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
    }

    .big,
    .stat {
        padding: 10px 16px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-border);
        border-radius: 8px;
    }

    .big {
        border-color: var(--color-gold);
    }

    .stat.dim {
        opacity: 0.6;
    }

    .lbl {
        font-family: var(--font-ui);
        font-size: 10px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-text-muted);
    }

    .val {
        font-family: var(--font-heading);
        font-size: 26px;
        color: var(--color-text-primary);
    }

    .big .val {
        color: var(--color-gold);
    }

    .val.slots {
        display: flex;
        gap: 8px;
        font-size: 16px;
    }

    .val.slots sup {
        font-size: 9px;
        color: var(--color-text-muted);
    }

    .big small {
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .stat small {
        font-family: var(--font-ui);
        font-size: 11px;
        color: var(--color-text-muted);
    }

    /* --- tabs --- */
    .tabs {
        display: flex;
        gap: 4px;
        overflow-x: auto;
        scrollbar-width: none;
        border-bottom: 1px solid var(--color-border);
    }

    .tabs::-webkit-scrollbar {
        display: none;
    }

    .tabs button {
        flex: none;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        background: transparent;
        border: 0;
        border-bottom: 2px solid transparent;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: 14px;
        cursor: pointer;
    }

    .tabs button:hover {
        color: var(--color-text-primary);
    }

    .tabs button.on {
        color: var(--color-text-primary);
        border-bottom-color: var(--color-gold);
    }

    .dot {
        flex: none;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--color-danger);
    }

    .dot.opt {
        background: var(--color-text-muted);
    }

    .dot.done {
        background: var(--color-success);
    }

    .t-count {
        font-size: 12px;
        color: var(--color-text-muted);
    }

    /* overview: list of choices to make */
    .todo {
        padding-top: 12px;
        border-top: 1px solid var(--color-border);
    }

    .todo ul {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .todo-row {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: 14px;
        text-align: left;
        cursor: pointer;
    }

    .todo-row:hover {
        border-color: var(--color-gold);
    }

    .todo-row .t-count {
        margin-left: auto;
    }

    .next {
        display: flex;
        justify-content: flex-end;
    }

    .next button {
        padding: 8px 16px;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-gold);
        border-radius: 6px;
        color: var(--color-gold);
        font-family: var(--font-ui);
        font-size: 14px;
        cursor: pointer;
    }

    .next button:hover {
        background: var(--color-gold);
        color: var(--color-bg);
    }

    @media (max-width: 640px) {
        .tabs button {
            padding: 10px;
            font-size: 13px;
        }
    }

    h4 {
        margin: 0 0 6px;
        font-family: var(--font-heading-alt);
        font-size: 16px;
        color: var(--color-text-accent);
    }

    .gains,
    .choices {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .gain-group ul,
    .picked {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .gain-group li {
        display: flex;
        flex-direction: column;
    }

    .gain-group b {
        font-family: var(--font-ui);
        font-size: 13px;
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
    }

    .gain-group span,
    .picked li {
        font-family: var(--font-spell);
        font-size: 15px;
        color: var(--color-text-secondary);
    }

    .tag {
        margin-left: 6px;
        padding: 0 6px;
        border: 1px solid var(--color-border);
        border-radius: 999px;
        font-family: var(--font-ui);
        font-size: 10px;
        font-weight: var(--font-weight-regular);
        color: var(--color-text-muted);
    }

    /* --- choices --- */
    .choice {
        padding: 12px 14px;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-danger);
        border-radius: 8px;
    }

    .choice.done {
        border-color: var(--color-success);
    }

    .c-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        font-family: var(--font-ui);
        font-size: 14px;
        color: var(--color-text-primary);
    }

    .count {
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .c-desc {
        margin: 4px 0 0;
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .chips {
        margin-top: 10px;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }

    .chip {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        padding: 5px 10px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: 13px;
        text-align: left;
        cursor: pointer;
    }

    .chip small {
        font-size: 10px;
        color: var(--color-text-muted);
    }

    .chip:hover {
        border-color: var(--color-gold);
        color: var(--color-text-primary);
    }

    .chip.on {
        background: var(--color-magic-purple-dark);
        border-color: var(--color-magic-purple);
        color: var(--color-text-primary);
    }

    /* --- chosen subclass --- */
    .sub-picked {
        margin-top: 10px;
    }

    .sub-desc {
        margin: 0 0 10px;
        font-family: var(--font-spell);
        font-size: 15px;
        color: var(--color-text-secondary);
    }

    .sub-feats {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .sub-feats li {
        display: grid;
        grid-template-columns: 64px 1fr;
        column-gap: 10px;
        padding-left: 10px;
        border-left: 2px solid var(--color-border);
    }

    .sub-feats li.now {
        border-left-color: var(--color-magic-purple);
    }

    .sub-feats li.later {
        opacity: 0.55;
    }

    .f-lvl {
        grid-row: span 2;
        padding-top: 2px;
        font-family: var(--font-ui);
        font-size: 10px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-text-muted);
    }

    .sub-feats b {
        font-family: var(--font-ui);
        font-size: 14px;
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
    }

    .f-desc {
        font-family: var(--font-spell);
        font-size: 14px;
        line-height: 1.35;
        color: var(--color-text-secondary);
    }

    /* --- wild shape forms --- */
    .cr-group {
        margin-top: 12px;
    }

    h5 {
        margin: 0 0 6px;
        font-family: var(--font-ui);
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-text-muted);
    }

    .beasts {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
        gap: 6px;
    }

    .beast {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px;
        min-width: 0;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        text-align: left;
        cursor: pointer;
    }

    .beast:hover {
        border-color: var(--color-gold);
    }

    .beast.on {
        background: var(--color-magic-purple-dark);
        border-color: var(--color-magic-purple);
    }

    .beast.full {
        opacity: 0.5;
    }

    .b-img {
        flex: none;
        width: 44px;
        height: 44px;
        border-radius: 6px;
        overflow: hidden;
        background: var(--color-card);
    }

    .b-img img {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: cover;
    }

    .b-body {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .b-body b {
        font-size: 13px;
        font-weight: var(--font-weight-semibold);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .b-body small {
        font-size: 11px;
        color: var(--color-text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .picked-cards {
        margin-top: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .picked-card {
        position: relative;
    }

    .picked-card :global(.card) {
        padding-right: 48px;
        border-color: var(--color-magic-purple);
        background: var(--color-magic-purple-dark);
    }

    .clear {
        position: absolute;
        top: 8px;
        right: 8px;
        width: 28px;
        height: 28px;
        padding: 0;
        display: grid;
        place-items: center;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 50%;
        color: var(--color-text-secondary);
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
    }

    .clear:hover {
        border-color: var(--color-danger);
        color: var(--color-danger);
    }

    .option-cards {
        margin-top: 10px;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 8px;
    }

    .picked {
        margin-top: 10px;
    }

    .picked b {
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-primary);
    }

    .asi {
        margin-top: 10px;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 6px 14px;
    }

    .asi-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .asi-row.on {
        color: var(--color-text-primary);
    }

    .asi-ctl {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .asi-ctl b {
        min-width: 22px;
        text-align: center;
        color: var(--color-gold);
    }

    .asi-ctl button {
        width: 24px;
        height: 24px;
        padding: 0;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 4px;
        color: var(--color-text-primary);
        cursor: pointer;
    }

    .asi-ctl button:disabled {
        opacity: 0.35;
        cursor: default;
    }

    .muted {
        margin: 0;
        color: var(--color-text-muted);
    }
</style>
