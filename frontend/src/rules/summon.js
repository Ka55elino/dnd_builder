/**
 * Summons: familiars, summoned spirits, companions (Find Familiar, Summon Beast, Primal Companion).
 *
 * Every summoned creature is a bestiary monster (assets/data/monsters). Its Hit Points and AC
 * come from there; a monster made for a spell or a feature can scale with what summoned it:
 *
 *   monster "summon": {                          (in the monster's JSON, kept in data)
 *     ac: "11 + slot",                           — expressions (see evalExpr): slot, level, prof,
 *     hp: "30 + 5 * (slot - 2)",                   str…cha (the caster's modifiers), spellMod,
 *     attack: { bonus: "spellAttack",              spellAttack, spellDC
 *               damage: "4 + slot" },          — every attack: to-hit and the flat damage modifier
 *     initiative: "owner" | "own",               — shares the caster's turn / rolls its own
 *     note: "…"                                  — a line under the card
 *   }
 *
 *   spell / ability "summon": {                  (assets/data/spells, kept in data)
 *     options: [monster ids],                    — what can be summoned (one is chosen)
 *     types: ["celestial", "fey", "fiend"],      — the creature type is chosen too (Find Familiar)
 *     count: "1 + 2 * (slot - 3)",               — how many at once (expression; Animate Dead)
 *     stack: true,                               — a new cast adds to the ones there (Animate Dead);
 *                                                  otherwise one cast per group: it replaces the old
 *     group: "familiar",                         — the group (default: the spell's id)
 *     initiative: "owner" | "own",               — default for the monsters (theirs wins)
 *     tempHp: "floor(level / 2)",                — it appears with Temporary Hit Points (Hound of Ill Omen)
 *     hp: "1",                                   — its Hit Point maximum instead of the monster's (Fungal Infestation)
 *     fromFallen: { types: ["beast", "humanoid"] } — it raises a creature that fell in the encounter
 *                                                  (the DM's line: a monster at 0 HP of these types);
 *                                                  it takes the corpse's place on the map
 *   a feat may add forms: "summonOptions": { findFamiliar: [ids] } (Pact of the Chain, models/Character.js)
 *   types (Find Familiar) apply to a Beast form only — Pact of the Chain's imp stays a Fiend
 *     token: { name, icon, ac?, hp?, note? }     — not a creature (Flaming Sphere, Spiritual Weapon):
 *                                                  no stat block, a token to move; ac / hp — expressions,
 *                                                  no hp — it can't be damaged, only dismissed
 *   }
 *
 * The summon itself lives in CharacterState.summons (the player's app owns its Hit Points,
 * like the character's own); the DM's app puts it in the Initiative line and on the map.
 */

// ---------- expressions: numbers, names, + − * / ( ), floor / ceil / min / max ----------

/**
 * Evaluate "11 + slot", "5 + 5 * level", "floor(slot / 2)" with vars (no eval).
 * Unknown names count as 0; a number stays a number; anything broken → fallback.
 */
export function evalExpr(src, vars = {}, fallback = 0) {
    if (typeof src === 'number') return src;
    if (src == null || src === '') return fallback;
    const toks = String(src).match(/\d+(?:\.\d+)?|[A-Za-z_]\w*|[-+*/(),]/g) ?? [];
    let i = 0;
    const peek = () => toks[i];
    const next = () => toks[i++];
    const FN = { floor: Math.floor, ceil: Math.ceil, min: Math.min, max: Math.max };
    function primary() {
        const t = next();
        if (t == null) throw new Error('end');
        if (t === '(') {
            const v = sum();
            if (next() !== ')') throw new Error(')');
            return v;
        }
        if (t === '-') return -primary();
        if (t === '+') return primary();
        if (/^\d/.test(t)) return Number(t);
        if (FN[t] && peek() === '(') {
            next();
            const args = [sum()];
            while (peek() === ',') {
                next();
                args.push(sum());
            }
            if (next() !== ')') throw new Error(')');
            return FN[t](...args);
        }
        return Number(vars[t]) || 0;
    }
    function product() {
        let v = primary();
        while (peek() === '*' || peek() === '/') v = next() === '*' ? v * primary() : v / primary();
        return v;
    }
    function sum() {
        let v = product();
        while (peek() === '+' || peek() === '-') v = next() === '+' ? v + product() : v - product();
        return v;
    }
    try {
        const v = sum();
        return i === toks.length && Number.isFinite(v) ? Math.floor(v) : fallback;
    } catch {
        return fallback;
    }
}

