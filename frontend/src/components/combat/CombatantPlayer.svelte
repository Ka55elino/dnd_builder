<script>
    /**
     * One combatant in the player's initiative line: order number, icon, name.
     * No Hit Points or stats — that's for the DM.
     *
     * c   — { id, kind, name, image, type, playerId, conditions } (what the DM shares)
     * n   — its place in the line (1-based)
     * me  — this is the player's own character
     * turn — it's this combatant's turn (set by the DM; shown as a check on the icon)
     */
    let { c, n = 1, me = false, turn = false } = $props();
    let broken = $state(false);
</script>

<div class="cmb {c.kind}" class:me class:turn title={turn ? `${c.name} — their turn` : c.name}>
    <span class="n">{n}</span>
    <div class="icon-wrap">
        <div class="icon type-{c.type ?? ''}">
            {#if c.image && !broken}
                <img src={c.image} alt="" onerror={() => (broken = true)} />
            {:else}
                <span>{c.name?.[0] ?? "?"}</span>
            {/if}
        </div>
        {#if turn}<span class="turn-mark" aria-label="Their turn">✓</span>{/if}
    </div>
    <span class="name">{c.name}{#if me}<small> (you)</small>{/if}</span>
    {#if c.conditions?.length}
        <span class="conds">{#each c.conditions as x (x)}<span class="cchip">{x}</span>{/each}</span>
    {/if}
</div>

<style>
    .conds {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 3px;
    }

    .cchip {
        padding: 0 5px;
        border: 1px solid var(--color-danger);
        border-radius: 999px;
        font-size: 10px;
        line-height: 15px;
        color: var(--color-text-primary);
        background: color-mix(in srgb, var(--color-danger) 15%, transparent);
    }

    .cmb {
        position: relative;
        width: 112px;
        flex: none;
        box-sizing: border-box;
        padding: 8px 6px 6px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 10px;
        font-family: var(--font-ui);
    }

    .cmb.me {
        border-color: var(--color-gold);
        background: var(--color-card-elevated);
    }

    .n {
        position: absolute;
        top: 4px;
        left: 6px;
        font-size: 11px;
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-muted);
    }

    .icon {
        --tc: var(--color-gold);
        width: 72px;
        height: 72px;
        box-sizing: border-box;
        flex: none;
        border: 2px solid var(--tc);
        border-radius: 50%;
        overflow: hidden;
        display: grid;
        place-items: center;
        background: var(--color-card-elevated);
        font-family: var(--font-heading);
        font-size: 30px;
        color: var(--tc);
    }

    .icon-wrap {
        position: relative;
    }

    .turn-mark {
        position: absolute;
        right: -2px;
        bottom: -2px;
        width: 24px;
        height: 24px;
        display: grid;
        place-items: center;
        background: var(--color-gold);
        border: 2px solid var(--color-card);
        border-radius: 50%;
        font-size: 14px;
        font-weight: var(--font-weight-bold);
        color: var(--color-bg);
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
        max-width: 100%;
        overflow-wrap: anywhere; /* long names wrap onto the next line */
        line-height: 1.2;
        text-align: center;
        font-family: var(--font-heading);
        font-size: 12px;
        color: var(--color-text-primary);
    }

    .name small {
        font-family: var(--font-ui);
        color: var(--color-gold);
    }
</style>
