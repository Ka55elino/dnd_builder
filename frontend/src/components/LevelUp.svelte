<script>
    /**
     * Level up: the same level screen as in the builder,
     * but for level (current + 1). Saves into the same character.
     *
     * id — character; onDone(id) — saved; onCancel() — cancel
     */
    import { onMount } from "svelte";
    import { GetCharacter, SaveCharacter } from "../../wailsjs/go/main/App.js";
    import { CharacterBuild, MAX_LEVEL } from "../models/CharacterBuild.svelte.js";
    import { loadRefs, EMPTY_REFS } from "../data/refs.js";
    import LevelScreen from "./LevelScreen.svelte";

    let { id, onDone, onCancel } = $props();

    let build = $state(null);
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
            b.setLevel(Math.min(MAX_LEVEL, b.level + 1));
            build = b;
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            loading = false;
        }
    });

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
    <header class="top">
        <button class="ghost" onclick={onCancel}>← Cancel</button>
        <h1>
            Level Up
            {#if build}<span>{build.name}: {fromLevel} → {build.level}</span>{/if}
        </h1>
        {#if build}
            <button class="save" onclick={save} disabled={saving || !complete}
                title={complete ? "" : "Make all level choices"}>
                {saving ? "Saving…" : "Save"}
            </button>
        {/if}
    </header>

    {#if error}<p class="error">Error: {error}</p>{/if}

    <section class="content">
        {#if loading}
            <p class="muted">Loading…</p>
        {:else if build && fromLevel >= MAX_LEVEL}
            <p class="muted">The character is already at maximum level.</p>
        {:else if build}
            <LevelScreen {build} level={build.level} {refs} bind:complete />
        {/if}
    </section>
</div>

<style>
    .page {
        min-height: 100%;
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

    h1 span {
        margin-left: 10px;
        font-family: var(--font-heading-alt);
        font-size: 18px;
        font-weight: var(--font-weight-regular);
        color: var(--color-text-secondary);
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

    .muted {
        margin: 0;
        color: var(--color-text-muted);
    }

    .error {
        margin: 0;
        color: var(--color-danger);
    }
</style>