/** The names a summon's expressions can use, from the caster (models/Character) and the slot. */
export function summonVars(ch, slot = null) {
    const mods = ch?.mods ?? {};
    const sc = ch?.spellcasting ?? null;
    return {
        ...mods,
        slot: slot ?? 0,
        level: ch?.level ?? 1,
        prof: ch?.prof ?? 2,
        spellMod: sc?.ability ? mods[sc.ability] ?? 0 : 0,
        spellAttack: sc?.attack ?? (ch?.prof ?? 2),
        spellDC: sc?.saveDC ?? 8 + (ch?.prof ?? 2),
        hpMax: ch?.maxHp ?? 0,
    };
}

// ---------- what an item summons ----------

export const CREATURE_TYPE_NAMES = {
    celestial: 'Celestial', fey: 'Fey', fiend: 'Fiend', beast: 'Beast', undead: 'Undead',
    elemental: 'Elemental', construct: 'Construct', aberration: 'Aberration', dragon: 'Dragon',
};

/**
 * The item's summon data, or null:
 * { options: [ids], types: [type] | null, count, stack, group, initiative, token: {…} | null }.
 */
export function summonOf(item) {
    const s = item?.data?.summon;
    if (!s) return null;
    const token = s.token && typeof s.token === 'object' && s.token.name ? s.token : null;
    const options = Array.isArray(s.options) ? s.options : [];
    if (!token && !options.length) return null;
    return {
        options,
        types: Array.isArray(s.types) && s.types.length ? s.types : null,
        count: s.count ?? 1,
        stack: !!s.stack,
        group: s.group ?? item.id,
        initiative: s.initiative ?? null,
        token,
        tempHp: s.tempHp ?? null,
        hp: s.hp ?? null,
        fromFallen: s.fromFallen ? { types: Array.isArray(s.fromFallen.types) ? s.fromFallen.types : null } : null,
    };
}

/** The chosen creature type applies to this form (Find Familiar: a Beast; not the imp of Pact of the Chain). */
export const canTakeType = (s, monster) => !!s?.types && (!monster || monster.type === 'beast');

/**
 * Creatures that fell in the encounter and can be raised (Fungal Infestation):
 * line — the line the player sees (combat.svelte.js seen.line: down, raised, type).
 */
export function fallenChoices(item, line = []) {
    const f = summonOf(item)?.fromFallen;
    if (!f) return [];
    return line.filter((c) => c.kind === 'monster' && c.down && !c.raised && (!f.types || f.types.includes(c.type)));
}

/** How many it summons with this slot (Animate Dead: 1, +2 per slot level above 3rd). */
export function summonCount(item, ch, slot = null) {
    const s = summonOf(item);
    if (!s) return 0;
    return Math.max(1, Math.min(20, evalExpr(s.count, summonVars(ch, slot ?? item?.level ?? null), 1)));
}

/** The bestiary monsters it can summon (the ones that exist), in the data's order. */
export function summonChoices(item, monsters = []) {
    const s = summonOf(item);
    if (!s) return [];
    const byId = new Map(monsters.map((m) => [m.id, m]));
    return s.options.map((id) => byId.get(id)).filter(Boolean);
}

// ---------- the creature's numbers ----------

const DIE = /^(\d+d\d+)\s*(?:([+-])\s*(\d+))?$/i;
const avgOf = (die, mod) => {
    const [n, d] = die.toLowerCase().split('d').map(Number);
    return Math.floor((n * (d + 1)) / 2) + mod;
};

/**
 * The monster with its numbers for this caster and slot: AC, Hit Points, attacks.
 * A monster without "summon" comes back as it is (Find Familiar: the bestiary's owl).
 * type — another creature type it takes (Find Familiar: Celestial / Fey / Fiend).
 * @returns { monster, ac, maxHp, initiative: 'owner' | 'own' | null, note }
 */
