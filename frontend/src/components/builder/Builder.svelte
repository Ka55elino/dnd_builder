<script>
    import { CharacterBuild } from "../../models/CharacterBuild.svelte.js";
    import BasicsTab from "./BasicsTab.svelte";
    import AbilitiesTab from "./AbilitiesTab.svelte";
    import RaceTab from "./RaceTab.svelte";
    import ClassTab from "./ClassTab.svelte";
    import EquipmentTab from "./EquipmentTab.svelte";
    import { onMount, untrack } from "svelte";
    import { SaveCharacter } from "../../api.js";
    import { validateBuild, BUILDER_TABS } from "../../rules/validation.js";
    import { loadRefs, EMPTY_REFS } from "../../data/refs.js";
    import LevelScreen from "../LevelScreen.svelte";
    import { levelPlan, evaluatePlan } from "../../rules/progression.js";

    /**
     * initial  — saved character data (for editing) or null
     * onExit() — back to the start screen
     * onSaved(id) — the character was saved
     */
    let {
        initial = null,
        onExit = () => console.log("[exit]"),
        onSaved = (id) => console.log("[saved]", id),
    } = $props();

    // initial is read once: when the character changes, App recreates the builder ({#key})
    let build = new CharacterBuild(untrack(() => initial) ?? {});

    // 5 tabs + the level 1 screen (summary and choices)
    const LEVEL_STEP = BUILDER_TABS.length;
    const steps = [...BUILDER_TABS, build.level > 1 ? "Levels" : "Summary · Lvl 1"];

    // levels: when editing a character, each one can be revisited and adjusted
    const levels = Array.from({ length: build.level }, (_, i) => i + 1);
    let levelTab = $state(untrack(() => build.level));
    let step = $state(0);

    // reference data: for validation (subspecies, armor) and the level screen
    let refs = $state(EMPTY_REFS);
    let refsError = $state(null);
    onMount(async () => {
        try {
            refs = await loadRefs();
        } catch (e) {
            refsError = e?.message ?? String(e);
        }
    });

    const errors = $derived(validateBuild(build, refs));
    const tabHasError = $derived(new Set(errors.map((e) => e.tab)));

    // errors are shown only after an attempt to go to the summary
    let attempted = $state(false);
    // whether choices are made on every level (not only the open one)
    const levelDone = $derived(
        Object.fromEntries(
            levels.map((l) => [l, evaluatePlan(levelPlan(build, l, refs), build, refs).complete]),
        ),
    );
    const levelComplete = $derived(levels.every((l) => levelDone[l]));
    let saving = $state(false);
    let saveError = $state(null);

    const onLevelStep = $derived(step === LEVEL_STEP);

    /** "Next": the next tab; from the last one — validation and the level screen. */
    function next() {
        if (step < LEVEL_STEP - 1) {
            step += 1;
            return;
        }
        attempted = true;
        if (errors.length) {
            step = errors[0].tab;
            return;
        }
        step = LEVEL_STEP;
    }

    function goTo(i) {
        if (i === LEVEL_STEP) return next(); // to the summary — only via validation
        step = i;
    }

    async function save() {
        saveError = null;
        if (errors.length) {
            attempted = true;
            step = errors[0].tab;
            return;
        }
        if (!levelComplete) return;
        saving = true;
        try {
            build.touch();
            const id = await SaveCharacter(JSON.stringify(build));
            onSaved(id);
        } catch (e) {
            saveError = e?.message ?? String(e);
        } finally {
            saving = false;
        }
    }
</script>

