<script>
    /**
     * A location on the campaign board. With sub-locations it is a group (a frame with the
     * title on top that holds them); otherwise a card. Quest routes end at the top handle.
     * data: { loc, group, start, party, npcs: [names], encounters: [names], quests: [colours] }
     */
    import { Handle, Position } from "@xyflow/svelte";

    let { data, selected = false } = $props();
    const l = $derived(data.loc);
</script>

<div class="loc" class:group={data.group} class:selected class:party={data.party} class:unknown={!l.visible}>
    <Handle type="target" position={Position.Top} />
    <div class="head">
        {#if data.start}<span class="star" title="Starting location">★</span>{/if}
        <span class="name" title={l.name}>{l.name}</span>
        {#if l.type}<span class="type">{l.type}</span>{/if}
    </div>
    {#if !data.group || data.npcs.length || data.encounters.length || data.party}
        <div class="meta">
            {#if data.party}<span class="here" title="The party is here (the latest “location visited” in the log)">● party here</span>{/if}
            {#if data.npcs.length}<span title={data.npcs.join(", ")}>☺ {data.npcs.length}</span>{/if}
            {#if data.encounters.length}<span title={data.encounters.join(", ")}>⚔ {data.encounters.length}</span>{/if}
            {#if data.quests.length}
                <span class="dots" title="Quests that go here">
                    {#each data.quests as c}<i style:background={c}></i>{/each}
                </span>
            {/if}
        </div>
    {/if}
</div>

<style>
    .loc {
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 8px 12px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 10px;
        font-family: var(--font-ui);
        color: var(--color-text-primary);
    }

    .loc.group {
        padding: 10px 14px;
        background: color-mix(in srgb, var(--color-card) 55%, transparent);
        border-style: dashed;
        border-color: color-mix(in srgb, var(--color-gold) 35%, var(--color-border));
    }

    .loc.unknown:not(.group) {
        border-style: dashed;
    }

    .loc.selected {
        border-color: var(--color-gold);
        box-shadow: 0 0 0 1px var(--color-gold);
    }

    .loc.party {
        box-shadow: 0 0 0 2px var(--color-success);
    }

    .head {
        display: flex;
        align-items: baseline;
        gap: 6px;
        min-width: 0;
    }

    .name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--font-heading);
        font-size: 15px;
    }

    .group .name {
        font-size: 17px;
        color: var(--color-gold);
    }

    .star {
        color: var(--color-gold);
    }

    .type {
        flex: none;
        font-size: 10px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-text-muted);
    }

    .meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        font-size: 11px;
        color: var(--color-text-secondary);
    }

    .here {
        color: var(--color-success);
    }

    .dots {
        display: inline-flex;
        gap: 3px;
    }

    .dots i {
        width: 8px;
        height: 8px;
        border-radius: 50%;
    }
</style>
