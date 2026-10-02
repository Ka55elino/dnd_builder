<script>
    /**
     * The DM's initiative line: every combatant in order, left to right (CombatantDM).
     * Reorder with ◀ ▶ on a card or by dragging it; changes go to the players.
     *
     * sheetOf(playerId) — { hp, maxHp, temp, ac } | null for a player's card
     * onPlayerHp(playerId, op, amount) — Hit Points of a player (sent to their app)
     * onPlayerCondition(playerId, data) — a "condition" event for a player (game.js)
     * conditionDefs — refs.conditions (for the Conditions dialog)
     */
    import { combat, move, moveTo, remove, monsterHp, setTurn, nextTurn, monsterCondition } from "../../combat.svelte.js";
    import CombatantDM from "./CombatantDM.svelte";
    import ConditionDialog from "../ConditionDialog.svelte";

    let { sheetOf = () => null, onPlayerHp, onPlayerCondition, conditionDefs = [] } = $props();

    // the combatant whose Conditions dialog is open (its id — the entry itself may be replaced)
    let condFor = $state(null);
    const condC = $derived(combat.line.find((c) => c.id === condFor) ?? null);
    const instancesOf = (c) => (c.kind === "monster" ? (c.effects ?? []) : (sheetOf(c.playerId)?.conditionInstances ?? []));

    function onCondition(c, data) {
        if (c.kind === "monster") return monsterCondition(c, data);
        return onPlayerCondition?.(c.playerId, data);
    }

    let dragFrom = $state(-1);
    let dragOver = $state(-1);

    const monsters = $derived(combat.line.filter((c) => c.kind === "monster"));
    const down = $derived(monsters.filter((c) => c.hp <= 0).length);

    function onHp(c, op, n) {
        if (c.kind === "monster") return monsterHp(c, op, n);
        return onPlayerHp?.(c.playerId, op, n);
    }

    function drop(i) {
        if (dragFrom !== -1) moveTo(dragFrom, i);
        dragFrom = dragOver = -1;
    }
</script>

<section class="lineup">
    <header>
        <h2>Encounter{#if combat.name}<span class="nm"> · {combat.name}</span>{/if}</h2>
        <span class="meta">
            {combat.line.length} in order · {monsters.length} {monsters.length === 1 ? "monster" : "monsters"}{#if down}, {down} down{/if}
        </span>
        <span class="round">Round <b>{combat.round}</b></span>
        <button class="next" onclick={nextTurn} disabled={!combat.line.length}
            title="End this turn (conditions tick: rounds, saves) and pass it on">Next turn ▶</button>
        <span class="hint">Order: ◀ ▶ or drag a card · whose turn: the circle on the icon or “Next turn”</span>
    </header>

    <div class="line" role="list">
        {#each combat.line as c, i (c.id)}
            <div
                role="listitem"
                class="slot"
                class:over={dragOver === i && dragFrom !== i}
                draggable="true"
                ondragstart={(e) => {
                    dragFrom = i;
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", c.id);
                }}
                ondragover={(e) => {
                    e.preventDefault();
                    dragOver = i;
                }}
                ondragleave={() => dragOver === i && (dragOver = -1)}
                ondrop={(e) => {
                    e.preventDefault();
                    drop(i);
                }}
                ondragend={() => (dragFrom = dragOver = -1)}
            >
                <CombatantDM
                    {c}
                    n={i + 1}
                    sheet={c.kind === "player" ? sheetOf(c.playerId) : null}
                    first={i === 0}
                    last={i === combat.line.length - 1}
                    turn={combat.turn === c.id}
                    onTurn={() => setTurn(c.id)}
                    onHp={(op, n) => onHp(c, op, n)}
                    onConditions={() => (condFor = c.id)}
                    onMove={(dir) => move(i, dir)}
                    onRemove={() => remove(i)}
                />
            </div>
        {:else}
            <p class="empty">Nobody is in the encounter.</p>
        {/each}
    </div>
</section>

{#if condC}
    <ConditionDialog
        name={condC.name}
        defs={conditionDefs}
        current={instancesOf(condC)}
        onApply={(data) => onCondition(condC, data)}
        onClose={() => (condFor = null)}
    />
{/if}

<style>
    .lineup {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 14px 16px;
        background: color-mix(in srgb, var(--color-danger) 6%, var(--color-card));
        border: 1px solid color-mix(in srgb, var(--color-danger) 40%, var(--color-border));
        border-radius: 12px;
    }

    header {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 12px;
    }

    h2 {
        margin: 0;
        font-family: var(--font-heading);
        font-size: 18px;
        color: var(--color-text-accent);
    }

    .nm {
        color: var(--color-text-secondary);
    }

    .meta,
    .hint {
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .hint {
        margin-left: auto;
    }

    .round {
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .next {
        padding: 4px 12px;
        background: transparent;
        border: 1px solid var(--color-gold);
        border-radius: 6px;
        color: var(--color-gold);
        font-family: var(--font-ui);
        font-size: 12px;
        cursor: pointer;
    }

    .next:hover:not(:disabled) {
        background: color-mix(in srgb, var(--color-gold) 15%, transparent);
    }

    .next:disabled {
        opacity: 0.4;
        cursor: default;
    }

    /* left to right; long encounters scroll sideways */
    .line {
        display: flex;
        align-items: stretch;
        gap: 8px;
        overflow-x: auto;
        padding: 2px 2px 6px;
    }

    /* every card as tall as the tallest one */
    .slot {
        display: flex;
        align-items: stretch;
        border-radius: 10px;
        outline: 2px dashed transparent;
        outline-offset: 2px;
    }

    .slot.over {
        outline-color: var(--color-gold);
    }

    .empty {
        margin: 0;
        font-size: 13px;
        color: var(--color-text-muted);
    }
</style>
