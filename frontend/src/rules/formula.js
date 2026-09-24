/**
 * Формулы в данных (без eval). Используются для max ресурсов и т.п.
 *
 *   3                                  — число
 *   "level"                            — уровень класса
 *   "prof"                             — бонус мастерства
 *   { "byLevel": { "1": 2, "3": 3 } }  — таблица: берётся значение
 *                                        для наибольшего ключа ≤ уровня
 *   { "abilityMod": "cha", "min": 1 }  — модификатор характеристики
 *   { "sum": [ ... ] }                 — сумма нескольких формул
 *
 * Для любой формулы-объекта можно добавить "min" / "max".
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
        if (f.min != null) v = Math.max(f.min, v);
        if (f.max != null) v = Math.min(f.max, v);
        return v;
    }
    return Number(f) || 0;
}

/** Значение из таблицы { уровень: значение } для текущего уровня. */
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

/** Таблица в формате v2: [[minLevel, value], ...] → значение для уровня. */
export const byLevelPairs = (pairs, level) =>
    byLevel(Object.fromEntries((pairs ?? []).map(([l, v]) => [l, v])), level);
