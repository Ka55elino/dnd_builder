<script>
    /**
     * Происхождение (предыстория 2024) на вкладке «Атрибуты».
     * Выбор предыстории → её навыки, инструменты, черта происхождения
     * и бонус к характеристикам: +2/+1 или +1/+1/+1 (из трёх её характеристик).
     */
    import { onMount } from "svelte";
    import { loadRefs } from "../../data/refs.js";
    import { ABILITIES } from "../../rules/abilities.js";
    import { SKILLS } from "../../rules/skills.js";

    let { build } = $props();

    let backgrounds = $state([]);
    let feats = $state([]);
    let error = $state(null);

    onMount(async () => {
        try {
            const refs = await loadRefs();
            backgrounds = refs.backgrounds;
            feats = refs.feats;
        } catch (e) {
            error = e?.message ?? String(e);
        }
    });

    const bg = $derived(backgrounds.find((b) => b.id === build.backgroundId) ?? null);
    const feat = $derived(bg ? feats.find((f) => f.id === bg.feat) : null);
    const options = $derived(bg?.data?.abilities?.options ?? []);
    const skillName = (id) => SKILLS.find((s) => s.id === id)?.name ?? id;
</script>

<section class="origin">
    <h3>Происхождение</h3>

    {#if error}
        <p class="error">Не удалось загрузить предыстории: {error}</p>
    {:else}
        <div class="bg-list">
            {#each backgrounds as b (b.id)}
                <button
                    class="bg"
                    class:active={b.id === build.backgroundId}
                    onclick={() => build.setBackground(b.id === build.backgroundId ? null : b.id)}
                >
                    <b>{b.name}</b>
                    <small>{(b.data?.abilities?.options ?? []).map((k) => ABILITIES[k]?.short).join(" · ")}</small>
                </button>
            {/each}
        </div>

        {#if bg}
            <div class="details">
                <div class="info">
                    <span>Навыки: <b>{(bg.data?.skills ?? []).map(skillName).join(", ")}</b></span>
                    {#if bg.data?.tool}<span>Инструменты: <b>{bg.data.tool}</b></span>{/if}
                    {#if feat}
                        <span class="feat">Черта: <b>{feat.name}</b> — {feat.desc}</span>
                    {/if}
                </div>

                <div class="bonus">
                    <div class="modes">
                        <button
                            class="mode"
                            class:active={build.backgroundBonusMode === "2-1"}
                            onclick={() => build.setBackgroundBonusMode("2-1")}
                        >+2 / +1</button>
                        <button
                            class="mode"
                            class:active={build.backgroundBonusMode === "1-1-1"}
                            onclick={() => build.setBackgroundBonusMode("1-1-1")}
                        >+1 / +1 / +1</button>
                    </div>

                    <div class="targets">
                        {#each options as k}
                            {@const v = build.backgroundBonus[k] ?? 0}
                            <div class="target" class:set={v}>
                                <span class="t-name">{ABILITIES[k]?.name}</span>
                                {#if build.backgroundBonusMode === "2-1"}
                                    <span class="t-buttons">
                                        <button class:on={v === 2} onclick={() => build.setBackgroundBonus(k, v === 2 ? 0 : 2)}>+2</button>
                                        <button class:on={v === 1} onclick={() => build.setBackgroundBonus(k, v === 1 ? 0 : 1)}>+1</button>
                                    </span>
                                {:else}
                                    <span class="t-buttons">
                                        <button class:on={v === 1} onclick={() => build.setBackgroundBonus(k, 1)}>+1</button>
                                    </span>
                                {/if}
                            </div>
                        {/each}
                    </div>
                </div>
            </div>
        {/if}
    {/if}
</section>

<style>
    .origin {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
    }

    h3 {
        margin: 0;
        font-family: var(--font-heading-alt);
        font-size: 18px;
        color: var(--color-gold);
    }

    .bg-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 8px;
    }

    .bg {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        padding: 8px 10px;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        text-align: left;
        cursor: pointer;
    }

    .bg:hover {
        border-color: var(--color-gold);
    }

    .bg.active {
        background: var(--color-magic-purple-dark);
        border-color: var(--color-magic-purple);
    }

    .bg b {
        font-size: 14px;
        font-weight: var(--font-weight-semibold);
    }

    .bg small {
        font-size: 11px;
        color: var(--color-text-muted);
        letter-spacing: 0.04em;
    }

    .details {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 16px;
        align-items: start;
    }

    @media (max-width: 900px) {
        .details {
            grid-template-columns: 1fr;
        }
    }

    .info {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .info b {
        color: var(--color-text-primary);
        font-weight: var(--font-weight-medium);
    }

    .feat {
        font-family: var(--font-spell);
        font-size: 15px;
    }

    .bonus {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .modes {
        display: flex;
        gap: 6px;
    }

    .mode,
    .t-buttons button {
        padding: 4px 10px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: 13px;
        cursor: pointer;
    }

    .mode.active,
    .t-buttons button.on {
        background: var(--color-gold);
        border-color: var(--color-gold);
        color: var(--color-bg);
        font-weight: var(--font-weight-semibold);
    }

    .targets {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .target {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .target.set .t-name {
        color: var(--color-text-primary);
    }

    .t-buttons {
        display: flex;
        gap: 4px;
    }

    .error {
        margin: 0;
        color: var(--color-danger);
    }
</style>
