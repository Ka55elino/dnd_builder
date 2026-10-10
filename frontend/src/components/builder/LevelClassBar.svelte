<script>
    /**
     * The "Levels" step when editing a character: a bar over the level screen —
     *   Level N: [class ▾] · Wizard 2 · (the last level) − Remove level N
     * The class of a level from 2 up can be changed (multiclass prerequisites apply); level 1
     * is the starting class (the Class tab). Changing a class / removing the last level resets
     * the class choices of the levels it touches (CharacterBuild.setLevelClass / removeLastLevel);
     * they are made again here, level by level.
     *
     * build; level — the level shown; refs — reference data (classes)
     */
    import { ask } from "../../confirm.svelte.js";
    import { canTakeClass, classSummary } from "../../rules/multiclass.js";

    let { build, level, refs } = $props();

    const classes = $derived(refs?.classes ?? []);
    const id = $derived(build.classAt(level));
    const nameOf = (cid) => classes.find((c) => c.id === cid)?.name ?? cid ?? "—";

    // why a class can't take this level (a new class: the multiclass prerequisites), or ""
    function blockedReason(cid) {
        if (cid === id) return "";
        const r = canTakeClass(build, { classes }, cid);
        return r.ok ? "" : r.reasons.join("; ");
    }

    // a subclass whose class level fell below its subclass level is dropped
    $effect(() => {
        for (const e of build.classEntries()) {
            const c = classes.find((x) => x.id === e.classId);
            if (c && e.subclassId && e.level < (c.subclassLevel || 3)) build.setSubclassFor(e.classId, null);
        }
    });

    async function removeLast() {
        const ok = await ask({
            title: `Remove level ${level}?`,
            text: `The character goes back to level ${level - 1}; the choices made at level ${level} are lost.`,
            ok: "Remove",
        });
        if (ok) build.removeLastLevel();
    }
</script>

<div class="bar">
    <span class="lv">Level {level}</span>
    {#if level === 1}
        <span class="fixed">{nameOf(id)}</span>
        <small class="hint">starting class — change it on the Class tab</small>
    {:else}
        <select
            value={id}
            onchange={(e) => build.setLevelClass(level, e.currentTarget.value)}
            aria-label="Class gained at level {level}"
            title="The class this level goes to; changing it resets the class choices of the levels it affects"
        >
            {#each classes as c (c.id)}
                {@const why = blockedReason(c.id)}
                <option value={c.id} disabled={!!why} title={why}>{c.name}{why ? " — prerequisites not met" : ""}</option>
            {/each}
        </select>
    {/if}
    <span class="cl">{nameOf(id)} {build.classLevelAt(level)}</span>

    {#if level === build.level && level > 1}
        <span class="grow"></span>
        <button class="btn" onclick={removeLast}>− Remove level {level}</button>
    {/if}
</div>
{#if build.classes.length > 1}
    <p class="summary">{classSummary(build, { classes }, { withSubclass: true })}</p>
{/if}

<style>
    .bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 12px;
        padding: 8px 12px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        font-family: var(--font-ui);
        font-size: 14px;
    }

    .lv {
        color: var(--color-text-muted);
    }

    .fixed {
        color: var(--color-text-primary);
    }

    select {
        min-width: 0;
        max-width: 100%;
        padding: 5px 8px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-primary);
        font-family: var(--font-form);
        font-size: 14px;
    }

    select:focus {
        outline: none;
        border-color: var(--color-gold);
    }

    .cl {
        color: var(--color-gold);
        font-weight: var(--font-weight-semibold);
    }

    .hint {
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .grow {
        flex: 1;
    }

    .btn {
        padding: 5px 12px;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        cursor: pointer;
    }

    .btn:hover {
        border-color: var(--color-gold);
        color: var(--color-gold-hover);
    }

    .summary {
        margin: 6px 2px 0;
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-muted);
    }
</style>
