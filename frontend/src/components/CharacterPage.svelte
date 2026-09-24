<script>
    import { damageShort, damageName, damageLabel } from "../rules/labels.js";
    import IconLabel from "./common/IconLabel.svelte";
    import Icon, { hasIcon } from "./common/Icon.svelte";
    /**
     * Страница персонажа — по мотивам классического листа D&D.
     *
     *  ┌──────────── 2 ────────────┬──────────────────── 4 ────────────────────┐
     *  │ портрет                   │ КД · Инициатива · Скорость · Хиты · …    │
     *  │ имя / класс / уровень     │ 6 характеристик + спасброски              │
     *  ├───────── 3 ─────────┬─────┴──────────────── 7 ────────────────────────┤
     *  │ Внешность           │ Атаки · Снаряжение · Навыки · Черты и умения    │
     *  │ Личность            │                                                 │
     *  └─────────────────────┴─────────────────────────────────────────────────┘
     *
     * id — id персонажа в БД; onBack(); onEdit(data)
     */
    import { onMount } from "svelte";
    import {
        GetCharacter,
        GetCharacterState,
        SaveCharacterState,
    } from "../../wailsjs/go/main/App.js";
    import { loadRefs, EMPTY_REFS } from "../data/refs.js";
    import { Character } from "../models/Character.js";
    import ActionCard from "./common/ActionCard.svelte";
    import Tooltip from "./common/Tooltip.svelte";
    import { describeItem, acText, ARMOR_CAT } from "../rules/equipment.js";
    import { CharacterState } from "../models/CharacterState.svelte.js";
    import { SLOTS, equip, slotOptions, slotOf, isTwoHanded } from "../rules/loadout.js";
    import {
        BIO_GROUPS,
        CharacterBuild,
    } from "../models/CharacterBuild.svelte.js";
    import {
        ABILITIES,
        ABILITY_KEYS,
        formatModifier,
    } from "../rules/abilities.js";

    let { id, onBack, onEdit, onLevelUp, onGiveItem } = $props();

    let raw = $state(null); // как пришло из БД — для редактирования
    let build = $state(null);
    let ref = $state(EMPTY_REFS);
    let state = $state(null); // CharacterState — хиты, ресурсы, ячейки
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

    // производный слой: всё посчитанное из build + справочников
    const character = $derived(
        build ? new Character(build, ref, state?.equipped ?? null) : null,
    );

    // экипировка: смена предмета в слоте
    function onEquip(slot, e) {
        state.equipped = equip(character.equipped, slot, e.currentTarget.value, character.inventory);
    }
    // вторая рука занята двуручным оружием
    const handBlocked = (slot) => {
        if (slot === "armor") return false;
        const other = character.loadout[slot === "main" ? "off" : "main"];
        return isTwoHanded(other);
    };
    const KIND_ORDER = { armor: 0, shield: 1, weapon: 2, item: 3 };

    // надетый доспех и щит в руке — для строки «Доспех» в экипировке
    const worn = $derived(character?.loadout.armor ?? null);
    const heldShield = $derived(
        [character?.loadout.main, character?.loadout.off].find((x) => x?.kind === "shield") ?? null,
    );
    const weaponInv = (id) => character?.inventory.find((x) => x.kind === "weapon" && x.ref?.id === id);
    const SLOT_TAG = { main: "в правой руке", off: "в левой руке", armor: "надет" };

    // короткие имена для шаблона
    const race = $derived(character?.race);
    const subrace = $derived(character?.subrace);
    const cls = $derived(character?.cls);
    const subclass = $derived(character?.subclass);
    const armor = $derived(character?.armor);
    const weapons = $derived(character?.weapons ?? []);
    const pack = $derived(character?.pack);
    const sheet = $derived(character);
    const features = $derived(character?.featureGroups ?? []);
    const passives = $derived(character?.passives ?? { effects: [], abilities: [] });

    const hpNow = $derived(state && character ? state.currentHp(character) : 0);

    // --- игровое состояние (хиты, ресурсы, ячейки, экипировка, заметки) ---
    // Сохраняется кнопкой «Сохранить» (или Ctrl/Cmd+S), а также автоматически
    // через пару секунд после изменения и при уходе со страницы.
    let saveTimer;
    let stateError = $state(null);
    let savedJson = $state(null); // что сейчас лежит в БД
    let saving = $state(false);
    let savedAt = $state(null);   // время последнего сохранения

    const stateJson = $derived(state ? JSON.stringify(state) : null); // читает все поля → подписка
    const dirty = $derived(stateJson != null && savedJson != null && stateJson !== savedJson);

    // первое значение — то, что загрузили: оно уже сохранено
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

    // автосохранение — страховка, если забыли нажать кнопку
    $effect(() => {
        if (!dirty) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveNow, 2000);
        return () => clearTimeout(saveTimer);
    });

    // уходим со страницы — сначала сохранить
    const leave = (fn) => async (...args) => {
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
     * Поле растёт по высоте вместе с текстом — без внутренней прокрутки.
     * Параметр — текущий текст: при смене (загрузка, ввод) пересчитываем высоту.
     */
    function autosize(el, _value) {
        const fit = () => {
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight + 2}px`; // +2 — рамка
        };
        fit();
        // ширина колонки изменилась — строки переносятся иначе (на свою высоту не реагируем)
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

    const hhmm = (d) => d?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) ?? "";

    let hpAmount = $state(1);

    // кнопки хитов (иконки: assets/icons/hpDamage|hpHeal|hpTemp.svg)
    const HP_ACTIONS = [
        { id: "dmg", icon: "hpDamage", short: "−", label: "Урон", run: () => state.damage(hpAmount, character) },
        { id: "heal", icon: "hpHeal", short: "+", label: "Лечение", run: () => state.heal(hpAmount, character) },
        { id: "temp", icon: "hpTemp", short: "В", label: "Временные хиты", run: () => state.setTempHp(hpAmount) },
    ];

    const ft = (n) => `${n} фт.`;
</script>

<!-- картинка предмета (или буква-заглушка) -->
{#snippet thumb(it, size = "lg")}
    <span class="thumb {size}" class:empty={!it}>
        {#if it?.ref?.image}<img src={it.ref.image} alt="" />{:else if it}<span>{it.name.slice(0, 1)}</span>{/if}
    </span>
{/snippet}

<!-- подсказка к предмету рюкзака / экипировки -->
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
    <header class="top">
        <button class="ghost" onclick={leave(onBack)}>← К персонажам</button>
        {#if build}
            <span class="spacer"></span>
            {#if state}
                <span class="save-status" class:dirty class:err={stateError}>
                    {#if stateError}Не сохранено
                    {:else if saving}Сохранение…
                    {:else if dirty}Есть несохранённые изменения
                    {:else if savedAt}Сохранено в {hhmm(savedAt)}
                    {:else}Всё сохранено
                    {/if}
                </span>
                <button class="save" onclick={saveNow} disabled={saving || !dirty} title="Сохранить состояние (Ctrl/Cmd+S)">
                    Сохранить
                </button>
            {/if}
            <button class="ghost" onclick={leave(onGiveItem)}>＋ Дать предмет</button>
            {#if build.level < 20}
                <button class="ghost levelup" onclick={leave(onLevelUp)}>▲ Повысить уровень</button>
            {/if}
            <button class="ghost" onclick={leave(() => onEdit(raw))}
                >Редактировать</button
            >
        {/if}
    </header>

    {#if loading}
        <p class="muted">Загрузка…</p>
    {:else if error}
        <p class="error">Не удалось загрузить персонажа: {error}</p>
    {:else if build && sheet}
        <!-- ================= верх: 2 / 4 ================= -->
        <div class="row row-title">
            <section>
                <h1>{build.name}</h1>
                <p class="class-line">
                    {cls?.name ?? build.classId}
                    <span class="lvl">{build.level} уровень</span>
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
            <!-- портрет + имя -->
            <section class="identity">
                <div class="portrait">
                    {#if build.portrait}
                        <img src={build.portrait} alt="Портрет" />
                    {:else}
                        <span class="img-empty">нет портрета</span>
                    {/if}
                </div>
            </section>

            <!-- атрибуты -->
            <section class="stats">
                <div class="combat">
                    <div class="stat shield">
                        <span class="stat-label">КД</span>
                        <span class="stat-value">{sheet.ac}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Инициатива</span>
                        <span class="stat-value"
                            >{formatModifier(sheet.initiative)}</span
                        >
                    </div>
                    <div class="stat">
                        <span class="stat-label">Скорость</span>
                        <span class="stat-value">{ft(sheet.speed)}</span>
                    </div>
                    <div class="stat hp">
                        <span class="stat-label">Хиты</span>
                        <span class="stat-value"
                            >{hpNow}<small>/{character.maxHp}</small></span
                        >
                    </div>
                    <div class="stat">
                        <span class="stat-label">Кость хитов</span>
                        <span class="stat-value"
                            >{build.level}d{sheet.hitDie}</span
                        >
                    </div>
                    <div class="stat">
                        <span class="stat-label">Мастерство</span>
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
                    <h3>Спасброски</h3>
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
                    <h3>Навыки</h3>
                    <ul class="checklist cols-3">
                        {#each sheet.skills as s (s.id)}
                            <li class:prof={s.proficient} class:expert={s.expertise}>
                                <span class="dot"></span>
                                <span class="val">{formatModifier(s.value)}</span>
                                <span>{s.name} <small>({ABILITIES[s.ability].short})</small></span>
                            </li>
                        {/each}
                    </ul>
                    <p class="passive">
                        Пассивная Внимательность: <b>{sheet.passivePerception}</b>
                        {#if sheet.darkvision}· Тёмное зрение: <b>{ft(sheet.darkvision)}</b>{/if}
                    </p>
                </div>
            </section>
        </div>

        <!-- ================= низ: 3 / 7 ================= -->
        <div class="row row-bottom">
            <!-- Внешность, Личность — одной колонкой -->
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
                    <h2>Рюкзак</h2>
                    {#if character.inventory.length}
                        <ul class="inventory">
                            {#each [...character.inventory].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) as it (it.key)}
                                {@const where = slotOf(it.key, character.equipped)}
                                <li class:worn={where}>
                                    <span>
                                        <Tooltip>
                                            {it.name}
                                            {#snippet tip()}{@render itemTip(it)}{/snippet}
                                        </Tooltip>
                                        {#if where}<small class="tag">{SLOT_TAG[where]}</small>{/if}
                                        {#if it.given}<small class="tag">выдано</small>{/if}
                                    </span>
                                    <span class="qty">× {it.qty}</span>
                                </li>
                            {/each}
                        </ul>
                    {:else}
                        <p class="muted">Пусто.</p>
                    {/if}
                </section>
                <section class="card">
                    <h2>Черты и умения</h2>
                    {#each features as g}
                        <h3>{g.title}</h3>
                        <ul class="features">
                            {#each g.items as f}
                                <li>
                                    <b
                                        >{f.name}{#if f.level}<small>
                                                · {f.level} ур.</small
                                            >{/if}</b
                                    >
                                    <span>{f.desc}</span>
                                </li>
                            {/each}
                        </ul>
                    {:else}
                        <p class="muted">Нет данных.</p>
                    {/each}
                </section>
            </div>

            <!-- экипировка, навыки и прочее -->
            <div class="col">
                <!-- игровое состояние -->
                <section class="card play">
                    <h2>Состояние</h2>
                    {#if stateError}<p class="error">Не сохранено: {stateError}</p>{/if}

                    <div class="hp-row">
                        <div class="hp-big" class:down={hpNow === 0}>
                            <span class="hp-now">{hpNow}</span>
                            <span class="hp-max">/ {character.maxHp}</span>
                            {#if state.tempHp}<span class="hp-temp">+{state.tempHp} врем.</span>{/if}
                        </div>
                        <!-- число и столбик действий: урон / лечение / временные хиты -->
                        <div class="hp-ctl">
                            <input class="hp-input" type="number" min="1" bind:value={hpAmount} aria-label="Сколько хитов" />
                            <div class="hp-actions">
                                {#each HP_ACTIONS as act (act.id)}
                                    <Tooltip delay={150}>
                                        <button class="hp-btn {act.id}" onclick={() => act.run()} aria-label={act.label}>
                                            <Icon name={act.icon} label={act.label} short={act.short} native={false} />
                                        </button>
                                        {#snippet tip()}<b>{act.label}</b> на {hpAmount || 0}{/snippet}
                                    </Tooltip>
                                {/each}
                            </div>
                        </div>
                    </div>

                    {#if character.resources.length}
                        <h3>Ресурсы</h3>
                        <ul class="pools">
                            {#each character.resources as r (r.id)}
                                {@const left = state.resourceLeft(r)}
                                <li>
                                    <span class="pool-name">{r.name}
                                        <small><IconLabel
                                            name={r.recharge === "short" ? "shortRest" : "longRest"}
                                            kind="rest"
                                            label={r.recharge === "short" ? "Восстанавливается на коротком отдыхе" : "Восстанавливается на долгом отдыхе"}
                                            text={r.recharge === "short" ? "кор. отдых" : "долг. отдых"}
                                        /></small></span>
                                    <span class="pips">
                                        {#if r.max > 10}
                                            <button class="ghost step" onclick={() => state.spend(r)} disabled={left === 0} aria-label="Потратить">−</button>
                                            <button class="ghost step" onclick={() => state.restore(r)} disabled={left === r.max} aria-label="Вернуть">+</button>
                                        {:else}
                                        {#each Array(r.max) as _, i}
                                            <button
                                                class="pip"
                                                class:full={i < left}
                                                title={i < left ? "Потратить" : "Вернуть"}
                                                aria-label={r.name}
                                                onclick={() => (i < left ? state.spend(r) : state.restore(r))}
                                            ></button>
                                        {/each}
                                        {/if}
                                    </span>
                                    <span class="pool-count">{left}/{r.max}</span>
                                </li>
                            {/each}
                        </ul>
                    {/if}

                    {#if character.spellSlots.length}
                        <h3>
                            Ячейки заклинаний
                            <small class="sc-meta"><IconLabel name="dc" kind="meta" label="Сложность спасброска от ваших заклинаний" text="Сл" /> {character.spellcasting.saveDC} · атака {formatModifier(character.spellcasting.attack)}</small>
                        </h3>
                        <ul class="pools">
                            {#each character.spellSlots as slot (state.slotKey(slot))}
                                {@const left = state.slotsLeft(slot)}
                                <li>
                                    <span class="pool-name">
                                        <IconLabel
                                            name={slot.pact ? "pact" : "slot"}
                                            kind="meta"
                                            label={slot.pact ? "Ячейка договора — восстанавливается на коротком отдыхе" : "Ячейка заклинаний"}
                                            text=""
                                        />
                                        {slot.level} круг{#if slot.pact && !hasIcon("pact")} <small>договор</small>{/if}
                                    </span>
                                    <span class="pips">
                                        {#each Array(slot.max) as _, i}
                                            <button
                                                class="pip slot"
                                                class:pact={slot.pact}
                                                class:full={i < left}
                                                aria-label="Ячейка {slot.level} круга"
                                                onclick={() => state.useSlot(slot, i < left ? 1 : -1)}
                                            ></button>
                                        {/each}
                                    </span>
                                    <span class="pool-count">{left}/{slot.max}</span>
                                </li>
                            {/each}
                        </ul>
                    {/if}

                    <div class="rests">
                        <button class="ghost" onclick={() => state.shortRest(character)}>Короткий отдых</button>
                        <button class="ghost" onclick={() => state.longRest(character)}>Долгий отдых</button>
                    </div>
                </section>

                <!-- пассивные эффекты: действуют всегда -->
                {#if passives.effects.length || passives.abilities.length}
                    <section class="card passives">
                        <h2>Пассивные эффекты</h2>
                        {#if passives.effects.length}
                            <dl class="fx">
                                {#each passives.effects as g (g.id)}
                                    <dt class="fx-{g.id}">{g.title}</dt>
                                    <dd>
                                        {#each g.items as l (l.label)}
                                            <Tooltip>
                                                <span class="fx-chip fx-{g.id}" style={l.dmg ? `--c: var(--color-dmg-${l.dmg})` : ""}>
                                                    {#if l.dmg && hasIcon(l.dmg)}<Icon name={l.dmg} kind="dmg" label={l.label} native={false} />{:else}{l.label}{/if}
                                                </span>
                                                {#snippet tip()}
                                                    <div class="tip">
                                                        {#if l.dmg}<div class="tip-head"><b>{g.title}: {l.label}</b></div>{/if}
                                                        {#if l.note}<p class="tip-desc">{l.note}</p>{/if}
                                                        {#each l.sources as s}
                                                            <div class="tip-head">
                                                                <b>{s.name}</b>
                                                                {#if s.from}<span class="tip-tag">{s.from}</span>{/if}
                                                            </div>
                                                            {#if s.desc}<p class="tip-desc">{s.desc}</p>{/if}
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
                            <h3>Умения</h3>
                            <ul class="pa">
                                {#each passives.abilities as a (a.source + a.name)}
                                    <li>
                                        <Tooltip>
                                            <b>{a.name}</b>
                                            {#snippet tip()}
                                                <div class="tip">
                                                    <div class="tip-head">
                                                        <b>{a.name}</b>
                                                        <span class="tip-tag">{a.source}{a.level ? ` · ${a.level} ур.` : ""}</span>
                                                    </div>
                                                    {#if a.desc}<p class="tip-desc">{a.desc}</p>{/if}
                                                </div>
                                            {/snippet}
                                        </Tooltip>
                                        <small>{a.source}</small>
                                        {#each a.notes as n}<span class="pa-note">{n}</span>{/each}
                                    </li>
                                {/each}
                            </ul>
                        {/if}
                    </section>
                {/if}

                <section class="card">
                    <h2>Экипировка и атаки</h2>
                    <div class="slots">
                        {#each SLOTS as slot (slot.id)}
                            {@const blocked = handBlocked(slot.id)}
                            {@const held = character.loadout[slot.id]}
                            <label class="slot" class:blocked>
                                <span>{slot.label}</span>
                                {#if held}
                                    <Tooltip>
                                        {@render thumb(held, "lg")}
                                        {#snippet tip()}{@render itemTip(held)}{/snippet}
                                    </Tooltip>
                                {:else}
                                    {@render thumb(null, "lg")}
                                {/if}
                                <select
                                    value={character.equipped[slot.id] ?? ""}
                                    disabled={blocked}
                                    onchange={(e) => onEquip(slot.id, e)}
                                >
                                    <option value="">{blocked ? "— занята (двуручное) —" : "— пусто —"}</option>
                                    {#each slotOptions(slot.id, character.inventory) as it (it.key)}
                                        <option value={it.key}>
                                            {it.name}{isTwoHanded(it)
                                                ? " (двуручное)"
                                                : (it.ref?.data?.properties ?? []).includes("light")
                                                  ? " (лёгкое)"
                                                  : ""}
                                        </option>
                                    {/each}
                                </select>
                            </label>
                        {/each}
                    </div>

                    <div class="armor-line">
                        <span class="al-label">Доспех</span>
                        {#if worn}
                            <Tooltip>
                                <b class="al-name">{worn.name}</b>
                                {#snippet tip()}{@render itemTip(worn)}{/snippet}
                            </Tooltip>
                            <span class="al-meta">{ARMOR_CAT[worn.ref.category] ?? ""} · КД {acText(worn.ref)}{worn.ref.data?.acBonus ? ` +${worn.ref.data.acBonus}` : ""}</span>
                            {#if worn.ref.data?.stealthDisadvantage}<span class="al-warn">помеха Скрытности</span>{/if}
                        {:else}
                            <span class="al-meta">без доспеха</span>
                        {/if}
                        {#if heldShield}
                            <span class="al-sep">+</span>
                            <Tooltip>
                                <b class="al-name">{heldShield.name}</b>
                                {#snippet tip()}{@render itemTip(heldShield)}{/snippet}
                            </Tooltip>
                            <span class="al-meta">+{heldShield.ref.data?.acBonus ?? 2} КД</span>
                        {/if}
                        <span class="al-total">Итого КД <b>{sheet.ac}</b></span>
                    </div>

                    <table class="attacks">
                        <thead>
                            <tr><th>Рука</th><th>Оружие</th><th>Действие</th><th>Бонус</th><th>Урон / вид</th></tr>
                        </thead>
                        <tbody>
                            {#each sheet.attacks as a (a.hand + a.id)}
                                <tr>
                                    <td class="hand">{a.hand === "off" ? "левая" : "правая"}</td>
                                    <td>
                                        {#if weaponInv(a.id)}
                                            <Tooltip>
                                                {a.name}
                                                {#snippet tip()}{@render itemTip(weaponInv(a.id))}{/snippet}
                                            </Tooltip>
                                        {:else}{a.name}{/if}
                                        {#if a.magic}<small class="magic">★</small>{/if}
                                    </td>
                                    <td class="act" class:bonus={a.action === "bonus"}>
                                        {a.action === "bonus" ? "бонусное" : "атака"}
                                    </td>
                                    <td class="num">{formatModifier(a.toHit)}</td>
                                    <td>
                                        {a.damage}
                                        <small class="dmg-ico"><IconLabel name={a.damageType} kind="dmg" label={damageLabel(a.damageType)} text={damageShort(a.damageType)} /></small>
                                        {#each a.extra ?? [] as x}
                                            <span class="extra">+ {x.dice} <small class="dmg-ico"><IconLabel name={x.type} kind="dmg" label={damageLabel(x.type)} text={damageShort(x.type)} /></small></span>
                                        {/each}
                                        {#if a.note}<small class="hint">· {a.note}</small>{/if}
                                    </td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                </section>

                {#if character.actionGroups.length}
                    <section class="card">
                        <h2>
                            Действия и заклинания
                            {#if character.spellcasting}
                                <small class="h2-sub">
                                    Сл {character.spellcasting.saveDC} · атака {formatModifier(character.spellcasting.attack)}
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
                                        saveDC={g.spells ? character.spellcasting?.saveDC ?? null : null}
                                    />
                                {/each}
                            </div>
                        {/each}
                    </section>
                {/if}

                <!-- заметки игрока: хранятся в состоянии персонажа -->
                {#if state}
                    <section class="card notes">
                        <h2>
                            Заметки
                            {#if dirty}<small class="h2-sub">не сохранено</small>{/if}
                        </h2>
                        <textarea
                            bind:value={state.notes}
                            use:autosize={state.notes}
                            rows="6"
                            placeholder="Квесты, имена NPC, долги, найденные подсказки…"
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
        resize: none;       /* высоту задаёт текст (autosize) */
        overflow: hidden;   /* без внутренней прокрутки */
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

    /* ---------- состояние ---------- */
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

    /* поле числа — высотой со столбик кнопок */
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

    .hp-btn.dmg { --c: var(--color-danger); }
    .hp-btn.heal { --c: var(--color-success); }
    .hp-btn.temp { --c: var(--color-text-accent); }

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

    /* ячейки договора колдуна */
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

    /* ---------- сетки ---------- */
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

    /* ---------- портрет + имя ---------- */
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

    /* ---------- атрибуты ---------- */
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

    /* классический блок характеристики: название, крупный модификатор, значение в овале */
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

    /* список с «кружком владения», как на листе */
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

    /* ---------- тексты ---------- */
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

    /* ---------- атаки ---------- */
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

    /* ---------- экипировка ---------- */
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

    /* картинка предмета */
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

    /* фиксированный квадрат по центру слота; в узкой колонке ужимается, не обрезаясь */
    .thumb.lg {
        width: min(150px, 100%);
        aspect-ratio: 1;
        align-self: center;
        border-radius: 8px;
    }

    /* картинка целиком, без обрезки */
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

    /* ---------- инвентарь ---------- */
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
    }

    .qty {
        color: var(--color-gold);
    }

    /* ---------- черты ---------- */
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

    /* рюкзак — отдельной карточкой, без верхнего разделителя */
    .card > .inventory {
        margin: 0;
        padding: 0;
        border-top: none;
    }

    /* ---------- заклинания ---------- */
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

    /* ---------- карточки действий ---------- */
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

    /* компетентность: кружок с обводкой */
    .checklist li.expert .dot {
        box-shadow: 0 0 0 2px var(--color-bg), 0 0 0 3px var(--color-gold);
    }

    /* ---------- подсказки ---------- */
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

    /* ---------- надетый доспех ---------- */
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
    /* --- пассивные эффекты --- */
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

    .fx-chip.fx-advantage { --c: var(--color-success); }
    .fx-chip.fx-disadvantage { --c: var(--color-danger); }
    .fx-chip.fx-sense { --c: var(--color-rest-shortRest); }
    .fx-chip.fx-bonus { --c: var(--color-gold); }
    .fx-chip.fx-note { --c: var(--color-text-secondary); }

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

</style>
