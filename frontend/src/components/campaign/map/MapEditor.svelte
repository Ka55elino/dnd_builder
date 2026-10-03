<script>
    /**
     * The campaign map editor (Overview): a slim tool bar on the left, the canvas on the right.
     *
     *   layers:  every location of the campaign is a layer — its own map; nesting comes from
     *            Locations (region → city → building, forest → dungeon). 🗂 opens the layer menu
     *            (the location tree); the path of the current layer is shown over the map and
     *            its parts are clickable
     *   tools:   ✋ pan (H) · 🖌 paint (B) · 📍 place (P) · ⌫ erase (E) — Space + drag pans
     *            with any tool
     *   place:   the layer's direct children (one level down) and the NPCs of this location go
     *            into cells as markers — one marker per thing, one per cell; 📍 opens the list
     *            (locations inside, NPCs here — NPCs come from their "location"), a click on the
     *            map puts the chosen one there (or moves it); double click on a marker opens
     *            its layer; the eraser removes markers too
     *   encounters: an encounter of a location is placed on its map like a child (⚔), and has
     *            a map of its own — a layer "encounter:<id>" (terrain only: the enemies are put
     *            there during the game, not in the editor)
     *   terrain: a click on 🖌 opens the menu of terrains (data/mapTiles.js; keys 1…9 pick one
     *            directly); the brush button shows the current one; Alt+click on the map picks
     *            a cell's tile
     *
     * campaign; onOpenSection(id) — go to another section of the campaign ("locations")
     *
     * Saving (maps.go): a layer is loaded when it is opened; the terrain is saved ~0.7 s after
     * a stroke (and right away when switching layers / leaving), markers — at once.
     */
    import { onMount, onDestroy } from "svelte";
    import MapCanvas from "./MapCanvas.svelte";
    import { TERRAIN, terrainById } from "../../../data/mapTiles.js";
    import {
        loadLocations, loadNpcs, loadCampaignEncounters, locationTree,
        loadMapLayers, loadMapLayer, saveMapCells, placeMapMarker, removeMapMarker, tilesToCells,
    } from "../../../data/campaigns.js";
    import { layerOwner, layerKey, typeIcon, placeablesOf, markersOf, placedOf, pathTo } from "../../../data/mapLayers.js";

    let { campaign, onOpenSection } = $props();

    let tool = $state("paint");
    let tile = $state(TERRAIN[0]?.id ?? null);
    let canvas = $state(null);
    let menu = $state(""); // '' | 'terrain' | 'layers' — the menu next to its button
    let menuPos = $state({ left: 0, top: 0 });

    // ---------- layers = locations ----------

    let locations = $state([]);
    let loading = $state(true);
    let error = $state("");
    let layer = $state(""); // the location whose map is shown
    // the painted cells of every layer: locationId → { "x,y": tileId } (kept while switching)
    let layerCells = $state({});
    // what is placed on every layer: locationId → { "location:id" | "npc:id": "x,y" }
    let layerMarkers = $state({});
    let placingKey = $state(""); // what the place tool puts: "location:id" | "npc:id"
    let npcs = $state([]);
    let encounters = $state([]);
    let note = $state(""); // a short message over the map

    // ---------- saving ----------
    // layer key ("locId" | "encounter:id") → the owner of its map
    const ownerOf = layerOwner;
    let loaded = $state({}); // layer → true once its map came from the database
    let layerLoading = $state(false);
    let layerError = $state("");
    let info = $state({}); // layer → { cells, markers } — counts for the layer menu (all maps)
    let saveState = $state("saved"); // saved | pending | saving | error
    let saveError = $state("");
    const timers = new Map(); // layer → the debounce timer of its terrain save
    const dirty = new Set(); // layers with unsaved terrain

    async function ensureLayer(key) {
        if (!key || loaded[key]) return;
        layerLoading = true;
        layerError = "";
        try {
            const o = ownerOf(key);
            const m = await loadMapLayer(campaign.id, o.type, o.id);
            layerCells = { ...layerCells, [key]: tilesToCells(m?.tiles) };
            layerMarkers = { ...layerMarkers, [key]: placedOf(m) };
            loaded = { ...loaded, [key]: true };
        } catch (e) {
            layerError = e?.message ?? String(e);
        } finally {
            layerLoading = false;
        }
    }

    function scheduleSave(key) {
        dirty.add(key);
        saveState = "pending";
        clearTimeout(timers.get(key));
        timers.set(key, setTimeout(() => saveLayer(key), 700));
    }

    async function saveLayer(key) {
        clearTimeout(timers.get(key));
        timers.delete(key);
        if (!dirty.has(key)) return;
        dirty.delete(key);
        saveState = "saving";
        const cells = layerCells[key] ?? {};
        try {
            const o = ownerOf(key);
            await saveMapCells(campaign.id, o.type, o.id, cells);
            info = { ...info, [key]: { ...(info[key] ?? { markers: 0 }), cells: Object.keys(cells).length } };
            if (!dirty.size && saveState !== "error") saveState = "saved";
        } catch (e) {
            dirty.add(key); // try again with the next stroke
            saveState = "error";
            saveError = e?.message ?? String(e);
        }
    }

    // painted cells of a layer: what is open here, or the count from the database
    const cellsOf = (key) => (loaded[key] ? Object.keys(layerCells[key] ?? {}).length : (info[key]?.cells ?? 0));

    const flushAll = () => [...dirty].forEach((k) => saveLayer(k));
    onDestroy(flushAll); // leaving the Overview: what is still waiting goes now

    // markers: saved at once; on failure the map goes back to what the database has
    async function saveMarker(key, refKey, pos) {
        const o = ownerOf(key);
        const [rt, rid] = [refKey.slice(0, refKey.indexOf(":")), refKey.slice(refKey.indexOf(":") + 1)];
        try {
            saveState = "saving";
            if (pos) {
                const [x, y] = pos.split(",").map(Number);
                await placeMapMarker(campaign.id, o.type, o.id, rt, rid, x, y);
            } else {
                await removeMapMarker(campaign.id, o.type, o.id, rt, rid);
            }
            info = { ...info, [key]: { ...(info[key] ?? { cells: 0 }), markers: Object.keys(layerMarkers[key] ?? {}).length } };
            if (!dirty.size) saveState = "saved";
        } catch (e) {
            say(e?.message ?? String(e));
            saveState = dirty.size ? "pending" : "saved";
            loaded = { ...loaded, [key]: false };
            const keep = layerCells[key];
            await ensureLayer(key);
            if (keep && dirty.has(key)) layerCells = { ...layerCells, [key]: keep }; // unsaved terrain stays
        }
    }

    const tree = $derived(locationTree(locations));
    const byId = $derived(new Map(locations.map((l) => [l.id, l])));
    // an encounter's own map: the layer "encounter:<id>"
    const encLayer = $derived(layer.startsWith("encounter:") ? (encounters.find((e) => `encounter:${e.id}` === layer) ?? null) : null);
    // the location of the layer (for an encounter: where it happens)
    const current = $derived(encLayer ? (byId.get(encLayer.locationId) ?? null) : (byId.get(layer) ?? null));
    const layerName = $derived(encLayer ? encLayer.name : (current?.name ?? ""));
    const count = $derived(Object.keys(layerCells[layer] ?? {}).length);
    // the path from the top: Region › City › Building
    const path = $derived(pathTo(current, byId));
    const children = $derived(locations.filter((l) => l.parentId === layer).sort((a, b) => a.name.localeCompare(b.name)));
    const encountersHere = $derived(encounters.filter((e) => e.locationId === layer).sort((a, b) => a.name.localeCompare(b.name)));
    const encountersOf = (locId) => encounters.filter((e) => (e.locationId || "") === locId).sort((a, b) => a.name.localeCompare(b.name));
    const placed = $derived(layerMarkers[layer] ?? {});
    // everything that can go on this layer's map
    const placeables = $derived(placeablesOf(layer, { locations, npcs, encounters }));
    const markers = $derived(markersOf(placeables, placed));
    const placing = $derived(placeables.find((t) => t.key === placingKey) ?? null);


    onMount(async () => {
        try {
            [locations, npcs, encounters] = await Promise.all([
                loadLocations(campaign.id),
                loadNpcs(campaign.id),
                loadCampaignEncounters(campaign.id),
            ]);
            // start where the adventure begins — on the top layer above it
            const start = byId.get(campaign?.data?.startLocationId);
            layer = (start ? path0(start) : tree[0]?.loc)?.id ?? "";
            // the counts of every map (the layer menu); the current map itself
            loadMapLayers(campaign.id)
                .then((ls) => {
                    info = Object.fromEntries(
                        ls.map((l) => [layerKey(l.ownerType, l.ownerId), { cells: l.cells, markers: l.markers }]),
                    );
                })
                .catch(() => {});
            await ensureLayer(layer);
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            loading = false;
        }
    });

    // the top-level location above l (the region the adventure starts in)
    function path0(l) {
        let top = l;
        for (let i = 0; top?.parentId && byId.has(top.parentId) && i < 64; i++) top = byId.get(top.parentId);
        return top;
    }

    // a location id, or "encounter:<id>" — an encounter's own map
    function openLayer(id) {
        if (id.startsWith("encounter:") ? !encounters.some((e) => `encounter:${e.id}` === id) : !byId.has(id)) return;
        if (dirty.has(layer)) saveLayer(layer); // the old layer's terrain: now, not in 0.7 s
        layer = id;
        ensureLayer(id);
        menu = "";
        placingKey = "";
        if (tool === "place") tool = "paint";
    }

    // ---------- markers: the children of this layer ----------

    let noteTimer;
    function say(msg) {
        note = msg;
        clearTimeout(noteTimer);
        noteTimer = setTimeout(() => (note = ""), 2500);
    }

    function choosePlacing(key) {
        placingKey = key;
        tool = "place";
        menu = "";
    }

    function placeAt(x, y) {
        if (!placing) return say("Choose what to place: 📍");
        const k = `${x},${y}`;
        const other = Object.entries(placed).find(([key, pos]) => pos === k && key !== placingKey);
        if (other) return say(`This cell is taken by ${placeables.find((t) => t.key === other[0])?.name ?? "something else"}`);
        layerMarkers = { ...layerMarkers, [layer]: { ...placed, [placingKey]: k } };
        saveMarker(layer, placingKey, k);
        // next: the first thing of the same kind not on the map yet (or stay on this one to move it)
        const next = placeables.find((t) => t.type === placing.type && !layerMarkers[layer][t.key]);
        if (next) placingKey = next.key;
    }

    function eraseMarker(key) {
        const { [key]: _, ...rest } = placed;
        layerMarkers = { ...layerMarkers, [layer]: rest };
        saveMarker(layer, key, "");
    }

    // double click on a marker: a location / an encounter opens its map
    function openMarker(key) {
        const [type, id] = key.split(":");
        if (type === "location") openLayer(id);
        else if (type === "encounter") openLayer(key);
    }

    // ---------- tools and menus ----------

    const TOOLS = [
        { id: "pan", icon: "✋", name: "Pan", key: "H" },
        { id: "paint", icon: "🖌", name: "Paint terrain", key: "B" },
        { id: "place", icon: "📍", name: "Place a location, an NPC or an encounter", key: "P" },
        { id: "erase", icon: "⌫", name: "Erase", key: "E" },
    ];

    // menus live in <body> with position: fixed — nothing (the canvas, overflow: hidden
    // of the map box) can cover or clip them
    function portal(node) {
        document.body.appendChild(node);
        return { destroy: () => node.remove() };
    }

    function toggleMenu(name, btn) {
        if (menu === name) return void (menu = "");
        const r = btn?.getBoundingClientRect();
        if (r) menuPos = { left: r.right + 10, top: Math.max(8, r.top - 6) };
        menu = name;
    }

    function pickTile(id) {
        tile = id;
        tool = "paint";
        menu = "";
    }

    // the brush: makes it the tool and opens / closes the terrain menu
    function brush(e) {
        if (tool !== "paint") tool = "paint";
        toggleMenu("terrain", e.currentTarget);
    }

    function setTool(id) {
        if (id === "place" && !placeables.length) return;
        if (id === "place" && !placing) placingKey = placeables.find((t) => !placed[t.key])?.key ?? placeables[0]?.key ?? "";
        tool = id;
        menu = "";
    }

    // a click anywhere else closes the menu
    function onDocDown(e) {
        if (menu && !e.target.closest?.(".menu-btn, .popup-menu")) menu = "";
    }

    function clearAll() {
        if (!count || !confirm(`Clear the map of “${layerName}”?`)) return;
        canvas?.setCells({});
        layerCells = { ...layerCells, [layer]: {} };
        scheduleSave(layer);
    }

    function onKey(e) {
        if (e.metaKey || e.ctrlKey || e.altKey || /input|textarea|select/i.test(e.target?.tagName)) return;
        if (e.key === "Escape" && menu) return void (menu = "");
        const k = e.key.toLowerCase();
        const t = TOOLS.find((x) => x.key.toLowerCase() === k);
        if (t) return void setTool(t.id);
        const n = Number(e.key);
        if (n >= 1 && n <= TERRAIN.length) pickTile(TERRAIN[n - 1].id);
    }
