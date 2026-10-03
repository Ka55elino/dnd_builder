<script>
    /**
     * The campaign map during the game (the DM's "Map" tab): the maps drawn in the campaign's
     * Overview, view only.
     *
     *   ┌ 🗂 The Ember Vale › Millbrook › [Chapel] [Tankard] [⚔ Smugglers] ─────── − ⌖ + ┐
     *   │                                                                               │
     *   │      terrain + markers (locations, NPCs, encounters)                          │
     *   │                                                                               │
     *   └ double click a location / an encounter opens its map ─────────────────────────┘
     *
     * Navigation: the path over the map (clickable), the places inside the current one, the
     * layer menu (🗂), double click on a marker. Nothing in the campaign is changed here.
     *
     * An encounter (combat.svelte.js): when one starts, its map opens (a hand-made one, or one
     * from outside the campaign — an empty grid) with the list of combatants on the left —
     * the players and the enemies, in initiative order. The DM puts them on the map (drag from
     * the list, or click one and then a cell) and moves them (drag on the map); a click on a
     * token selects it, Delete takes it off. Whose turn it is glows. For now only the DM sees
     * the positions (combat.positions).
     *
     * campaign; startAt — the layer to open first (a location id / "encounter:<id>"); by default
     * the top region above the campaign's starting location
     */
    import { onMount } from "svelte";
    import MapCanvas from "./MapCanvas.svelte";
    import { loadLocations, loadNpcs, loadCampaignEncounters, loadMapLayers, loadMapLayer, locationTree, tilesToCells, cellsToTiles } from "../../../data/campaigns.js";
    import { layerOwner, layerKey, typeIcon, placeablesOf, markersOf, placedOf, pathTo } from "../../../data/mapLayers.js";
    import { combat, placeToken, removeToken, setCombatMap } from "../../../combat.svelte.js";

    let { campaign, startAt = "" } = $props();

    let locations = $state([]);
    let npcs = $state([]);
    let encounters = $state([]);
    let info = $state({}); // layer → { cells, markers }: which layers have a map at all
    let loading = $state(true);
    let error = $state("");

    let layer = $state("");
    let maps = $state({}); // layer → { cells: { "x,y": tileId }, placed: { "type:id": "x,y" } }
    let layerError = $state("");
    let menu = $state(false);
    let menuPos = $state({ left: 0, top: 0 });

    const tree = $derived(locationTree(locations));
    const byId = $derived(new Map(locations.map((l) => [l.id, l])));
    const encLayer = $derived(layer.startsWith("encounter:") ? (encounters.find((e) => `encounter:${e.id}` === layer) ?? null) : null);
    const current = $derived(encLayer ? (byId.get(encLayer.locationId) ?? null) : (byId.get(layer) ?? null));
    const path = $derived(pathTo(current, byId));
    const placeables = $derived(placeablesOf(layer, { locations, npcs, encounters }));
    const map = $derived(maps[layer] ?? null);
    const markers = $derived(map ? markersOf(placeables, map.placed) : []);
    // the places inside this one (locations and encounters — they have maps of their own)
    const inside = $derived(placeables.filter((t) => t.type !== "npc"));
    const empty = $derived(!!map && !Object.keys(map.cells).length && !markers.length);
    const hasMap = (key) => (info[key]?.cells ?? 0) + (info[key]?.markers ?? 0) > 0;

    // ---------- the running encounter ----------
    // its map: the preset's own layer, or an empty grid for a hand-made encounter
    const combatKey = $derived(combat.active ? (combat.presetId ? `encounter:${combat.presetId}` : "combat:adhoc") : "");
    const inCombat = $derived(!!combatKey && layer === combatKey);
    let selected = $state(null); // the combatant the DM is placing / moving
    let note = $state("");
    let noteTimer;
    function say(msg) {
        note = msg;
        clearTimeout(noteTimer);
        noteTimer = setTimeout(() => (note = ""), 2500);
    }

    const tokenOf = (c) => {
        const down = c.kind === "monster" && c.hp <= 0;
        return {
            id: c.id,
            kind: c.kind,
            image: c.image || "",
            icon: c.kind === "player" ? "🧑" : down ? "💀" : "👹",
            ring: c.kind === "player" ? "#4a86c8" : "#c0392b",
            label: c.name,
            active: combat.turn === c.id,
            down,
        };
    };
    const tokens = $derived(
        inCombat
            ? combat.line
                  .filter((c) => combat.positions[c.id])
                  .map((c) => {
                      const [x, y] = combat.positions[c.id].split(",").map(Number);
                      return { ...tokenOf(c), x, y };
                  })
            : [],
    );
    const selectedCombatant = $derived(combat.line.find((c) => c.id === selected) ?? null);
    // the selected one: a click on an empty cell puts it there (or moves it there)
    const placing = $derived(inCombat && selectedCombatant ? tokenOf(selectedCombatant) : null);

    // a new encounter: its map opens
    let lastCombat = "";
    $effect(() => {
        const k = combatKey;
        if (k && k !== lastCombat && !loading) {
            lastCombat = k;
            selected = null;
            openLayer(k);
        } else if (!k) lastCombat = "";
    });

    // the encounter's map is loaded: the players get it (terrain only), read-only
    $effect(() => {
        const k = combatKey;
        const m = k ? maps[k] : null;
        if (!m || combat.map?.key === k) return;
        setCombatMap({ key: k, name: encLayer?.name || combat.name || "Encounter", tiles: cellsToTiles(m.cells).tiles });
    });

    function put(id, x, y) {
        const wasOn = !!combat.positions[id];
        if (!placeToken(id, x, y)) return say("This cell is taken");
        // just put on the map: the next one not there yet is selected
        if (!wasOn && id === selected) selected = combat.line.find((c) => !combat.positions[c.id])?.id ?? null;
    }

    function pick(id) {
        selected = selected === id ? null : id;
    }

    function takeOff(id) {
        removeToken(id);
        if (selected === id) selected = null;
    }

    function dragToken(e, c) {
        e.dataTransfer.setData("text/x-map-item", c.id);
        e.dataTransfer.effectAllowed = "move";
        selected = c.id;
    }

    function onKey(e) {
        if (!inCombat || /input|textarea|select/i.test(e.target?.tagName)) return;
        if (e.key === "Escape") selected = null;
        if ((e.key === "Delete" || e.key === "Backspace") && selected && combat.positions[selected]) {
            e.preventDefault();
            takeOff(selected);
        }
    }

    onMount(async () => {
        try {
            const [ls, ns, es, infos] = await Promise.all([
                loadLocations(campaign.id),
                loadNpcs(campaign.id),
                loadCampaignEncounters(campaign.id),
                loadMapLayers(campaign.id).catch(() => []),
            ]);
            locations = ls;
            npcs = ns;
            encounters = es;
            info = Object.fromEntries(infos.map((l) => [layerKey(l.ownerType, l.ownerId), { cells: l.cells, markers: l.markers }]));
            let first = startAt && (byId.has(startAt) || es.some((e) => `encounter:${e.id}` === startAt)) ? startAt : "";
            if (!first) {
                // the top region above where the adventure begins (or the first location)
                let top = byId.get(campaign?.data?.startLocationId) ?? tree[0]?.loc;
                for (let i = 0; top?.parentId && byId.has(top.parentId) && i < 64; i++) top = byId.get(top.parentId);
                first = top?.id ?? "";
            }
            // an encounter is already running: its map; else where we start
            if (combatKey) {
                lastCombat = combatKey;
                await openLayer(combatKey);
            } else await openLayer(first);
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            loading = false;
        }
    });

    async function openLayer(key) {
        if (!key) return;
        menu = false;
        layer = key;
        if (maps[key]) return;
        layerError = "";
        const blank = { cells: {}, placed: {} };
        if (key === "combat:adhoc") return void (maps = { ...maps, [key]: blank }); // a hand-made encounter: an empty grid
        try {
            const o = layerOwner(key);
            const m = await loadMapLayer(campaign.id, o.type, o.id);
            maps = { ...maps, [key]: { cells: tilesToCells(m?.tiles), placed: placedOf(m) } };
        } catch (e) {
            // an encounter preset from outside the campaign: no map of its own — an empty grid
            if (key === combatKey) maps = { ...maps, [key]: blank };
            else layerError = e?.message ?? String(e);
        }
    }

    // double click on a marker: a location / an encounter opens its map
    function openMarker(key) {
        const [type, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
        if (type === "location") openLayer(id);
        else if (type === "encounter") openLayer(key);
    }

    // the layer menu lives in <body> (position: fixed): nothing covers or clips it
    function portal(node) {
        document.body.appendChild(node);
        return { destroy: () => node.remove() };
    }
    function toggleMenu(e) {
        if (menu) return void (menu = false);
        const r = e.currentTarget.getBoundingClientRect();
        menuPos = { left: r.left, top: r.bottom + 6 };
        menu = true;
    }
    function onDocDown(e) {
        if (menu && !e.target.closest?.(".layers-btn, .view-menu")) menu = false;
    }
    const encountersOf = (locId) => encounters.filter((e) => (e.locationId || "") === locId).sort((a, b) => a.name.localeCompare(b.name));
</script>

<svelte:window
    onpointerdown={onDocDown}
    onkeydown={(e) => (e.key === "Escape" && (menu = false), onKey(e))}
    onresize={() => (menu = false)}
    onscrollcapture={() => (menu = false)}
/>

<div class="view" class:combat={inCombat}>
    {#if inCombat}
        <!-- the combatants: drag onto the map, or click and then a cell -->
        <aside class="party" aria-label="Combatants">
            <header>
                <b>⚔ {combat.name || "Encounter"}</b>
                <small>Round {combat.round}</small>
            </header>
            <ul>
                {#each combat.line as c (c.id)}
                    {@const on = !!combat.positions[c.id]}
                    <li>
                        <button
                            class="who {c.kind}"
                            class:sel={selected === c.id}
                            class:turn={combat.turn === c.id}
                            class:down={c.kind === "monster" && c.hp <= 0}
                            draggable="true"
                            ondragstart={(e) => dragToken(e, c)}
                            onclick={() => pick(c.id)}
                            title={on ? "On the map — drag it there to move, or click and then a cell" : "Drag onto the map, or click and then click a cell"}
                        >
                            <span class="face" style:border-color={c.kind === "player" ? "#4a86c8" : "#c0392b"}>
                                {#if c.image}<img src={c.image} alt="" draggable="false" />{:else}{c.kind === "player" ? "🧑" : "👹"}{/if}
                            </span>
                            <span class="nm">
                                {c.name}
                                {#if c.kind === "monster"}<small>{Math.max(0, c.hp)}/{c.maxHp} HP</small>{:else}<small>player</small>{/if}
                            </span>
                            <span class="st" class:on>{on ? "●" : "○"}</span>
                        </button>
                        {#if on}<button class="off" onclick={() => takeOff(c.id)} title="Take off the map" aria-label="Take {c.name} off the map">✕</button>{/if}
                    </li>
                {/each}
            </ul>
            <p class="tip">● on the map · ○ not yet<br />Drag tokens on the map to move them; a click selects, Delete takes it off.</p>
        </aside>
    {/if}
    <div class="area">
    {#if loading}
        <p class="msg">Loading the map…</p>
    {:else if error}
        <p class="msg err">Failed to load the map: {error}</p>
    {:else if !locations.length}
        <p class="msg">This campaign has no locations — and so no maps yet. Draw them in the campaign's Overview.</p>
    {:else}
        {#if map}
            {#key layer}
                <MapCanvas
                    tool={inCombat ? "move" : "pan"}
                    bounded={Object.keys(map.cells).length > 0}
                    cells={map.cells}
                    markers={inCombat ? [...markers, ...tokens] : markers}
                    {placing}
                    selected={inCombat ? selected : null}
                    onopenmarker={openMarker}
                    onplace={(x, y) => selected && put(selected, x, y)}
                    onmovemarker={(id, x, y) => combat.positions[id] && put(id, x, y)}
                    onclickmarker={(id) => combat.positions[id] && pick(id)}
                    ondropitem={inCombat ? (id, x, y) => put(id, x, y) : null}
                />
            {/key}
        {:else}
            <p class="msg">{layerError ? `Failed to load the map: ${layerError}` : "Loading the map…"}</p>
        {/if}

        <nav class="bar" aria-label="Map">
            <button class="layers-btn" class:open={menu} onclick={toggleMenu} title="All maps" aria-haspopup="menu" aria-expanded={menu}>🗂 ▾</button>
            {#each path as l, i (l.id)}
                {#if i}<span class="sep">›</span>{/if}
                <button class:cur={l.id === layer} onclick={() => openLayer(l.id)}>{typeIcon(l)} {l.name}</button>
            {/each}
            {#if encLayer}
                {#if path.length}<span class="sep">›</span>{/if}
                <button class="cur enc">⚔ {encLayer.name}</button>
            {:else if inCombat}
                <button class="cur enc">⚔ {combat.name || "Encounter"}</button>
            {/if}
            {#if inside.length}
                <span class="sep">›</span>
                {#each inside as t (t.key)}
                    {@const key = t.type === "encounter" ? t.key : t.id}
                    <button class="child" class:enc={t.type === "encounter"} class:nomap={!hasMap(key)} onclick={() => openLayer(key)} title={hasMap(key) ? `Open the map of ${t.name}` : `${t.name}: no map drawn yet`}>
                        {t.icon} {t.name}
                    </button>
                {/each}
            {/if}
        </nav>

        {#if empty && !inCombat}
            <p class="empty">Nothing is drawn here yet — draw this map in the campaign's Overview.</p>
        {/if}
        {#if note}<p class="note">{note}</p>{/if}
        <p class="hint">
            {#if inCombat}
                {placing
                    ? `${placing.label} — click a cell to ${combat.positions[selected] ? "move" : "put"} them there · Delete takes them off`
                    : "Choose someone on the left — drag them onto the map, or click and then a cell"}
            {:else}Double click a place or an encounter on the map to open its map{/if}
        </p>
    {/if}
    </div>
</div>

{#if menu}
    <div class="view-menu" role="menu" aria-label="Maps" use:portal style:left="{menuPos.left}px" style:top="{menuPos.top}px">
        <div class="menu-title">Maps</div>
        {#each tree as t (t.loc.id)}
            <button class="item" class:on={layer === t.loc.id} class:nomap={!hasMap(t.loc.id)} role="menuitem" style:padding-left="{6 + t.depth * 16}px" onclick={() => openLayer(t.loc.id)}>
                <span class="ico">{typeIcon(t.loc)}</span><span class="nm">{t.loc.name}</span>
            </button>
            {#each encountersOf(t.loc.id) as e (e.id)}
                {@const key = `encounter:${e.id}`}
                <button class="item enc" class:on={layer === key} class:nomap={!hasMap(key)} role="menuitem" style:padding-left="{6 + (t.depth + 1) * 16}px" onclick={() => openLayer(key)}>
                    <span class="ico">⚔</span><span class="nm">{e.name}</span>
                </button>
            {/each}
        {/each}
        <p class="menu-hint">Greyed out — no map drawn yet.</p>
    </div>
{/if}

<style>
    .view {
        position: relative;
        display: flex;
        height: calc(100vh - 230px);
        min-height: 420px;
        border: 1px solid var(--color-border);
        border-radius: 10px;
        overflow: hidden;
        isolation: isolate;
        background: var(--color-card-elevated);
    }

    .area {
        position: relative;
        flex: 1;
        min-width: 0;
    }

    /* ---- the combatants ---- */
    .party {
        flex: none;
        width: 220px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 10px 8px;
        overflow-y: auto;
        background: var(--color-card);
        border-right: 1px solid var(--color-border);
    }

    .party header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 6px;
        padding: 0 4px 4px;
        font-size: 13px;
        color: var(--color-text-primary);
    }

    .party header small {
        color: var(--color-text-muted);
        font-size: 11px;
        white-space: nowrap;
    }

    .party ul {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 3px;
    }

    .party li {
        display: flex;
        align-items: center;
        gap: 2px;
    }

    .who {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 6px;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 8px;
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: 12px;
        text-align: left;
        cursor: grab;
    }

    .who:hover {
        background: var(--color-card-elevated);
    }

    .who.sel {
        border-color: var(--color-gold);
        background: var(--color-card-elevated);
    }

    .who.turn .nm {
        color: var(--color-gold);
        font-weight: 600;
    }

    .who.down {
        opacity: 0.5;
    }

    .face {
        flex: none;
        width: 28px;
        height: 28px;
        display: grid;
        place-items: center;
        border: 2px solid;
        border-radius: 50%;
        overflow: hidden;
        background: rgba(29, 26, 23, 0.88);
        font-size: 14px;
    }

    .face img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .who .nm {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .who .nm small {
        display: block;
        color: var(--color-text-muted);
        font-size: 10px;
        font-weight: 400;
    }

    .st {
        color: var(--color-text-muted);
        font-size: 10px;
    }

    .st.on {
        color: var(--color-gold);
    }

    .off {
        flex: none;
        width: 22px;
        height: 22px;
        padding: 0;
        background: transparent;
        border: 0;
        border-radius: 4px;
        color: var(--color-text-muted);
        font-size: 11px;
        cursor: pointer;
    }

    .off:hover {
        color: var(--color-danger);
    }

    .tip {
        margin: auto 4px 0;
        padding-top: 8px;
        color: var(--color-text-muted);
        font-size: 11px;
        line-height: 1.4;
    }

    .note {
        position: absolute;
        left: 50%;
        bottom: 44px;
        transform: translateX(-50%);
        margin: 0;
        padding: 5px 12px;
        background: var(--color-card);
        border: 1px solid var(--color-gold);
        border-radius: 6px;
        color: var(--color-text-primary);
        font-size: 12px;
        pointer-events: none;
    }

    .msg {
        display: grid;
        place-items: center;
        height: 100%;
        margin: 0;
        padding: 24px;
        box-sizing: border-box;
        color: var(--color-text-muted);
        font-size: 13px;
        text-align: center;
    }

    .msg.err {
        color: var(--color-danger);
    }

    .bar {
        position: absolute;
        left: 32px;
        top: 32px;
        right: 130px; /* the zoom buttons */
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
        pointer-events: none;
    }

    .bar button {
        pointer-events: auto;
        padding: 3px 8px;
        background: color-mix(in srgb, var(--color-card) 88%, transparent);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: 12px;
        cursor: pointer;
    }

    .bar button:hover {
        color: var(--color-gold);
    }

    .bar button.cur {
        color: var(--color-text-primary);
        border-color: var(--color-gold);
        font-weight: 600;
    }

    .bar button.enc {
        border-color: color-mix(in srgb, #c0392b 70%, var(--color-border));
    }

    .bar .child {
        border-style: dashed;
    }

    .bar .nomap,
    .item.nomap {
        opacity: 0.55;
    }

    .layers-btn.open {
        border-color: var(--color-gold);
    }

    .sep {
        color: var(--color-text-muted);
        font-size: 12px;
    }

    .empty {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        margin: 0;
        padding: 8px 14px;
        background: color-mix(in srgb, var(--color-card) 90%, transparent);
        border: 1px dashed var(--color-border);
        border-radius: 8px;
        color: var(--color-text-secondary);
        font-size: 13px;
        pointer-events: none;
    }

    .hint {
        position: absolute;
        left: 32px;
        bottom: 10px;
        max-width: calc(100% - 320px);
        margin: 0;
        padding: 4px 10px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        background: color-mix(in srgb, var(--color-card) 85%, transparent);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: 11px;
        pointer-events: none;
    }

    .view-menu {
        position: fixed;
        z-index: 1000;
        width: 250px;
        max-height: min(70vh, 520px);
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 6px;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-border);
        border-radius: 10px;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
    }

    .menu-title {
        padding: 2px 6px 4px;
        font-family: var(--font-heading);
        font-size: 11px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-text-accent);
    }

    .item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 6px;
        background: transparent;
        border: 0;
        border-radius: 6px;
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: 13px;
        text-align: left;
        cursor: pointer;
    }

    .item:hover {
        background: var(--color-card);
    }

    .item.on {
        background: var(--color-card);
        box-shadow: inset 2px 0 0 var(--color-gold);
    }

    .item.enc .nm {
        color: var(--color-text-secondary);
    }

    .ico {
        width: 18px;
        text-align: center;
    }

    .menu-hint {
        margin: 4px 6px 2px;
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: 11px;
    }
</style>
