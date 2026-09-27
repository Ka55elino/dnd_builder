<script>
    /**
     * Form for the DM's own monster: create, edit, or copy a built-in one.
     * Live stat block preview on the right. Saved via saveMonster (Go: SaveCustomMonster).
     *
     * initial — a Monster to edit / copy (null — a new one)
     * copy    — true: a new monster based on `initial`
     * onSaved(id), onCancel()
     *
     * Numbers only — nothing is rolled: damage is "average (dice)", the average is
     * worked out from the dice.
     */
    import { saveMonster, CREATURE_TYPES, SIZES, HABITATS, CONDITIONS, ACTION_GROUPS, CRS, crLabel, XP_BY_CR, abilityMod, profByCR, fmtMod, cap } from "../../data/bestiary.js";
    import { DAMAGE_TYPES } from "../../rules/labels.js";
    import { ABILITIES, ABILITY_KEYS } from "../../rules/abilities.js";
    import MonsterStatBlock from "./MonsterStatBlock.svelte";
    import { untrack } from "svelte";

    let { initial = null, copy = false, onSaved, onCancel } = $props();

    const DMG = Object.keys(DAMAGE_TYPES).filter((k) => k !== "physical" && k !== "weapon");
    const SPEED_KEYS = ["walk", "fly", "swim", "climb", "burrow"];
    const SENSE_KEYS = ["darkvision", "blindsight", "tremorsense", "truesight"];
    const GROUPS = [...ACTION_GROUPS, { key: "legendary", title: "Legendary Actions" }];

    // ---------- form state ----------
    // the form is filled once from the props (the page re-creates the editor for another monster)
    const src = untrack(() => (initial ? structuredClone($state.snapshot(initial)) : null));
    const isCopy = untrack(() => copy);
    const d0 = src?.data ?? {};

    /** an action in the form: attack/save/uses flattened for inputs */
    const toForm = (a) => ({
        name: a.name ?? "",
        desc: a.desc ?? "",
        atk: a.attack?.kind ?? "",
        bonus: a.attack?.bonus ?? 0,
        reach: a.attack?.reach ?? 5,
        range: a.attack?.range ?? "",
        damage: (a.damage ?? []).map((x) => ({ dice: x.dice ?? "", avg: x.avg ?? "", type: x.type ?? "slashing" })),
        saveAb: a.save?.ability ?? "",
        dc: a.save?.dc ?? 10,
        usesKind: a.uses?.recharge ? "recharge" : a.uses?.perDay ? "perDay" : "",
        recharge: a.uses?.recharge ?? "5-6",
        perDay: a.uses?.perDay ?? 1,
    });

    let f = $state({
        name: src ? (isCopy ? `${src.name} (copy)` : src.name) : "",
        type: src?.type ?? "humanoid",
        subtypes: (d0.subtypes ?? []).join(", "),
        size: src?.size ?? "medium",
        alignment: src?.alignment ?? "neutral",
        cr: src?.cr ?? 1,
        ac: src?.ac ?? 12,
        acNote: d0.acNote ?? "",
        hp: src?.hp ?? 10,
        hpFormula: d0.hpFormula ?? "",
        initiative: d0.initiative ?? null, // null — Dexterity modifier
        speed: Object.fromEntries(SPEED_KEYS.map((k) => [k, d0.speed?.[k] ?? (k === "walk" ? 30 : 0)])),
        hover: !!d0.speed?.hover,
        abilities: Object.fromEntries(ABILITY_KEYS.map((k) => [k, d0.abilities?.[k] ?? 10])),
        saveProf: Object.fromEntries(ABILITY_KEYS.map((k) => [k, !!(d0.saves && k in d0.saves)])),
        skills: Object.entries(d0.skills ?? {}).map(([k, v]) => `${k} ${fmtMod(v)}`).join(", "),
        vulnerabilities: [...(d0.vulnerabilities ?? [])],
        resistances: [...(d0.resistances ?? [])],
        immunities: [...(d0.immunities ?? [])],
        conditionImmunities: [...(d0.conditionImmunities ?? [])],
        senses: Object.fromEntries(SENSE_KEYS.map((k) => [k, d0.senses?.[k] ?? 0])),
        languages: d0.languages ?? "",
        habitats: [...(src?.habitats ?? [])],
        groups: {
            traits: (d0.traits ?? []).map(toForm),
            actions: (d0.actions ?? []).map(toForm),
            bonusActions: (d0.bonusActions ?? []).map(toForm),
            reactions: (d0.reactions ?? []).map(toForm),
            legendary: (d0.legendary?.actions ?? []).map(toForm),
        },
        legendaryPerRound: d0.legendary?.perRound ?? 3,
        desc: d0.desc ?? "",
        treasure: d0.treasure ?? "",
    });
    if (!src) f.groups.actions.push(toForm({ name: "Slam", attack: { kind: "melee", bonus: 3, reach: 5 }, damage: [{ dice: "1d6+1", type: "bludgeoning" }] }));

    let tab = $state("basics"); // basics | defenses | actions | lore
    let saving = $state(false);
    let error = $state("");

    // ---------- helpers ----------
    /** average of "2d6+3" / "1d8 - 1" / "7" */
    function avgOf(dice) {
        const s = String(dice ?? "").replace(/\s+/g, "");
        if (!s) return 0;
        let total = 0;
        for (const part of s.match(/[+-]?[^+-]+/g) ?? []) {
            const sign = part.startsWith("-") ? -1 : 1;
            const t = part.replace(/^[+-]/, "");
            const m = t.match(/^(\d*)d(\d+)$/i);
            if (m) total += sign * ((Number(m[1] || 1) * (Number(m[2]) + 1)) / 2);
            else if (/^\d+$/.test(t)) total += sign * Number(t);
            else return NaN;
        }
        return Math.max(0, Math.floor(total));
    }

    const toggle = (list, v) => {
        const i = list.indexOf(v);
        if (i === -1) list.push(v);
        else list.splice(i, 1);
    };

    const pb = $derived(profByCR(Number(f.cr)));
    const mod = (k) => abilityMod(f.abilities[k]);

    function parseSkills(text) {
        const out = {};
        for (const part of String(text).split(",")) {
            const m = part.trim().match(/^([a-z][a-z ]*?)\s*([+-]\d+)$/i);
            if (!m) continue;
            const key = m[1].trim().toLowerCase().replace(/\s+(\w)/g, (_, c) => c.toUpperCase()); // "sleight of hand" → sleightOfHand
            out[key] = Number(m[2]);
        }
        return out;
    }

    function fromForm(a) {
        const out = { name: a.name.trim() || "Unnamed" };
        if (a.atk) {
            out.attack = { kind: a.atk, bonus: Number(a.bonus) || 0 };
            if (a.atk === "melee") out.attack.reach = Number(a.reach) || 5;
            else out.attack.range = String(a.range || "").trim() || "30";
        }
        const dmg = a.damage
            .filter((x) => String(x.dice).trim())
            .map((x) => ({ avg: Number.isNaN(avgOf(x.dice)) ? Number(x.avg) || 0 : avgOf(x.dice), dice: String(x.dice).trim(), type: x.type }));
        if (dmg.length) out.damage = dmg;
        if (a.saveAb) out.save = { ability: a.saveAb, dc: Number(a.dc) || 10 };
        if (a.usesKind === "recharge") out.uses = { recharge: String(a.recharge || "6").trim() };
        if (a.usesKind === "perDay") out.uses = { perDay: Math.max(1, Number(a.perDay) || 1) };
        if (a.desc.trim()) out.desc = a.desc.trim();
        return out;
    }

    // the monster as it will be saved (also drives the preview)
    const monster = $derived.by(() => {
        const data = { ...(src?.data ?? {}) }; // keep fields the form doesn't know
        delete data.custom;
        const saves = {};
        for (const k of ABILITY_KEYS) if (f.saveProf[k]) saves[k] = mod(k) + pb;
        const speed = {};
        for (const k of SPEED_KEYS) if (Number(f.speed[k]) > 0) speed[k] = Number(f.speed[k]);
        if (f.hover && speed.fly) speed.hover = true;
        const senses = {};
        for (const k of SENSE_KEYS) if (Number(f.senses[k]) > 0) senses[k] = Number(f.senses[k]);
        const skills = parseSkills(f.skills);
        Object.assign(data, {
            subtypes: f.subtypes.split(",").map((s) => s.trim()).filter(Boolean),
            acNote: f.acNote.trim(),
            hpFormula: f.hpFormula.trim(),
            initiative: f.initiative === null || f.initiative === "" ? mod("dex") : Number(f.initiative),
            speed,
            abilities: Object.fromEntries(ABILITY_KEYS.map((k) => [k, Number(f.abilities[k]) || 10])),
            saves,
            skills,
            vulnerabilities: [...f.vulnerabilities],
            resistances: [...f.resistances],
            immunities: [...f.immunities],
            conditionImmunities: [...f.conditionImmunities],
            senses,
            passivePerception: 10 + (skills.perception ?? mod("wis")),
            languages: f.languages.trim(),
            traits: f.groups.traits.map(fromForm),
            actions: f.groups.actions.map(fromForm),
            bonusActions: f.groups.bonusActions.map(fromForm),
            reactions: f.groups.reactions.map(fromForm),
            desc: f.desc.trim(),
            treasure: f.treasure.trim(),
        });
        if (f.groups.legendary.length) data.legendary = { perRound: Number(f.legendaryPerRound) || 3, actions: f.groups.legendary.map(fromForm) };
        else delete data.legendary;
        const cr = Number(f.cr);
        return {
            ...(isCopy || !src ? {} : { id: src.id }),
            name: f.name.trim(),
            image: src?.image || undefined,
            type: f.type,
            size: f.size,
            alignment: f.alignment.trim(),
            cr,
            ac: Number(f.ac) || 10,
            hp: Number(f.hp) || 1,
            habitats: [...f.habitats],
            ...data,
        };
    });

    // preview wants the Monster shape (columns + data)
    const preview = $derived.by(() => {
        const { id, name, image, type, size, alignment, cr, ac, hp, habitats, ...data } = monster;
        return {
            id: id ?? "preview", name: name || "Unnamed", image, type, size, alignment, cr, ac, hp, habitats,
            xp: XP_BY_CR[cr] ?? 0, legendary: !!data.legendary, data: { ...data, custom: true },
        };
    });

    async function save() {
        error = "";
        if (!monster.name) {
            tab = "basics";
            error = "Enter a name.";
            return;
        }
        const bad = [...Object.values(f.groups).flat()].flatMap((a) => a.damage).find((x) => String(x.dice).trim() && Number.isNaN(avgOf(x.dice)));
        if (bad) {
            tab = "actions";
            error = `Can't read damage “${bad.dice}” — use a form like 2d6+3.`;
            return;
        }
        saving = true;
        try {
            const id = await saveMonster(monster);
            onSaved?.(id);
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            saving = false;
        }
    }

    function onKey(e) {
        if (e.key === "Escape") onCancel?.();
    }

    const addAction = (g) => f.groups[g].push(toForm({ name: "", desc: "" }));
    const removeAction = (g, i) => f.groups[g].splice(i, 1);
    const moveAction = (g, i, dir) => {
        const list = f.groups[g];
        const j = i + dir;
        if (j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
    };
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={(e) => e.target === e.currentTarget && onCancel?.()}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Custom monster">
        <header>
            <h2>{initial && !copy ? "Edit monster" : copy ? "New monster (copy)" : "New monster"}</h2>
            <nav class="tabs">
                {#each [["basics", "Basics"], ["defenses", "Defenses & senses"], ["actions", "Traits & actions"], ["lore", "Description"]] as [id, label]}
                    <button class:active={tab === id} onclick={() => (tab = id)}>{label}</button>
                {/each}
            </nav>
        </header>

        <div class="layout">
            <div class="form">
                {#if tab === "basics"}
                    <label class="field wide">
                        <span>Name *</span>
                        <input type="text" bind:value={f.name} placeholder="E.g. Cave Goblin" />
                    </label>
                    <div class="grid">
                        <label class="field">
                            <span>Type</span>
                            <select bind:value={f.type}>
                                {#each Object.entries(CREATURE_TYPES) as [k, v]}<option value={k}>{v}</option>{/each}
                            </select>
                        </label>
                        <label class="field">
                            <span>Subtypes</span>
                            <input type="text" bind:value={f.subtypes} placeholder="goblinoid, devil…" />
                        </label>
                        <label class="field">
                            <span>Size</span>
                            <select bind:value={f.size}>
                                {#each Object.entries(SIZES) as [k, v]}<option value={k}>{v}</option>{/each}
                            </select>
                        </label>
                        <label class="field">
                            <span>Alignment</span>
                            <input type="text" bind:value={f.alignment} placeholder="chaotic evil / unaligned" />
                        </label>
                        <label class="field">
                            <span>Challenge Rating</span>
                            <select bind:value={f.cr}>
                                {#each CRS as c}<option value={c}>{crLabel(c)} — {XP_BY_CR[c].toLocaleString("en-US")} XP</option>{/each}
                            </select>
                        </label>
                        <div class="field">
                            <span>Proficiency Bonus</span>
                            <p class="calc">{fmtMod(pb)} <small>from CR</small></p>
                        </div>
                        <label class="field">
                            <span>Armor Class</span>
                            <input type="number" min="0" bind:value={f.ac} />
                        </label>
                        <label class="field">
                            <span>AC note</span>
                            <input type="text" bind:value={f.acNote} placeholder="natural armor" />
                        </label>
                        <label class="field">
                            <span>Hit Points (average)</span>
                            <input type="number" min="1" bind:value={f.hp} />
                        </label>
                        <label class="field">
                            <span>Hit Dice</span>
                            <input type="text" bind:value={f.hpFormula} placeholder="4d8+4" />
                            {#if f.hpFormula && !Number.isNaN(avgOf(f.hpFormula)) && avgOf(f.hpFormula) !== Number(f.hp)}
                                <button class="hint-btn" onclick={() => (f.hp = avgOf(f.hpFormula))}>average is {avgOf(f.hpFormula)} — use it</button>
                            {/if}
                        </label>
                        <label class="field">
                            <span>Initiative</span>
                            <input type="number" value={f.initiative ?? ""} placeholder={fmtMod(mod("dex"))}
                                oninput={(e) => (f.initiative = e.currentTarget.value === "" ? null : Number(e.currentTarget.value))} />
                        </label>
                    </div>

                    <div class="field wide">
                        <span>Speed, ft.</span>
                        <div class="inline">
                            {#each SPEED_KEYS as k}
                                <label class="mini"><small>{cap(k)}</small><input type="number" min="0" step="5" bind:value={f.speed[k]} /></label>
                            {/each}
                            <label class="check"><input type="checkbox" bind:checked={f.hover} disabled={!Number(f.speed.fly)} /> hover</label>
                        </div>
                    </div>

                    <div class="field wide">
                        <span>Abilities · saving throw proficiency</span>
                        <div class="abil">
                            {#each ABILITY_KEYS as k}
                                <div class="ab">
                                    <small>{ABILITIES[k].short}</small>
                                    <input type="number" min="1" max="30" bind:value={f.abilities[k]} />
                                    <span class="m">{fmtMod(mod(k))}</span>
                                    <label class="check" title="Proficient in {ABILITIES[k].name} saving throws">
                                        <input type="checkbox" bind:checked={f.saveProf[k]} /> {fmtMod(mod(k) + (f.saveProf[k] ? pb : 0))}
                                    </label>
                                </div>
                            {/each}
                        </div>
                    </div>

                    <label class="field wide">
                        <span>Skills</span>
                        <input type="text" bind:value={f.skills} placeholder="perception +5, stealth +6" />
                    </label>

                    <div class="field wide">
                        <span>Habitats</span>
                        <div class="chips">
                            {#each Object.entries(HABITATS) as [k, v]}
                                <button class="chip" class:on={f.habitats.includes(k)} onclick={() => toggle(f.habitats, k)}>{v}</button>
                            {/each}
                        </div>
                    </div>
                {:else if tab === "defenses"}
                    {#each [["vulnerabilities", "Damage vulnerabilities"], ["resistances", "Damage resistances"], ["immunities", "Damage immunities"]] as [key, label]}
                        <div class="field wide">
                            <span>{label}</span>
                            <div class="chips">
                                {#each DMG as t}
                                    <button class="chip" class:on={f[key].includes(t)} onclick={() => toggle(f[key], t)}>{DAMAGE_TYPES[t].name}</button>
                                {/each}
                            </div>
                        </div>
                    {/each}
                    <div class="field wide">
                        <span>Condition immunities</span>
                        <div class="chips">
                            {#each CONDITIONS as c}
                                <button class="chip" class:on={f.conditionImmunities.includes(c)} onclick={() => toggle(f.conditionImmunities, c)}>{cap(c)}</button>
                            {/each}
                        </div>
                    </div>
                    <div class="field wide">
                        <span>Senses, ft.</span>
                        <div class="inline">
                            {#each SENSE_KEYS as k}
                                <label class="mini"><small>{cap(k)}</small><input type="number" min="0" step="5" bind:value={f.senses[k]} /></label>
                            {/each}
                        </div>
                        <small class="hint">Passive Perception: {monster.passivePerception} (10 + Perception or Wisdom)</small>
                    </div>
                    <label class="field wide">
                        <span>Languages</span>
                        <input type="text" bind:value={f.languages} placeholder="Common, Goblin / understands Common but can't speak" />
                    </label>
                {:else if tab === "actions"}
                    {#each GROUPS as g (g.key)}
                        <section class="group">
                            <div class="g-head">
                                <h3>{g.title} <small>{f.groups[g.key].length}</small></h3>
                                {#if g.key === "legendary" && f.groups.legendary.length}
                                    <label class="mini inline-l">per round <input type="number" min="1" max="5" bind:value={f.legendaryPerRound} /></label>
                                {/if}
                                <button class="ghost small" onclick={() => addAction(g.key)}>+ Add</button>
                            </div>
                            {#each f.groups[g.key] as a, i (a)}
                                <div class="action">
                                    <div class="a-row">
                                        <input class="a-name" type="text" bind:value={a.name} placeholder="Name" />
                                        <select bind:value={a.atk} title="Attack roll">
                                            <option value="">no attack roll</option>
                                            <option value="melee">Melee attack</option>
                                            <option value="ranged">Ranged attack</option>
                                        </select>
                                        <span class="tools">
                                            <button class="x" onclick={() => moveAction(g.key, i, -1)} disabled={i === 0} aria-label="Up">↑</button>
                                            <button class="x" onclick={() => moveAction(g.key, i, 1)} disabled={i === f.groups[g.key].length - 1} aria-label="Down">↓</button>
                                            <button class="x del" onclick={() => removeAction(g.key, i)} aria-label="Remove">✕</button>
                                        </span>
                                    </div>
                                    {#if a.atk}
                                        <div class="a-row">
                                            <label class="mini"><small>to hit</small><input type="number" bind:value={a.bonus} /></label>
                                            {#if a.atk === "melee"}
                                                <label class="mini"><small>reach, ft.</small><input type="number" min="5" step="5" bind:value={a.reach} /></label>
                                            {:else}
                                                <label class="mini"><small>range, ft.</small><input type="text" bind:value={a.range} placeholder="80/320" /></label>
                                            {/if}
                                            <small class="hint">suggested to hit: {fmtMod(pb + Math.max(mod("str"), mod("dex")))}</small>
                                        </div>
                                    {/if}
                                    <div class="a-row">
                                        <label class="mini">
                                            <small>saving throw</small>
                                            <select bind:value={a.saveAb}>
                                                <option value="">none</option>
                                                {#each ABILITY_KEYS as k}<option value={k}>{ABILITIES[k].name}</option>{/each}
                                            </select>
                                        </label>
                                        {#if a.saveAb}<label class="mini"><small>DC</small><input type="number" min="1" bind:value={a.dc} /></label>{/if}
                                        <label class="mini">
                                            <small>uses</small>
                                            <select bind:value={a.usesKind}>
                                                <option value="">unlimited</option>
                                                <option value="recharge">Recharge</option>
                                                <option value="perDay">per day</option>
                                            </select>
                                        </label>
                                        {#if a.usesKind === "recharge"}
                                            <label class="mini"><small>on</small><input type="text" bind:value={a.recharge} placeholder="5-6" /></label>
                                        {:else if a.usesKind === "perDay"}
                                            <label class="mini"><small>times</small><input type="number" min="1" bind:value={a.perDay} /></label>
                                        {/if}
                                    </div>
                                    {#each a.damage as dm, j}
                                        <div class="a-row dmg">
                                            <label class="mini"><small>damage</small><input type="text" bind:value={dm.dice} placeholder="2d6+3" /></label>
                                            <span class="avg">= {Number.isNaN(avgOf(dm.dice)) ? "?" : avgOf(dm.dice)}</span>
                                            <select bind:value={dm.type}>
                                                {#each DMG as t}<option value={t}>{DAMAGE_TYPES[t].name}</option>{/each}
                                            </select>
                                            <button class="x del" onclick={() => a.damage.splice(j, 1)} aria-label="Remove damage">✕</button>
                                        </div>
                                    {/each}
                                    <button class="link" onclick={() => a.damage.push({ dice: "", avg: "", type: "slashing" })}>+ damage</button>
                                    <textarea rows="2" bind:value={a.desc} placeholder="What it does, rider effects…"></textarea>
                                </div>
                            {:else}
                                <p class="empty">None.</p>
                            {/each}
                        </section>
                    {/each}
                {:else}
                    <label class="field wide">
                        <span>Description</span>
                        <textarea rows="6" bind:value={f.desc} placeholder="What it looks like, what it wants, where it's found…"></textarea>
                    </label>
                    <label class="field wide">
                        <span>Treasure</span>
                        <input type="text" bind:value={f.treasure} placeholder="optional" />
                    </label>
                {/if}
            </div>

            <aside class="preview">
                <span class="p-label">Preview</span>
                <MonsterStatBlock monster={preview} />
            </aside>
        </div>

        {#if error}<p class="error">{error}</p>{/if}

        <div class="buttons">
            <button class="ghost" onclick={onCancel}>Cancel</button>
            <button class="primary" onclick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
    </div>
</div>

<style>
    .backdrop {
        position: fixed;
        inset: 0;
        z-index: 900;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 40px 16px;
        overflow-y: auto;
        background: rgba(0, 0, 0, 0.6);
    }

    .dialog {
        width: min(1180px, 100%);
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 22px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 10px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
        font-family: var(--font-ui);
    }

    header {
        display: flex;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
    }

    h2 {
        margin: 0;
        font-family: var(--font-heading-alt);
        font-size: 22px;
        color: var(--color-gold);
    }

    .tabs {
        display: flex;
        gap: 4px;
        border-bottom: 1px solid var(--color-border);
    }

    .tabs button {
        margin-bottom: -1px;
        padding: 6px 12px;
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: 13px;
        cursor: pointer;
    }

    .tabs button.active {
        border-bottom-color: var(--color-gold);
        color: var(--color-gold);
    }

    .layout {
        display: grid;
        grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
        gap: 18px;
        align-items: start;
    }

    .form {
        display: flex;
        flex-direction: column;
        gap: 14px;
        min-width: 0;
    }

    .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
        gap: 12px;
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
    }

    .field > span,
    .mini small {
        font-family: var(--font-form);
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .calc {
        margin: 0;
        padding: 7px 0;
        font-family: var(--font-heading);
        font-size: 18px;
    }

    .calc small,
    .hint {
        font-family: var(--font-ui);
        font-size: 11px;
        color: var(--color-text-muted);
    }

    .hint-btn,
    .link {
        align-self: flex-start;
        padding: 0;
        background: none;
        border: none;
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-gold);
        cursor: pointer;
    }

    input,
    select,
    textarea {
        padding: 6px 9px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-primary);
        font-family: var(--font-form);
        font-size: 14px;
        min-width: 0;
    }

    textarea {
        resize: vertical;
        font-family: var(--font-spell);
        font-size: 15px;
    }

    input:focus,
    select:focus,
    textarea:focus {
        outline: none;
        border-color: var(--color-gold);
    }

    .inline {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: 8px;
    }

    .mini {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .mini input[type="number"] {
        width: 76px;
    }

    .inline-l {
        flex-direction: row;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .inline-l input {
        width: 52px;
    }

    .abil {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 6px;
    }

    .ab {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
        padding: 6px 4px;
        background: var(--color-card-elevated);
        border-radius: 8px;
    }

    .ab small {
        font-size: 11px;
        color: var(--color-text-muted);
    }

    .ab input {
        width: 100%;
        box-sizing: border-box;
        text-align: center;
    }

    .ab .m {
        font-size: 13px;
        color: var(--color-gold);
    }

    .check {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
    }

    .chip {
        padding: 3px 10px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 999px;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: 12px;
        cursor: pointer;
    }

    .chip.on {
        background: var(--color-magic-purple-dark);
        border-color: var(--color-magic-purple);
        color: var(--color-text-primary);
    }

    .group {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .g-head {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    h3 {
        flex: 1;
        margin: 0;
        font-family: var(--font-heading);
        font-size: 13px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-gold);
    }

    h3 small {
        font-family: var(--font-ui);
        color: var(--color-text-muted);
    }

    .action {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 10px;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-border);
        border-radius: 8px;
    }

    .a-row {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: 8px;
    }

    .a-name {
        flex: 1;
        font-family: var(--font-heading-alt);
        font-size: 15px;
    }

    .tools {
        display: flex;
        gap: 2px;
    }

    .avg {
        padding-bottom: 7px;
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .x {
        width: 26px;
        height: 28px;
        padding: 0;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 4px;
        color: var(--color-text-muted);
        cursor: pointer;
    }

    .x:not(:disabled):hover {
        border-color: var(--color-border);
        color: var(--color-text-primary);
    }

    .x.del:hover {
        border-color: var(--color-danger);
        color: var(--color-danger);
    }

    .x:disabled {
        opacity: 0.3;
        cursor: default;
    }

    .empty {
        margin: 0;
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .preview {
        position: sticky;
        top: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
    }

    .p-label {
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-text-muted);
    }

    .error {
        margin: 0;
        color: var(--color-danger);
    }

    .buttons {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
    }

    .primary {
        padding: 8px 20px;
        background: var(--color-gold);
        border: 1px solid var(--color-gold);
        border-radius: 6px;
        color: var(--color-bg);
        font-family: var(--font-ui);
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
    }

    .primary:disabled {
        opacity: 0.6;
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

    .ghost.small {
        padding: 3px 10px;
        font-size: 12px;
    }

    .ghost:hover {
        border-color: var(--color-gold);
        color: var(--color-gold-hover);
    }

    @media (max-width: 900px) {
        .layout {
            grid-template-columns: 1fr;
        }

        .preview {
            position: static;
        }
    }
</style>
