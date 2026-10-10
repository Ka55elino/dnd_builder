/**
 * "Use" / "Cast" on a character-sheet card: what it spends and what upcasting adds.
 *
 *   useOptions(card, ch, state) → { kind, ... } — what the card's button does
 *   applyUse(info, choice, ch, state)           — spend it (and gain, if the ability converts)
 *   upcastLines(item, slotLevel)                — the bonus of a higher-level slot, as text
 *
 * Data (spells table, data field):
 *
 *   upcast: {                                  — PHB "Using a Higher-Level Spell Slot"
 *     damage: '1d6' | 5,                       — added per step to the (first) damage part
 *     heal: '2d8' | 10,                        — healing per step
 *     temp: 5,                                 — Temporary Hit Points per step
 *     targets: 1,                              — extra creatures per step
 *     text: '{n} darts', base, each,           — free text: {n} = base + steps × each, {slot} = slot level
 *     at: { '3': '…', '5': '…' },              — text by slot level (the highest that applies)
 *     every: 1,                                — slot levels per step (default 1)
 *     maxSteps,                                — cap on steps (Divine Smite: up to 5d8)
 *   }
 *
 *   cost: {                                    — abilities that draw from a pool
 *     resource: 'kiPoints' | ['channelDivinity', 'channelDivinityPaladin'],  — the first one the character has
 *     amount: 1 | { min, max },                — fixed or chosen (Lay on Hands, Bastion of Law)
 *     bySlot: { '1': 2, … },                   — amount by the slot level created (Create Spell Slot)
 *     slot: { min, max },                      — spends a spell slot instead (Divine Smite)
 *   }
 *   gain: { resource, amount: 1 | 'slotLevel' } | { slot: { max } }  — conversions; with no cost
 *                                              it just adds to the pool (Tokens of the Departed: +1 Soul Trinket)
 *   gainTempHp: <formula>                      — Temporary Hit Points on use (Persistent Rage: "level")
 *   requires: 'raging'                         — usable only while this effect is on you
 *   turnGain: { action: 1 }                    — one more Action / Bonus Action / Reaction this turn
 *                                              (Action Surge), see CharacterState.gainTurn
 *
 * Abilities with uses spend their own resource (data.resource ?? id); Metamagic spends
 * Sorcery Points (feat field cost). Cantrips and at-will spells cost nothing: their button
 * only starts Concentration and/or the spell's effect.
 *
 *   apply: {                                   — a spell/ability whose effect lasts (rules/modifiers.js)
 *     condition: 'bless',                      — the effect (assets/data/conditions) or a condition it inflicts
 *     target: 'self' | 'creature' | 'enemy',   — self: always on you; creature: on you if you tick "on me";
 *                                              enemy: never on you (the DM puts it on the target)
 *     choose: 'skill' | 'skillOrTool' | 'ability' | 'damageType' | 'equipped', options?: [...]  — asked at casting
 *                                              (equipped: an item in hand / worn — Rune Carver)
 *                                              (Guidance: a skill; Whispers of the Dead: a skill or a tool)
 *     choose: 'option', options: [{ value, label }]  — the ability's own options (Aspect of the Wilds);
 *                                              the effect's modifiers with choice: '<value>' apply only to it
 *     label?: 'Set'                            — the button text (an ability with no cost: a switch)
 *     rounds?,                                 — it lasts N rounds (Shield: 1)
 *     tempHp: <formula>                        — Temporary Hit Points on use (rules/formula.js;
 *                                              they don't stack: the higher value is kept)
 *     endsWithTempHp: true                     — the effect ends when they run out
 *     effects: [{ kind: 'die', target: [ids], multiply: 2 }]  — doubles another card's die
 *
 *   summon: { options: [monster ids], group?, initiative? } — calls a creature (rules/summon.js);
 *                                              the sheet adds it after applyUse spent the cost
 */
import { isConcentration } from '../models/Character.js';
import { evalFormula } from './formula.js';
import { SKILLS, TOOLS } from './skills.js';
import { ABILITY_KEYS, ABILITIES } from './abilities.js';
import { DAMAGE_TYPES } from './labels.js';

