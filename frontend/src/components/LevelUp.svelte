<script>
    /**
     * Level up: first — which class gains the level (one of the character's
     * classes, or a new one if the multiclass prerequisites are met); then the
     * same level screen as in the builder, for level (current + 1).
     * Saves into the same character.
     *
     * id — character; onDone(id) — saved; onCancel() — cancel
     */
    import TopBar from "./common/TopBar.svelte";
    import { onMount } from "svelte";
    import { GetCharacter, SaveCharacter } from "../api.js";
    import { CharacterBuild, MAX_LEVEL } from "../models/CharacterBuild.svelte.js";
    import { loadRefs, EMPTY_REFS } from "../data/refs.js";
    import { canTakeClass, prerequisitesText } from "../rules/multiclass.js";
    import LevelScreen from "./LevelScreen.svelte";
    import ChoiceGrid from "./builder/common/ChoiceGrid.svelte";

    let { id, onDone, onCancel } = $props();

    let base = $state(null);  // the character before this level-up
    let build = $state(null); // base + the new level (after the class is picked)
    let refs = $state(EMPTY_REFS);
    let fromLevel = $state(1);
    let loading = $state(true);
    let error = $state(null);
    let complete = $state(false);
    let saving = $state(false);

    onMount(async () => {
        try {
            const [data, r] = await Promise.all([GetCharacter(id), loadRefs()]);
            refs = r;
            const b = CharacterBuild.fromJSON(data);
            fromLevel = b.level;
            b.dropChoicesAbove(b.level); // leftovers from previous unfinished level-ups
            base = b;
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            loading = false;
        }
    });

    // --- step 1: which class gains the level ---
    const owned = $derived(
        base ? base.classEntries().map((c) => refs.classes?.find((x) => x.id === c.classId)).filter(Boolean) : [],
    );
    const others = $derived(
        base ? (refs.classes ?? []).filter((c) => !base.classes.some((x) => x.classId === c.id)) : [],
    );
    const blocked = (cls) => {
        const r = canTakeClass(base, refs, cls.id);
        return r.ok ? false : r.reasons.join("; ");
    };

    function pickClass(classId) {
        const b = CharacterBuild.fromJSON(base.toJSON());
        b.addLevel(classId);
        complete = false;
        build = b;
    }

    function changeClass() {
        build = null;
        complete = false;
    }

    async function save() {
        if (!complete) return;
        saving = true;
        error = null;
        try {
            await SaveCharacter(JSON.stringify(build));
            onDone(id);
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            saving = false;
        }
    }
</script>

<div class="page">
    <!-- Save — the main button: stays in the bar on phones too -->
    <TopBar title="Level Up" sub={base ? `${base.name}: ${fromLevel} → ${fromLevel + 1}` : ""} onBack={onCancel} back="Cancel">
        {#snippet pinned()}
            {#if build}
                <button class="save" onclick={save} disabled={saving || !complete}
                    title={complete ? "" : "Make all level choices"}>
                    {saving ? "Saving…" : "Save"}
                </button>
            {/if}
        {/snippet}
    </TopBar>

    {#if error}<p class="error">Error: {error}</p>{/if}

    <section class="content">
        {#if loading}
            <p class="muted">Loading…</p>
        {:else if base && fromLevel >= MAX_LEVEL}
            <p class="muted">The character is already at maximum level.</p>
        {:else if build}
            {@const cls = refs.classes?.find((c) => c.id === build.classAt(build.level))}
            <div class="picked">
                <span>Level {build.level}: <b>{cls?.name ?? "?"} {build.classLevelAt(build.level)}</b></span>
                <button class="ghost" onclick={changeClass}>Change class</button>
            </div>
            <LevelScreen {build} level={build.level} {refs} bind:complete />
        {:else if base}
            <h2>Which class gains a level?</h2>
            <ChoiceGrid
                items={owned}
                onpick={pickClass}
                caption={(c) => `Level ${base.classLevel(c.id)} → ${base.classLevel(c.id) + 1}`}
            />
            {#if others.length}
                <h2>New class (multiclass)</h2>
                <p class="muted hint">
                    Requires 13 in the primary ability of the new class and of every class you already have.
                </p>
                <ChoiceGrid
                    items={others}
                    small
                    onpick={pickClass}
                    disabled={blocked}
                    caption={(c) => prerequisitesText(c)}
                />
            {/if}
        {/if}
    </section>
</div>

<style>
    .page {
        width: 100%;
        max-width: var(--page-max-width); /* big screens: centered, not stretched */
        margin: 0 auto;
        min-height: 100%;
        padding: 32px;
        display: flex;
        flex-direction: column;
        gap: 20px;
    }

    .ghost {
        padding: 6px 12px;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        cursor: pointer;
    }

    .ghost:hover {
        border-color: var(--color-gold);
        color: var(--color-gold-hover);
    }

    .save {
        margin-left: auto;
        padding: 8px 20px;
        background: var(--color-gold);
        border: 1px solid var(--color-gold);
        border-radius: 6px;
        color: var(--color-bg);
        font-family: var(--font-ui);
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
    }

    .save:disabled {
        opacity: 0.5;
        cursor: default;
    }

    .content {
        padding: 24px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 8px;
    }

    h2 {
        margin: 0 0 16px;
        font-family: var(--font-heading);
        font-size: 20px;
        color: var(--color-gold);
    }

    h2:not(:first-child) {
        margin-top: 28px;
    }

    .hint {
        margin-bottom: 12px !important;
    }

    .picked {
        margin-bottom: 16px;
        display: flex;
        align-items: center;
        gap: 12px;
        font-family: var(--font-ui);
        color: var(--color-text-secondary);
    }

    .picked b {
        color: var(--color-gold);
    }

    .muted {
        margin: 0;
        color: var(--color-text-muted);
    }

    .error {
        margin: 0;
        color: var(--color-danger);
    }

    @media (max-width: 640px) {
        .page {
            padding: 12px 12px 24px;
            gap: 12px;
        }

        .content {
            padding: 12px;
        }
    }
</style>
