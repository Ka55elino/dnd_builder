<script>
    import { damageShort } from "../../rules/labels.js";
    /**
     * "Equipment" tab — three sub-tabs, each with a counter of what is taken:
     *   Weapons — several, and several of the same (2 daggers): the taken ones as rows with
     *             − n + ; the grid below adds one more on a click (a badge shows how many).
     *             Filter: all / simple / martial.
     *   Armor   — armor (one) + clothes (one) + the shield (taken / not).
     *             Armor is worn by default, the clothes go on when there's no armor.
     *   Pack    — one: grid → card with its contents (×).
     * The grids show only records with is_default = 1 (filtered by the backend).
     * The choice is written to build.equipment (weaponIds repeats an id per piece).
     */
    import { onMount } from "svelte";
    import { loadRefs } from "../../data/refs.js"; // cached: loaded once at startup
    import ChoiceGrid from "./common/ChoiceGrid.svelte";
    import ChoiceCard from "./common/ChoiceCard.svelte";
    import { ARMOR_CAT, WEAPON_CAT, WEAPON_PROPS, acText, armorSummary, isClothing } from "../../rules/equipment.js";

    let { build } = $props();

    let eq = $state({ weapons: [], armor: [], items: [], packs: [] });
    let loading = $state(true);
    let error = $state(null);
    let tab = $state("weapons"); // 'weapons' | 'armor' | 'pack'
    let weaponFilter = $state("all"); // 'all' | 'simple' | 'martial'

    const eqState = $derived(build.equipment);

    // the shield is not armor but a separate flag equipment.shield; clothes have their own pick
    const bodyArmor = $derived(eq.armor.filter((a) => a.category !== "shield" && !isClothing(a)));
    const clothes = $derived(eq.armor.filter((a) => isClothing(a)));
    const shieldItem = $derived(eq.armor.find((a) => a.category === "shield") ?? null);
    const armor = $derived(bodyArmor.find((a) => a.id === eqState.armorId) ?? null);
    const clothing = $derived(clothes.find((a) => a.id === eqState.clothingId) ?? null);
    const pack = $derived(eq.packs.find((p) => p.id === eqState.packId) ?? null);

    // weapons: how many of each (weaponIds repeats an id)
    const counts = $derived.by(() => {
        const c = {};
        for (const id of eqState.weaponIds ?? []) c[id] = (c[id] ?? 0) + 1;
        return c;
    });
    const pickedWeapons = $derived(eq.weapons.filter((w) => counts[w.id]));
    const weaponTotal = $derived((eqState.weaponIds ?? []).length);
    const shownWeapons = $derived(eq.weapons.filter((w) => weaponFilter === "all" || w.category === weaponFilter));
    const armorTotal = $derived((armor ? 1 : 0) + (clothing ? 1 : 0) + (eqState.shield ? 1 : 0));

    const TABS = $derived([
        { id: "weapons", label: "Weapons", count: weaponTotal },
        { id: "armor", label: "Armor & clothes", count: armorTotal },
        { id: "pack", label: "Pack", count: pack ? 1 : 0 },
    ]);

    // an old build kept clothes in the armor pick: move them to the clothes one
    $effect(() => {
        const a = eq.armor.find((x) => x.id === eqState.armorId);
        if (a && isClothing(a)) {
            if (!eqState.clothingId) build.setClothing(a.id);
            build.setArmor(null);
        }
    });

    // --- captions (shared ones — rules/equipment.js) ---
    const PROPS = WEAPON_PROPS;
    const armorCaption = (a) => armorSummary(a);
    const weaponCaption = (w) => `${w.damage} ${damageShort(w.damageType)}`.trim();
    const packCaption = (p) => `${p.items.length + (p.armor?.length ?? 0)} items · ${p.cost || "—"}`;
    const weaponBadge = (w) => (counts[w.id] ? `×${counts[w.id]}` : "");

    onMount(async () => {
        try {
            eq = (await loadRefs()).eq;
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            loading = false;
        }
    });
</script>

