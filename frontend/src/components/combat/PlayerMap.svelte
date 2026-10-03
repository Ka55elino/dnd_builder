<script>
    /**
     * The encounter's map on a player's screen — read-only: the terrain the DM drew and the
     * tokens where the DM puts them (combat.svelte.js `seen`: "encmap" + "encounter".positions).
     * The player can look around (pan / zoom, held to the map), nothing else. Their own token
     * has a dashed ring; whose turn it is glows.
     */
    import MapCanvas from "../campaign/map/MapCanvas.svelte";
    import { seen } from "../../combat.svelte.js";
    import { server } from "../../server.svelte.js";
    import { tilesToCells } from "../../data/campaigns.js";

    const me = $derived(server.playerId ? `p:${server.playerId}` : "");
    const cells = $derived(tilesToCells(seen.map?.tiles));
    const tokens = $derived(
        seen.line
            .filter((c) => seen.positions[c.id])
            .map((c) => {
                const [x, y] = seen.positions[c.id].split(",").map(Number);
                return {
                    id: c.id,
                    kind: c.kind,
                    x,
                    y,
                    image: c.image || "",
                    icon: c.kind === "player" ? "🧑" : "👹",
                    ring: c.kind === "player" ? "#4a86c8" : "#c0392b",
                    label: c.id === me ? `${c.name} (you)` : c.name,
                    active: seen.turn === c.id,
                };
            }),
    );
    const notPlaced = $derived(seen.line.filter((c) => !seen.positions[c.id]).length);
</script>

<div class="pmap">
    <header>
        <b>⚔ {seen.map?.name || seen.name || "Encounter"}</b>
        <small>Round {seen.round}{#if notPlaced} · {notPlaced} not on the map yet{/if}</small>
    </header>
    <div class="canvas">
        {#key seen.map?.at}
            <MapCanvas tool="pan" {cells} markers={tokens} selected={me} bounded={Object.keys(cells).length > 0} />
        {/key}
        <p class="hint">The DM moves the tokens · you can look around</p>
    </div>
</div>

<style>
    .pmap {
        display: flex;
        flex-direction: column;
        gap: 8px;
        height: calc(100vh - 190px);
        min-height: 360px;
        padding: 0 24px 24px;
        box-sizing: border-box;
    }

    header {
        display: flex;
        align-items: baseline;
        gap: 10px;
        color: var(--color-text-primary);
        font-size: 14px;
    }

    header small {
        color: var(--color-text-muted);
        font-size: 12px;
    }

    .canvas {
        position: relative;
        flex: 1;
        min-height: 0;
        border: 1px solid var(--color-border);
        border-radius: 10px;
        overflow: hidden;
        isolation: isolate;
    }

    .hint {
        position: absolute;
        left: 32px;
        bottom: 10px;
        margin: 0;
        padding: 4px 10px;
        background: color-mix(in srgb, var(--color-card) 85%, transparent);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: 11px;
        pointer-events: none;
    }
</style>
