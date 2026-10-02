<script>
    /**
     * One combatant in the DM's initiative line — a card, top to bottom: order number
     * with ◀ ▶ ✕ (reorder / remove), icon, name, AC and Hit Points, an amount input
     * and Damage / Heal / Temp HP. The card can also be dragged (LineupDM handles the drop).
     *
     * c      — the combatant (see combat.svelte.js)
     * n      — its place in the line (1-based)
     * sheet  — { hp, maxHp, temp, ac } for a player (from their state), null while unknown;
     *          monsters carry their own numbers in `c`
     * first, last — disable ◀ / ▶
     * onHp(op, amount) — may return a promise (players: sent to their app)
     * turn   — it's this combatant's turn; onTurn() — the DM marks it (a radio on the icon, one for the line)
     * onMove(dir), onRemove()
     * onConditions() — open the Conditions dialog (LineupDM renders it, outside the draggable card)
     * Conditions show as chips under the name (a save due is highlighted).
     */
    import Icon from "../common/Icon.svelte";
    import Tooltip from "../common/Tooltip.svelte";
    import { monsterView } from "../../combat.svelte.js";

    let {
        c, n = 1, sheet = null, first = false, last = false, turn = false,
        onTurn, onHp, onMove, onRemove, onConditions = null,
    } = $props();

    // monsters: conditions computed here (AC with Slowed −2 …); players: from their summary
    const mv = $derived(c.kind === "monster" ? monsterView(c) : null);
    const nums = $derived(c.kind === "monster" ? { hp: c.hp, maxHp: c.maxHp, temp: c.temp, ac: mv.ac } : sheet);
    const condNames = $derived(c.kind === "monster" ? mv.names : (sheet?.conditions ?? []));
    const instances = $derived(c.kind === "monster" ? (c.effects ?? []) : (sheet?.conditionInstances ?? []));
    const saveDue = $derived(instances.some((e) => e.savePending));
    const pct = $derived(nums?.maxHp ? Math.round((nums.hp / nums.maxHp) * 100) : 0);
    const state = $derived(!nums ? "" : nums.hp <= 0 ? "down" : pct <= 25 ? "critical" : pct <= 50 ? "bloodied" : pct < 100 ? "hurt" : "ok");

    let amount = $state(1);
    let busy = $state(false);
    let error = $state("");
    let broken = $state(false);

    const ACTIONS = [
        { op: "damage", cls: "dmg", icon: "hpDamage", short: "−", label: "Damage" },
        { op: "heal", cls: "heal", icon: "hpHeal", short: "+", label: "Heal" },
        { op: "temp", cls: "temp", icon: "hpTemp", short: "T", label: "Temp HP" },
    ];

    async function act(op) {
        const v = Math.floor(Number(amount));
        if (!Number.isFinite(v) || v < 0 || (v === 0 && op !== "temp")) return;
        busy = true;
        error = "";
        try {
            await onHp?.(op, v);
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            busy = false;
        }
    }
</script>

