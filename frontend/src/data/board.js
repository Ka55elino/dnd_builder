/**
 * The campaign board — the graph Svelte Flow draws (components/campaign/CampaignBoard.svelte).
 * Pure functions: campaign data in, nodes and edges out.
 *
 *   location nodes — nested: a location with sub-locations is a group that holds them
 *                    (Svelte Flow parentId; positions inside are relative to the group)
 *   quest nodes    — one per quest
 *   step edges     — quest → location, the quest's route (quest.data.route[i] =
 *                    { locationId, label, objective }); solid when that objective is done
 *   unlock edges   — quest → quest (campaign_links kind "unlocks", note — the condition)
 *
 * Saved positions (the board's nodes) win; whatever has none is laid out here.
 */

export const LEAF = { w: 200, h: 76 }; // a location without sub-locations
export const QUEST = { w: 220, h: 84 };
const PAD = 22; // inside a group
const HEADER = 62; // a group's title (+ the line with NPCs, encounters, "party here")
const GAP = 26;
const ROW_MAX = 3; // children per row in a group
const ROOT_GAP = 70;

export const QUEST_COLORS = ['#D9A441', '#5FA8D3', '#C0607A', '#6FB35F', '#A07AD6', '#E08A3C', '#4FB3A9', '#D97FB6', '#8FA0E0', '#B8A07A'];

/** A stable colour per quest (by its place in the list, main quests first). */
export function questColors(quests) {
    const order = [...quests].sort((a, b) => (a.kind === 'main' ? 0 : 1) - (b.kind === 'main' ? 0 : 1) || a.name.localeCompare(b.name));
    return Object.fromEntries(order.map((q, i) => [q.id, QUEST_COLORS[i % QUEST_COLORS.length]]));
}

export const route = (q) => (Array.isArray(q?.data?.route) ? q.data.route : []);
export const objectives = (q) => q?.data?.objectives ?? [];

/** Is this step done: the quest completed, or the objective it is bound to ticked. */
export function stepDone(q, step) {
    if (q.status === 'completed') return true;
    const i = step?.objective;
    return i != null && i !== '' && !!objectives(q)[Number(i)]?.done;
}

export function progress(q) {
    const r = route(q);
    if (!r.length) return { done: 0, total: 0 };
    return { done: r.filter((s) => stepDone(q, s)).length, total: r.length };
}

/** Unlock links (quest → quest). */
export const unlockLinks = (links) =>
    (links ?? []).filter((l) => l.kind === 'unlocks' && l.fromType === 'quest' && l.toType === 'quest');

/** Quest depth: 0 — nothing unlocks it; otherwise 1 + the deepest quest that does (cycles ignored). */
export function questDepths(quests, unlocks) {
    const into = new Map();
    for (const l of unlocks) (into.get(l.toId) ?? into.set(l.toId, []).get(l.toId)).push(l.fromId);
    const ids = new Set(quests.map((q) => q.id));
    const depth = {};
    const visit = (id, seen) => {
        if (depth[id] != null) return depth[id];
        if (seen.has(id)) return 0; // a cycle
        seen.add(id);
        const from = (into.get(id) ?? []).filter((x) => ids.has(x));
        const d = from.length ? 1 + Math.max(...from.map((x) => visit(x, seen))) : 0;
        seen.delete(id);
        return (depth[id] = d);
    };
    for (const q of quests) visit(q.id, new Set());
    return depth;
}

/**
 * Default layout of the locations: groups size themselves around their children.
 * Returns Map id → { x, y, w, h } (x / y relative to the parent group).
 */
