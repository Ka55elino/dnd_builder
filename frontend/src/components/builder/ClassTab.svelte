<script>
    /**
     * "Class" tab — same pattern as "Species".
     * Nothing selected  → grid of classes.
     * Class selected    → only its card (×) + grid of subclasses.
     * Subclass selected → only its card (×).
     * The choice is written to build (CharacterBuild.classId / subclassId).
     *
     * TODO: per the rules, the subclass is chosen at subclassLevel (usually 3) —
     * this restriction is not enforced yet.
     */
    import { onMount } from "svelte";
    import { GetClasses } from "../../../wailsjs/go/main/App.js";
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

    const ARMOR = { light: "light", medium: "medium", heavy: "heavy", shield: "shields" };
    const WEAPONS = { simple: "simple", martial: "martial" };
    const CASTER = { full: "full", half: "half", third: "third", none: "none" };

    const abilityList = (keys) =>
        (keys ?? []).map((k) => ABILITIES[k]?.short ?? k).join(", ") || "—";
    const mapList = (keys, dict) =>
        (keys ?? []).map((k) => dict[k] ?? k).join(", ") || "—";

    onMount(async () => {
        try {
            classes = await GetClasses();
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            loading = false;
        }
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
            <FeatureList items={cls.data.features} />
        </ChoiceCard>

        {#if cls.subclasses.length}
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
</style>