</script>

{#snippet encItem(e, depth)}
    {@const key = `encounter:${e.id}`}
    {@const n = cellsOf(key)}
    <button class="item layer enc" class:on={layer === key} role="menuitem" style:padding-left="{6 + depth * 16}px" onclick={() => openLayer(key)}>
        <span class="ico">⚔</span>
        <span class="nm">{e.name}</span>
        {#if n}<span class="cnt" title="{n} painted cells">{n}</span>{/if}
    </button>
{/snippet}

<svelte:window onkeydown={onKey} onpointerdown={onDocDown} onresize={() => (menu = "")} onscrollcapture={() => (menu = "")} />

{#if loading}
    <p class="msg">Loading…</p>
{:else if error}
    <p class="msg err">Failed to load the locations: {error}</p>
{:else if !locations.length}
    <div class="msg empty">
        <span class="big" aria-hidden="true">🗺</span>
        <p>Every location is a layer of the map — add the campaign's locations first.</p>
        {#if onOpenSection}<button class="btn" onclick={() => onOpenSection("locations")}>Go to Locations ›</button>{/if}
    </div>
{:else}
    <div class="editor">
        <aside class="palette" aria-label="Map tools">
            <button
                class="tool menu-btn"
                class:open={menu === "layers"}
                onclick={(e) => toggleMenu("layers", e.currentTarget)}
                title="Layer: {layerName || '—'} — choose a location or an encounter"
                aria-label="Layers"
                aria-haspopup="menu"
                aria-expanded={menu === "layers"}
            >
                🗂<span class="caret" aria-hidden="true">▸</span>
            </button>
            <hr />
            {#each TOOLS as t (t.id)}
                {#if t.id === "paint"}
                    <button
                        class="tool brush menu-btn"
                        class:on={tool === "paint"}
                        class:open={menu === "terrain"}
                        onclick={brush}
                        title="{t.name} ({t.key}) — choose the terrain"
                        aria-label={t.name}
                        aria-haspopup="menu"
                        aria-expanded={menu === "terrain"}
                    >
                        {t.icon}
                        {#if terrainById(tile)}<img class="swatch" src={terrainById(tile).url} alt="" draggable="false" />{/if}
                        <span class="caret" aria-hidden="true">▸</span>
                    </button>
                {:else if t.id === "place"}
                    <button
                        class="tool menu-btn"
                        class:on={tool === "place"}
                        class:open={menu === "place"}
                        onclick={(e) => ((tool = "place"), toggleMenu("place", e.currentTarget))}
                        disabled={!placeables.length}
                        title={placeables.length
                            ? `${t.name} (${t.key}) — locations, NPCs and encounters of ${current?.name}`
                            : encLayer
                              ? "An encounter's map: the enemies are placed during the game"
                              : `No locations, NPCs or encounters in ${current?.name ?? "this location"}`}
                        aria-label={t.name}
                        aria-haspopup="menu"
                        aria-expanded={menu === "place"}
                    >
                        {t.icon}
                        {#if placeables.length}<span class="badge">{markers.length}/{placeables.length}</span>{/if}
                        <span class="caret" aria-hidden="true">▸</span>
                    </button>
                {:else}
                    <button class="tool" class:on={tool === t.id} onclick={() => setTool(t.id)} title="{t.name} ({t.key})" aria-label={t.name}>{t.icon}</button>
                {/if}
            {/each}
            <span class="grow"></span>
            <button class="tool small" onclick={clearAll} disabled={!count} title="Clear this layer" aria-label="Clear this layer">🗑</button>
        </aside>

        <div class="stage">
            {#if !loaded[layer]}
                <p class="msg layer-msg">{layerError ? `Failed to load the map: ${layerError}` : "Loading the map…"}</p>
            {:else}
            {#key layer}
                <MapCanvas
                    bind:this={canvas}
                    {tool}
                    {tile}
                    cells={layerCells[layer] ?? {}}
                    {markers}
                    placing={placing ? { id: placing.key, kind: placing.type, icon: placing.icon, image: placing.image, ring: placing.ring } : null}
                    onplace={placeAt}
                    onerasemarker={eraseMarker}
                    onopenmarker={openMarker}
                    onpick={pickTile}
                    onchange={(cells) => ((layerCells = { ...layerCells, [layer]: cells }), scheduleSave(layer))}
                />
            {/key}
            {/if}

            <!-- the current layer: its path (clickable) and what is inside it -->
            <nav class="crumbs" aria-label="Layer">
                {#each path as l, i (l.id)}
                    {#if i}<span class="sep">›</span>{/if}
                    <button class:cur={l.id === layer} onclick={() => openLayer(l.id)}>{typeIcon(l)} {l.name}</button>
                {/each}
                {#if encLayer}
                    {#if path.length}<span class="sep">›</span>{/if}
                    <button class="cur enc" title="The encounter's map — the enemies are placed during the game">⚔ {encLayer.name}</button>
                {/if}
                {#if children.length || encountersHere.length}
                    <span class="sep">›</span>
                    <span class="inside">
                        {#each children as ch (ch.id)}
                            <button
                                class="child"
                                class:placed={!!placed[`location:${ch.id}`]}
                                onclick={() => openLayer(ch.id)}
                                title="{placed[`location:${ch.id}`] ? 'On the map' : 'Not on the map yet'} — open the layer of {ch.name}">{typeIcon(ch)} {ch.name}</button
                            >
                        {/each}
                        {#each encountersHere as e (e.id)}
                            <button
                                class="child enc"
                                class:placed={!!placed[`encounter:${e.id}`]}
                                onclick={() => openLayer(`encounter:${e.id}`)}
                                title="{placed[`encounter:${e.id}`] ? 'On the map' : 'Not on the map yet'} — open the encounter's map">⚔ {e.name}</button
                            >
                        {/each}
                    </span>
                {/if}
            </nav>

            {#if note}<div class="note">{note}</div>{/if}
            <div class="save s-{saveState}" title={saveState === "error" ? saveError : ""}>
                {saveState === "saving" ? "Saving…" : saveState === "pending" ? "Unsaved changes" : saveState === "error" ? "Not saved" : "Saved"}
            </div>
            <div class="current">
                {#if tool === "pan"}Pan — drag the map
                {:else if tool === "place"}{placing ? `${placing.name} — click a cell to ${placed[placing.key] ? "move" : "place"} ${placing.type === "npc" ? "them" : "it"} · double click a location or an encounter opens its map` : "Choose what to place: 📍"}
                {:else if tool === "erase"}Erase — click or drag over cells
                {:else}{terrainById(tile)?.name ?? "—"} — click or drag to paint · Alt+click picks a tile
                {/if}
            </div>
        </div>
    </div>

    {#if menu === "terrain"}
        <div class="menu popup-menu" role="menu" aria-label="Terrain" use:portal style:left="{menuPos.left}px" style:top="{menuPos.top}px">
            <div class="menu-title">Terrain</div>
            {#each TERRAIN as tt, i (tt.id)}
                <button class="item" class:on={tile === tt.id} role="menuitem" onclick={() => pickTile(tt.id)}>
                    <img src={tt.url} alt="" draggable="false" />
                    <span class="nm">{tt.name}</span>
                    {#if i < 9}<kbd>{i + 1}</kbd>{/if}
                </button>
            {/each}
        </div>
    {:else if menu === "place"}
        <div class="menu popup-menu layers" role="menu" aria-label="Place on the map" use:portal style:left="{menuPos.left}px" style:top="{menuPos.top}px">
            <div class="menu-title">Inside {current?.name}</div>
            {#each placeables.filter((t) => t.type === "location") as t (t.key)}
                <button class="item layer" class:on={placingKey === t.key} role="menuitem" onclick={() => choosePlacing(t.key)}>
                    <span class="ico">{t.icon}</span>
                    <span class="nm">{t.name}</span>
                    {#if placed[t.key]}<span class="cnt" title="On the map at {placed[t.key]}">✓</span>{/if}
                </button>
            {:else}
                <p class="menu-hint">No locations inside.</p>
            {/each}
            <div class="menu-title sub">NPCs here</div>
            {#each placeables.filter((t) => t.type === "npc") as t (t.key)}
                <button class="item layer" class:on={placingKey === t.key} role="menuitem" onclick={() => choosePlacing(t.key)}>
                    {#if t.image}<img class="face" src={t.image} alt="" draggable="false" style:border-color={t.ring} />{:else}<span class="ico">{t.icon}</span>{/if}
                    <span class="nm">{t.name}{#if t.sub}<small>{t.sub}</small>{/if}</span>
                    {#if placed[t.key]}<span class="cnt" title="On the map at {placed[t.key]}">✓</span>{/if}
                </button>
            {:else}
                <p class="menu-hint">No NPCs in {current?.name}: set an NPC's location in NPCs.</p>
            {/each}
            <div class="menu-title sub">Encounters here</div>
            {#each placeables.filter((t) => t.type === "encounter") as t (t.key)}
                <button class="item layer" class:on={placingKey === t.key} role="menuitem" onclick={() => choosePlacing(t.key)}>
                    <span class="ico">{t.icon}</span>
                    <span class="nm">{t.name}{#if t.sub}<small>{t.sub}</small>{/if}</span>
                    {#if placed[t.key]}<span class="cnt" title="On the map at {placed[t.key]}">✓</span>{/if}
                </button>
            {:else}
                <p class="menu-hint">No encounters in {current?.name}: set an encounter's location in Encounters.</p>
            {/each}
            <p class="menu-hint">Only one level down: deeper locations and their NPCs go on their own maps.</p>
        </div>
    {:else if menu === "layers"}
        <div class="menu popup-menu layers" role="menu" aria-label="Layers" use:portal style:left="{menuPos.left}px" style:top="{menuPos.top}px">
            <div class="menu-title">Layers · locations and encounters</div>
            {#each tree as t (t.loc.id)}
                {@const n = cellsOf(t.loc.id)}
                <button class="item layer" class:on={layer === t.loc.id} role="menuitem" style:padding-left="{6 + t.depth * 16}px" onclick={() => openLayer(t.loc.id)}>
                    <span class="ico">{typeIcon(t.loc)}</span>
                    <span class="nm">{t.loc.name}</span>
                    {#if n}<span class="cnt" title="{n} painted cells">{n}</span>{/if}
                </button>
                {#each encountersOf(t.loc.id) as e (e.id)}
                    {@render encItem(e, t.depth + 1)}
                {/each}
            {/each}
            {#if encountersOf("").length}
                <div class="menu-title sub">Encounters without a location</div>
                {#each encountersOf("") as e (e.id)}
                    {@render encItem(e, 0)}
                {/each}
            {/if}
        </div>
    {/if}
{/if}

<style>
    .editor {
        display: flex;
        height: 100%;
        min-height: 0;
    }

    .palette {
        flex: none;
        width: 56px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 8px 0;
        position: relative;
        z-index: 2; /* the terrain menu opens over the canvas */
        background: var(--color-card);
        border-right: 1px solid var(--color-border);
    }

    .grow {
        flex: 1;
    }

    .tool {
        width: 38px;
        height: 34px;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 8px;
        color: var(--color-text-secondary);
        font-size: 17px;
        cursor: pointer;
    }

    .tool:hover:not(:disabled) {
        background: var(--color-card-elevated);
    }

    .tool.on {
        background: var(--color-card-elevated);
        border-color: var(--color-gold);
    }

    .tool.small {
        font-size: 14px;
    }

    .tool:disabled {
        opacity: 0.35;
        cursor: default;
    }

    .menu-btn {
        position: relative;
    }

    .palette hr {
        width: 32px;
        margin: 2px 0;
        border: 0;
        border-top: 1px solid var(--color-border);
    }

    .swatch {
        position: absolute;
        right: -3px;
        bottom: -3px;
        width: 15px;
        height: 15px;
        border: 1.5px solid var(--color-card);
        border-radius: 4px;
    }

    .caret {
        position: absolute;
        right: 1px;
        top: 1px;
        font-size: 8px;
        color: var(--color-text-muted);
    }

    .menu-btn.open {
        background: var(--color-card-elevated);
    }

    .menu-btn.open .caret {
        color: var(--color-gold);
    }

    .menu {
        position: fixed;
        z-index: 1000;
        width: 190px;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 6px;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-border);
        border-radius: 10px;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
    }

    .menu.layers {
        width: 240px;
        max-height: min(70vh, 520px);
        overflow-y: auto;
    }

    .item.layer {
        gap: 8px;
        padding-top: 4px;
        padding-bottom: 4px;
    }

    .ico {
        width: 18px;
        text-align: center;
    }

    .cnt {
        color: var(--color-text-muted);
        font-size: 11px;
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
        gap: 10px;
        padding: 5px 6px;
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

    .item img {
        width: 28px;
        height: 28px;
        border-radius: 5px;
    }

    .item .nm {
        flex: 1;
    }

    kbd {
        padding: 0 5px;
        border: 1px solid var(--color-border);
        border-radius: 4px;
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: 10px;
    }

    .stage {
        position: relative;
        isolation: isolate; /* the canvas stays in its own layer */
        flex: 1;
        min-width: 0;
    }

    .crumbs {
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

    .crumbs button {
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

    .crumbs button:hover {
        color: var(--color-gold);
    }

    .crumbs button.cur {
        color: var(--color-text-primary);
        border-color: var(--color-gold);
        font-weight: 600;
    }

    .crumbs .child {
        opacity: 0.75;
        border-style: dashed;
    }

    .crumbs .child.placed {
        opacity: 1;
        border-style: solid;
    }

    .badge {
        position: absolute;
        left: -4px;
        bottom: -5px;
        padding: 0 3px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: 8px;
        line-height: 12px;
    }

    .menu-title.sub {
        margin-top: 6px;
        padding-top: 8px;
        border-top: 1px solid var(--color-border);
    }

    .face {
        width: 22px;
        height: 22px;
        border: 2px solid var(--color-border);
        border-radius: 50%;
        object-fit: cover;
    }

    .item .nm small {
        display: block;
        color: var(--color-text-muted);
        font-size: 11px;
    }

    .menu-hint {
        margin: 4px 6px 2px;
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: 11px;
        line-height: 1.35;
    }

    .layer-msg {
        display: grid;
        place-items: center;
        height: 100%;
    }

    .save {
        position: absolute;
        right: 10px;
        top: 66px;
        padding: 3px 9px;
        background: color-mix(in srgb, var(--color-card) 88%, transparent);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: 11px;
        pointer-events: none;
    }

    .save.s-pending,
    .save.s-saving {
        color: var(--color-text-accent);
    }

    .save.s-error {
        border-color: var(--color-danger);
        color: var(--color-danger);
        pointer-events: auto;
    }

    .note {
        position: absolute;
        left: 50%;
        bottom: 44px;
        transform: translateX(-50%);
        padding: 5px 12px;
        background: var(--color-card);
        border: 1px solid var(--color-gold);
        border-radius: 6px;
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: 12px;
        pointer-events: none;
    }

    .crumbs button.enc {
        border-color: #c0392b;
    }

    .crumbs .child.enc {
        border-color: color-mix(in srgb, #c0392b 70%, var(--color-border));
    }

    .item.enc .nm {
        color: var(--color-text-secondary);
    }

    .inside {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }

    .sep {
        color: var(--color-text-muted);
        font-size: 12px;
    }

    .msg {
        margin: 0;
        padding: 24px;
        color: var(--color-text-muted);
        font-size: 13px;
    }

    .msg.err {
        color: var(--color-danger);
    }

    .msg.empty {
        height: 100%;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        text-align: center;
        color: var(--color-text-secondary);
    }

    .big {
        font-size: 40px;
    }

    .btn {
        padding: 6px 14px;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-secondary);
        font: inherit;
        cursor: pointer;
    }

    .btn:hover {
        border-color: var(--color-gold);
        color: var(--color-gold);
    }

    .current {
        position: absolute;
        left: 32px;
        bottom: 10px;
        max-width: calc(100% - 320px); /* the zoom / coordinates read-out on the right */
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        padding: 4px 10px;
        background: color-mix(in srgb, var(--color-card) 85%, transparent);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: 11px;
        pointer-events: none;
    }
</style>