export function layoutLocations(locations) {
    const ids = new Set(locations.map((l) => l.id));
    const kids = new Map();
    for (const l of locations) {
        const p = l.parentId && ids.has(l.parentId) ? l.parentId : '';
        (kids.get(p) ?? kids.set(p, []).get(p)).push(l);
    }
    for (const arr of kids.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    const out = new Map();
    const size = (l, depth = 0) => {
        const ch = depth < 16 ? kids.get(l.id) ?? [] : [];
        if (!ch.length) return { ...LEAF };
        // children in rows of ROW_MAX
        let y = HEADER;
        let w = 0;
        for (let i = 0; i < ch.length; i += ROW_MAX) {
            const row = ch.slice(i, i + ROW_MAX).map((c) => ({ c, s: size(c, depth + 1) }));
            let x = PAD;
            const rowH = Math.max(...row.map((r) => r.s.h));
            for (const r of row) {
                out.set(r.c.id, { x, y, w: r.s.w, h: r.s.h });
                x += r.s.w + GAP;
            }
            w = Math.max(w, x - GAP + PAD);
            y += rowH + GAP;
        }
        return { w: Math.max(w, LEAF.w + 2 * PAD), h: y - GAP + PAD };
    };
    let x = 0;
    for (const root of kids.get('') ?? []) {
        const s = size(root);
        out.set(root.id, { x, y: 0, w: s.w, h: s.h });
        x += s.w + ROOT_GAP;
    }
    return out;
}

/**
 * Default layout of the quests: a band above the map, one column per depth — a quest stands
 * to the right of the quests that unlock it, so "unlocks" arrows run left to right.
 */
export function layoutQuests(quests, unlocks, mapWidth = 0) {
    const depth = questDepths(quests, unlocks);
    const cols = {};
    for (const q of quests) (cols[depth[q.id]] ??= []).push(q);
    const COL = QUEST.w + 210; // room for the condition on an "unlocks" arrow
    const ROW = QUEST.h + 36;
    const tallest = Math.max(1, ...Object.values(cols).map((c) => c.length));
    const width = Object.keys(cols).length * COL - 210;
    const x0 = Math.max(0, (mapWidth - width) / 2);
    const top = -(tallest * ROW) - 110; // the band ends 110px above the map
    const out = new Map();
    for (const [d, list] of Object.entries(cols)) {
        list.sort((a, b) => (a.kind === 'main' ? 0 : 1) - (b.kind === 'main' ? 0 : 1) || a.name.localeCompare(b.name));
        const offset = ((tallest - list.length) * ROW) / 2; // centre shorter columns
        list.forEach((q, i) => out.set(q.id, { x: x0 + Number(d) * COL, y: top + offset + i * ROW }));
    }
    return out;
}

/**
 * Nodes for Svelte Flow (parents before children).
 * ctx: { locations, quests, links, npcs, encounters, saved: [{ refType, refId, x, y, w, h }],
 *        startId, partyId, colors, hidden: Set<questId>, focus: questId | null }
 */
export function buildNodes(ctx) {
    const { locations = [], quests = [], links = [], npcs = [], encounters = [], saved = [], startId = '', partyId = '', colors = {}, hidden = new Set() } = ctx;
    const pos = new Map(saved.map((n) => [`${n.refType}:${n.refId}`, n]));
    const auto = layoutLocations(locations);
    const ids = new Set(locations.map((l) => l.id));
    const parentOf = (l) => (l.parentId && ids.has(l.parentId) ? l.parentId : '');
    const hasKids = new Set(locations.map(parentOf).filter(Boolean));

    // what passes through each location (shown on its card)
    const through = {};
    for (const q of quests) {
        if (hidden.has(q.id)) continue;
        route(q).forEach((s) => (through[s.locationId] ??= new Set()).add(q.id));
    }

    // locations, parents first (depth order)
    const depthOf = (l, n = 0) => (parentOf(l) && n < 32 ? depthOf(locations.find((x) => x.id === l.parentId), n + 1) : n);
    const sorted = [...locations].sort((a, b) => depthOf(a) - depthOf(b));
    const nodes = [];
    for (const l of sorted) {
        const s = pos.get(`location:${l.id}`);
        const a = auto.get(l.id) ?? { x: 0, y: 0, ...LEAF };
        const group = hasKids.has(l.id);
        const w = group ? Math.max(s?.w ?? 0, a.w) : LEAF.w;
        const h = group ? Math.max(s?.h ?? 0, a.h) : LEAF.h;
        const parent = parentOf(l);
        nodes.push({
            id: `loc:${l.id}`,
            type: 'location',
            position: s ? { x: s.x, y: s.y } : { x: a.x, y: a.y },
            ...(parent ? { parentId: `loc:${parent}`, expandParent: true } : {}),
            width: w,
            height: h,
            zIndex: group ? 0 : 1,
            deletable: false,
            data: {
                loc: l,
                group,
                start: l.id === startId,
                party: l.id === partyId,
                npcs: npcs.filter((n) => n.locationId === l.id).map((n) => n.name),
                encounters: encounters.filter((e) => e.locationId === l.id).map((e) => e.name),
                quests: [...(through[l.id] ?? [])].map((id) => colors[id]),
            },
        });
    }
    // groups grow around children that were saved outside them
    for (let pass = 0; pass < 4; pass++) {
        for (const n of nodes) {
            if (!n.data.group) continue;
            for (const c of nodes) {
                if (c.parentId !== n.id) continue;
                n.width = Math.max(n.width, c.position.x + c.width + PAD);
                n.height = Math.max(n.height, c.position.y + c.height + PAD);
            }
        }
    }

    const roots = nodes.filter((n) => !n.parentId);
    const mapWidth = roots.length ? Math.max(...roots.map((n) => n.position.x + n.width)) : 0;
    const qauto = layoutQuests(quests, unlockLinks(links), mapWidth);
    for (const q of quests) {
        if (hidden.has(q.id)) continue;
        const s = pos.get(`quest:${q.id}`);
        nodes.push({
            id: `quest:${q.id}`,
            type: 'quest',
            position: s ? { x: s.x, y: s.y } : qauto.get(q.id) ?? { x: 0, y: -200 },
            width: QUEST.w,
            height: QUEST.h,
            zIndex: 2,
            deletable: false,
            data: { quest: q, color: colors[q.id], progress: progress(q) },
        });
    }
    return nodes;
}

/** Edges: route steps and unlocks. focus — a quest id: the rest fade. */
export function buildEdges(ctx, MarkerType) {
    const { quests = [], links = [], colors = {}, hidden = new Set(), focus = null, locations = [] } = ctx;
    const locIds = new Set(locations.map((l) => l.id));
    const questIds = new Set(quests.filter((q) => !hidden.has(q.id)).map((q) => q.id));
    const fade = (qid) => (focus && focus !== qid ? 'opacity:0.15;' : '');
    const edges = [];
    for (const q of quests) {
        if (!questIds.has(q.id)) continue;
        const color = colors[q.id];
        route(q).forEach((s, i) => {
            if (!locIds.has(s.locationId)) return;
            const done = stepDone(q, s);
            // full text when this quest is in focus; otherwise short, so labels don't pile up
            const text = s.label && (focus === q.id || s.label.length <= 22) ? s.label : s.label ? `${s.label.slice(0, 20)}…` : '';
            edges.push({
                id: `step:${q.id}:${i}`,
                source: `quest:${q.id}`,
                target: `loc:${s.locationId}`,
                label: `${i + 1}${text ? `. ${text}` : ''}${done ? ' ✓' : ''}`,
                style: `stroke:${color};stroke-width:${done ? 2.5 : 2};${done ? '' : 'stroke-dasharray:7 5;'}${fade(q.id)}`,
                labelStyle: `color:${color};${fade(q.id)}`,
                markerEnd: { type: MarkerType?.ArrowClosed ?? 'arrowclosed', color, width: 16, height: 16 },
                zIndex: 3,
                data: { kind: 'step', questId: q.id, index: i },
            });
        });
    }
    for (const l of unlockLinks(links)) {
        if (!questIds.has(l.fromId) || !questIds.has(l.toId)) continue;
        const f = focus && focus !== l.fromId && focus !== l.toId ? 'opacity:0.15;' : '';
        edges.push({
            id: `unl:${l.id}`,
            source: `quest:${l.fromId}`,
            target: `quest:${l.toId}`,
            sourceHandle: 'unlocks',
            targetHandle: 'unlocked',
            label: l.note ? `unlocks · ${l.note}` : 'unlocks',
            style: `stroke:var(--color-text-secondary);stroke-width:2.5;${f}`,
            labelStyle: f,
            markerEnd: { type: MarkerType?.ArrowClosed ?? 'arrowclosed', color: '#A9A19A', width: 18, height: 18 },
            zIndex: 3,
            data: { kind: 'unlock', linkId: l.id },
        });
    }
    return edges;
}