<div class="cmb {c.kind} {state}" class:busy class:turn>
    <div class="top">
        <span class="n">{n}</span>
        <span class="tools">
            <button onclick={() => onMove?.(-1)} disabled={first} aria-label="Earlier in the order" title="Earlier">◀</button>
            <button onclick={() => onMove?.(1)} disabled={last} aria-label="Later in the order" title="Later">▶</button>
            <button class="del" onclick={() => onRemove?.()} aria-label="Remove from the encounter" title="Remove">✕</button>
        </span>
    </div>

    <label class="icon-wrap" title="Mark: {c.name}'s turn">
        <span class="icon type-{c.type ?? ''}">
            {#if c.image && !broken}
                <img src={c.image} alt="" onerror={() => (broken = true)} />
            {:else}
                <span>{c.name?.[0] ?? "?"}</span>
            {/if}
        </span>
        <input class="turn-radio" type="radio" name="combat-turn" checked={turn} onchange={() => onTurn?.()}
            aria-label="{c.name}'s turn" />
    </label>

    <p class="name" title={c.name}>{c.name}</p>

    <div class="conds">
        {#each condNames as name (name)}
            <span class="cchip">{name}</span>
        {/each}
        {#if onConditions}
            {#if mv && (mv.summary.flags.length || mv.summary.changes.length)}
                <Tooltip>
                    <span class="cchip info">?</span>
                    {#snippet tip()}
                        <div class="ctip">
                            {#each mv.summary.changes as x}<p>{x.label} <small>{x.sources.join(", ")}</small></p>{/each}
                            {#each mv.summary.flags as f (f.key)}<p>
                                    {f.label.target}: <b>{f.label.mode}</b>
                                    <small>{f.sources.map((s) => s.source).join(", ")}</small>
                                </p>{/each}
                            {#each mv.summary.notes as x}<p>{x.note} <small>{x.source}</small></p>{/each}
                        </div>
                    {/snippet}
                </Tooltip>
            {/if}
            <button class="cbtn" class:due={saveDue} onclick={() => onConditions?.()}
                title={saveDue ? "A save is due — open Conditions" : "Conditions"} aria-label="Conditions of {c.name}"
                >{saveDue ? "save!" : "◎"}</button
            >
        {/if}
    </div>

    {#if nums}
        <p class="stats">
            <span title="Armor Class">AC <b>{nums.ac}</b></span>
            <span title="Hit Points">HP <b>{nums.hp}</b>/{nums.maxHp}{#if nums.temp > 0}<small> +{nums.temp}</small>{/if}</span>
        </p>
        <div class="bar"><span style:width="{pct}%"></span></div>
    {:else}
        <p class="stats muted">…</p>
    {/if}

    <input type="number" min="0" bind:value={amount} aria-label="Hit Points amount for {c.name}" />
    <div class="btns">
        {#each ACTIONS as a (a.op)}
            <button class="hp-btn {a.cls}" onclick={() => act(a.op)} disabled={busy} aria-label={a.label}
                title="{a.label} {a.op === 'temp' ? 'set to' : 'by'} {amount || 0}">
                <Icon name={a.icon} label={a.label} short={a.short} native={false} />
            </button>
        {/each}
    </div>
    {#if error}<p class="error" title={error}>{error}</p>{/if}
</div>

<style>
    /* a card in the (horizontal) line; its content goes top to bottom */
    .cmb {
        --hp: var(--color-success);
        --btn: 38px;
        --gap: 4px;
        width: calc(3 * var(--btn) + 2 * var(--gap) + 24px); /* the three HP buttons + padding */
        box-sizing: border-box;
        flex: none;
        padding: 8px 12px 10px;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 6px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-top-width: 3px;
        border-radius: 10px;
        font-family: var(--font-ui);
        cursor: grab;
    }

    .cmb.monster {
        border-top-color: color-mix(in srgb, var(--color-danger) 70%, var(--color-border));
    }

    .cmb.player {
        border-top-color: var(--color-gold);
    }

    .cmb.hurt { --hp: var(--color-gold); }
    .cmb.bloodied { --hp: var(--color-act-bonus); }
    .cmb.critical,
    .cmb.down { --hp: var(--color-danger); }

    .cmb.down {
        opacity: 0.5;
    }

    .cmb.busy {
        opacity: 0.7;
    }

    .top {
        display: flex;
        align-items: center;
    }

    .conds {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 3px;
        min-height: 18px;
    }

    .cchip {
        padding: 0 6px;
        border: 1px solid var(--color-danger);
        border-radius: 999px;
        font-size: 10px;
        line-height: 16px;
        color: var(--color-text-primary);
        background: color-mix(in srgb, var(--color-danger) 15%, transparent);
    }

    .cchip.info {
        border-color: var(--color-border);
        background: transparent;
        color: var(--color-text-muted);
        cursor: help;
    }

    .cbtn {
        padding: 0 6px;
        background: transparent;
        border: 1px dashed var(--color-border);
        border-radius: 999px;
        font-size: 10px;
        line-height: 16px;
        color: var(--color-text-muted);
        cursor: pointer;
    }

    .cbtn:hover {
        border-color: var(--color-danger);
        color: var(--color-danger);
    }

    .cbtn.due {
        border-style: solid;
        border-color: var(--color-gold);
        color: var(--color-gold);
    }

    .ctip p {
        margin: 2px 0;
        font-size: 12px;
    }

    .ctip small {
        color: var(--color-text-muted);
    }

    .n {
        font-size: 13px;
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-muted);
    }

    .tools {
        margin-left: auto;
        display: flex;
        gap: 1px;
    }

    .tools button {
        width: 22px;
        height: 22px;
        padding: 0;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 4px;
        font-size: 11px;
        color: var(--color-text-muted);
        cursor: pointer;
    }

    .tools button:not(:disabled):hover {
        border-color: var(--color-border);
        color: var(--color-gold-hover);
    }

    .tools button.del:hover {
        border-color: var(--color-danger);
        color: var(--color-danger);
    }

    .tools button:disabled {
        opacity: 0.25;
        cursor: default;
    }

    .icon-wrap {
        position: relative;
        align-self: center;
        cursor: pointer;
    }

    .icon {
        --tc: var(--color-gold);
        flex: none;
        width: 80px;
        height: 80px;
        box-sizing: border-box;
        border: 2px solid var(--tc);
        border-radius: 50%;
        overflow: hidden;
        display: grid;
        place-items: center;
        background: var(--color-card-elevated);
        font-family: var(--font-heading);
        font-size: 34px;
        color: var(--tc);
    }

    /* whose turn: a check in a circle on the icon; one radio for the whole line */
    .turn-radio {
        appearance: none;
        position: absolute;
        right: -2px;
        bottom: -2px;
        width: 26px;
        height: 26px;
        margin: 0;
        display: grid;
        place-items: center;
        background: var(--color-card);
        border: 2px solid var(--color-border);
        border-radius: 50%;
        cursor: pointer;
    }

    .turn-radio:hover {
        border-color: var(--color-gold);
    }

    .turn-radio:checked {
        background: var(--color-gold);
        border-color: var(--color-gold);
    }

    .turn-radio:checked::after {
        content: "✓";
        font-size: 15px;
        font-weight: var(--font-weight-bold);
        line-height: 1;
        color: var(--color-bg);
    }

    .turn-radio:focus-visible {
        outline: 2px solid var(--color-gold-hover);
        outline-offset: 2px;
    }

    .cmb.turn {
        border-color: var(--color-gold);
        box-shadow: 0 0 0 1px var(--color-gold), 0 0 14px color-mix(in srgb, var(--color-gold) 35%, transparent);
    }

    .cmb.turn .icon {
        border-color: var(--color-gold);
    }

    .monster .icon { --tc: var(--color-danger); }
    .type-celestial { --tc: var(--color-dmg-radiant) !important; }
    .type-fey, .type-plant, .type-beast { --tc: var(--color-success) !important; }
    .type-aberration, .type-ooze { --tc: var(--color-magic-purple) !important; }
    .type-elemental, .type-dragon { --tc: var(--color-dmg-fire) !important; }

    .icon img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .name {
        margin: 0;
        overflow-wrap: anywhere; /* long names wrap onto the next line */
        line-height: 1.2;
        text-align: center;
        font-family: var(--font-heading);
        font-size: 14px;
        color: var(--color-text-primary);
    }

    .stats {
        margin: 0;
        display: flex;
        justify-content: space-between;
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .stats b {
        color: var(--color-text-primary);
    }

    .stats small {
        color: var(--color-meta-range);
    }

    .muted {
        justify-content: center;
        color: var(--color-text-muted);
    }

    .bar {
        height: 4px;
        background: var(--color-card-elevated);
        border-radius: 999px;
        overflow: hidden;
    }

    .bar span {
        display: block;
        height: 100%;
        background: var(--hp);
        transition: width 0.3s ease;
    }

    input {
        width: 100%;
        height: 34px;
        box-sizing: border-box;
        padding: 0 6px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-primary);
        font-family: var(--font-heading);
        font-size: 16px;
        text-align: center;
        cursor: text;
    }

    input:focus {
        outline: none;
        border-color: var(--color-gold);
    }

    .btns {
        display: flex;
        gap: var(--gap);
    }

    .hp-btn {
        --c: var(--color-text-secondary);
        width: var(--btn);
        height: 34px;
        padding: 0;
        display: grid;
        place-items: center;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        cursor: pointer;
    }

    .hp-btn :global(.icon) {
        width: 20px;
        height: 20px;
        color: var(--c);
    }

    .hp-btn.dmg { --c: var(--color-danger); }
    .hp-btn.heal { --c: var(--color-success); }
    .hp-btn.temp { --c: var(--color-text-accent); }

    .hp-btn:not(:disabled):hover {
        border-color: var(--c);
        background: color-mix(in srgb, var(--c) 15%, transparent);
    }

    .error {
        margin: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 10px;
        color: var(--color-danger);
    }
</style>
