<script>
    /**
     * The player's view of the initiative line: icons and names in the order
     * the DM set (CombatantPlayer). Shown only while the DM runs an encounter.
     */
    import { seen } from "../../combat.svelte.js";
    import { server } from "../../server.svelte.js";
    import CombatantPlayer from "./CombatantPlayer.svelte";
</script>

{#if seen.active && server.role === "player"}
    <section class="lineup">
        <header>
            <h2>Encounter{#if seen.name}<span class="nm"> · {seen.name}</span>{/if}</h2>
            <span class="meta">order of play · round {seen.round}</span>
        </header>
        <div class="line" role="list">
            {#each seen.line as c, i (c.id)}
                <div role="listitem">
                    <CombatantPlayer {c} n={i + 1} me={c.kind === "player" && c.playerId === server.playerId} turn={seen.turn === c.id} />
                </div>
            {/each}
        </div>
    </section>
{/if}

<style>
    .lineup {
        margin: 20px 32px 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 12px 16px;
        background: color-mix(in srgb, var(--color-danger) 6%, var(--color-card));
        border: 1px solid color-mix(in srgb, var(--color-danger) 40%, var(--color-border));
        border-radius: 12px;
    }

    header {
        display: flex;
        align-items: baseline;
        gap: 12px;
    }

    h2 {
        margin: 0;
        font-family: var(--font-heading);
        font-size: 16px;
        color: var(--color-text-accent);
    }

    .nm {
        color: var(--color-text-secondary);
    }

    .meta {
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .line {
        display: flex;
        align-items: stretch;
        gap: 8px;
        overflow-x: auto;
        padding-bottom: 4px;
    }

    /* every card as tall as the tallest one (names wrap to 1–2 lines) */
    .line > div {
        display: flex;
    }

    @media print {
        .lineup {
            display: none;
        }
    }
</style>