{#snippet armorStats(a)}
    <div class="stats">
        <span>Type: <b>{ARMOR_CAT[a.category] ?? a.category}</b></span>
        {#if isClothing(a)}
            <span>Doesn't count as armor{#if a.baseAC}; AC <b>{acText(a)}</b>{/if}</span>
        {:else}
            <span>AC: <b>{acText(a)}</b></span>
        {/if}
        {#if a.data.strengthReq}
            <span>Strength required: <b>{a.data.strengthReq}</b></span>
        {/if}
        {#if a.data.stealthDisadvantage}
            <span class="warn">Stealth Disadvantage</span>
        {/if}
    </div>
{/snippet}

<div class="tab">
    {#if loading}
        <p class="muted">Loading equipment…</p>
    {:else if error}
        <p class="error">Failed to load equipment: {error}</p>
    {:else}
        <div class="subtabs" role="tablist">
            {#each TABS as t (t.id)}
                <button role="tab" class:on={tab === t.id} aria-selected={tab === t.id} onclick={() => (tab = t.id)}>
                    {t.label}
                    <span class="count" class:zero={!t.count}>{t.count}</span>
                </button>
            {/each}
        </div>

        {#if tab === "weapons"}
            <!-- ===== Weapons ===== -->
            <section>
                {#if pickedWeapons.length}
                    <ul class="picked-list">
                        {#each pickedWeapons as w (w.id)}
                            <li>
                                {#if w.image}<img src={w.image} alt="" />{:else}<span class="img-ph">{w.name[0]}</span>{/if}
                                <span class="w-main">
                                    <b>{w.name}</b>
                                    <small>
                                        {WEAPON_CAT[w.category] ?? w.category} · {weaponCaption(w)}{#if w.data.mastery} · {w.data.mastery}{/if}
                                        {#if w.data.properties?.length}· {w.data.properties.map((p) => PROPS[p] ?? p).join(", ")}{/if}
                                    </small>
                                </span>
                                <span class="stepper">
                                    <button onclick={() => build.stepWeapon(w.id, -1)} aria-label="One less {w.name}">−</button>
                                    <b>{counts[w.id]}</b>
                                    <button onclick={() => build.stepWeapon(w.id, +1)} aria-label="One more {w.name}" disabled={counts[w.id] >= 20}>+</button>
                                </span>
                                <button class="x" onclick={() => build.toggleWeapon(w.id)} aria-label="Remove {w.name}" title="Remove">×</button>
                            </li>
                        {/each}
                    </ul>
                {:else}
                    <p class="muted">No weapons yet — pick from the list; a second click adds one more.</p>
                {/if}

                <div class="filters">
                    {#each [["all", "All"], ["simple", "Simple"], ["martial", "Martial"]] as [id, label] (id)}
                        <button class:on={weaponFilter === id} onclick={() => (weaponFilter = id)}>{label}</button>
                    {/each}
                </div>
                <ChoiceGrid small items={shownWeapons} caption={weaponCaption} badge={weaponBadge} onpick={(id) => build.stepWeapon(id, +1)} />
            </section>
        {:else if tab === "armor"}
            <!-- ===== Armor ===== -->
            <section>
                <h4>Armor</h4>
                {#if armor}
                    <ChoiceCard item={armor} badge="Armor" onclear={() => build.setArmor(null)}>
                        {@render armorStats(armor)}
                    </ChoiceCard>
                {:else if bodyArmor.length}
                    <ChoiceGrid small items={bodyArmor} caption={armorCaption} onpick={(id) => build.setArmor(id)} />
                {:else}
                    <p class="muted">No armor.</p>
                {/if}

                {#if shieldItem}
                    <button
                        class="shield-toggle"
                        class:on={eqState.shield}
                        onclick={() => build.setShield(!eqState.shield)}
                        aria-pressed={eqState.shield}
                    >
                        {#if shieldItem.image}<img src={shieldItem.image} alt="" />{/if}
                        <span>{shieldItem.name} <small>+{shieldItem.data.acBonus ?? 2} AC</small></span>
                        <b>{eqState.shield ? "✓ taken" : "take"}</b>
                    </button>
                {/if}
            </section>

            <section>
                <h4>Clothes</h4>
                <p class="hint">Worn when there's no armor (and under it on the sheet — in the backpack).</p>
                {#if clothing}
                    <ChoiceCard item={clothing} badge="Clothes" onclear={() => build.setClothing(null)}>
                        {@render armorStats(clothing)}
                    </ChoiceCard>
                {:else if clothes.length}
                    <ChoiceGrid small items={clothes} caption={armorCaption} onpick={(id) => build.setClothing(id)} />
                {:else}
                    <p class="muted">No clothes.</p>
                {/if}
            </section>
        {:else}
            <!-- ===== Pack ===== -->
            <section>
                {#if pack}
                    <ChoiceCard item={pack} badge="Pack" onclear={() => build.setPack(null)}>
                        {#if pack.desc}<p class="desc">{pack.desc}</p>{/if}
                        <div class="stats"><span>Cost: <b>{pack.cost || "—"}</b></span></div>
                        <ul class="contents">
                            {#each pack.items as pi (pi.item.id)}
                                <li>
                                    {#if pi.item.image}<img src={pi.item.image} alt="" />{:else}<span class="img-ph"></span>{/if}
                                    <span class="c-name">{pi.item.name}</span>
                                    <span class="c-qty">× {pi.qty}</span>
                                </li>
                            {/each}
                            <!-- clothes (armor table, category clothing) -->
                            {#each pack.armor ?? [] as pa (pa.armor.id)}
                                <li>
                                    {#if pa.armor.image}<img src={pa.armor.image} alt="" />{:else}<span class="img-ph"></span>{/if}
                                    <span class="c-name">{pa.armor.name}</span>
                                    <span class="c-qty">× {pa.qty}</span>
                                </li>
                            {/each}
                        </ul>
                    </ChoiceCard>
                {:else if eq.packs.length}
                    <ChoiceGrid items={eq.packs} caption={packCaption} onpick={(id) => build.setPack(id)} />
                {:else}
                    <p class="muted">No packs.</p>
                {/if}
            </section>
        {/if}
    {/if}
</div>

<style>
    .tab {
        display: flex;
        flex-direction: column;
        gap: 20px;
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

    /* ---------- sub-tabs ---------- */
    .subtabs {
        display: flex;
        gap: 4px;
        overflow-x: auto;
        scrollbar-width: none;
        border-bottom: 1px solid var(--color-border);
    }

    .subtabs::-webkit-scrollbar {
        display: none;
    }

    .subtabs button {
        flex: none;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        background: transparent;
        border: 0;
        border-bottom: 2px solid transparent;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: 14px;
        cursor: pointer;
    }

    .subtabs button:hover {
        color: var(--color-text-primary);
    }

    .subtabs button.on {
        color: var(--color-text-primary);
        border-bottom-color: var(--color-gold);
    }

    .count {
        min-width: 22px;
        padding: 1px 7px;
        background: var(--color-gold);
        border-radius: 999px;
        font-size: 12px;
        font-weight: var(--font-weight-bold);
        color: var(--color-bg);
        text-align: center;
    }

    .count.zero {
        background: transparent;
        border: 1px solid var(--color-border);
        color: var(--color-text-muted);
        font-weight: var(--font-weight-regular);
    }

    /* ---------- taken weapons ---------- */
    .picked-list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .picked-list li {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-gold);
        border-radius: 8px;
    }

    .picked-list img,
    .picked-list .img-ph {
        width: 40px;
        height: 40px;
        flex: none;
        border-radius: 6px;
        object-fit: cover;
    }

    .picked-list .img-ph {
        display: grid;
        place-items: center;
        background: var(--color-card);
        font-family: var(--font-heading);
        color: var(--color-text-muted);
    }

    .w-main {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-family: var(--font-ui);
    }

    .w-main b {
        font-size: 14px;
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
    }

    .w-main small {
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .stepper {
        flex: none;
        display: flex;
        align-items: center;
        gap: 2px;
        font-family: var(--font-ui);
    }

    .stepper b {
        min-width: 26px;
        text-align: center;
        font-size: 16px;
        color: var(--color-gold);
    }

    .stepper button,
    .x {
        width: 32px;
        height: 32px;
        padding: 0;
        display: grid;
        place-items: center;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-secondary);
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
    }

    .stepper button:hover:not(:disabled) {
        border-color: var(--color-gold);
        color: var(--color-gold);
    }

    .stepper button:disabled {
        opacity: 0.4;
        cursor: default;
    }

    .x {
        flex: none;
        border-color: transparent;
        color: var(--color-text-muted);
    }

    .x:hover {
        color: var(--color-danger);
    }

    .filters {
        display: flex;
        gap: 6px;
    }

    .filters button {
        padding: 5px 12px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 999px;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: 13px;
        cursor: pointer;
    }

    .filters button.on {
        border-color: var(--color-gold);
        color: var(--color-gold);
    }

    /* ---------- cards ---------- */
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

    .desc {
        margin: 0 0 8px;
        font-family: var(--font-lore);
        font-size: 15px;
        color: var(--color-text-secondary);
    }

    .hint {
        margin: -6px 0 0;
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-muted);
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

    .contents .img-ph {
        width: 32px;
        height: 32px;
        border-radius: 4px;
        background: var(--color-border);
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

    @media (max-width: 640px) {
        .subtabs button {
            padding: 10px 10px;
            font-size: 13px;
        }

        .picked-list li {
            gap: 8px;
            padding: 6px 8px;
        }

        .picked-list img,
        .picked-list .img-ph {
            width: 32px;
            height: 32px;
        }

        .w-main small {
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }
    }
</style>
