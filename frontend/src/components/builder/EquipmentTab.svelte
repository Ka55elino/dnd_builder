<script>
    import { damageShort } from "../../rules/labels.js";
    /**
     * Вкладка «Снаряжение» — по схеме рас/классов.
     *   Доспех — один:     сетка → выбранная карточка (×).
     *   Оружие — несколько: выбранные карточки (× у каждой) + сетка остальных.
     *   Набор  — один:     сетка → карточка с содержимым (×).
     *   Отдельные предметы в билдере не выводятся (только внутри наборов).
     * В сетке только записи с is_default = 1 (фильтрует бэкенд).
     * Выбор пишется в build.equipment.
     */
    import { onMount } from "svelte";
    import { GetEquipment } from "../../../wailsjs/go/main/App.js";
    import ChoiceGrid from "./common/ChoiceGrid.svelte";
    import ChoiceCard from "./common/ChoiceCard.svelte";
    import { ARMOR_CAT, WEAPON_CAT, WEAPON_PROPS, acText } from "../../rules/equipment.js";

    let { build } = $props();

    let eq = $state({ weapons: [], armor: [], items: [], packs: [] });
    let loading = $state(true);
    let error = $state(null);

    const eqState = $derived(build.equipment);

    // щит — не доспех, а отдельный флаг equipment.shield
    const bodyArmor = $derived(eq.armor.filter((a) => a.category !== "shield"));
    const shieldItem = $derived(eq.armor.find((a) => a.category === "shield") ?? null);
    const armor = $derived(bodyArmor.find((a) => a.id === eqState.armorId) ?? null);
    const pack = $derived(eq.packs.find((p) => p.id === eqState.packId) ?? null);

    const pickedWeapons = $derived(eq.weapons.filter((w) => eqState.weaponIds.includes(w.id)));
    const freeWeapons = $derived(eq.weapons.filter((w) => !eqState.weaponIds.includes(w.id)));

    // --- подписи (общие — rules/equipment.js) ---
    const PROPS = WEAPON_PROPS;
    const armorCaption = (a) => `${ARMOR_CAT[a.category] ?? a.category} · КД ${acText(a)}`;
    const weaponCaption = (w) => `${w.damage} ${damageShort(w.damageType)}`.trim();
    const packCaption = (p) => `${p.items.length} предм. · ${p.cost || "—"}`;

    onMount(async () => {
        try {
            eq = await GetEquipment();
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            loading = false;
        }
    });
</script>

