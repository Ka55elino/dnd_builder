<script>
    /**
     * "Class" tab — same pattern as "Species".
     * Nothing selected  → grid of classes.
     * Class selected    → only its card (×) + grid of subclasses (from the subclass level).
     * Subclass selected → only its card (×).
     * The choice is written to build (CharacterBuild.classId / subclassId).
     *
     * The subclass comes at the class's subclassLevel (usually 3): below it there is no
     * picker (just a note), and a subclass left from before is dropped.
     * (The class of each level and removing levels — on the "Levels" step, LevelClassBar.)
     */
    import { onMount } from "svelte";
    import { loadRefs } from "../../data/refs.js"; // cached: loaded once at startup
    import { ABILITIES } from "../../rules/abilities.js";
    import ChoiceGrid from "./common/ChoiceGrid.svelte";
    import ChoiceCard from "./common/ChoiceCard.svelte";
    import FeatureList from "./common/FeatureList.svelte";

    let { build } = $props();

    let classes = $state([]);
    let loading = $state(true);
    let error = $state(null);

    const cls = $derived(classes.find((c) => c.id === build.classId) ?? null);
    const subclass = $derived(
        cls?.subclasses.find((s) => s.id === build.subclassId) ?? null,
    );

    // the level the class picks its subclass at (usually 3)
    const subLevel = $derived(cls?.subclassLevel || 3);
    const subclassOpen = $derived(build.classLevel(build.classId) >= subLevel);
    // a subclass whose class level is below its subclass level is dropped (every class:
    // a level can be removed or given to another class)
    $effect(() => {
        for (const e of build.classEntries()) {
            const c = classes.find((x) => x.id === e.classId);
            if (c && e.subclassId && e.level < (c.subclassLevel || 3)) build.setSubclassFor(e.classId, null);
        }
    });

    const ARMOR = { light: "light", medium: "medium", heavy: "heavy", shield: "shields" };
    const WEAPONS = { simple: "simple", martial: "martial" };
    const CASTER = { full: "full", half: "half", third: "third", none: "none" };

    const abilityList = (keys) =>
        (keys ?? []).map((k) => ABILITIES[k]?.short ?? k).join(", ") || "—";
    const mapList = (keys, dict) =>
        (keys ?? []).map((k) => dict[k] ?? k).join(", ") || "—";

    onMount(async () => {
        try {
            classes = (await loadRefs()).classes;
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            loading = false;
        }
    });

    // class features + Ability Score Improvement levels (asiLevels), sorted by level;
    // Fighter and Rogue get extra ones (e.g. Fighter 6 and 14, Rogue 10)
    const classFeatures = $derived.by(() => {
        if (!cls) return [];
        const asi = (cls.data.asiLevels ?? []).map((level) => ({
            level,
            name: "Ability Score Improvement",
            desc: "Choose the Ability Score Improvement feat or another feat you qualify for.",
        }));
        return [...(cls.data.features ?? []), ...asi].sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
    });
</script>

<div class="tab">
    {#if loading}
        <p class="muted">Loading classes…</p>
    {:else if error}
        <p class="error">Failed to load classes: {error}</p>
    {:else if !cls}
        {#if classes.length === 0}
            <p class="muted">No classes found.</p>
        {:else}
            <ChoiceGrid items={classes} onpick={(id) => build.setClass(id)} />
        {/if}
    {:else}
        <ChoiceCard item={cls} badge="Class" onclear={() => build.setClass(null)}>
            <div class="stats">
                <span>Hit Point Die: <b>d{cls.hitDie}</b></span>
                <span>Primary ability: <b>{abilityList(cls.data.primaryAbility)}</b></span>
                <span>Saving throws: <b>{abilityList(cls.data.savingThrows)}</b></span>
                <span>Armor: <b>{mapList(cls.data.armorTraining, ARMOR)}</b></span>
                <span>Weapons: <b>{mapList(cls.data.weaponProficiencies, WEAPONS)}</b></span>
                <span>Spellcaster: <b>{CASTER[cls.caster] ?? cls.caster ?? "—"}</b></span>
            </div>
            <FeatureList items={classFeatures} />
        </ChoiceCard>

        {#if cls.subclasses.length && !subclassOpen}
            <p class="sub-note">Subclass — at level {subLevel} (on Level Up).</p>
        {:else if cls.subclasses.length}
            <h4>Subclass</h4>
            {#if subclass}
                <ChoiceCard
                    item={subclass}
                    badge="Subclass"
                    sub
                    onclear={() => build.setSubclass(null)}
                >
                    <FeatureList items={subclass.data.features} />
                </ChoiceCard>
            {:else}
                <ChoiceGrid
                    items={cls.subclasses}
                    onpick={(id) => build.setSubclass(id)}
                />
            {/if}
        {/if}
    {/if}
</div>

<style>
    .tab {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    h4 {
        margin: 8px 0 0;
        font-family: var(--font-heading-alt);
        font-size: 18px;
        color: var(--color-text-accent);
    }

    .stats {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 20px;
        margin-bottom: 12px;
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .stats b {
        color: var(--color-text-primary);
        font-weight: var(--font-weight-medium);
    }

    .muted {
        margin: 0;
        color: var(--color-text-muted);
    }

    .error {
        margin: 0;
        color: var(--color-danger);
    }

    .sub-note {
        margin: 0;
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-muted);
    }
</style>