export function resolveSummon(monster, vars, { type = null } = {}) {
    if (!monster) return null;
    if (type && type !== monster.type) monster = { ...monster, type }; // Find Familiar: Celestial, Fey or Fiend
    const d = monster.data ?? {};
    const s = d.summon ?? null;
    if (!s) return { monster, ac: Number(monster.ac) || 10, maxHp: Math.max(1, Number(monster.hp) || 1), initiative: null, note: '' };
    const ac = s.ac != null ? evalExpr(s.ac, vars, Number(monster.ac) || 10) : Number(monster.ac) || 10;
    const maxHp = Math.max(1, s.hp != null ? evalExpr(s.hp, vars, Number(monster.hp) || 1) : Number(monster.hp) || 1);
    const atk = s.attack ?? null;
    const scale = (a) => {
        if (!atk || !a?.attack) return a;
        const out = { ...a, attack: { ...a.attack } };
        if (atk.bonus != null) out.attack.bonus = evalExpr(atk.bonus, vars, a.attack.bonus);
        if (atk.damage != null && Array.isArray(a.damage) && a.damage.length) {
            const [first, ...rest] = a.damage;
            const m = DIE.exec(String(first.dice ?? ''));
            if (m) {
                const mod = evalExpr(atk.damage, vars, 0);
                const dice = `${m[1]}${mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : ''}`;
                out.damage = [{ ...first, dice, avg: avgOf(m[1], mod) }, ...rest];
            }
        }
        return out;
    };
    const data = {
        ...d,
        traits: d.traits ?? [],
        actions: (d.actions ?? []).map(scale),
        bonusActions: (d.bonusActions ?? []).map(scale),
        reactions: d.reactions ?? [],
    };
    return {
        monster: { ...monster, ac, hp: maxHp, data },
        ac,
        maxHp,
        initiative: s.initiative ?? null,
        note: s.note ?? '',
    };
}

const newUid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/**
 * New CharacterState.summons entries for one cast: what the sheet and the DM need without
 * the bestiary. item — the spell / ability, monster — the chosen one (null for a token),
 * slot — the slot level it was cast with, type — the chosen creature type (Find Familiar).
 * Several (Animate Dead) are numbered: "Skeleton 1", "Skeleton 2"…
 */
export function makeSummons(item, monster, { ch, slot = null, conc = null, type = null, fallen = null } = {}) {
    const s = summonOf(item);
    if (!s) return [];
    const vars = summonVars(ch, slot);
    const base = {
        source: item.id,
        sourceName: item.name,
        group: s.stack ? `${item.id}:${newUid()}` : s.group,
        slot: slot ?? null,
        conc: conc ?? null,
        hpLost: 0,
        tempHp: 0,
        since: Date.now(),
    };
    let one;
    if (s.token && !monster) {
        // not a creature: a token to move (Flaming Sphere, Spiritual Weapon)
        const t = s.token;
        one = {
            ...base,
            monsterId: '',
            name: t.name,
            icon: t.icon ?? '✦',
            image: t.image ?? '',
            size: t.size ?? 'medium',
            token: true,
            note: t.note ?? '',
            ac: t.ac != null ? evalExpr(t.ac, vars, null) : null,
            maxHp: t.hp != null ? Math.max(1, evalExpr(t.hp, vars, 1)) : null,
            initiative: s.initiative ?? 'owner',
        };
    } else {
        const r = resolveSummon(monster, vars);
        if (!r) return [];
        one = {
            ...base,
            monsterId: monster.id,
            // Fungal Infestation: "Zombie (Goblin 2)" — the fallen enemy it was
            name: fallen?.name ? `${monster.name} (${fallen.name})` : monster.name,
            image: monster.image ?? '',
            size: monster.size ?? 'medium',
            creatureType: canTakeType(s, monster) && s.types.includes(type) ? type : null,
            raisedFrom: fallen?.id ?? null,
            ac: r.ac,
            maxHp: s.hp != null ? Math.max(1, evalExpr(s.hp, vars, r.maxHp)) : r.maxHp,
            tempHp: s.tempHp != null ? Math.max(0, evalExpr(s.tempHp, vars, 0)) : 0, // Hound of Ill Omen
            initiative: r.initiative ?? s.initiative ?? 'own',
        };
    }
    const n = summonCount(item, ch, slot);
    return Array.from({ length: n }, (_, i) => ({ ...one, uid: newUid(), name: n > 1 ? `${one.name} ${i + 1}` : one.name }));
}

/** One summon (the first of makeSummons). */
export const makeSummon = (item, monster, opts) => makeSummons(item, monster, opts)[0] ?? null;