const CHOICES = {
    skill: () => SKILLS.map((s) => ({ value: s.id, label: s.name })),
    // what you hold and wear now (Rune Carver: the item a rune is inscribed on); value — the item's name
    equipped: (ch) => {
        const l = ch?.loadout ?? {};
        const seen = new Set();
        return [l.main, l.off, l.armor]
            .filter((it) => it && !seen.has(it.name) && seen.add(it.name))
            .map((it) => ({ value: it.name, label: it.name }));
    },
    // a skill or a tool (Whispers of the Dead)
    skillOrTool: () => [...SKILLS, ...TOOLS].map((s) => ({ value: s.id, label: s.name })),
    ability: () => ABILITY_KEYS.map((k) => ({ value: k, label: ABILITIES[k]?.name ?? k })),
    damageType: () =>
        Object.entries(DAMAGE_TYPES)
            .filter(([k]) => k !== 'physical' && k !== 'weapon')
            .map(([k, v]) => ({ value: k, label: v.name })),
};

/**
 * What a spell's lasting effect asks for at casting: { condition, target, choose: [{ value, label }] | null }
 * (null if the spell has none). defs — refs.conditions, for the effect's name; ch — the Character
 * (choose: 'equipped' lists what it holds and wears).
 */
export function applyInfo(item, defs = [], ch = null) {
    const a = item?.data?.apply;
    if (!a?.condition) return null;
    const def = defs.find((d) => d.id === a.condition);
    let choose = null;
    if (a.choose === 'option' && Array.isArray(a.options)) {
        // own options (Aspect of the Wilds: Owl / Panther / Salmon / Chameleon): [{ value, label }]
        choose = a.options.map((o) => (typeof o === 'string' ? { value: o, label: o[0].toUpperCase() + o.slice(1) } : o));
    } else if (a.choose && CHOICES[a.choose]) {
        choose = CHOICES[a.choose](ch);
        if (Array.isArray(a.options) && a.options.length) choose = choose.filter((o) => a.options.includes(o.value));
    }
    return {
        condition: a.condition, name: def?.name ?? a.condition, target: a.target ?? 'self', choose, kind: a.choose ?? null,
        onMeLabel: a.onMeLabel ?? null, // the "on me" checkbox text (Sacred Weapon: "Cast on self")
    };
}

const DICE = /^(\d+)d(\d+)$/;

/** Steps above the base level: (slot − base) / every, capped by maxSteps. */
function steps(up, base, slot) {
    const n = Math.max(0, Math.floor((slot - base) / (up.every ?? 1)));
    return up.maxSteps != null ? Math.min(n, up.maxSteps) : n;
}

/** '1d6' × 3 → '3d6'; 5 × 3 → 15. */
function times(v, n) {
    if (typeof v === 'number') return v * n;
    const m = DICE.exec(String(v));
    return m ? `${Number(m[1]) * n}d${m[2]}` : `${n}×${v}`;
}

/** '8d6' + '2d6' → '10d6'; 5 + 10 → 15; otherwise null (different dice). */
function plus(a, b) {
    if (a == null) return null;
    if (typeof b === 'number' && /^\d+$/.test(String(a))) return Number(a) + b;
    const x = DICE.exec(String(a));
    const y = DICE.exec(String(b));
    return x && y && x[2] === y[2] ? `${Number(x[1]) + Number(y[1])}d${x[2]}` : null;
}

