<script>
    import { damageShort, damageName, damageLabel } from "../rules/labels.js";
    import IconLabel from "./common/IconLabel.svelte";
    import Icon, { hasIcon } from "./common/Icon.svelte";
    /**
     * Character page — modeled on the classic D&D character sheet.
     *
     *  ┌──────────── 2 ────────────┬──────────────────── 4 ────────────────────┐
     *  │ portrait                  │ AC · Initiative · Speed · Hit Points · … │
     *  │ name / class / level      │ 6 abilities + saving throws               │
     *  ├───────── 3 ─────────┬─────┴──────────────── 7 ────────────────────────┤
     *  │ Appearance          │ Attacks · Equipment · Skills · Features & traits│
     *  │ Personality         │                                                 │
     *  └─────────────────────┴─────────────────────────────────────────────────┘
     *
     * id — character id in the DB; onBack(); onEdit(data)
     * onLevelUp / onGiveItem / onEdit — the matching header button is shown
     *   only when the handler is passed (in a game they are left out)
     * backLabel — text of the back button
     * inGame — the sheet of a player in a LAN game: applies the DM's "hp" events,
     *   shows items the DM gives, and reports every state change to the DM (see game.js)
     * actions(leave) — optional snippet at the right of the header (e.g. "Leave game");
     *   wrap handlers in leave(fn) so unsaved state is saved first
     */
    import { onMount } from "svelte";
    import { onGameEvent } from "../server.svelte.js";
    import { EV, applyHp, sendState, findItem, giftEvents } from "../game.js";
    import { printPage } from "../print.js";
    import { exportCharacter } from "../transfer.js";
    import { buildSummary } from "../rules/summary.js";
    import {
        GetCharacter,
        GetCharacterState,
        SaveCharacterState,
    } from "../api.js";
    import { loadRefs, EMPTY_REFS } from "../data/refs.js";
    import { Character } from "../models/Character.js";
    import ActionCard from "./common/ActionCard.svelte";
    import Tooltip from "./common/Tooltip.svelte";
    import { describeItem, acText, ARMOR_CAT } from "../rules/equipment.js";
    import {
        CharacterState,
        BAG_MAX,
    } from "../models/CharacterState.svelte.js";
    import {
        SLOTS,
        equip,
        slotOptions,
        slotOf,
        isTwoHanded,
    } from "../rules/loadout.js";
    import {
        BIO_GROUPS,
        CharacterBuild,
    } from "../models/CharacterBuild.svelte.js";
    import {
        ABILITIES,
        ABILITY_KEYS,
        formatModifier,
    } from "../rules/abilities.js";

    let {
        id,
        onBack,
        onEdit,
        onLevelUp,
        onGiveItem,
        backLabel = "← Characters",
        actions,
        inGame = false,
    } = $props();

    let raw = $state(null); // as loaded from the DB — for editing
    let build = $state(null);
    let ref = $state(EMPTY_REFS);
    let state = $state(null); // CharacterState — Hit Points, resources, slots
    let loading = $state(true);
    let error = $state(null);

    onMount(async () => {
        try {
            const [data, st, refs] = await Promise.all([
                GetCharacter(id),
                GetCharacterState(id),
                loadRefs(),
            ]);
            raw = data;
            build = CharacterBuild.fromJSON(data);
            ref = refs;
            state = CharacterState.fromJSON(st);
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            loading = false;
        }
    });

    // derived layer: everything computed from build + reference data
    const character = $derived(
        build
            ? new Character(
                  build,
                  ref,
                  state?.equipped ?? null,
                  state?.bagAdjust ?? null,
              )
            : null,
    );

    // equipment: changing the item in a slot
    function onEquip(slot, e) {
        state.equipped = equip(
            character.equipped,
            slot,
            e.currentTarget.value,
            character.inventory,
        );
    }
    // the other hand is taken by a two-handed weapon
    const handBlocked = (slot) => {
        if (slot === "armor") return false;
        const other = character.loadout[slot === "main" ? "off" : "main"];
        return isTwoHanded(other);
    };
    const KIND_ORDER = { armor: 0, shield: 1, weapon: 2, item: 3 };

    // worn armor and held shield — for the “Armor” row in equipment
    const worn = $derived(character?.loadout.armor ?? null);
    const heldShield = $derived(
        [character?.loadout.main, character?.loadout.off].find(
            (x) => x?.kind === "shield",
        ) ?? null,
    );
    const weaponInv = (id) =>
        character?.inventory.find(
            (x) => x.kind === "weapon" && x.ref?.id === id,
        );
    const SLOT_TAG = {
        main: "in main hand",
        off: "in off hand",
        armor: "worn",
    };

    // short names for the template
    const race = $derived(character?.race);
    const subrace = $derived(character?.subrace);
    const cls = $derived(character?.cls);
    const subclass = $derived(character?.subclass);
    const armor = $derived(character?.armor);
    const weapons = $derived(character?.weapons ?? []);
    const pack = $derived(character?.pack);
    const sheet = $derived(character);
    const features = $derived(character?.featureGroups ?? []);
    const passives = $derived(
        character?.passives ?? { effects: [], abilities: [] },
    );

    const hpNow = $derived(state && character ? state.currentHp(character) : 0);

    // --- game state (Hit Points, resources, slots, equipment, notes) ---
    // Saved by the “Save” button (or Ctrl/Cmd+S), and also automatically
    // a couple of seconds after a change and when leaving the page.
    let saveTimer;
    let stateError = $state(null);
    let savedJson = $state(null); // what is currently in the DB
    let saving = $state(false);
    let savedAt = $state(null); // time of the last save

    const stateJson = $derived(state ? JSON.stringify(state) : null); // reads all fields → subscription
    const dirty = $derived(
        stateJson != null && savedJson != null && stateJson !== savedJson,
    );

    // --- LAN game: the DM changes Hit Points, the DM's card follows our state ---
    $effect(() => {
        if (!inGame) return;
        return onGameEvent((ev) => {
            if (ev?.kind === EV.HP) applyHp(state, character, ev.data); // autosave picks it up
        });
    });

    // a gift is stored in the DB by WhisperPopups (a custom item is saved to the catalog
    // first); once it is, show it in the open sheet's backpack too — this page never saves the build
    $effect(() => {
        if (!inGame) return;
        const onStored = async (e) => {
            const { kind, id, qty } = e.detail ?? {};
            ref = { ...(await loadRefs()) }; // the catalog may have a new custom item
            if (build && findItem(ref.catalog, kind, id))
                build.addToBag(kind, id, qty);
        };
        giftEvents.addEventListener("stored", onStored);
        return () => giftEvents.removeEventListener("stored", onStored);
    });

    // what the DM's card shows, computed here with this app's data (rules/summary.js)
    const summaryJson = $derived.by(() => {
        if (!inGame || !character || !build || !state) return null;
        try {
            return JSON.stringify(buildSummary(build, character, state));
        } catch (e) {
            console.warn("[game] summary:", e);
            return null;
        }
    });

    let syncTimer;
    $effect(() => {
        if (!inGame || stateJson == null) return;
        const json = stateJson; // on load and after every change (state or build — e.g. a gift)
        const sum = summaryJson;
        clearTimeout(syncTimer);
        syncTimer = setTimeout(() => {
            sendState(JSON.parse(json), sum ? JSON.parse(sum) : null).catch(
                (e) => console.warn("[game] state not sent:", e),
            );
        }, 250);
        return () => clearTimeout(syncTimer);
    });

    // the first value is what was loaded: it is already saved
    $effect(() => {
        if (stateJson != null && savedJson == null) savedJson = stateJson;
    });

    async function saveNow() {
        clearTimeout(saveTimer);
        if (!state) return;
        const json = JSON.stringify(state);
        if (json === savedJson) return;
        saving = true;
        try {
            await SaveCharacterState(id, json);
            savedJson = json;
            savedAt = new Date();
            stateError = null;
        } catch (e) {
            stateError = e?.message ?? String(e);
        } finally {
            saving = false;
        }
    }

    // autosave — a safety net in case the button wasn't pressed
    $effect(() => {
        if (!dirty) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveNow, 2000);
        return () => clearTimeout(saveTimer);
    });

    // leaving the page — save first
    // Export to a .json file (transfer.js): build + state + portrait + the custom records it uses
    let exporting = $state(false);
    let exportNote = $state("");
    let exportError = $state("");
    let exportTimer;
    async function exportSheet() {
        exporting = true;
        exportError = "";
        try {
            const path = await exportCharacter(id);
            if (path) {
                exportNote = `Saved to ${path}`;
                clearTimeout(exportTimer);
                exportTimer = setTimeout(() => (exportNote = ""), 4000);
            }
        } catch (e) {
            exportError = e?.message ?? String(e);
            clearTimeout(exportTimer);
            exportTimer = setTimeout(() => (exportError = ""), 6000);
        } finally {
            exporting = false;
        }
    }

    // Print / Save as PDF: the whole sheet, named after the character (see print.js and style.css)
    const printSheet = () =>
        printPage(
            [build?.name, cls?.name && `${cls.name} ${build.level}`]
                .filter(Boolean)
                .join(" — "),
        );

    const leave =
        (fn) =>
        async (...args) => {
            await saveNow();
            fn?.(...args);
        };

    function onKey(e) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            saveNow();
        }
    }

    /**
     * The field grows in height with its text — no inner scrolling.
     * Parameter — the current text: on change (load, input) recompute the height.
     */
    function autosize(el, _value) {
        const fit = () => {
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight + 2}px`; // +2 — border
        };
        fit();
        // column width changed — lines wrap differently (we ignore our own height changes)
        let width = el.clientWidth;
        const ro = new ResizeObserver(() => {
            if (el.clientWidth !== width) {
                width = el.clientWidth;
                fit();
            }
        });
        ro.observe(el);
        return { update: fit, destroy: () => ro.disconnect() };
    }

    const hhmm = (d) =>
        d?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) ?? "";

    let hpAmount = $state(1);

    // Hit Point buttons (icons: assets/icons/hpDamage|hpHeal|hpTemp.svg)
    const HP_ACTIONS = [
        {
            id: "dmg",
            icon: "hpDamage",
            short: "−",
            label: "Damage",
            run: () => state.damage(hpAmount, character),
        },
        {
            id: "heal",
            icon: "hpHeal",
            short: "+",
            label: "Heal",
            run: () => state.heal(hpAmount, character),
        },
        {
            id: "temp",
            icon: "hpTemp",
            short: "T",
            label: "Temp HP",
            run: () => state.setTempHp(hpAmount),
        },
    ];

    const ft = (n) => `${n} ft.`;
</script>

<!-- item image (or a placeholder letter) -->
{#snippet thumb(it, size = "lg")}
    <span class="thumb {size}" class:empty={!it}>
        {#if it?.ref?.image}<img src={it.ref.image} alt="" />{:else if it}<span
                >{it.name.slice(0, 1)}</span
            >{/if}
    </span>
{/snippet}

<!-- tooltip for a backpack / equipment item -->
{#snippet itemTip(it)}
    {@const info = describeItem(it, { damageShort })}
    <div class="tip">
        <div class="tip-head">
            <b>{info.title}</b>
            {#if info.tag}<span class="tip-tag">{info.tag}</span>{/if}
        </div>
        {#if info.lines.length}
            <ul class="tip-lines">
                {#each info.lines as l}<li>{l}</li>{/each}
            </ul>
        {/if}
        {#if info.desc}<p class="tip-desc">{info.desc}</p>{/if}
    </div>
{/snippet}

<svelte:window onkeydown={onKey} />

<div class="page">
    <header class="top no-print">
        <button class="ghost" onclick={leave(onBack)}>{backLabel}</button>
        {#if build}
            <span class="spacer"></span>
            {#if state}
                <span class="save-status" class:dirty class:err={stateError}>
                    {#if stateError}Not saved
                    {:else if saving}Saving…
                    {:else if dirty}Unsaved changes
                    {:else if savedAt}Saved at {hhmm(savedAt)}
                    {:else}All saved
                    {/if}
                </span>
                <button
                    class="save"
                    onclick={saveNow}
                    disabled={saving || !dirty}
                    title="Save state (Ctrl/Cmd+S)"
                >
                    Save
                </button>
            {/if}
            {#if onGiveItem}
                <button class="ghost" onclick={leave(onGiveItem)}
                    >＋ Give Item</button
                >
            {/if}
            {#if onLevelUp && build.level < 20}
                <button class="ghost levelup" onclick={leave(onLevelUp)}
                    >▲ Level Up</button
                >
            {/if}
            <button
                class="ghost"
                onclick={leave(printSheet)}
                title="Print the whole sheet or save it as a PDF">Print</button
            >
            <button
                class="ghost"
                class:bad={!!exportError}
                onclick={leave(exportSheet)}
                disabled={exporting}
                title={exportError ||
                    exportNote ||
                    "Save the character as a .json file (to move it to another computer or share it)"}
            >
                {exporting
                    ? "Exporting…"
                    : exportError
                      ? "Export failed"
                      : exportNote
                        ? "Exported ✓"
                        : "Export"}
            </button>
            {#if onEdit}
                <button class="ghost" onclick={leave(() => onEdit(raw))}
                    >Edit</button
                >
            {/if}
        {/if}
        {#if actions}
            {#if !build}<span class="spacer"></span>{/if}
            {@render actions(leave)}
        {/if}
    </header>

    {#if loading}
        <p class="muted">Loading…</p>
    {:else if error}
        <p class="error">Failed to load character: {error}</p>
    {:else if build && sheet}
        <!-- ================= top: 2 / 4 ================= -->
        <div class="row row-title">
            <section>
                <h1>{build.name}</h1>
                <p class="class-line">
                    {cls?.name ?? build.classId}
                    <span class="lvl">Level {build.level}</span>
                </p>
                <p class="sub-line">
                    {race?.name ?? build.raceId}{subrace
                        ? ` · ${subrace.name}`
                        : ""}
                    {#if subclass}<br />{subclass.name}{/if}
                </p>
            </section>
        </div>
        <div class="row row-top">
            <!-- portrait + name -->
            <section class="identity">
                <div class="portrait">
                    {#if build.portrait}
                        <img src={build.portrait} alt="Portrait" />
                    {:else}
                        <span class="img-empty">no portrait</span>
                    {/if}
                </div>
            </section>

            <!-- attributes -->
            <section class="stats">
                <div class="combat">
                    <div class="stat shield">
                        <span class="stat-label">AC</span>
                        <span class="stat-value">{sheet.ac}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Initiative</span>
                        <span class="stat-value"
                            >{formatModifier(sheet.initiative)}</span
                        >
                    </div>
                    <div class="stat">
                        <span class="stat-label">Speed</span>
                        <span class="stat-value">{ft(sheet.speed)}</span>
                    </div>
                    <div class="stat hp">
                        <span class="stat-label">Hit Points</span>
                        <span class="stat-value"
                            >{hpNow}<small>/{character.maxHp}</small></span
                        >
                    </div>
                    <div class="stat">
                        <span class="stat-label">Hit Dice</span>
                        <span class="stat-value"
                            >{build.level}d{sheet.hitDie}</span
                        >
                    </div>
                    <div class="stat">
                        <span class="stat-label">Proficiency</span>
                        <span class="stat-value"
                            >{formatModifier(sheet.prof)}</span
                        >
                    </div>
                </div>

                <div class="abilities">
                    {#each ABILITY_KEYS as k}
                        <div class="ability">
                            <span class="ab-name">{ABILITIES[k].name}</span>
                            <span class="ab-mod"
                                >{formatModifier(sheet.mods[k])}</span
                            >
                            <span class="ab-score"
                                >{build.totalAbilities[k] ?? "—"}</span
                            >
                        </div>
                    {/each}
                </div>

                <div class="saves">
                    <h3>Saving Throws</h3>
                    <ul class="checklist cols-3">
                        {#each sheet.saves as s}
                            <li class:prof={s.proficient}>
                                <span class="dot"></span>
                                <span class="val"
                                    >{formatModifier(s.value)}</span
                                >
                                <span>{ABILITIES[s.key].name}</span>
                            </li>
                        {/each}
                    </ul>
                </div>

                <div class="saves">
                    <h3>Skills</h3>
                    <ul class="checklist cols-3">
                        {#each sheet.skills as s (s.id)}
                            <li
                                class:prof={s.proficient}
                                class:expert={s.expertise}
                            >
                                <span class="dot"></span>
                                <span class="val"
                                    >{formatModifier(s.value)}</span
                                >
                                <span
                                    >{s.name}
                                    <small>({ABILITIES[s.ability].short})</small
                                    ></span
                                >
                            </li>
                        {/each}
                    </ul>
                    <p class="passive">
                        Passive Perception: <b>{sheet.passivePerception}</b>
                        {#if sheet.darkvision}· Darkvision: <b
                                >{ft(sheet.darkvision)}</b
                            >{/if}
                    </p>
                </div>
            </section>
        </div>

        <!-- ================= bottom: 3 / 7 ================= -->
        <div class="row row-bottom">
            <!-- Appearance, Personality — in one column -->
            <div class="col">
                {#each BIO_GROUPS as group}
                    <section class="card">
                        <h2>{group.title}</h2>
                        <dl>
                            {#each group.fields as f}
                                <dt>{f.label}</dt>
                                <dd>{build.bio[f.key] || "—"}</dd>
                            {/each}
                        </dl>
                    </section>
                {/each}

                <section class="card">
                    <h2>Backpack</h2>
                    {#if character.inventory.length}
                        <ul class="inventory">
                            {#each [...character.inventory].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) as it (it.key)}
                                {@const where = slotOf(
                                    it.key,
                                    character.equipped,
                                )}
                                <li class:worn={where}>
                                    <span>
                                        <Tooltip>
                                            {it.name}
                                            {#snippet tip()}{@render itemTip(
                                                    it,
                                                )}{/snippet}
                                        </Tooltip>
                                        {#if where}<small class="tag"
                                                >{SLOT_TAG[where]}</small
                                            >{/if}
                                        {#if it.given}<small class="tag"
                                                >given</small
                                            >{/if}
                                    </span>
                                    <span class="qty-ctl">
                                        <button
                                            class="qty-btn"
                                            title="Decrease"
                                            aria-label="Decrease {it.name}"
                                            disabled={it.qty <= 1}
                                            onclick={() =>
                                                state.changeQty(it, -1)}
                                        >
                                            <svg
                                                viewBox="0 0 16 16"
                                                aria-hidden="true"
                                                ><path d="M3.5 8h9" /></svg
                                            >
                                        </button>
                                        <span class="qty">× {it.qty}</span>
                                        <button
                                            class="qty-btn"
                                            title="Increase"
                                            aria-label="Increase {it.name}"
                                            disabled={it.qty >= BAG_MAX}
                                            onclick={() =>
                                                state.changeQty(it, 1)}
                                        >
                                            <svg
                                                viewBox="0 0 16 16"
                                                aria-hidden="true"
                                                ><path
                                                    d="M3.5 8h9M8 3.5v9"
                                                /></svg
                                            >
                                        </button>
                                        <button
                                            class="qty-btn remove"
                                            title="Remove from backpack"
                                            aria-label="Remove {it.name}"
                                            onclick={() => state.removeItem(it)}
                                        >
                                            <svg
                                                viewBox="0 0 16 16"
                                                aria-hidden="true"
                                                ><path
                                                    d="M4.5 4.5l7 7M11.5 4.5l-7 7"
                                                /></svg
                                            >
                                        </button>
                                    </span>
                                </li>
                            {/each}
                        </ul>
                    {:else}
                        <p class="muted">Empty.</p>
                    {/if}
                </section>
                <section class="card">
                    <h2>Features & traits</h2>
                    {#each features as g}
                        <h3>{g.title}</h3>
                        <ul class="features">
                            {#each g.items as f}
                                <li>
                                    <b
                                        >{f.name}{#if f.level}<small>
                                                · Level {f.level}</small
                                            >{/if}</b
                                    >
                                    <span>{f.desc}</span>
                                </li>
                            {/each}
                        </ul>
                    {:else}
                        <p class="muted">No data.</p>
                    {/each}
                </section>
            </div>

            <!-- equipment, skills and more -->
            <div class="col">
                <!-- game state -->
                <section class="card play">
                    <h2>Status</h2>
                    {#if stateError}<p class="error">
                            Not saved: {stateError}
                        </p>{/if}

                    <div class="hp-row">
                        <div class="hp-big" class:down={hpNow === 0}>
                            <span class="hp-now">{hpNow}</span>
                            <span class="hp-max">/ {character.maxHp}</span>
                            {#if state.tempHp}<span class="hp-temp"
                                    >+{state.tempHp} temp</span
                                >{/if}
                        </div>
                        <!-- number and action column: damage / heal / Temp HP -->
                        <div class="hp-ctl">
                            <input
                                class="hp-input"
                                type="number"
                                min="1"
                                bind:value={hpAmount}
                                aria-label="Hit Points amount"
                            />
                            <div class="hp-actions">
                                {#each HP_ACTIONS as act (act.id)}
                                    <Tooltip delay={150}>
                                        <button
                                            class="hp-btn {act.id}"
                                            onclick={() => act.run()}
                                            aria-label={act.label}
                                        >
                                            <Icon
                                                name={act.icon}
                                                label={act.label}
                                                short={act.short}
                                                native={false}
                                            />
                                        </button>
                                        {#snippet tip()}<b>{act.label}</b> by {hpAmount ||
                                                0}{/snippet}
                                    </Tooltip>
                                {/each}
                            </div>
                        </div>
                    </div>

                    {#if character.resources.length}
                        <h3>Resources</h3>
                        <ul class="pools">
                            {#each character.resources as r (r.id)}
                                {@const left = state.resourceLeft(r)}
                                <li>
                                    <span class="pool-name"
                                        >{r.name}{#if r.die}
                                            <b class="pool-die">{r.die}</b>{/if}
                                        <small
                                            ><IconLabel
                                                name={r.recharge === "short"
                                                    ? "shortRest"
                                                    : "longRest"}
                                                kind="rest"
                                                label={r.recharge === "short"
                                                    ? "Recharges on a Short Rest"
                                                    : "Recharges on a Long Rest"}
                                                text={r.recharge === "short"
                                                    ? "Short Rest"
                                                    : "Long Rest"}
                                            /></small
                                        ></span
                                    >
                                    <span class="pips">
                                        {#if r.max > 10}
                                            <button
                                                class="ghost step"
                                                onclick={() => state.spend(r)}
                                                disabled={left === 0}
                                                aria-label="Spend">−</button
                                            >
                                            <button
                                                class="ghost step"
                                                onclick={() => state.restore(r)}
                                                disabled={left === r.max}
                                                aria-label="Restore">+</button
                                            >
                                        {:else}
                                            {#each Array(r.max) as _, i}
                                                <button
                                                    class="pip"
                                                    class:full={i < left}
                                                    title={i < left
                                                        ? "Spend"
                                                        : "Restore"}
                                                    aria-label={r.name}
                                                    onclick={() =>
                                                        i < left
                                                            ? state.spend(r)
                                                            : state.restore(r)}
                                                ></button>
                                            {/each}
                                        {/if}
                                    </span>
                                    <span class="pool-count"
                                        >{left}/{r.max}</span
                                    >
                                </li>
                            {/each}
                        </ul>
                    {/if}

                    {#if character.spellSlots.length}
                        <h3>
                            Spell Slots
                            <small class="sc-meta"
                                ><IconLabel
                                    name="dc"
                                    kind="meta"
                                    label="Your spell save DC"
                                    text="DC"
                                />
                                {character.spellcasting.saveDC} · attack {formatModifier(
                                    character.spellcasting.attack,
                                )}</small
                            >
                        </h3>
                        <ul class="pools">
                            {#each character.spellSlots as slot (state.slotKey(slot))}
                                {@const left = state.slotsLeft(slot)}
                                <li>
                                    <span class="pool-name">
                                        <IconLabel
                                            name={slot.pact ? "pact" : "slot"}
                                            kind="meta"
                                            label={slot.pact
                                                ? "Pact slot — recharges on a Short Rest"
                                                : "Spell slot"}
                                            text=""
                                        />
                                        Level {slot.level}{#if slot.pact && !hasIcon("pact")}
                                            <small>pact</small>{/if}
                                    </span>
                                    <span class="pips">
                                        {#each Array(slot.max) as _, i}
                                            <button
                                                class="pip slot"
                                                class:pact={slot.pact}
                                                class:full={i < left}
                                                aria-label="Level {slot.level} slot"
                                                onclick={() =>
                                                    state.useSlot(
                                                        slot,
                                                        i < left ? 1 : -1,
                                                    )}
                                            ></button>
                                        {/each}
                                    </span>
                                    <span class="pool-count"
                                        >{left}/{slot.max}</span
                                    >
                                </li>
                            {/each}
                        </ul>
                    {/if}

                    <div class="rests">
                        <button
                            class="ghost"
                            onclick={() => state.shortRest(character)}
                            >Short Rest</button
                        >
                        <button
                            class="ghost"
                            onclick={() => state.longRest(character)}
                            >Long Rest</button
                        >
                    </div>
                </section>

                <!-- passive effects: always active -->
                {#if passives.effects.length || passives.abilities.length}
                    <section class="card passives">
                        <h2>Passive effects</h2>
                        {#if passives.effects.length}
                            <dl class="fx">
                                {#each passives.effects as g (g.id)}
                                    <dt class="fx-{g.id}">{g.title}</dt>
                                    <dd>
                                        {#each g.items as l (l.label)}
                                            <Tooltip>
                                                <span
                                                    class="fx-chip fx-{g.id}"
                                                    style={l.dmg
                                                        ? `--c: var(--color-dmg-${l.dmg})`
                                                        : ""}
                                                >
                                                    {#if l.dmg && hasIcon(l.dmg)}<Icon
                                                            name={l.dmg}
                                                            kind="dmg"
                                                            label={l.label}
                                                            native={false}
                                                        />{:else}{l.label}{/if}
                                                </span>
                                                {#snippet tip()}
                                                    <div class="tip">
                                                        {#if l.dmg}<div
                                                                class="tip-head"
                                                            >
                                                                <b
                                                                    >{g.title}: {l.label}</b
                                                                >
                                                            </div>{/if}
                                                        {#if l.note}<p
                                                                class="tip-desc"
                                                            >
                                                                {l.note}
                                                            </p>{/if}
                                                        {#each l.sources as s}
                                                            <div
                                                                class="tip-head"
                                                            >
                                                                <b>{s.name}</b>
                                                                {#if s.from}<span
                                                                        class="tip-tag"
                                                                        >{s.from}</span
                                                                    >{/if}
                                                            </div>
                                                            {#if s.desc}<p
                                                                    class="tip-desc"
                                                                >
                                                                    {s.desc}
                                                                </p>{/if}
                                                        {/each}
                                                    </div>
                                                {/snippet}
                                            </Tooltip>
                                        {/each}
                                    </dd>
                                {/each}
                            </dl>
                        {/if}
                        {#if passives.abilities.length}
                            <h3>Features</h3>
                            <ul class="pa">
                                {#each passives.abilities as a (a.source + a.name)}
                                    <li>
                                        <Tooltip>
                                            <b>{a.name}</b>
                                            {#snippet tip()}
                                                <div class="tip">
                                                    <div class="tip-head">
                                                        <b>{a.name}</b>
                                                        <span class="tip-tag"
                                                            >{a.source}{a.level
                                                                ? ` · Level ${a.level}`
                                                                : ""}</span
                                                        >
                                                    </div>
                                                    {#if a.desc}<p
                                                            class="tip-desc"
                                                        >
                                                            {a.desc}
                                                        </p>{/if}
                                                </div>
                                            {/snippet}
                                        </Tooltip>
                                        <small>{a.source}</small>
                                        {#each a.notes as n}<span
                                                class="pa-note">{n}</span
                                            >{/each}
                                    </li>
                                {/each}
                            </ul>
                        {/if}
                    </section>
                {/if}

                <section class="card">
                    <h2>Equipment & attacks</h2>
                    <div class="slots">
                        {#each SLOTS as slot (slot.id)}
                            {@const blocked = handBlocked(slot.id)}
                            {@const held = character.loadout[slot.id]}
                            <label class="slot" class:blocked>
                                <span>{slot.label}</span>
                                {#if held}
                                    <Tooltip>
                                        {@render thumb(held, "lg")}
                                        {#snippet tip()}{@render itemTip(
                                                held,
                                            )}{/snippet}
                                    </Tooltip>
                                {:else}
                                    {@render thumb(null, "lg")}
                                {/if}
                                <select
                                    value={character.equipped[slot.id] ?? ""}
                                    disabled={blocked}
                                    onchange={(e) => onEquip(slot.id, e)}
                                >
                                    <option value=""
                                        >{blocked
                                            ? "— occupied (two-handed) —"
                                            : "— empty —"}</option
                                    >
                                    {#each slotOptions(slot.id, character.inventory) as it (it.key)}
                                        <option value={it.key}>
                                            {it.name}{isTwoHanded(it)
                                                ? " (two-handed)"
                                                : (
                                                        it.ref?.data
                                                            ?.properties ?? []
                                                    ).includes("light")
                                                  ? " (light)"
                                                  : ""}
                                        </option>
                                    {/each}
                                </select>
                            </label>
                        {/each}
                    </div>

                    <div class="armor-line">
                        <span class="al-label">Armor</span>
                        {#if worn}
                            <Tooltip>
                                <b class="al-name">{worn.name}</b>
                                {#snippet tip()}{@render itemTip(
                                        worn,
                                    )}{/snippet}
                            </Tooltip>
                            <span class="al-meta"
                                >{ARMOR_CAT[worn.ref.category] ?? ""} · AC {acText(
                                    worn.ref,
                                )}{worn.ref.data?.acBonus
                                    ? ` +${worn.ref.data.acBonus}`
                                    : ""}</span
                            >
                            {#if worn.ref.data?.stealthDisadvantage}<span
                                    class="al-warn">Stealth Disadvantage</span
                                >{/if}
                        {:else}
                            <span class="al-meta">no armor</span>
                        {/if}
                        {#if heldShield}
                            <span class="al-sep">+</span>
                            <Tooltip>
                                <b class="al-name">{heldShield.name}</b>
                                {#snippet tip()}{@render itemTip(
                                        heldShield,
                                    )}{/snippet}
                            </Tooltip>
                            <span class="al-meta"
                                >+{heldShield.ref.data?.acBonus ?? 2} AC</span
                            >
                        {/if}
                        <span class="al-total">Total AC <b>{sheet.ac}</b></span>
                    </div>

                    <table class="attacks">
                        <thead>
                            <tr
                                ><th>Hand</th><th>Weapon</th><th>Action</th><th
                                    >Bonus</th
                                ><th>Damage / type</th></tr
                            >
                        </thead>
                        <tbody>
                            {#each sheet.attacks as a (a.hand + a.id)}
                                <tr>
                                    <td class="hand"
                                        >{a.hand === "off" ? "off" : "main"}</td
                                    >
                                    <td>
                                        {#if weaponInv(a.id)}
                                            <Tooltip>
                                                {a.name}
                                                {#snippet tip()}{@render itemTip(
                                                        weaponInv(a.id),
                                                    )}{/snippet}
                                            </Tooltip>
                                        {:else}{a.name}{/if}
                                        {#if a.magic}<small class="magic"
                                                >★</small
                                            >{/if}
                                    </td>
                                    <td
                                        class="act"
                                        class:bonus={a.action === "bonus"}
                                    >
                                        {a.action === "bonus"
                                            ? "bonus"
                                            : "attack"}
                                    </td>
                                    <td class="num"
                                        >{formatModifier(a.toHit)}</td
                                    >
                                    <td>
                                        {a.damage}
                                        <small class="dmg-ico"
                                            ><IconLabel
                                                name={a.damageType}
                                                kind="dmg"
                                                label={damageLabel(
                                                    a.damageType,
                                                )}
                                                text={damageShort(a.damageType)}
                                            /></small
                                        >
                                        {#each a.extra ?? [] as x}
                                            <span class="extra"
                                                >+ {x.dice}
                                                <small class="dmg-ico"
                                                    ><IconLabel
                                                        name={x.type}
                                                        kind="dmg"
                                                        label={damageLabel(
                                                            x.type,
                                                        )}
                                                        text={damageShort(
                                                            x.type,
                                                        )}
                                                    /></small
                                                ></span
                                            >
                                        {/each}
                                        {#if a.note}<small class="hint"
                                                >· {a.note}</small
                                            >{/if}
                                    </td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                </section>

                {#if character.actionGroups.length}
                    <section class="card">
                        <h2>
                            Actions & spells
                            {#if character.spellcasting}
                                <small class="h2-sub">
                                    DC {character.spellcasting.saveDC} · attack {formatModifier(
                                        character.spellcasting.attack,
                                    )}
                                </small>
                            {/if}
                        </h2>
                        {#each character.actionGroups as g (g.title)}
                            <h3>{g.title}</h3>
                            <div class="cards">
                                {#each g.cards as c (c.item.id)}
                                    <ActionCard
                                        item={c.item}
                                        level={character.level}
                                        source={c.source}
                                        uses={c.uses}
                                        saveDC={g.spells
                                            ? (c.saveDC ?? null)
                                            : null}
                                        note={c.note ?? ""}
                                    />
                                {/each}
                            </div>
                        {/each}
                    </section>
                {/if}

                <!-- player notes: stored in the character state -->
                {#if state}
                    <section class="card notes">
                        <h2>
                            Notes
                            {#if dirty}<small class="h2-sub">not saved</small
                                >{/if}
                        </h2>
                        <textarea
                            bind:value={state.notes}
                            use:autosize={state.notes}
                            rows="6"
                            placeholder="Quests, NPC names, debts, clues found…"
                        ></textarea>
                    </section>
                {/if}
            </div>
        </div>
    {/if}
</div>

<style>
    .page {
        min-height: 100%;
        padding: 24px 32px 40px;
        display: flex;
        flex-direction: column;
        gap: 20px;
    }

    .top {
        display: flex;
        justify-content: space-between;
        gap: 12px;
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

    .spacer {
        flex: 1;
    }

    .top {
        align-items: center;
    }

    .ghost.bad {
        border-color: var(--color-danger);
        color: var(--color-danger);
    }

    .save-status {
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .save-status.dirty {
        color: var(--color-text-accent);
    }

    .save-status.err {
        color: var(--color-danger);
    }

    .save {
        padding: 6px 16px;
        background: var(--color-gold);
        border: 1px solid var(--color-gold);
        border-radius: 6px;
        color: var(--color-bg);
        font-family: var(--font-ui);
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
    }

    .save:hover:not(:disabled) {
        background: var(--color-gold-hover);
    }

    .save:disabled {
        background: transparent;
        border-color: var(--color-border);
        color: var(--color-text-muted);
        cursor: default;
    }

    .notes textarea {
        width: 100%;
        min-height: 140px;
        box-sizing: border-box;
        padding: 10px 12px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-primary);
        font-family: var(--font-lore);
        font-size: 15px;
        line-height: 1.5;
        resize: none; /* height is set by the text (autosize) */
        overflow: hidden; /* no inner scrolling */
        outline: none;
    }

    .notes textarea:focus {
        border-color: var(--color-gold);
    }

    .ghost.levelup {
        border-color: var(--color-gold);
        color: var(--color-gold);
    }

    .ghost.levelup:hover {
        background: var(--color-gold);
        color: var(--color-bg);
    }

    .ghost.danger:hover {
        border-color: var(--color-danger);
        color: var(--color-danger);
    }

    .ghost.ok:hover {
        border-color: var(--color-success);
        color: var(--color-success);
    }

    /* ---------- status ---------- */
    .hp-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
    }

    .hp-big {
        margin-right: 8px;
        display: flex;
        align-items: baseline;
        gap: 4px;
        font-family: var(--font-heading);
    }

    .hp-now {
        font-size: 32px;
        color: var(--color-text-primary);
    }

    .hp-big.down .hp-now {
        color: var(--color-danger);
    }

    .hp-max {
        font-size: 16px;
        color: var(--color-text-muted);
    }

    .hp-temp {
        margin-left: 6px;
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-accent);
    }

    .hp-ctl {
        display: flex;
        align-items: stretch;
        gap: 6px;
    }

    /* number field — as tall as the button column */
    .hp-input {
        width: 76px;
        padding: 0 8px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        color: var(--color-text-primary);
        font-family: var(--font-heading);
        font-size: 28px;
        text-align: center;
    }

    .hp-input:focus {
        outline: none;
        border-color: var(--color-gold);
    }

    .hp-actions {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .hp-actions :global(.anchor) {
        display: block;
    }

    .hp-btn {
        --c: var(--color-text-secondary);
        width: 30px;
        height: 26px;
        display: grid;
        place-items: center;
        padding: 0;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--c);
        cursor: pointer;
    }

    .hp-btn :global(.icon) {
        color: var(--c);
        width: 16px;
        height: 16px;
    }

    .hp-btn.dmg {
        --c: var(--color-danger);
    }
    .hp-btn.heal {
        --c: var(--color-success);
    }
    .hp-btn.temp {
        --c: var(--color-text-accent);
    }

    .hp-btn:hover {
        border-color: var(--c);
        background: color-mix(in srgb, var(--c) 15%, transparent);
    }

    .pools {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .pools li {
        display: grid;
        grid-template-columns: minmax(140px, auto) 1fr auto;
        align-items: center;
        gap: 12px;
    }

    .pool-name {
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-primary);
    }

    .pool-name small,
    h3 small {
        margin-left: 4px;
        font-family: var(--font-ui);
        font-size: 11px;
        color: var(--color-text-muted);
    }

    .pips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }

    .pip {
        width: 16px;
        height: 16px;
        padding: 0;
        background: transparent;
        border: 1px solid var(--color-gold);
        border-radius: 50%;
        cursor: pointer;
    }

    .pip.full {
        background: var(--color-gold);
    }

    .ghost.step {
        padding: 2px 10px;
    }

    .pip.slot {
        border-color: var(--color-slot);
        border-radius: 3px;
        transform: rotate(45deg);
    }

    .pip.slot.full {
        background: var(--color-slot);
    }

    /* warlock pact slots */
    .pip.slot.pact {
        border-color: var(--color-slot-pact);
    }

    .pip.slot.pact.full {
        background: var(--color-slot-pact);
    }

    .pool-count {
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .rests {
        margin-top: 14px;
        padding-top: 10px;
        border-top: 1px solid var(--color-border);
        display: flex;
        gap: 8px;
    }

    .stat-value small {
        font-size: 13px;
        color: var(--color-text-muted);
    }

    .ghost:hover {
        border-color: var(--color-gold);
        color: var(--color-gold-hover);
    }

    /* ---------- grids ---------- */
    .row {
        display: grid;
        gap: 20px;
        align-items: start;
    }

    .row-top {
        grid-template-columns: 2fr 4fr;
    }

    .row-bottom {
        grid-template-columns: 3fr 7fr;
    }

    .col {
        display: flex;
        flex-direction: column;
        gap: 16px;
        min-width: 0;
    }

    .pair {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        align-items: start;
    }

    @media (max-width: 900px) {
        .row-top,
        .row-bottom,
        .pair {
            grid-template-columns: 1fr;
        }
    }

    .card {
        padding: 16px 20px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        min-width: 0;
    }

    h2 {
        margin: 0 0 12px;
        padding-bottom: 6px;
        border-bottom: 1px solid var(--color-border);
        font-family: var(--font-heading);
        font-size: 15px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-gold);
    }

    h3 {
        margin: 12px 0 6px;
        font-family: var(--font-heading-alt);
        font-size: 16px;
        color: var(--color-text-accent);
    }

    h3:first-of-type {
        margin-top: 0;
    }

    /* ---------- portrait + name ---------- */
    .identity {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        min-width: 0;
    }

    .portrait {
        width: 100%;
        aspect-ratio: 1;
        border: 2px solid var(--color-gold);
        border-radius: 12px;
        overflow: hidden;
        background: var(--color-card);
    }

    .portrait img {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: cover;
    }

    .img-empty {
        width: 100%;
        height: 100%;
        display: grid;
        place-items: center;
        font-family: var(--font-ui);
        color: var(--color-text-muted);
    }

    h1 {
        margin: 14px 0 2px;
        font-family: var(--font-heading);
        font-size: 32px;
        line-height: 1.1;
        color: var(--color-gold);
        word-break: break-word;
    }

    .class-line {
        margin: 0;
        font-family: var(--font-heading-alt);
        font-size: 20px;
        color: var(--color-text-primary);
    }

    .class-line .lvl {
        margin-left: 6px;
        padding: 1px 10px;
        border: 1px solid var(--color-magic-purple);
        border-radius: 999px;
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-secondary);
        vertical-align: middle;
    }

    .sub-line {
        margin: 4px 0 0;
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    /* ---------- attributes ---------- */
    .stats {
        display: flex;
        flex-direction: column;
        gap: 18px;
        min-width: 0;
    }

    .combat {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 10px;
    }

    .stat {
        padding: 10px 6px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        text-align: center;
    }

    .stat.shield {
        border-color: var(--color-gold);
        border-radius: 8px 8px 40% 40%;
    }

    .stat.hp {
        border-color: var(--color-danger);
    }

    .stat-label {
        font-family: var(--font-ui);
        font-size: 10px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-text-muted);
    }

    .stat-value {
        font-family: var(--font-heading);
        font-size: 22px;
        color: var(--color-text-primary);
        white-space: nowrap;
    }

    /* classic ability block: name, large modifier, score in an oval */
    .abilities {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 12px;
        padding-bottom: 12px;
    }

    .ability {
        position: relative;
        padding: 10px 6px 22px;
        display: flex;
        flex-direction: column;
        align-items: center;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-gold);
        border-radius: 10px;
    }

    .ab-name {
        font-family: var(--font-ui);
        font-size: 10px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-text-secondary);
    }

    .ab-mod {
        font-family: var(--font-heading);
        font-size: 34px;
        line-height: 1.1;
        color: var(--color-text-primary);
    }

    .ab-score {
        position: absolute;
        bottom: -12px;
        left: 50%;
        transform: translateX(-50%);
        min-width: 44px;
        padding: 2px 10px;
        background: var(--color-bg);
        border: 1px solid var(--color-gold);
        border-radius: 999px;
        font-family: var(--font-ui);
        font-weight: var(--font-weight-semibold);
        font-size: 14px;
        text-align: center;
        color: var(--color-gold);
    }

    .saves {
        padding: 12px 16px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 8px;
    }

    .saves h3 {
        margin: 0 0 8px;
        font-family: var(--font-heading);
        font-size: 13px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-gold);
    }

    /* list with a “proficiency circle”, as on the sheet */
    .checklist {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .checklist.cols-3 {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 4px 16px;
    }

    .checklist li {
        display: flex;
        align-items: center;
        gap: 8px;
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .checklist li.prof {
        color: var(--color-text-primary);
    }

    .checklist small {
        color: var(--color-text-muted);
    }

    .dot {
        flex: 0 0 10px;
        height: 10px;
        border: 1px solid var(--color-text-muted);
        border-radius: 50%;
    }

    .prof .dot {
        background: var(--color-gold);
        border-color: var(--color-gold);
    }

    .val {
        flex: 0 0 28px;
        font-weight: var(--font-weight-semibold);
        text-align: right;
        color: var(--color-text-primary);
    }

    .passive {
        margin: 12px 0 0;
        padding-top: 8px;
        border-top: 1px solid var(--color-border);
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .passive b {
        color: var(--color-text-primary);
    }

    /* ---------- texts ---------- */
    dl {
        margin: 0;
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 6px 14px;
    }

    dt {
        padding-top: 2px;
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-muted);
    }

    dd {
        margin: 0;
        font-family: var(--font-lore);
        font-size: 15px;
        color: var(--color-text-primary);
        word-break: break-word;
    }

    /* ---------- attacks ---------- */
    .attacks {
        width: 100%;
        border-collapse: collapse;
        font-family: var(--font-ui);
        font-size: 14px;
    }

    .attacks th {
        padding: 4px 8px;
        text-align: left;
        font-size: 11px;
        font-weight: var(--font-weight-regular);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-text-muted);
        border-bottom: 1px solid var(--color-border);
    }

    .attacks td {
        padding: 6px 8px;
        border-bottom: 1px solid var(--color-border);
        color: var(--color-text-primary);
    }

    .attacks tr:last-child td {
        border-bottom: none;
    }

    .attacks .num {
        font-weight: var(--font-weight-semibold);
        color: var(--color-gold);
    }

    .attacks small {
        color: var(--color-text-secondary);
    }

    /* ---------- equipment ---------- */
    .slots {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
        margin-bottom: 14px;
    }

    @media (max-width: 900px) {
        .slots {
            grid-template-columns: 1fr;
        }
    }

    .slot {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .slot > span {
        font-family: var(--font-ui);
        font-size: 11px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-text-muted);
    }

    /* item image */
    .thumb {
        display: inline-grid;
        place-items: center;
        flex: 0 0 auto;
        overflow: hidden;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        vertical-align: middle;
    }

    .thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .thumb span {
        font-family: var(--font-heading);
        color: var(--color-text-muted);
    }

    /* fixed square centered in the slot; shrinks in a narrow column without cropping */
    .thumb.lg {
        width: min(150px, 100%);
        aspect-ratio: 1;
        align-self: center;
        border-radius: 8px;
    }

    /* whole image, no cropping */
    .thumb.lg img {
        object-fit: contain;
    }

    .thumb.lg span {
        font-size: 36px;
    }

    .thumb.empty {
        border-style: dashed;
        opacity: 0.5;
    }

    .slot :global(.anchor) {
        display: flex;
        justify-content: center;
    }

    .slot select {
        width: 100%;
        padding: 7px 8px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: 14px;
    }

    .slot select:focus {
        outline: none;
        border-color: var(--color-gold);
    }

    .slot.blocked select {
        opacity: 0.5;
    }

    .attacks .hand {
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .attacks .act {
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .attacks .act.bonus {
        color: var(--color-act-bonus);
    }

    .attacks .hint {
        color: var(--color-text-muted);
    }

    .checklist.cols-2 {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 4px 20px;
    }

    .inventory li.worn span:first-child {
        color: var(--color-gold);
    }

    .inventory .tag {
        margin-left: 6px;
        font-size: 11px;
        color: var(--color-text-muted);
    }

    /* ---------- inventory ---------- */
    .inventory {
        margin: 12px 0 0;
        padding: 8px 0 0;
        list-style: none;
        border-top: 1px solid var(--color-border);
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-primary);
    }

    .inventory li {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .qty {
        color: var(--color-gold);
    }

    .qty-ctl {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        flex: 0 0 auto;
    }

    .qty-ctl .qty {
        min-width: 44px;
        text-align: center;
        font-variant-numeric: tabular-nums;
    }

    .qty-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        padding: 0;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 4px;
        color: var(--color-text-secondary);
        cursor: pointer;
    }

    .qty-btn svg {
        width: 12px;
        height: 12px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.6;
        stroke-linecap: round;
    }

    .qty-btn:hover:not(:disabled) {
        border-color: var(--color-gold);
        color: var(--color-gold-hover);
    }

    .qty-btn.remove {
        margin-left: 4px;
    }

    .qty-btn.remove:hover {
        border-color: var(--color-danger);
        color: var(--color-danger);
    }

    .qty-btn:disabled {
        opacity: 0.35;
        cursor: default;
    }

    @media print {
        .qty-btn {
            display: none;
        }
    }

    /* ---------- features ---------- */
    .features {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .features li {
        display: flex;
        flex-direction: column;
    }

    .features b {
        font-family: var(--font-ui);
        font-size: 13px;
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
    }

    .features b small {
        font-weight: var(--font-weight-regular);
        color: var(--color-text-muted);
    }

    .features span {
        font-family: var(--font-spell);
        font-size: 15px;
        color: var(--color-text-secondary);
    }

    .muted {
        margin: 0;
        color: var(--color-text-muted);
    }

    .error {
        margin: 0;
        color: var(--color-danger);
    }

    /* backpack — a separate card, no top divider */
    .card > .inventory {
        margin: 0;
        padding: 0;
        border-top: none;
    }

    /* ---------- spells ---------- */
    .spells {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .spells li {
        display: grid;
        grid-template-columns: 48px auto 1fr;
        gap: 2px 10px;
        align-items: baseline;
    }

    .sp-lvl {
        font-family: var(--font-ui);
        font-size: 11px;
        color: var(--color-text-accent);
    }

    .spells b {
        font-family: var(--font-ui);
        font-size: 14px;
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
    }

    .sp-tag {
        font-family: var(--font-ui);
        font-size: 10px;
        color: var(--color-text-muted);
    }

    .sp-desc {
        grid-column: 2 / -1;
        font-family: var(--font-spell);
        font-size: 14px;
        color: var(--color-text-secondary);
    }

    /* ---------- action cards ---------- */
    .cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 10px;
        margin-bottom: 8px;
    }

    .h2-sub {
        margin-left: 8px;
        font-family: var(--font-ui);
        font-size: 12px;
        letter-spacing: 0;
        text-transform: none;
        color: var(--color-text-secondary);
    }

    /* expertise: outlined circle */
    .checklist li.expert .dot {
        box-shadow:
            0 0 0 2px var(--color-bg),
            0 0 0 3px var(--color-gold);
    }

    /* ---------- tooltips ---------- */
    .tip {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .tip-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
    }

    .tip-head b {
        font-size: 14px;
        color: var(--color-gold);
    }

    .tip-tag {
        font-size: 10px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-text-accent);
    }

    .tip-lines {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .tip-desc {
        margin: 0;
        font-family: var(--font-spell);
        font-size: 14px;
        line-height: 1.35;
        color: var(--color-text-primary);
    }

    /* ---------- worn armor ---------- */
    .armor-line {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 6px 10px;
        margin-bottom: 12px;
        padding: 8px 12px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        font-family: var(--font-ui);
        font-size: 13px;
    }

    .al-label {
        font-size: 11px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-text-muted);
    }

    .al-name {
        color: var(--color-text-primary);
        font-weight: var(--font-weight-semibold);
        border-bottom: 1px dotted var(--color-text-muted);
    }

    .al-meta,
    .al-sep {
        color: var(--color-text-secondary);
    }

    .al-warn {
        color: var(--color-danger);
        font-size: 12px;
    }

    .al-total {
        margin-left: auto;
        color: var(--color-text-secondary);
    }

    .al-total b {
        font-family: var(--font-heading);
        font-size: 16px;
        color: var(--color-gold);
    }

    .attacks .extra {
        margin-left: 4px;
        color: var(--color-text-accent);
    }

    .attacks .magic {
        margin-left: 4px;
        color: var(--color-gold);
    }

    .inventory :global(.anchor) {
        border-bottom: 1px dotted var(--color-text-muted);
    }
    /* --- passive effects --- */
    .fx {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 8px 14px;
        margin: 0 0 4px;
        align-items: baseline;
    }

    .fx dt {
        font-family: var(--font-ui);
        font-size: 12px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--color-text-muted);
    }

    .fx dd {
        margin: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }

    .fx-chip {
        --c: var(--color-text-accent);
        display: inline-block;
        padding: 2px 10px;
        border: 1px solid color-mix(in srgb, var(--c) 55%, transparent);
        border-radius: 999px;
        background: color-mix(in srgb, var(--c) 12%, transparent);
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--c);
    }

    .fx-chip.fx-advantage {
        --c: var(--color-success);
    }
    .fx-chip.fx-disadvantage {
        --c: var(--color-danger);
    }
    .fx-chip.fx-sense {
        --c: var(--color-rest-shortRest);
    }
    .fx-chip.fx-bonus {
        --c: var(--color-gold);
    }
    .fx-chip.fx-note {
        --c: var(--color-text-secondary);
    }

    .pa {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .pa li {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 4px 10px;
        font-family: var(--font-ui);
        font-size: 14px;
    }

    .pa b {
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
    }

    .pa small {
        font-size: 11px;
        color: var(--color-text-muted);
    }

    .pa-note {
        flex-basis: 100%;
        font-size: 12px;
        color: var(--color-text-accent);
    }

    .pool-die {
        margin-left: 4px;
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-accent);
    }
</style>