<div class="builder">
    <header class="top">
        <button class="back" onclick={onExit}>← Back</button>
        <h1>{initial ? "Edit character" : "Create character"}</h1>
        {#if onLevelStep}
            <button class="save" onclick={save} disabled={saving || !levelComplete}
                title={levelComplete ? "" : "Make all choices on every level"}>
                {saving ? "Saving…" : "Save"}
            </button>
        {:else}
            <button class="save" onclick={next}>Next →</button>
        {/if}
    </header>

    <nav class="steps">
        {#each steps as label, i}
            <button
                class="chip"
                class:active={i === step}
                class:invalid={attempted && tabHasError.has(i)}
                class:final={i === LEVEL_STEP}
                onclick={() => goTo(i)}
            >
                {i + 1} · {label}
            </button>
        {/each}
    </nav>

    {#if saveError}
        <div class="alert">Failed to save: {saveError}</div>
    {/if}

    {#if attempted && errors.length}
        <div class="alert">
            <b>Complete these to go to the summary:</b>
            {#each BUILDER_TABS as tabLabel, t}
                {@const list = errors.filter((e) => e.tab === t)}
                {#if list.length}
                    <div class="alert-group">
                        <button class="alert-tab" onclick={() => (step = t)}>{tabLabel}</button>
                        <span>{list.map((e) => e.message).join(" · ")}</span>
                    </div>
                {/if}
            {/each}
        </div>
    {/if}

    <section class="content">
        {#if step === 0}
            <BasicsTab {build} />
        {:else if step === 1}
            <AbilitiesTab {build} />
        {:else if step === 2}
            <RaceTab {build} />
        {:else if step === 3}
            <ClassTab {build} />
        {:else if step === 4}
            <EquipmentTab {build} />
        {:else if refsError}
            <p class="err">Failed to load reference data: {refsError}</p>
        {:else}
            {#if levels.length > 1}
                <nav class="level-tabs">
                    {#each levels as l}
                        <button
                            class="chip"
                            class:active={l === levelTab}
                            class:invalid={!levelDone[l]}
                            onclick={() => (levelTab = l)}
                        >Lvl {l}</button>
                    {/each}
                </nav>
            {/if}
            {#key levelTab}
                <LevelScreen {build} level={levelTab} {refs} />
            {/key}
        {/if}
    </section>
</div>

<style>
    .builder {
        height: 100%;
        padding: 32px;
        display: flex;
        flex-direction: column;
        gap: 20px;
    }

    .top {
        display: flex;
        align-items: center;
        gap: 16px;
    }

    h1 {
        margin: 0;
        font-family: var(--font-heading);
        font-weight: var(--font-weight-bold);
        color: var(--color-gold);
    }

    .back {
        padding: 6px 12px;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        cursor: pointer;
    }

    .save {
        padding: 8px 20px;
        background: var(--color-gold);
        border: 1px solid var(--color-gold);
        border-radius: 6px;
        color: var(--color-bg);
        font-family: var(--font-ui);
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
    }

    .save:hover:not(:disabled) {
        background: var(--color-gold-hover);
        border-color: var(--color-gold-hover);
    }

    .save:disabled {
        opacity: 0.6;
        cursor: default;
    }

    .alert {
        padding: 12px 16px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        background: color-mix(in srgb, var(--color-danger) 12%, var(--color-card));
        border: 1px solid var(--color-danger);
        border-radius: 8px;
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-primary);
    }

    .alert-group {
        display: flex;
        gap: 10px;
        align-items: baseline;
    }

    .alert-group span {
        color: var(--color-text-secondary);
    }

    .alert-tab {
        flex: 0 0 auto;
        padding: 0;
        background: none;
        border: none;
        color: var(--color-gold);
        font-family: var(--font-ui);
        font-weight: var(--font-weight-semibold);
        text-decoration: underline;
        cursor: pointer;
    }

    .alert-tab:hover {
        color: var(--color-gold-hover);
    }

    .level-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 16px;
    }

    .chip.final {
        border-style: dashed;
        border-color: var(--color-gold);
    }

    .err {
        margin: 0;
        color: var(--color-danger);
    }

    .chip.invalid {
        border-color: var(--color-danger);
    }

    .chip.invalid::after {
        content: " •";
        color: var(--color-danger);
    }

    .back:hover {
        border-color: var(--color-gold);
        color: var(--color-gold-hover);
    }

    .steps {
        display: flex;
        flex-wrap: wrap;
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

    .chip:hover {
        color: var(--color-text-primary);
    }

    .chip.active {
        background: var(--color-magic-purple-dark);
        border-color: var(--color-magic-purple);
        color: var(--color-text-primary);
    }

    .content {
        flex: 1;
        padding: 24px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 8px;
    }

    h2 {
        margin: 0 0 8px;
        font-family: var(--font-heading-alt);
        color: var(--color-text-primary);
    }

    p {
        margin: 0;
        color: var(--color-text-muted);
    }
</style>
