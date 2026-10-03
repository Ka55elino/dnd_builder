/**
 * Map terrain tiles: one SVG per kind of terrain, filling exactly one grid cell.
 *
 * Files: src/assets/map-tiles/<id>.svg (64×64, the picture fills the whole square). A new file
 * is picked up automatically; add a name / order here if the id isn't a nice name.
 *
 * On the canvas a tile is drawn from a raster copy at the size it is shown (cached per size
 * step), so it stays sharp at any zoom — see tileImage().
 */
const files = import.meta.glob('../assets/map-tiles/*.svg', { eager: true, query: '?url', import: 'default' });

/** Names and order of the known tiles; others are added after them, named after the file. */
const KNOWN = [
    { id: 'grass', name: 'Grass' },
    { id: 'forest', name: 'Forest' },
    { id: 'water', name: 'Water' },
    { id: 'mountain', name: 'Mountains' },
    { id: 'sand', name: 'Sand' },
];

const titleCase = (s) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** [{ id, name, url }] */
export const TERRAIN = (() => {
    const urls = Object.fromEntries(Object.entries(files).map(([p, url]) => [p.split('/').pop().replace(/\.svg$/, ''), url]));
    const out = KNOWN.filter((t) => urls[t.id]).map((t) => ({ ...t, url: urls[t.id] }));
    for (const id of Object.keys(urls).sort()) if (!out.some((t) => t.id === id)) out.push({ id, name: titleCase(id), url: urls[id] });
    return out;
})();

export const terrainById = (id) => TERRAIN.find((t) => t.id === id) ?? null;

// ---------- raster copies for the canvas ----------

const sources = new Map(); // id → HTMLImageElement (loaded once)
const rasters = new Map(); // `${id}@${size}` → canvas
let onReady = null; // called when a picture finishes loading (the canvas redraws)

/** The canvas sets this to redraw once tile pictures have loaded. */
export function onTilesLoaded(fn) {
    onReady = fn;
}

/**
 * A tile's raster copy at least `px` device pixels wide (sizes step 16, 32, 64… 512), or null
 * while its picture is loading.
 */
export function tileImage(id, px) {
    const t = terrainById(id);
    if (!t) return null;
    let img = sources.get(id);
    if (!img) {
        img = new Image();
        img.decoding = 'async';
        img.onload = () => onReady?.();
        img.src = t.url;
        sources.set(id, img);
    }
    if (!img.complete || !img.naturalWidth) return null;
    const size = Math.min(512, Math.max(16, 2 ** Math.ceil(Math.log2(Math.max(1, px)))));
    const key = `${id}@${size}`;
    let c = rasters.get(key);
    if (!c) {
        c = document.createElement('canvas');
        c.width = c.height = size;
        c.getContext('2d').drawImage(img, 0, 0, size, size); // SVG: drawn as vector at this size
        rasters.set(key, c);
    }
    return c;
}
