<script>
    /**
     * The campaign board (Overview): locations — nested, a city holds its inn — and quests as
     * nodes; arrows quest → location are the quest's route (numbered steps; dashed until the
     * objective bound to the step is done), arrows quest → quest — "unlocks" (with the condition,
     * so the campaign's branches can be described). Svelte Flow draws it; data/board.js builds it.
     *
     *   drag a node             — it stays there (saved)
     *   drag from a quest's ●   — bottom ● to a location: a new route step;
     *                             to another quest: "unlocks"
     *   click                   — details on the right (edit the route, objectives, conditions)
     *   select an arrow + Del   — removes that step / unlock
     *
     * campaign — the campaign; onOpen(section) — go to a section (to edit a quest / location)
     */
    import { onMount } from "svelte";
    import { SvelteFlow, Background, Controls, MiniMap, MarkerType } from "@xyflow/svelte";
    import "@xyflow/svelte/dist/style.css";
    import LocationNode from "./LocationNode.svelte";
    import QuestNode from "./QuestNode.svelte";
    import {
        loadLocations, loadQuests, loadNpcs, loadLinks, loadCampaignEncounters, saveQuest, saveLink, deleteLink,
        loadBoard, saveBoardNodes, resetBoardLayout, loadPartyLocation, locationTree, QUEST_STATUSES,
    } from "../../../data/campaigns.js";
    import { buildNodes, buildEdges, questColors, route, objectives, stepDone, progress, unlockLinks } from "../../../data/board.js";

    let { campaign, onOpen = null } = $props();

    const nodeTypes = { location: LocationNode, quest: QuestNode };

    let locations = $state([]);
    let quests = $state([]);
    let npcs = $state([]);
    let links = $state([]);
    let encounters = $state([]);
    let board = $state(null);
    let partyId = $state("");
    let loading = $state(true);
    let error = $state("");

    let nodes = $state.raw([]);
    let edges = $state.raw([]);
    let selected = $state(null); // { type: 'quest' | 'location' | 'step' | 'unlock', id, … }
    let hidden = $state(new Set()); // quest ids hidden on the board
    let hideFinished = $state(false);
    let hideSide = $state(false);

    const colors = $derived(questColors(quests));
    const tree = $derived(locationTree(locations));
    const locName = (id) => locations.find((l) => l.id === id)?.name ?? "(deleted)";
    const questById = (id) => quests.find((q) => q.id === id) ?? null;
    const unlocks = $derived(unlockLinks(links));

    // quests not drawn: hidden one by one, or by the filters
    const hiddenAll = $derived.by(() => {
        const out = new Set(hidden);
        for (const q of quests) {
            if (hideFinished && ["completed", "failed", "abandoned"].includes(q.status)) out.add(q.id);
            if (hideSide && q.kind !== "main") out.add(q.id);
        }
        return out;
    });

    async function loadAll() {
        [locations, quests, npcs, links, encounters, board, partyId] = await Promise.all([
            loadLocations(campaign.id), loadQuests(campaign.id), loadNpcs(campaign.id), loadLinks(campaign.id),
            loadCampaignEncounters(campaign.id), loadBoard(campaign.id), loadPartyLocation(campaign.id),
        ]);
    }

    onMount(async () => {
        try {
            await loadAll();
            rebuild();
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            loading = false;
        }
    });

    function ctx() {
        return {
            locations, quests, links, npcs, encounters,
            saved: board?.nodes ?? [],
            startId: campaign.data?.startLocationId ?? "",
            partyId, colors, hidden: hiddenAll,
            focus: selected?.type === "quest" ? selected.id : selected?.questId ?? null,
        };
    }

    // nodes and edges from the data (keeps where nodes were dragged: board.nodes is updated on drop)
    function rebuild() {
        const c = ctx();
        const selId = selected?.type === "quest" ? `quest:${selected.id}` : selected?.type === "location" ? `loc:${selected.id}` : null;
        nodes = buildNodes(c).map((n) => (n.id === selId ? { ...n, selected: true } : n));
        const selEdge = selected?.type === "step" ? `step:${selected.questId}:${selected.index}` : selected?.type === "unlock" ? `unl:${selected.id}` : null;
        edges = buildEdges(c, MarkerType).map((e) => (e.id === selEdge ? { ...e, selected: true } : e));
    }

    // filters / hiding re-draw at once
    $effect(() => {
        void hiddenAll;
        if (!loading) rebuild();
    });

    // ---------- positions ----------
    let saveTimer;
    let pending = new Map();
    function remember(n) {
        const [type, ...rest] = n.id.split(":");
        const refType = type === "loc" ? "location" : "quest";
        const refId = rest.join(":");
        const group = n.type === "location" && n.data?.group;
        const entry = {
            refType, refId, x: n.position.x, y: n.position.y,
            w: group ? (n.width ?? n.measured?.width ?? null) : null,
            h: group ? (n.height ?? n.measured?.height ?? null) : null,
        };
        pending.set(n.id, entry);
        // keep the local copy in step, so a re-draw doesn't jump back
        const list = board.nodes.filter((x) => !(x.refType === refType && x.refId === refId));
        board.nodes = [...list, entry];
    }
    function ondragstop({ nodes: moved }) {
        if (!board) return;
        for (const n of moved ?? []) remember(n);
        // groups may have grown around a dragged child (expandParent): keep their sizes too
        for (const n of nodes) if (n.type === "location" && n.data?.group) remember(n);
        clearTimeout(saveTimer);
        saveTimer = setTimeout(flush, 400);
    }
    async function flush() {
        const list = [...pending.values()];
        pending = new Map();
        if (!list.length) return;
        try {
            await saveBoardNodes(board.id, list);
        } catch (e) {
            error = e?.message ?? String(e);
        }
    }
    async function tidyUp() {
        try {
            await resetBoardLayout(board.id);
            board.nodes = [];
            rebuild();
        } catch (e) {
            error = e?.message ?? String(e);
        }
    }

    // ---------- selection ----------
    const idOf = (nid) => nid.split(":").slice(1).join(":");
    function onnodeclick({ node }) {
        selected = node.type === "quest" ? { type: "quest", id: idOf(node.id) } : { type: "location", id: idOf(node.id) };
        rebuild();
    }
    function onedgeclick({ edge }) {
        const d = edge.data ?? {};
        selected = d.kind === "step" ? { type: "step", questId: d.questId, index: d.index } : { type: "unlock", id: d.linkId };
        rebuild();
    }
    function onpaneclick() {
        if (!selected) return;
        selected = null;
        rebuild();
    }

    // ---------- editing: routes ----------
    async function setRoute(q, steps) {
        try {
            await saveQuest({ ...q, data: { ...(q.data ?? {}), route: steps } });
            quests = await loadQuests(campaign.id);
            rebuild();
        } catch (e) {
            error = e?.message ?? String(e);
        }
    }
    const firstFreeObjective = (q) => {
        const used = new Set(route(q).map((s) => s.objective).filter((x) => x != null && x !== ""));
        const i = objectives(q).findIndex((_, j) => !used.has(j));
        return i >= 0 ? i : null;
    };
    function addStep(q, locationId) {
        if (!locationId) return;
        return setRoute(q, [...route(q), { locationId, label: "", objective: firstFreeObjective(q) }]);
    }
    const updateStep = (q, i, patch) => setRoute(q, route(q).map((s, j) => (j === i ? { ...s, ...patch } : s)));
    const removeStep = (q, i) => setRoute(q, route(q).filter((_, j) => j !== i));
    function moveStep(q, i, dir) {
        const r = [...route(q)];
        const j = i + dir;
        if (j < 0 || j >= r.length) return;
        [r[i], r[j]] = [r[j], r[i]];
        return setRoute(q, r);
    }

    // ---------- editing: unlocks ----------
    async function addUnlock(fromId, toId, note = "") {
        if (!toId || fromId === toId) return;
        try {
            await saveLink({ campaignId: campaign.id, fromType: "quest", fromId, toType: "quest", toId, kind: "unlocks", note });
            links = await loadLinks(campaign.id);
            rebuild();
        } catch (e) {
            error = e?.message ?? String(e);
        }
    }
    async function removeUnlock(linkId) {
        try {
            await deleteLink(linkId);
            links = await loadLinks(campaign.id);
            if (selected?.type === "unlock" && selected.id === linkId) selected = null;
            rebuild();
        } catch (e) {
            error = e?.message ?? String(e);
        }
    }
    const setUnlockNote = (l, note) => addUnlock(l.fromId, l.toId, note);

    // drawing a connection: quest → location (a step) or quest → quest (unlocks)
    function onconnect(c) {
        const [st, ...s] = c.source.split(":");
        const [tt, ...t] = c.target.split(":");
        const from = questById(s.join(":"));
        if (st !== "quest" || !from) return rebuild();
        if (tt === "loc") addStep(from, t.join(":"));
        else if (tt === "quest") addUnlock(from.id, t.join(":"));
        else rebuild();
    }
    const isValidConnection = (c) => c.source.startsWith("quest:") && c.source !== c.target;

    // Del on a selected arrow
    async function ondelete({ edges: gone }) {
        const byQuest = {};
        for (const e of gone ?? []) {
            const d = e.data ?? {};
            if (d.kind === "step") (byQuest[d.questId] ??= []).push(d.index);
            if (d.kind === "unlock") await removeUnlock(d.linkId);
        }
        for (const [qid, idx] of Object.entries(byQuest)) {
            const q = questById(qid);
            if (q) await setRoute(q, route(q).filter((_, i) => !idx.includes(i)));
        }
        selected = null;
        rebuild();
    }

    // ---------- the side panel ----------
    const selQuest = $derived(selected?.type === "quest" ? questById(selected.id) : selected?.type === "step" ? questById(selected.questId) : null);
    const selLoc = $derived(selected?.type === "location" ? locations.find((l) => l.id === selected.id) ?? null : null);
    const selUnlock = $derived(selected?.type === "unlock" ? unlocks.find((l) => l.id === selected.id) ?? null : null);
    let addStepLoc = $state("");
    let addUnlockTo = $state("");
    const statusName = (s) => QUEST_STATUSES.find((x) => x.id === s)?.name ?? s;
    const questsThrough = (lid) =>
        quests.flatMap((q) => route(q).map((s, i) => ({ q, s, i })).filter((x) => x.s.locationId === lid));
