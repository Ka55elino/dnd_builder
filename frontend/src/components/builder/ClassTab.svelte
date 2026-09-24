<script>
    /**
     * Вкладка «Класс» — по той же схеме, что и «Раса».
     * Нет выбора        → сетка классов.
     * Класс выбран      → только его карточка (×) + сетка подклассов.
     * Подкласс выбран   → только его карточка (×).
     * Выбор пишется в build (CharacterBuild.classId / subclassId).
     *
     * TODO: подкласс по правилам выбирается на subclassLevel (обычно 3) —
     * пока это ограничение не применяем.
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

    const ARMOR = { light: "лёгкие", medium: "средние", heavy: "тяжёлые", shield: "щиты" };
    const WEAPONS = { simple: "простое", martial: "воинское" };
    const CASTER = { full: "полный", half: "половинный", third: "треть", none: "нет" };

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
        <p class="muted">Загрузка классов…</p>
    {:else if error}
        <p class="error">Не удалось загрузить классы: {error}</p>
    {:else if !cls}
        {#if classes.length === 0}
            <p class="muted">Классы не найдены.</p>
        {:else}
            <ChoiceGrid items={classes} onpick={(id) => build.setClass(id)} />
        {/if}
    {:else}
        <ChoiceCard item={cls} badge="Класс" onclear={() => build.setClass(null)}>
            <div class="stats">
                <span>Кость хитов: <b>d{cls.hitDie}</b></span>
                <span>Основная: <b>{abilityList(cls.data.primaryAbility)}</b></span>
                <span>Спасброски: <b>{abilityList(cls.data.savingThrows)}</b></span>
                <span>Доспехи: <b>{mapList(cls.data.armorTraining, ARMOR)}</b></span>
                <span>Оружие: <b>{mapList(cls.data.weaponProficiencies, WEAPONS)}</b></span>
                <span>Заклинатель: <b>{CASTER[cls.caster] ?? cls.caster ?? "—"}</b></span>
            </div>
            <FeatureList items={cls.data.features} />
        </ChoiceCard>

        {#if cls.subclasses.length}
            <h4>Подкласс</h4>
            {#if subclass}
                <ChoiceCard
                    item={subclass}
                    badge="Подкласс"
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