<div class="tab">
    {#if loading}
        <p class="muted">Загрузка снаряжения…</p>
    {:else if error}
        <p class="error">Не удалось загрузить снаряжение: {error}</p>
    {:else}
        <!-- ===== Доспех ===== -->
        <section>
            <h4>Доспех</h4>
            {#if armor}
                <ChoiceCard item={armor} badge="Доспех" onclear={() => build.setArmor(null)}>
                    <div class="stats">
                        <span>Тип: <b>{ARMOR_CAT[armor.category] ?? armor.category}</b></span>
                        <span>КД: <b>{acText(armor)}</b></span>
                        {#if armor.data.strengthReq}
                            <span>Требует Силу: <b>{armor.data.strengthReq}</b></span>
                        {/if}
                        {#if armor.data.stealthDisadvantage}
                            <span class="warn">Помеха на Скрытность</span>
                        {/if}
                    </div>
                </ChoiceCard>
            {:else if bodyArmor.length}
                <ChoiceGrid items={bodyArmor} caption={armorCaption} onpick={(id) => build.setArmor(id)} />
            {:else}
                <p class="muted">Доспехов нет.</p>
            {/if}

            {#if shieldItem}
                <button
                    class="shield-toggle"
                    class:on={eqState.shield}
                    onclick={() => build.setShield(!eqState.shield)}
                    aria-pressed={eqState.shield}
                >
                    <img src={shieldItem.image} alt="" />
                    <span>{shieldItem.name} <small>+{shieldItem.data.acBonus ?? 2} КД</small></span>
                    <b>{eqState.shield ? "✓ взят" : "взять"}</b>
                </button>
            {/if}
        </section>

        <!-- ===== Оружие ===== -->
        <section>
            <h4>Оружие</h4>
            {#if pickedWeapons.length}
                <div class="picked">
                    {#each pickedWeapons as w (w.id)}
                        <ChoiceCard item={w} badge="Оружие" compact onclear={() => build.toggleWeapon(w.id)}>
                            <div class="stats">
                                <span>{WEAPON_CAT[w.category] ?? w.category}</span>
                                <span>Урон: <b>{weaponCaption(w)}</b></span>
                                {#if w.data.mastery}<span>Мастерство: <b>{w.data.mastery}</b></span>{/if}
                            </div>
                            {#if w.data.properties?.length}
                                <div class="tags">
                                    {#each w.data.properties as p}<span class="tag">{PROPS[p] ?? p}</span>{/each}
                                </div>
                            {/if}
                        </ChoiceCard>
                    {/each}
                </div>
            {/if}
            {#if freeWeapons.length}
                <ChoiceGrid items={freeWeapons} caption={weaponCaption} onpick={(id) => build.toggleWeapon(id)} />
            {/if}
        </section>

        <!-- ===== Набор ===== -->
        <section>
            <h4>Набор снаряжения</h4>
            {#if pack}
                <ChoiceCard item={pack} badge="Набор" onclear={() => build.setPack(null)}>
                    {#if pack.desc}<p class="desc">{pack.desc}</p>{/if}
                    <div class="stats"><span>Стоимость: <b>{pack.cost || "—"}</b></span></div>
                    <ul class="contents">
                        {#each pack.items as pi (pi.item.id)}
                            <li>
                                <img src={pi.item.image} alt="" />
                                <span class="c-name">{pi.item.name}</span>
                                <span class="c-qty">× {pi.qty}</span>
                            </li>
                        {/each}
                    </ul>
                </ChoiceCard>
            {:else if eq.packs.length}
                <ChoiceGrid items={eq.packs} caption={packCaption} onpick={(id) => build.setPack(id)} />
            {:else}
                <p class="muted">Наборов нет.</p>
            {/if}
        </section>
    {/if}
</div>

<style>
    .tab {
        display: flex;
        flex-direction: column;
        gap: 28px;
    }

    section {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    h4 {
        margin: 0;
        font-family: var(--font-heading-alt);
        font-size: 18px;
        color: var(--color-text-accent);
    }

    .picked {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
        gap: 12px;
    }

    .stats {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 18px;
        margin-bottom: 8px;
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .stats b {
        color: var(--color-text-primary);
        font-weight: var(--font-weight-medium);
    }

    .warn {
        color: var(--color-danger);
    }

    .tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }

    .tag {
        padding: 2px 8px;
        border: 1px solid var(--color-border);
        border-radius: 999px;
        font-family: var(--font-ui);
        font-size: 11px;
        color: var(--color-text-secondary);
    }

    .desc {
        margin: 0 0 8px;
        font-family: var(--font-lore);
        font-size: 15px;
        color: var(--color-text-secondary);
    }

    .contents {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .contents li {
        display: flex;
        align-items: center;
        gap: 10px;
        font-family: var(--font-ui);
        font-size: 14px;
    }

    .contents img {
        width: 32px;
        height: 32px;
        border-radius: 4px;
        object-fit: cover;
    }

    .c-name {
        color: var(--color-text-primary);
    }

    .c-qty {
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

    .shield-toggle {
        align-self: flex-start;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 14px 8px 8px;
        background: var(--color-card-elevated);
        border: 1px dashed var(--color-border);
        border-radius: 8px;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: 14px;
        cursor: pointer;
    }

    .shield-toggle img {
        width: 40px;
        height: 40px;
        border-radius: 6px;
        object-fit: cover;
    }

    .shield-toggle small {
        color: var(--color-text-muted);
    }

    .shield-toggle b {
        font-weight: var(--font-weight-semibold);
        color: var(--color-gold);
    }

    .shield-toggle:hover {
        border-color: var(--color-gold);
    }

    .shield-toggle.on {
        border-style: solid;
        border-color: var(--color-gold);
        color: var(--color-text-primary);
    }
</style>