</script>

<div class="board-wrap">
    {#if loading}
        <p class="cp-muted">Loading the map…</p>
    {:else}
        <div class="flow">
            <SvelteFlow
                bind:nodes
                bind:edges
                {nodeTypes}
                colorMode="dark"
                fitView
                minZoom={0.2}
                maxZoom={2}
                deleteKey={["Delete", "Backspace"]}
                {isValidConnection}
                {onconnect}
                {ondelete}
                onnodedragstop={ondragstop}
                {onnodeclick}
                {onedgeclick}
                {onpaneclick}
                defaultEdgeOptions={{ type: "default" }}
            >
                <Background gap={22} />
                <Controls showLock={false} />
                <MiniMap pannable zoomable nodeColor={(n) => (n.type === "quest" ? n.data?.color : n.data?.group ? "transparent" : "#38323D")} />
            </SvelteFlow>
        </div>

        <aside class="panel">
            {#if error}<p class="cp-error">{error}</p>{/if}

            {#if selQuest}
                {@const q = selQuest}
                {@const p = progress(q)}
                <header class="ph">
                    <span class="sw" style:background={colors[q.id]}></span>
                    <b>{q.name}</b>
                </header>
                <p class="pm">{q.kind} · {statusName(q.status)}{#if p.total} · {p.done}/{p.total} steps{/if}</p>
                {#if onOpen}<button class="cp-btn cp-sm" onclick={() => onOpen("quests")}>Open in Quests</button>{/if}

                <p class="cp-h">Route</p>
                {#if route(q).length}
                    <ol class="steps">
                        {#each route(q) as s, i}
                            <li class:on={selected?.type === "step" && selected.index === i} class:done={stepDone(q, s)}>
                                <div class="srow">
                                    <span class="n">{i + 1}</span>
                                    <select class="cp-select grow" value={s.locationId} onchange={(e) => updateStep(q, i, { locationId: e.currentTarget.value })}>
                                        {#each tree as t (t.loc.id)}<option value={t.loc.id}>{" ".repeat(t.depth * 2)}{t.loc.name}</option>{/each}
                                    </select>
                                    <button class="cp-btn cp-sm" disabled={i === 0} onclick={() => moveStep(q, i, -1)} aria-label="Up">↑</button>
                                    <button class="cp-btn cp-sm" disabled={i === route(q).length - 1} onclick={() => moveStep(q, i, 1)} aria-label="Down">↓</button>
                                    <button class="cp-btn cp-sm cp-danger" onclick={() => removeStep(q, i)} aria-label="Remove step">✕</button>
                                </div>
                                <input class="cp-input" value={s.label} placeholder="What happens here…"
                                    onchange={(e) => updateStep(q, i, { label: e.currentTarget.value.trim() })} />
                                <select class="cp-select" value={s.objective ?? ""}
                                    onchange={(e) => updateStep(q, i, { objective: e.currentTarget.value === "" ? null : Number(e.currentTarget.value) })}
                                    title="The step is done when this objective is ticked (in the quest or the session log)">
                                    <option value="">— not tied to an objective —</option>
                                    {#each objectives(q) as o, j}<option value={j}>{o.done ? "✓ " : ""}{o.text}</option>{/each}
                                </select>
                            </li>
                        {/each}
                    </ol>
                {:else}
                    <p class="cp-muted small">No steps yet — drag from the quest's bottom ● to a location, or add one here.</p>
                {/if}
                <div class="srow">
                    <select class="cp-select grow" bind:value={addStepLoc}>
                        <option value="">+ step at…</option>
                        {#each tree as t (t.loc.id)}<option value={t.loc.id}>{" ".repeat(t.depth * 2)}{t.loc.name}</option>{/each}
                    </select>
                    <button class="cp-btn cp-sm" disabled={!addStepLoc} onclick={() => { addStep(q, addStepLoc); addStepLoc = ""; }}>Add</button>
                </div>

                <p class="cp-h">Unlocks <span class="cp-muted">— what this quest opens</span></p>
                {#each unlocks.filter((l) => l.fromId === q.id) as l (l.id)}
                    <div class="unl">
                        <span>→ <b>{questById(l.toId)?.name ?? "?"}</b></span>
                        <input class="cp-input" value={l.note} placeholder="condition: if…" onchange={(e) => setUnlockNote(l, e.currentTarget.value.trim())} />
                        <button class="cp-btn cp-sm cp-danger" onclick={() => removeUnlock(l.id)} aria-label="Remove">✕</button>
                    </div>
                {/each}
                <div class="srow">
                    <select class="cp-select grow" bind:value={addUnlockTo}>
                        <option value="">+ unlocks…</option>
                        {#each quests.filter((x) => x.id !== q.id && !unlocks.some((l) => l.fromId === q.id && l.toId === x.id)) as x (x.id)}<option value={x.id}>{x.name}</option>{/each}
                    </select>
                    <button class="cp-btn cp-sm" disabled={!addUnlockTo} onclick={() => { addUnlock(q.id, addUnlockTo); addUnlockTo = ""; }}>Add</button>
                </div>
                {#if unlocks.some((l) => l.toId === q.id)}
                    <p class="cp-h">Unlocked by</p>
                    {#each unlocks.filter((l) => l.toId === q.id) as l (l.id)}
                        <p class="small">← {questById(l.fromId)?.name ?? "?"}{#if l.note} <span class="cp-muted">({l.note})</span>{/if}</p>
                    {/each}
                {/if}
            {:else if selUnlock}
                <header class="ph"><b>Unlocks</b></header>
                <p class="small"><b>{questById(selUnlock.fromId)?.name}</b> → <b>{questById(selUnlock.toId)?.name}</b></p>
                <label class="cp-field"><span>Condition</span>
                    <input class="cp-input" value={selUnlock.note} placeholder="if the party spares Vesk…" onchange={(e) => setUnlockNote(selUnlock, e.currentTarget.value.trim())} /></label>
                <button class="cp-btn cp-sm cp-danger" onclick={() => removeUnlock(selUnlock.id)}>Remove</button>
            {:else if selLoc}
                {@const l = selLoc}
                <header class="ph"><b>{l.name}</b></header>
                <p class="pm">{l.type}{#if campaign.data?.startLocationId === l.id} · ★ start{/if}{#if partyId === l.id} · the party is here{/if}</p>
                {#if onOpen}<button class="cp-btn cp-sm" onclick={() => onOpen("locations")}>Open in Locations</button>{/if}
                {#if questsThrough(l.id).length}
                    <p class="cp-h">Quests here</p>
                    {#each questsThrough(l.id) as x (x.q.id + x.i)}
                        <p class="small"><span class="sw sm" style:background={colors[x.q.id]}></span> {x.q.name} — step {x.i + 1}{#if x.s.label}: {x.s.label}{/if}{stepDone(x.q, x.s) ? " ✓" : ""}</p>
                    {/each}
                {/if}
                {#if npcs.some((n) => n.locationId === l.id)}
                    <p class="cp-h">NPCs</p>
                    <p class="small">{npcs.filter((n) => n.locationId === l.id).map((n) => n.name).join(", ")}</p>
                {/if}
                {#if encounters.some((e) => e.locationId === l.id)}
                    <p class="cp-h">Encounters</p>
                    <p class="small">{encounters.filter((e) => e.locationId === l.id).map((e) => e.name).join(", ")}</p>
                {/if}
            {:else}
                <header class="ph"><b>Quests</b></header>
                <p class="small cp-muted">Click a quest or a location for details. Drag from a quest's bottom ● to a location to add a route step, from its right ● to another quest for “unlocks”. Select an arrow and press Delete to remove it.</p>
                <label class="cp-check"><input type="checkbox" bind:checked={hideFinished} /> Hide finished</label>
                <label class="cp-check"><input type="checkbox" bind:checked={hideSide} /> Main quests only</label>
                <ul class="legend">
                    {#each quests as q (q.id)}
                        <li>
                            <label class="cp-check">
                                <input type="checkbox" checked={!hidden.has(q.id)}
                                    onchange={(e) => { const h = new Set(hidden); e.currentTarget.checked ? h.delete(q.id) : h.add(q.id); hidden = h; }} />
                                <span class="sw sm" style:background={colors[q.id]}></span>
                                {q.name}
                            </label>
                            <span class="cp-muted small">{progress(q).done}/{progress(q).total}</span>
                        </li>
                    {:else}
                        <li class="cp-muted small">No quests yet.</li>
                    {/each}
                </ul>
                <button class="cp-btn cp-sm" onclick={tidyUp} title="Forget where nodes were dragged and lay the map out again">Tidy up the layout</button>
            {/if}
        </aside>
    {/if}
</div>

<style>
    .board-wrap {
        flex: 1;
        min-height: 560px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 300px;
        gap: 12px;
    }

    @media (max-width: 1000px) {
        .board-wrap {
            grid-template-columns: 1fr;
        }
    }

    .flow {
        position: relative;
        height: max(560px, calc(100vh - 260px));
        border: 1px solid var(--color-border);
        border-radius: 12px;
        overflow: hidden;
    }

    /* Svelte Flow in the app's colours */
    .flow :global(.svelte-flow) {
        --xy-background-color: var(--color-bg);
        --xy-background-pattern-color: color-mix(in srgb, var(--color-border) 80%, transparent);
        --xy-node-background-color: transparent;
        --xy-node-border: none;
        --xy-node-boxshadow-selected: none;
        --xy-edge-label-background-color: var(--color-card);
        --xy-edge-label-color: var(--color-text-secondary);
        --xy-minimap-background-color: var(--color-card);
        --xy-controls-button-background-color: var(--color-card);
        --xy-controls-button-color: var(--color-text-secondary);
        --xy-controls-button-border-color: var(--color-border);
        --xy-handle-background-color: var(--color-gold);
        --xy-handle-border-color: var(--color-bg);
        font-family: var(--font-ui);
    }

    .flow :global(.svelte-flow__node) {
        padding: 0;
        border: none;
        background: transparent;
        box-shadow: none;
    }

    .flow :global(.svelte-flow__edge-label) {
        padding: 1px 6px;
        border-radius: 6px;
        font-size: 11px;
    }

    .flow :global(.svelte-flow__handle) {
        width: 9px;
        height: 9px;
    }

    .panel {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: max(560px, calc(100vh - 260px));
        overflow-y: auto;
        padding: 14px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 12px;
        font-family: var(--font-ui);
        font-size: 13px;
    }

    .ph {
        display: flex;
        align-items: center;
        gap: 8px;
        font-family: var(--font-heading);
        font-size: 17px;
        color: var(--color-text-primary);
    }

    .pm {
        margin: 0;
        color: var(--color-text-muted);
        text-transform: capitalize;
    }

    .sw {
        width: 14px;
        height: 14px;
        flex: none;
        border-radius: 4px;
        display: inline-block;
    }

    .sw.sm {
        width: 10px;
        height: 10px;
        border-radius: 3px;
    }

    .steps {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .steps li {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 6px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
    }

    .steps li.on {
        border-color: var(--color-gold);
    }

    .steps li.done .n {
        background: var(--color-success);
        color: var(--color-bg);
    }

    .srow {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .n {
        width: 20px;
        height: 20px;
        flex: none;
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: var(--color-bg);
        font-size: 11px;
        color: var(--color-text-secondary);
    }

    .grow {
        flex: 1;
        min-width: 0;
    }

    .unl {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 6px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
    }

    .legend {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .legend li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
    }

    .small {
        margin: 0;
        font-size: 12px;
        line-height: 1.4;
    }
</style>
