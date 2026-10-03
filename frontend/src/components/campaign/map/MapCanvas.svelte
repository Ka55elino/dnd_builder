<script>
    /**
     * The campaign map's canvas (Konva via svelte-konva): an endless coordinate grid with
     * terrain tiles painted into its cells (one tile per cell, data/mapTiles.js).
     *
     *   world units: 1 cell = CELL px at zoom 1; coordinates are shown in cells, (0, 0) — the
     *   centre at start, x grows to the right, y — down (as on paper maps)
     *
     *   pan:  drag (the hand tool), or with any tool: the right / middle button, Space + drag,
     *         a two-finger trackpad scroll
     *   zoom: the wheel, a trackpad pinch (Ctrl+wheel), two fingers on a touch screen, the buttons
     *
     *   tool — 'pan' | 'paint' (fills cells with `tile`, drag to paint a line) | 'erase'
     *          (terrain and markers) | 'place' (a click calls onplace(x, y) — the parent puts
     *          a marker there)
     *   Alt+click — pick the cell's tile (onpick(tileId))
     *   markers — [{ id, kind ('location' | 'npc' | 'encounter'), x, y, icon, image?, ring?, label }]: things
     *             in cells (the child locations of this layer, its NPCs), drawn over the
     *             terrain — an NPC smaller, with its portrait and a ring of `ring` colour;
     *             double click → onopenmarker(id);
     *             the eraser → onerasemarker(id)
     *   placing — { icon } of what the place tool puts (a ghost under the pointer)
     *
     *   tool 'move' (combat tokens): drag a marker to another cell → onmovemarker(id, x, y);
     *          a click on a marker → onclickmarker(id); a click on an empty cell with `placing`
     *          → onplace(x, y); otherwise a drag pans. Markers of kind 'player' / 'monster' are
     *          tokens: a portrait, `active` (whose turn) — a gold glow, `down` — dimmed;
     *          `selected` — the id of the marker drawn with a dashed ring
     *   ondropitem(data, x, y) — an HTML drag of "text/x-map-item" dropped on a cell
     *   bounded — view only (the game): the view is held to what is on the map (terrain and
     *          markers): it opens fitted to it, can't zoom out further than that (the longer
     *          side fills the canvas) and can't be panned away from it
     *   cells — the painted cells at start, { "x,y": tileId } (later: setCells)
     *   onchange(cells) — after a stroke: the painted cells, { "x,y": tileId }
     *
     * The grid adapts to the zoom: lines every 1 / 2 / 5 / 10… cells so they are never denser
     * than MIN_GAP px; every 5th line is a major one with its coordinate on the rulers.
     * Everything is drawn in screen space by one Konva Shape (only the visible lines).
     *
     * Methods (bind:this): reset(), zoomBy(factor), setCells({ "x,y": tileId }), getCells().
     */
    import { Stage, Layer, Shape } from "svelte-konva";
    import { onMount, untrack } from "svelte";
    import { tileImage, onTilesLoaded } from "../../../data/mapTiles.js";

    let {
        tool = "pan",
        tile = null,
        cells: initialCells = {},
        markers = [],
        placing = null,
        onpick,
        onchange,
        onplace,
        onopenmarker,
        onerasemarker,
        onmovemarker,
        onclickmarker,
        ondropitem,
        selected = null,
        bounded = false,
    } = $props();

    const markerAt = (x, y) => markers.find((m) => m.x === x && m.y === y) ?? null;

    // portraits for NPC markers: loaded once, the canvas redraws when one arrives
    const faces = new Map();
    function face(url) {
        if (!url) return null;
        let img = faces.get(url);
        if (!img) {
            img = new Image();
            img.onload = () => redraw();
            img.src = url;
            faces.set(url, img);
        }
        return img.complete && img.naturalWidth ? img : null;
    }

    const CELL = 40; // px per cell at zoom 1
    const MIN_GAP = 24; // the densest grid, px between lines on screen
    const RULER = 22; // the rulers' thickness, px
    const MIN_ZOOM = 0.05;
    const MAX_ZOOM = 8;

    let box;
    let W = $state(0);
    let H = $state(0);
    let layerComp = $state(null);

    // the view: a world point (wx, wy) is on screen at (wx * zoom + x, wy * zoom + y)
    let view = $state({ zoom: 1, x: 0, y: 0 });
    let centred = false;
    let cursor = $state(null); // { x, y } in cells under the pointer
    let spaceDown = $state(false); // Space held: drag pans with any tool

    // the painted cells: "x,y" → tile id (not reactive: a stroke changes many, then redraws)
    const cells = new Map();
    const key = (x, y) => `${x},${y}`;

    /** Replace all cells: { "x,y": tileId }. */
    export function setCells(obj) {
        cells.clear();
        for (const [k, v] of Object.entries(obj ?? {})) if (v) cells.set(k, v);
        cellsVersion++;
        redraw();
    }

    /** The cells as { "x,y": tileId }. */
    export const getCells = () => Object.fromEntries(cells);

    const redraw = () => layerComp?.node?.batchDraw();

    let cellsVersion = $state(0); // bumps when the cells are replaced (the bounds follow)

    // the start cells only: the canvas is re-created for another layer
    // svelte-ignore state_referenced_locally
    for (const [k, v] of Object.entries(initialCells ?? {})) if (v) cells.set(k, v);

    let theme = { bg: "#24201b", minor: "rgba(255,255,255,0.06)", major: "rgba(255,255,255,0.14)", axis: "#c9a35a", text: "#9a8f80", ruler: "#1b1814" };

    onMount(() => {
        const cs = getComputedStyle(box);
        const v = (n, d) => cs.getPropertyValue(n).trim() || d;
        theme = {
            ...theme,
            bg: v("--color-card-elevated", theme.bg),
            axis: v("--color-gold", theme.axis),
            text: v("--color-text-muted", theme.text),
            ruler: v("--color-card", theme.ruler),
            line: v("--color-border", "#4a4038"),
        };
        const ro = new ResizeObserver(() => {
            W = box.clientWidth;
            H = box.clientHeight;
            if (!centred && W && H) {
                centred = true;
                reset();
            }
        });
        ro.observe(box);
        onTilesLoaded(redraw);
        const kd = (e) => {
            if (e.code === "Space" && !/input|textarea|select/i.test(e.target?.tagName)) {
                if (!spaceDown) spaceDown = true;
                if (box.matches(":hover")) e.preventDefault(); // no page scroll while over the map
            }
        };
        const ku = (e) => e.code === "Space" && (spaceDown = false);
        window.addEventListener("keydown", kd);
        window.addEventListener("keyup", ku);
        // not through Svelte's onwheel: it must be able to preventDefault (no page scroll / zoom)
        box.addEventListener("wheel", onWheel, { passive: false });
        // Safari / WKWebView (macOS app): a trackpad pinch comes as gesture events
        box.addEventListener("gesturestart", onGestureStart, { passive: false });
        box.addEventListener("gesturechange", onGestureChange, { passive: false });
        return () => {
            onTilesLoaded(null);
            window.removeEventListener("keydown", kd);
            window.removeEventListener("keyup", ku);
            ro.disconnect();
            box.removeEventListener("wheel", onWheel);
            box.removeEventListener("gesturestart", onGestureStart);
            box.removeEventListener("gesturechange", onGestureChange);
        };
    });

    // redraw when the view, the size, the hovered cell or the tool changes
    $effect(() => {
        void view.zoom, view.x, view.y, W, H, hover, tool, tile, markers, placing, selected, dragging;
        redraw();
    });

    // ---------- the view (bounded: held to what is on the map) ----------

    // what is on the map, in cells: { x0, y0, x1, y1 } (x1 / y1 — past the last cell), or null
    const content = $derived.by(() => {
        if (!bounded) return null;
        void cellsVersion;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        const add = (x, y) => {
            if (x < x0) x0 = x;
            if (y < y0) y0 = y;
            if (x + 1 > x1) x1 = x + 1;
            if (y + 1 > y1) y1 = y + 1;
        };
        for (const k of cells.keys()) {
            const i = k.indexOf(",");
            add(+k.slice(0, i), +k.slice(i + 1));
        }
        for (const m of markers) add(m.x, m.y);
        if (x0 === Infinity) return null;
        // a margin of a cell; a tiny map (a few tokens on an empty grid) still shows 10×8 cells
        const grow = (a, b, min) => {
            const d = Math.max(0, min - (b - a));
            return [a - Math.floor(d / 2), b + Math.ceil(d / 2)];
        };
        [x0, x1] = grow(x0 - 1, x1 + 1, 10);
        [y0, y1] = grow(y0 - 1, y1 + 1, 8);
        return { x0, y0, x1, y1 };
    });

    // the zoom at which the content fits the canvas (the longer side fills it)
    const fitZoom = () =>
        content
            ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((W - RULER) / ((content.x1 - content.x0) * CELL), (H - RULER) / ((content.y1 - content.y0) * CELL))))
            : MIN_ZOOM;
    const minZoom = () => (content ? fitZoom() : MIN_ZOOM);

    // every change of the view goes through here: the zoom limits and, when bounded, the edges
    function setView(v) {
        const z = Math.min(MAX_ZOOM, Math.max(minZoom(), v.zoom));
        let { x, y } = v;
        if (z !== v.zoom) {
            // keep the middle where it was
            const cx = RULER + (W - RULER) / 2, cy = RULER + (H - RULER) / 2;
            const wx = (cx - v.x) / v.zoom, wy = (cy - v.y) / v.zoom;
            x = cx - wx * z;
            y = cy - wy * z;
        }
        if (content && W && H) {
            const clampAxis = (pos, a0, a1, from, to) => {
                const s0 = a0 * CELL * z, s1 = a1 * CELL * z;
                if (s1 - s0 <= to - from) return from + (to - from - (s1 - s0)) / 2 - s0; // smaller: centred
                return Math.min(from - s0, Math.max(to - s1, pos)); // larger: no empty space at the edges
            };
            x = clampAxis(x, content.x0, content.x1, RULER, W);
            y = clampAxis(y, content.y0, content.y1, RULER, H);
        }
        view = { zoom: z, x, y };
    }

    /** (0, 0) in the middle, zoom 1 — or, bounded, the whole content. */
    export function reset() {
        if (content) return setView({ zoom: fitZoom(), x: 0, y: 0 });
        setView({ zoom: 1, x: RULER + (W - RULER) / 2, y: RULER + (H - RULER) / 2 });
    }

    /** Zoom around a screen point (default: the middle). */
    export function zoomBy(f, cx = RULER + (W - RULER) / 2, cy = RULER + (H - RULER) / 2) {
        const z = Math.min(MAX_ZOOM, Math.max(minZoom(), view.zoom * f));
        const wx = (cx - view.x) / view.zoom;
        const wy = (cy - view.y) / view.zoom;
        setView({ zoom: z, x: cx - wx * z, y: cy - wy * z });
    }

    // bounded: the content changed (a token put far away, the map replaced) — fit / re-clamp
    let fittedOnce = false;
    $effect(() => {
        const c = content;
        if (!bounded || !W || !H) return;
        untrack(() => {
            if (c && !fittedOnce) {
                fittedOnce = true;
                reset();
            } else setView(view);
        });
    });

    // ---------- input ----------

    const local = (e) => {
        const r = box.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    function onWheel(e) {
        e.preventDefault();
        const p = local(e);
        if (e.ctrlKey || e.metaKey) zoomBy(Math.exp(-e.deltaY * 0.01), p.x, p.y); // trackpad pinch
        else if (e.deltaX !== 0 && e.deltaMode === 0) setView({ ...view, x: view.x - e.deltaX, y: view.y - e.deltaY }); // trackpad scroll
        else zoomBy(e.deltaY > 0 ? 1 / 1.15 : 1.15, p.x, p.y); // mouse wheel
    }

    let gestureZoom = 1;
    function onGestureStart(e) {
        e.preventDefault();
        gestureZoom = view.zoom;
    }
    function onGestureChange(e) {
        e.preventDefault();
        const p = local(e);
        zoomBy((gestureZoom * e.scale) / view.zoom, p.x, p.y);
    }

    // pointers: one — pan or paint, two — pinch (zoom + pan)
    const pointers = new Map();
    let dragging = $state(null); // a token being dragged: { pointer, id, from, to }
    let gesture = null;
    let painting = null; // { id: pointerId, last: { x, y }, erase, changed }
    let panning = new Set(); // pointers that pan (hand tool, right / middle button, Space)

    const cellAt = (p) => ({ x: Math.floor((p.x - view.x) / view.zoom / CELL), y: Math.floor((p.y - view.y) / view.zoom / CELL) });
    const hover = $derived(cursor ? `${Math.floor(cursor.x)},${Math.floor(cursor.y)}` : "");
    const onRuler = (p) => p.x < RULER || p.y < RULER;

    function setCell(c, erase) {
        const k = key(c.x, c.y);
        if (erase) {
            const m = markerAt(c.x, c.y);
            if (m && !painting?.erased?.has(m.id)) {
                painting?.erased?.add(m.id);
                onerasemarker?.(m.id);
            }
            return cells.delete(k);
        }
        if (!tile || cells.get(k) === tile) return false;
        cells.set(k, tile);
        return true;
    }

    // a stroke: every cell between the last one and this one (fast drags leave no gaps)
    function paintTo(c) {
        const { last, erase } = painting;
        const n = Math.max(Math.abs(c.x - last.x), Math.abs(c.y - last.y));
        for (let i = 1; i <= n; i++) {
            const x = Math.round(last.x + ((c.x - last.x) * i) / n);
            const y = Math.round(last.y + ((c.y - last.y) * i) / n);
            if (setCell({ x, y }, erase)) painting.changed = true;
        }
        painting.last = c;
        redraw();
    }

    function onDown(e) {
        if (e.target.closest?.(".tools")) return; // the zoom buttons
        try {
            box.setPointerCapture(e.pointerId); // drags continue outside the canvas
        } catch {
            // a synthetic / already released pointer
        }
        const p = local(e);
        pointers.set(e.pointerId, p);
        gesture = null;
        if (pointers.size === 2) {
            // the second finger: a pinch, not a stroke / a token drag
            painting = null;
            dragging = null;
            return;
        }
        if (tool === "move" && e.button === 0 && !spaceDown && !onRuler(p)) {
            // tokens: drag one, click one, or put the chosen one into an empty cell; else pan
            const c = cellAt(p);
            const m = markerAt(c.x, c.y);
            if (m) return void (dragging = { pointer: e.pointerId, id: m.id, from: c, to: c });
            if (placing) return void onplace?.(c.x, c.y);
            return void panning.add(e.pointerId);
        }
        const pan = tool === "pan" || tool === "move" || spaceDown || e.button === 1 || e.button === 2;
        if (pan) return void panning.add(e.pointerId);
        if (e.button !== 0 || onRuler(p)) return;
        const c = cellAt(p);
        if (e.altKey) {
            // the pipette
            const id = cells.get(key(c.x, c.y));
            if (id) onpick?.(id);
            return;
        }
        if (tool === "place") return void onplace?.(c.x, c.y);
        painting = { id: e.pointerId, last: c, erase: tool === "erase", erased: new Set(), changed: false };
        painting.changed = setCell(c, tool === "erase");
        redraw();
    }

    function onMove(e) {
        const p = local(e);
        cursor = { x: (p.x - view.x) / view.zoom / CELL, y: (p.y - view.y) / view.zoom / CELL };
        if (!pointers.has(e.pointerId)) return;
        const prev = pointers.get(e.pointerId);
        pointers.set(e.pointerId, p);
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            if (gesture) {
                const z = Math.min(MAX_ZOOM, Math.max(minZoom(), view.zoom * (dist / gesture.dist)));
                const wx = (gesture.mid.x - view.x) / view.zoom;
                const wy = (gesture.mid.y - view.y) / view.zoom;
                setView({ zoom: z, x: mid.x - wx * z, y: mid.y - wy * z });
            }
            gesture = { mid, dist };
        } else if (dragging?.pointer === e.pointerId) {
            const c = cellAt(p);
            if (c.x !== dragging.to.x || c.y !== dragging.to.y) dragging = { ...dragging, to: c };
        } else if (painting?.id === e.pointerId) {
            const c = cellAt(p);
            if (c.x !== painting.last.x || c.y !== painting.last.y) paintTo(c);
        } else if (panning.has(e.pointerId)) {
            setView({ ...view, x: view.x + p.x - prev.x, y: view.y + p.y - prev.y });
        }
    }

    // an item dragged from an HTML list (combat tokens…) and dropped on a cell
    function onDragOver(e) {
        if (!ondropitem || !e.dataTransfer?.types?.includes("text/x-map-item")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        cursor = { x: (local(e).x - view.x) / view.zoom / CELL, y: (local(e).y - view.y) / view.zoom / CELL };
    }
    function onDrop(e) {
        const data = e.dataTransfer?.getData("text/x-map-item");
        if (!ondropitem || !data) return;
        e.preventDefault();
        const p = local(e);
        if (onRuler(p)) return;
        const c = cellAt(p);
        ondropitem(data, c.x, c.y);
    }

    // double click on a marker: open what it stands for
    function onDblClick(e) {
        const p = local(e);
        if (onRuler(p)) return;
        const c = cellAt(p);
        const m = markerAt(c.x, c.y);
        if (m) onopenmarker?.(m.id);
    }

    function onUp(e) {
        pointers.delete(e.pointerId);
        panning.delete(e.pointerId);
        gesture = null;
        if (dragging?.pointer === e.pointerId) {
            const d = dragging;
            dragging = null;
            if (d.to.x === d.from.x && d.to.y === d.from.y) onclickmarker?.(d.id);
            else onmovemarker?.(d.id, d.to.x, d.to.y);
        }
        if (painting?.id === e.pointerId) {
            if (painting.changed) onchange?.(getCells());
            painting = null;
        }
    }

    // ---------- drawing ----------

    /** The grid step in cells for the current zoom: 1, 2, 5, 10, 20, 50… (or ½, ¼ when close). */
    function gridStep(zoom) {
        const px = CELL * zoom; // one cell on screen
        const steps = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
        return steps.find((s) => s * px >= MIN_GAP) ?? steps.at(-1);
    }

    const fmt = (v) => (Math.abs(v) < 1e-9 ? "0" : Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, ""));

    function drawGrid(ctx) {
        const c = ctx._context; // the plain 2D context: thin crisp lines, no Konva overhead
        const { zoom, x: ox, y: oy } = view;
        const step = gridStep(zoom);
        const major = step * 5;
        const px = step * CELL * zoom;

        c.save();
        c.fillStyle = theme.bg;
        c.fillRect(0, 0, W, H);

        // visible range, in cells
        const x0 = (RULER - ox) / zoom / CELL;
        const x1 = (W - ox) / zoom / CELL;
        const y0 = (RULER - oy) / zoom / CELL;
        const y1 = (H - oy) / zoom / CELL;

        // ---- the terrain tiles ----
        const cpx = CELL * zoom; // one cell on screen
        const dpr = window.devicePixelRatio || 1;
        const cx = (v) => Math.round(v * cpx + ox);
        const cy = (v) => Math.round(v * cpx + oy);
        const drawTile = (id, x, y, alpha = 1) => {
            const img = tileImage(id, cpx * dpr);
            if (!img) return;
            const l = cx(x), t = cy(y);
            c.globalAlpha = alpha;
            c.drawImage(img, l, t, cx(x + 1) - l, cy(y + 1) - t); // edges rounded the same way: no seams
            c.globalAlpha = 1;
        };
        const ix0 = Math.floor(x0), ix1 = Math.floor(x1), iy0 = Math.floor(y0), iy1 = Math.floor(y1);
        if ((ix1 - ix0 + 1) * (iy1 - iy0 + 1) <= cells.size) {
            for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) {
                const id = cells.get(key(x, y));
                if (id) drawTile(id, x, y);
            }
        } else {
            for (const [k, id] of cells) {
                const [x, y] = k.split(",").map(Number);
                if (x >= ix0 && x <= ix1 && y >= iy0 && y <= iy1) drawTile(id, x, y);
            }
        }

        // the hovered cell: a preview of the tile / the eraser's outline
        if (hover && tool !== "pan" && !spaceDown) {
            const [hx, hy] = hover.split(",").map(Number);
            const hoverMarker = tool === "place" && markerAt(hx, hy) && markerAt(hx, hy)?.id !== placing?.id;
            if (tool === "paint" && tile) drawTile(tile, hx, hy, 0.55);
            c.strokeStyle = tool === "erase" ? "#d9534f" : tool === "place" && hoverMarker ? "#d9534f" : theme.axis;
            c.lineWidth = 2;
            c.strokeRect(cx(hx) + 1, cy(hy) + 1, cx(hx + 1) - cx(hx) - 2, cy(hy + 1) - cy(hy) - 2);
        }

        const isMajor = (v) => Math.abs(v / major - Math.round(v / major)) < 1e-6;
        const sx = (v) => Math.round(v * CELL * zoom + ox) + 0.5;
        const sy = (v) => Math.round(v * CELL * zoom + oy) + 0.5;

        const lines = (from, to, draw) => {
            for (let v = Math.ceil(from / step) * step; v <= to + 1e-9; v += step) draw(+v.toFixed(6));
        };

        // minor, then major lines
        for (const pass of ["minor", "major"]) {
            c.beginPath();
            c.strokeStyle = pass === "minor" ? theme.minor : theme.major;
            c.lineWidth = 1;
            lines(x0, x1, (v) => {
                if ((pass === "major") !== isMajor(v) || Math.abs(v) < 1e-9) return;
                c.moveTo(sx(v), RULER);
                c.lineTo(sx(v), H);
            });
            lines(y0, y1, (v) => {
                if ((pass === "major") !== isMajor(v) || Math.abs(v) < 1e-9) return;
                c.moveTo(RULER, sy(v));
                c.lineTo(W, sy(v));
            });
            if (px >= MIN_GAP || pass === "major") c.stroke();
        }

        // the axes through (0, 0)
        c.beginPath();
        c.strokeStyle = theme.axis;
        c.globalAlpha = 0.55;
        c.lineWidth = 1.5;
        if (x0 <= 0 && x1 >= 0) {
            c.moveTo(sx(0), RULER);
            c.lineTo(sx(0), H);
        }
        if (y0 <= 0 && y1 >= 0) {
            c.moveTo(RULER, sy(0));
            c.lineTo(W, sy(0));
        }
        c.stroke();
        c.globalAlpha = 1;

        // ---- markers: a badge with the icon, the name under the cell ----
        // part: 'all' | 'body' | 'label' — labels go in a second pass, over every token
        const drawMarker = (m, ghost = false, part = "all") => {
            const token = m.kind === "player" || m.kind === "monster";
            const npc = m.kind === "npc" || token;
            const r = token ? Math.max(6, Math.min(cpx * 0.42, 28)) : Math.max(npc ? 5 : 6, Math.min(cpx * (npc ? 0.32 : 0.4), npc ? 20 : 26));
            const l = cx(m.x), t = cy(m.y), w = cx(m.x + 1) - l;
            const mx = l + w / 2, my = t + w / 2;
            c.globalAlpha = ghost ? 0.55 : m.down ? 0.45 : 1;
            if (part === "label") {
                drawLabel(m, mx, my, r, npc, ghost);
                c.globalAlpha = 1;
                return;
            }
            if (m.active && !ghost) {
                // whose turn it is: a gold glow
                c.save();
                c.shadowColor = theme.axis;
                c.shadowBlur = 14;
                c.beginPath();
                c.arc(mx, my, r + 3, 0, Math.PI * 2);
                c.strokeStyle = theme.axis;
                c.lineWidth = 3;
                c.stroke();
                c.restore();
            }
            c.beginPath();
            c.arc(mx, my, r, 0, Math.PI * 2);
            c.fillStyle = "rgba(29,26,23,0.88)";
            c.fill();
            const img = npc && r >= 7 ? face(m.image) : null;
            if (img) {
                // the portrait, cropped to a circle (cover)
                c.save();
                c.beginPath();
                c.arc(mx, my, r - 1, 0, Math.PI * 2);
                c.clip();
                const k = Math.max((2 * r) / img.naturalWidth, (2 * r) / img.naturalHeight);
                const iw = img.naturalWidth * k, ih = img.naturalHeight * k;
                c.drawImage(img, mx - iw / 2, my - ih / 2, iw, ih);
                c.restore();
            }
            c.beginPath();
            c.arc(mx, my, r, 0, Math.PI * 2);
            c.lineWidth = npc ? 2.5 : 2;
            c.strokeStyle = m.ring || theme.axis; // NPC: attitude, encounter: red, location: gold
            c.stroke();
            if (selected === m.id && !ghost) {
                c.save();
                c.setLineDash([4, 3]);
                c.beginPath();
                c.arc(mx, my, r + 6, 0, Math.PI * 2);
                c.strokeStyle = "#f3ead8";
                c.lineWidth = 1.5;
                c.stroke();
                c.restore();
            }
            if (r >= 7 && !img) {
                c.font = `${Math.round(r * 1.05)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
                c.textAlign = "center";
                c.textBaseline = "middle";
                c.fillStyle = "#fff";
                c.fillText(m.icon ?? "📍", mx, my + r * 0.06);
            }
            if (part === "all") drawLabel(m, mx, my, r, npc, ghost);
            c.globalAlpha = 1;
        };
        function drawLabel(m, mx, my, r, npc, ghost) {
            if (ghost || !m.label || cpx < 18) return;
            c.font = npc ? '500 10px Inter, -apple-system, "Segoe UI", sans-serif' : '600 11px Inter, -apple-system, "Segoe UI", sans-serif';
            c.textAlign = "center";
            const tw = c.measureText(m.label).width + 10;
            const ly = my + r + 4;
            c.fillStyle = "rgba(29,26,23,0.85)";
            c.beginPath();
            if (c.roundRect) c.roundRect(mx - tw / 2, ly, tw, 17, 4);
            else c.rect(mx - tw / 2, ly, tw, 17);
            c.fill();
            c.fillStyle = "#f3ead8";
            c.textBaseline = "middle";
            c.fillText(m.label, mx, ly + 9);
        }
        const visible = markers.filter((m) => m.x >= ix0 - 1 && m.x <= ix1 + 1 && m.y >= iy0 - 1 && m.y <= iy1 + 1);
        for (const m of visible) drawMarker(m, dragging?.id === m.id, "body"); // dragged: a ghost where it was
        for (const m of visible) if (dragging?.id !== m.id) drawMarker(m, false, "label");
        if (dragging && (dragging.to.x !== dragging.from.x || dragging.to.y !== dragging.from.y)) {
            const m = markers.find((x) => x.id === dragging.id);
            if (m) drawMarker({ ...m, x: dragging.to.x, y: dragging.to.y, active: false });
        }
        if (hover && tool === "move" && placing && !dragging && !spaceDown) {
            const [hx, hy] = hover.split(",").map(Number);
            if (!markerAt(hx, hy)) drawMarker({ ...placing, x: hx, y: hy }, true);
        }
        if (hover && tool === "place" && placing && !spaceDown) {
            const [hx, hy] = hover.split(",").map(Number);
            drawMarker({ ...placing, x: hx, y: hy }, true);
        }

        // the rulers with the major coordinates
        c.fillStyle = theme.ruler;
        c.fillRect(0, 0, W, RULER);
        c.fillRect(0, 0, RULER, H);
        c.strokeStyle = theme.line;
        c.beginPath();
        c.moveTo(0, RULER + 0.5);
        c.lineTo(W, RULER + 0.5);
        c.moveTo(RULER + 0.5, 0);
        c.lineTo(RULER + 0.5, H);
        c.stroke();

        c.font = '10px Inter, -apple-system, "Segoe UI", sans-serif';
        c.fillStyle = theme.text;
        c.strokeStyle = theme.text;
        c.textBaseline = "middle";
        // labels on every major line (and every line when they're far apart)
        const labelEvery = major * CELL * zoom >= 60 && px >= 60 ? step : major;
        c.beginPath();
        c.textAlign = "left";
        for (let v = Math.ceil(x0 / labelEvery) * labelEvery; v <= x1 + 1e-9; v += labelEvery) {
            const x = sx(+v.toFixed(6));
            c.moveTo(x, RULER - 6);
            c.lineTo(x, RULER);
            c.fillText(fmt(+v.toFixed(6)), x + 3, RULER / 2);
        }
        for (let v = Math.ceil(y0 / labelEvery) * labelEvery; v <= y1 + 1e-9; v += labelEvery) {
            const y = sy(+v.toFixed(6));
            c.moveTo(RULER - 6, y);
            c.lineTo(RULER, y);
            c.save();
            c.translate(RULER / 2, y + 3);
            c.rotate(-Math.PI / 2);
            c.textAlign = "right";
            c.fillText(fmt(+v.toFixed(6)), 0, 0);
            c.restore();
        }
        c.stroke();

        // the corner
        c.fillStyle = theme.ruler;
        c.fillRect(0, 0, RULER, RULER);
        c.restore();
    }

    const stepLabel = $derived.by(() => {
        const s = gridStep(view.zoom);
        return s === 1 ? "1 cell" : `${fmt(s)} cells`;
    });
</script>

<div
    class="map-canvas"
    class:painting={tool !== "pan" && tool !== "move" && !spaceDown}
    bind:this={box}
    oncontextmenu={(e) => e.preventDefault()}
    ondragover={onDragOver}
    ondrop={onDrop}
    ondblclick={onDblClick}
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointercancel={onUp}
    onpointerleave={() => (cursor = null)}
    role="application"
    aria-label="Map canvas"
>
    <Stage width={W} height={H} listening={false}>
        <Layer bind:this={layerComp} listening={false}>
            <Shape sceneFunc={drawGrid} listening={false} />
        </Layer>
    </Stage>

    <div class="tools">
        <button onclick={() => zoomBy(1 / 1.3)} title="Zoom out" aria-label="Zoom out">−</button>
        <button onclick={reset} title="Back to (0, 0), 100%" aria-label="Reset the view">⌖</button>
        <button onclick={() => zoomBy(1.3)} title="Zoom in" aria-label="Zoom in">+</button>
    </div>

    <div class="hud">
        <span title="The grid's step">Grid: {stepLabel}</span>
        <span>{Math.round(view.zoom * 100)}%</span>
        {#if cursor}<span class="xy">x {fmt(Math.floor(cursor.x * 10) / 10)} · y {fmt(Math.floor(cursor.y * 10) / 10)}</span>{/if}
    </div>
</div>

<style>
    .map-canvas {
        position: relative;
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: hidden;
        border-radius: 10px;
        touch-action: none; /* pan and pinch are the canvas's */
        user-select: none;
        cursor: grab;
    }

    .map-canvas:active {
        cursor: grabbing;
    }

    .map-canvas.painting,
    .map-canvas.painting:active {
        cursor: crosshair;
    }

    .tools {
        position: absolute;
        top: 32px;
        right: 10px;
        display: flex;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        overflow: hidden;
        cursor: default;
    }

    .tools button {
        width: 30px;
        height: 28px;
        background: var(--color-card);
        border: 0;
        color: var(--color-text-secondary);
        font-size: 15px;
        cursor: pointer;
    }

    .tools button + button {
        border-left: 1px solid var(--color-border);
    }

    .tools button:hover {
        color: var(--color-gold);
    }

    .hud {
        position: absolute;
        right: 10px;
        bottom: 10px;
        display: flex;
        gap: 10px;
        padding: 4px 10px;
        background: color-mix(in srgb, var(--color-card) 85%, transparent);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: 11px;
        pointer-events: none;
    }

    .xy {
        min-width: 110px;
        color: var(--color-text-secondary);
        font-variant-numeric: tabular-nums;
    }
</style>