/** The first damage part ({ dice, type }) of an item's data. */
function firstDamage(dmg) {
    if (!dmg) return null;
    if ('dice' in dmg || 'type' in dmg) return dmg;
    return Object.values(dmg).find((p) => p && typeof p === 'object' && 'dice' in p) ?? null;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * What a slot of `slot` level adds to the item compared to its own level.
 * @returns string[] — e.g. ['+2d6 Fire damage (10d6)', '+2 targets']
 */
export function upcastLines(item, slot) {
    const up = item?.data?.upcast;
    // a spell: its own level; a slot-spending ability (Divine Smite): the lowest slot it takes
    const base = Math.max(1, item?.kind === 'spell' ? item?.level ?? 1 : item?.data?.cost?.slot?.min ?? 1);
    if (!up || !slot || slot < base) return [];
    const n = steps(up, base, slot);
    const out = [];
    if (n > 0) {
        if (up.damage != null) {
            const dmg = firstDamage(item.data?.damage);
            const add = times(up.damage, n);
            const total = plus(dmg?.dice, add);
            const type = dmg?.type && !['physical'].includes(dmg.type) ? ` ${dmg.type[0].toUpperCase()}${dmg.type.slice(1)}` : '';
            out.push(`+${add}${type} damage${total != null ? ` (${total} total)` : ''}`);
        }
        if (up.heal != null) out.push(`+${times(up.heal, n)} healing`);
        if (up.temp != null) out.push(`+${times(up.temp, n)} Temporary Hit Points`);
        if (up.targets) out.push(`+${plural(up.targets * n, 'target')}`);
        if (up.text) {
            const v = (up.base ?? 0) + n * (up.each ?? 1);
            out.push(up.text.replace(/\{n\}/g, String(v)).replace(/\{slot\}/g, String(slot)));
        }
    }
    if (up.at) {
        const key = Object.keys(up.at).map(Number).filter((l) => l <= slot).sort((a, b) => b - a)[0];
        if (key != null) out.push(up.at[key]);
    }
    return out;
}

/** The item has anything to show for a higher slot. */
export const canUpcast = (item) => !!item?.data?.upcast;

// ---------------------------------------------------------------------------

/** Slot options for a spell (or a slot-spending ability) of minimum level `min` (max — optional cap). */
function slotChoices(ch, state, min, max = 9) {
    return (ch.spellSlots ?? [])
        .filter((s) => s.level >= min && s.level <= max)
        .map((s) => {
            const left = state.slotsLeft(s);
            return {
                value: state.slotKey(s),
                slot: s,
                level: s.level,
                left,
                max: s.max,
                label: `${s.pact ? 'Pact slot' : 'Level'} ${s.level} · ${left}/${s.max}`,
                disabled: left <= 0,
            };
        });
}

/** The first resource of the character from an id or a list of ids. */
function findResource(ch, ids) {
    for (const id of [].concat(ids ?? [])) {
        const r = ch.resource?.(id);
        if (r) return r;
    }
    return null;
}

const firstFree = (opts) => opts.find((o) => !o.disabled)?.value ?? opts[0]?.value ?? '';

/**
 * What the card's button does.
 * @param card { item, free?, ritual? } — an action group card (models/Character.js)
 * @returns null (nothing to spend, no button) or {
 *   kind: 'spell' | 'resource' | 'slot' | 'create',
 *   label, options?: [{ value, label, disabled, level? }], defaultValue?,
 *   resource?, amount?, amountRange?: [min, max], disabled, reason?, concentration
 * }
 */
export function useOptions(card, ch, state) {
    const it = card?.item;
    if (!it || !ch || !state) return null;
    const d = it.data ?? {};
    const conc = isConcentration(it);

    // ----- spells -----
    if (it.kind === 'spell') {
        const free = it.level === 0 || card.free;
        const selfFx = d.apply?.condition && (d.apply.target ?? 'self') !== 'enemy';
        if (free) return conc || selfFx || d.summon ? { kind: 'free', label: 'Cast', concentration: conc, disabled: false } : null;
        const opts = slotChoices(ch, state, it.level);
        const ritual = !!(it.ritual || d.casting?.ritual || card.ritual);
        if (ritual) opts.push({ value: 'ritual', label: 'Ritual · no slot, +10 min', level: it.level, disabled: false });
        if (!opts.length) return { kind: 'spell', label: 'Cast', options: [], disabled: true, reason: 'No spell slots of this level', concentration: conc };
        const allSpent = opts.every((o) => o.disabled);
        return {
            kind: 'spell', label: 'Cast', options: opts, defaultValue: firstFree(opts),
            disabled: allSpent, reason: allSpent ? 'No spell slots left' : '', concentration: conc,
        };
    }

    // ----- Metamagic (feat with a cost in Sorcery Points) -----
    if (it.category === 'metamagic') {
        const r = findResource(ch, 'sorceryPoints');
        const amount = Number(d.cost ?? it.cost ?? 1) || 1;
        if (!r) return { kind: 'resource', label: 'Use', amount, disabled: true, reason: 'No Sorcery Points' };
        const left = state.resourceLeft(r);
        return { kind: 'resource', label: 'Use', resource: r, amount, disabled: left < amount, reason: left < amount ? 'Not enough Sorcery Points' : '' };
    }

    const cost = d.cost;

    // ----- spends a spell slot (Divine Smite, Wild Resurgence, Convert Slot to Points) -----
    if (cost?.slot) {
        const opts = slotChoices(ch, state, cost.slot.min ?? 1, cost.slot.max ?? 9);
        const allSpent = !opts.length || opts.every((o) => o.disabled);
        return {
            kind: 'slot', label: 'Use', options: opts, defaultValue: firstFree(opts),
            disabled: allSpent, reason: opts.length ? (allSpent ? 'No spell slots left' : '') : 'No spell slots',
            gain: d.gain ? { ...d.gain, resource: d.gain.resource ? findResource(ch, d.gain.resource) : null } : null,
            concentration: conc,
        };
    }

    // ----- Create Spell Slot: spend points, get a spent slot back -----
    if (cost?.bySlot && d.gain?.slot) {
        const r = findResource(ch, cost.resource);
        const max = d.gain.slot.max ?? 9;
        const opts = (ch.spellSlots ?? [])
            .filter((s) => !s.pact && s.level <= max && cost.bySlot[s.level] != null)
            .map((s) => {
                const price = cost.bySlot[s.level];
                const spent = s.max - state.slotsLeft(s);
                return {
                    value: state.slotKey(s), slot: s, level: s.level, price,
                    label: `Level ${s.level} · ${price} points`,
                    disabled: !r || spent <= 0 || state.resourceLeft(r) < price,
                };
            });
        const none = !opts.length || opts.every((o) => o.disabled);
        return {
            kind: 'create', label: 'Use', resource: r, options: opts, defaultValue: firstFree(opts),
            disabled: none, reason: !r ? 'No Sorcery Points' : none ? 'No spent slot you can afford' : '',
        };
    }

    // ----- spends a resource: its own uses or a shared pool -----
    const r = cost?.resource ? findResource(ch, cost.resource) : d.uses ? ch.resource?.(d.resource ?? it.id) : null;
    if (!r) {
        if (cost?.resource) return { kind: 'resource', label: 'Use', amount: 1, disabled: true, reason: 'You don\'t have the resource it needs' };
        if (d.summon) return { kind: 'free', label: 'Summon', concentration: conc, disabled: false }; // Primal Companion
        // no cost, adds to a pool (Tokens of the Departed: +1 Soul Trinket, up to its max)
        if (d.gain?.resource) {
            const g = findResource(ch, d.gain.resource);
            const full = !g || state.resourceLeft(g) >= g.max;
            return {
                kind: 'free', label: d.gain.label ?? 'Use', gain: g ? { ...d.gain, resource: g } : null, concentration: conc,
                disabled: full, reason: !g ? "You don't have the resource it fills" : full ? `${g.name}: already at the maximum` : '',
            };
        }
        // no cost, Temporary Hit Points on use (Persistent Rage: = level); requires — only while that effect is on
        if (d.gainTempHp != null) {
            const off = d.requires && !state.hasCondition(d.requires);
            const name = ch.conditionDefs?.find((x) => x.id === d.requires)?.name ?? d.requires;
            return { kind: 'free', label: 'Use', concentration: conc, disabled: !!off, reason: off ? `Only while ${name} is active` : '' };
        }
        // no cost, a lasting effect on you (Aspect of the Wilds): a switch — puts it on / changes the choice
        if (d.apply?.condition && (d.apply.target ?? 'self') !== 'enemy')
            return { kind: 'free', label: d.apply.label ?? 'Use', concentration: conc, disabled: false };
        return conc ? { kind: 'free', label: 'Use', concentration: true, disabled: false } : null;
    }
    const left = state.resourceLeft(r);
    const amt = cost?.amount ?? 1;
    if (typeof amt === 'object') {
        const min = amt.min ?? 1;
        const max = Math.min(amt.max ?? r.max, left);
        return {
            kind: 'resource', label: 'Use', resource: r, amount: min, amountRange: [min, Math.max(min, max)],
            disabled: left < min, reason: left < min ? `No ${r.name} left` : '', concentration: conc,
        };
    }
    return {
        kind: 'resource', label: 'Use', resource: r, amount: amt,
        disabled: left < amt, reason: left < amt ? `No ${r.name} left` : '', concentration: conc,
    };
}

/**
 * Spend what the button costs.
 * @param info   useOptions(...) result
 * @param choice { value?: slot key | 'ritual', amount?: number }
 * @returns true if something was used
 */
export function applyUse(info, choice, ch, state, item) {
    if (!info || info.disabled) return false;
    const opt = info.options?.find((o) => o.value === (choice?.value ?? info.defaultValue));
    switch (info.kind) {
        case 'free':
            if (info.gain?.resource) state.restore(info.gain.resource, Number(info.gain.amount) || 1);
            break;
        case 'spell':
            if (!opt || opt.disabled) return false;
            if (opt.slot) state.useSlot(opt.slot, 1);
            break;
        case 'slot':
            if (!opt?.slot || opt.disabled) return false;
            state.useSlot(opt.slot, 1);
            if (info.gain?.resource) {
                const n = info.gain.amount === 'slotLevel' ? opt.slot.level : Number(info.gain.amount) || 1;
                state.restore(info.gain.resource, n);
            }
            break;
        case 'create':
            if (!opt?.slot || opt.disabled) return false;
            state.spend(info.resource, opt.price);
            state.useSlot(opt.slot, -1);
            break;
        case 'resource': {
            const [lo, hi] = info.amountRange ?? [info.amount, info.amount];
            const n = Math.min(hi, Math.max(lo, Math.floor(Number(choice?.amount ?? info.amount)) || lo));
            if (state.resourceLeft(info.resource) < n) return false;
            state.spend(info.resource, n);
            break;
        }
        default:
            return false;
    }
    if (info.concentration && item?.id) state.concentrate(item.id);
    // a spell with a lasting effect (Mage Armor): it shows in Status and changes the sheet
    // Action Surge: an extra action this turn
    for (const [k, n] of Object.entries(item?.data?.turnGain ?? {})) state.gainTurn(k, Number(n) || 1, item.name);
    // Temporary Hit Points on use, no lasting effect (Persistent Rage); they don't stack — the higher stays
    if (item?.data?.gainTempHp != null) {
        const hp = evalFormula(item.data.gainTempHp, { level: ch.powerLevel?.[item.id] ?? ch.level, prof: ch.prof, mods: ch.mods });
        if (hp > state.tempHp) state.setTempHp(hp);
    }
    // the lasting effect: on you if the spell targets you (self), or you ticked "on me" (creature);
    // an enemy-only one (Hold Person → Paralyzed) is put on the target by the DM
    const apply = item?.data?.apply;
    const target = apply?.target ?? 'self';
    const onMe = target === 'self' || (target === 'creature' && !!choice?.onMe);
    if (apply?.condition && item.id && onMe) {
        if (apply.tempHp != null) {
            const hp = evalFormula(apply.tempHp, { level: ch.powerLevel?.[item.id] ?? ch.level, prof: ch.prof, mods: ch.mods });
            if (hp > state.tempHp) state.setTempHp(hp); // Temporary Hit Points don't stack
        }
        state.addCondition(apply.condition, {
            conc: info.concentration ? item.id : null, // ends with this spell's Concentration
            tempHp: !!apply.endsWithTempHp || undefined,
            choice: choice?.choose || undefined,
            rounds: Number(apply.rounds) > 0 ? Number(apply.rounds) : null,
        });
    }
    return true;
}
