<script>
    /**
     * "Species" tab.
     * Nothing selected    → grid of species.
     * Species selected    → only its card (× — cancel) + grid of subspecies.
     * Subspecies selected → only its card (×).
     * The choice is written straight to build (CharacterBuild.raceId / subraceId).
     */
    import { onMount } from "svelte";
    import { GetRaces } from "../../../wailsjs/go/main/App.js";
    import ChoiceGrid from "./common/ChoiceGrid.svelte";
    import ChoiceCard from "./common/ChoiceCard.svelte";
    import FeatureList from "./common/FeatureList.svelte";

    let { build } = $props();

    let races = $state([]);
    let loading = $state(true);
    let error = $state(null);

    const race = $derived(races.find((r) => r.id === build.raceId) ?? null);
    const subrace = $derived(
        race?.subraces.find((s) => s.id === build.subraceId) ?? null,
    );

    onMount(async () => {
        try {
            races = await GetRaces();
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            loading = false;
        }
    });
</script>

<div class="tab">
    {#if loading}
        <p class="muted">Loading species…</p>
    {:else if error}
        <p class="error">Failed to load species: {error}</p>
    {:else if !race}
        {#if races.length === 0}
            <p class="muted">No species found.</p>
        {:else}
            <ChoiceGrid items={races} onpick={(id) => build.setRace(id)} />
        {/if}
    {:else}
        <ChoiceCard item={race} badge="Species" onclear={() => build.setRace(null)}>
            <div class="stats">
                <span>Size: <b>{race.data.size ?? "—"}</b></span>
                <span>Speed: <b>{race.data.speed ?? "—"} ft.</b></span>
            </div>
            <FeatureList items={race.data.traits} />
        </ChoiceCard>

        {#if race.subraces.length}
            <h4>Subspecies</h4>
            {#if subrace}
                <ChoiceCard
                    item={subrace}
                    badge="Subspecies"
                    sub
                    onclear={() => build.setSubrace(null)}
                >
                    <FeatureList items={subrace.data.traits} />
                </ChoiceCard>
            {:else}
                <ChoiceGrid
                    items={race.subraces}
                    onpick={(id) => build.setSubrace(id)}
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
