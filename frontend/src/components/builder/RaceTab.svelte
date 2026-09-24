<script>
    /**
     * Вкладка «Раса».
     * Нет выбора      → сетка рас.
     * Раса выбрана    → только её карточка (× — отмена) + сетка подрас.
     * Подраса выбрана → только её карточка (×).
     * Выбор сразу пишется в build (CharacterBuild.raceId / subraceId).
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
        <p class="muted">Загрузка рас…</p>
    {:else if error}
        <p class="error">Не удалось загрузить расы: {error}</p>
    {:else if !race}
        {#if races.length === 0}
            <p class="muted">Расы не найдены.</p>
        {:else}
            <ChoiceGrid items={races} onpick={(id) => build.setRace(id)} />
        {/if}
    {:else}
        <ChoiceCard item={race} badge="Раса" onclear={() => build.setRace(null)}>
            <div class="stats">
                <span>Размер: <b>{race.data.size ?? "—"}</b></span>
                <span>Скорость: <b>{race.data.speed ?? "—"} фт.</b></span>
            </div>
            <FeatureList items={race.data.traits} />
        </ChoiceCard>

        {#if race.subraces.length}
            <h4>Подраса</h4>
            {#if subrace}
                <ChoiceCard
                    item={subrace}
                    badge="Подраса"
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
