/**
 * Formulas in data (no eval). Used for resource max etc.
 *
 *   3                                  — number
 *   "level"                            — class level
 *   "prof"                             — proficiency bonus
 *   { "byLevel": { "1": 2, "3": 3 } }  — table: takes the value
 *                                        for the largest key ≤ level
 *   { "abilityMod": "cha", "min": 1 }  — ability modifier
 *   { "sum": [ ... ] }                 — sum of several formulas
 *   { "perLevel": 4 }                  — 4 × level (Symbiotic Entity Temporary Hit Points)
 *
 * Any object formula may add "min" / "max".
 *
 * ctx: { level, prof, mods: { str, dex, ... } }
 */
export function evalFormula(f, ctx) {
    if (f == null) return 0;
    if (typeof f === 'number') return f;
    if (f === 'level') return ctx.level;
    if (f === 'prof') return ctx.prof;

    if (typeof f === 'object') {
        let v = 0;
        if (f.byLevel) v = byLevel(f.byLevel, ctx.level);
        else if (f.abilityMod) v = ctx.mods?.[f.abilityMod] ?? 0;
        else if (Array.isArray(f.sum)) v = f.sum.reduce((s, x) => s + evalFormula(x, ctx), 0);
        else if (f.perLevel != null) v = Number(f.perLevel) * ctx.level;
        if (f.min != null) v = Math.max(f.min, v);
        if (f.max != null) v = Math.min(f.max, v);
        return v;
    }
    return Number(f) || 0;
}

/** Value from a { level: value } table for the current level. */
export function byLevel(table, level) {
    let best = 0;
    let bestLvl = -Infinity;
    for (const [k, v] of Object.entries(table)) {
        const lvl = Number(k);
        if (lvl <= level && lvl > bestLvl) {
            best = v;
            bestLvl = lvl;
        }
    }
    return best;
}

/** v2-format table: [[minLevel, value], ...] → value for the level. */
export const byLevelPairs = (pairs, level) =>
    byLevel(Object.fromEntries((pairs ?? []).map(([l, v]) => [l, v])), level);
