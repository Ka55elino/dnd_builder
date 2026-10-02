/**
 * Conditions and effects → changes to the sheet. ONE pipeline for everything that is
 * "on" the character for a while: conditions (Prone, Grappled, Exhaustion…), named
 * effects (Slowed, Enlarged…) and spell effects (Mage Armor, Shield of Faith…).
 *
 *   definition  — reference data, never changes: assets/data/conditions/*.json (refs.conditions)
 *                 or a spell's data.apply.effects. { id, name, category, modifiers, implies,
 *                 levels, breaksConcentration, longRest }
 *   instance    — what is on this character: CharacterState.effects
 *                 { id, type: 'condition' } | { id, type: 'condition', level: 2 } (Exhaustion)
 *                 | { id, name, conc?, tempHp? } (a spell / ability effect, see rules/casting.js)
 *
 * The state stores only instances (references); numbers are always recomputed here,
 * so removing a condition, leveling up or changing armor needs no "undo".
 *
 * Modifiers (the vocabulary, shared with spell data.apply.effects):
 *   { kind: 'speed', op: 'set' | 'mul' | 'add', value, perLevel? }
 *   { kind: 'ac', op: 'add' | 'min', value }        (also legacy 'acBonus' / 'acMin'; 'acBase' — rules/sheet.js)
 *   { kind: 'd20', value, perLevel? }               — every D20 Test: attacks, checks, saves, Initiative
 *   { kind: 'save', ability?, value } · { kind: 'check', ability?, skill?, value }
 *   { kind: 'attack', value } · { kind: 'initiative', value }
 *   { kind: 'damage', dice: '1d4', sign: 1 | -1, type? } — weapon attacks (Enlarge / Reduce, Divine Favor)
 *   { kind: 'dice', dice: '1d4', sign: 1 | -1, on, ability?, skill? } — a die added to a roll, rolled at
 *        the table (Bless, Bane, Guidance, Blade Ward): on = checks | saves | attacks | attacksAgainst | damageTaken
 *   { kind: 'hpMax', value } (Aid) · { kind: 'sense', sense: 'darkvision' | 'truesight' | …, range }
 *   '$choice' in a field — what was chosen at casting (instance.choice): Guidance → { skill: '$choice' }
 *   { kind: 'flag', mode, on, ability?, note? }     — not computed, shown in Status:
 *        mode: advantage | disadvantage | autoFail | autoCrit | cant
 *        on:   attacks | attacksAgainst | checks | saves | initiative | actions | bonusActions | reactions | speech
 *   { kind: 'resistance', value } · { kind: 'immunity', value: <condition id or damage type> }
 *   { kind: 'note', note }
 *   { kind: 'economy', action: 'action' | 'bonus' | 'reaction', value } — extra per turn (Hasted: +1 action;
 *        counted in models/Character.js → economy)
 *   perLevel: × the instance level (Exhaustion 2 → −4 to D20 Tests).
 *
 * Order (fixed): base (sheet.js) → set → mul → add → min. A 'set' wins over 'mul'/'add'.
 * Same-named effects don't stack (one instance per id); Exhaustion has a level instead.
 */
import { ABILITIES } from './abilities.js';
import { SKILLS } from './skills.js';

const SKILL_NAME = Object.fromEntries(SKILLS.map((s) => [s.id, s.name]));

const SIGN = (n) => (n >= 0 ? `+${n}` : `−${-n}`);
const ABBR = (k) => ABILITIES?.[k]?.short ?? String(k ?? '').toUpperCase();

/** Modifier value with the instance level (perLevel). */
const val = (m) => (Number(m.value) || 0) * (m.perLevel ? Math.max(1, m.level ?? 1) : 1);

/**
 * Resolve condition instances against their definitions.
 * @param instances CharacterState.effects (only type 'condition' is used)
 * @param defs      refs.conditions
 * @param immuneTo  Set of condition ids the character is immune to (species, class…)
 * @returns [{ id, name, desc, category, level, maxLevel, explicit, impliedBy: [names], immune, def }]
 *   explicit — set by the player/DM; impliedBy — on because another condition includes it
 */
export function resolveConditions(instances = [], defs = [], immuneTo = new Set()) {
    const byId = new Map(defs.map((d) => [d.id, d]));
    // a custom condition another app sent (the DM's homebrew): its definition rides along
    for (const e of instances) if (e?.type === 'condition' && e.def && !byId.has(e.id)) byId.set(e.id, inlineDef(e.def));
    const out = new Map();
    const add = (id, { explicit = false, level = null, by = null, inst = null } = {}) => {
        const def = byId.get(id);
        if (!def) return;
        const d = def.data ?? def;
        let row = out.get(id);
        if (!row) {
            row = {
                id, name: def.name, desc: def.desc ?? '', category: def.category ?? 'condition',
                level: null, maxLevel: Number(d.levels) || null, explicit: false, impliedBy: [], immune: false, def,
            };
            out.set(id, row);
        }
        if (explicit) {
            row.explicit = true;
            row.instance = inst; // rounds, save, savePending, by (rules/conditions.js)
            if (row.maxLevel) row.level = Math.min(row.maxLevel, Math.max(1, Number(level) || 1));
        }
        if (by && !row.impliedBy.includes(by)) row.impliedBy.push(by);
        for (const sub of d.implies ?? []) add(sub, { by: def.name });
    };
    for (const e of instances) if (e?.type === 'condition') add(e.id, { explicit: true, level: e.level, inst: e });
    for (const row of out.values()) row.choice = row.instance?.choice ?? null;

    // immunities: the character's own + those granted by active conditions (Petrified → Poisoned)
    const immune = new Set(immuneTo);
    for (const row of out.values())
        for (const m of (row.def.data ?? row.def).modifiers ?? []) if (m.kind === 'immunity') immune.add(m.value);
    for (const row of out.values()) row.immune = immune.has(row.id);
    return [...out.values()];
}

/** A definition in assets/data format ({ id, name, desc, modifiers… }) → the refs.conditions shape. */
export function inlineDef(d) {
    const { desc, name, id, category, ...data } = d ?? {};
    return { id, name, category: category ?? 'condition', desc: desc ?? '', data: { ...data, category } };
}

/** A refs.conditions record → assets/data format (what goes over the LAN and into homebrew files). */
export function conditionDefinition(c) {
    const def = { ...(c.data ?? {}), id: c.id, name: c.name, category: c.category ?? 'condition' };
    delete def.custom;
    if (c.desc) def.desc = c.desc;
    return def;
}

/** Modifiers of the active (not immune) conditions, each with its source name and level. */
export function conditionModifiers(rows) {
    return rows
        .filter((r) => !r.immune && !r.inactive)
        .flatMap((r) =>
            ((r.def.data ?? r.def).modifiers ?? [])
                .map((m) => withChoice(m, r.choice))
                .filter(Boolean)
                .map((m) => ({ ...m, level: r.level, source: rowName(r), from: 'condition' })),
        );
}

/** "Exhaustion 2", "Guidance (Stealth)". */
export function rowName(r, label = choiceLabel) {
    const base = r.level ? `${r.name} ${r.level}` : r.name;
    return r.choice ? `${base} (${label(r.choice)})` : base;
}

/** '$choice' fields → the chosen value; a modifier that needs a choice nobody made is dropped. */
function withChoice(m, choice) {
    const uses = Object.values(m).some((v) => v === '$choice');
    if (!uses) return m;
    if (!choice) return null;
    return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v === '$choice' ? choice : v]));
}

/** A choice id → a readable label (skills, abilities, damage types). */
export function choiceLabel(id) {
    return SKILL_NAME[id] ?? ABILITIES?.[id]?.name ?? (id ? id[0].toUpperCase() + id.slice(1) : '');
}

/** Does adding this condition (or what it implies) break Concentration? */
export function breaksConcentration(id, defs = []) {
    const byId = new Map(defs.map((d) => [d.id, d]));
    const seen = new Set();
    const walk = (x) => {
        if (seen.has(x)) return false;
        seen.add(x);
        const d = byId.get(x);
        const data = d?.data ?? d ?? {};
        return !!data.breaksConcentration || (data.implies ?? []).some(walk);
    };
    return walk(id);
}

// ---------------------------------------------------------------------------

/**
 * Apply modifiers to a computed sheet (rules/sheet.js) — in place, and returns
 * { changes, flags, notes } for the Status card.
 *   changes — numeric changes: [{ label, sources }]
 *   flags   — grouped flags: [{ key, mode, on, ability, label, sources: [{ source, note }] }]
 *   notes   — free text: [{ note, source }]
 */
export function applyModifiers(sheet, modifiers = []) {
    const changes = [];
    const note = (label, srcs) => changes.push({ label, sources: [...new Set(srcs)] });
    const of = (kind, op) => modifiers.filter((m) => m.kind === kind && (op == null || (m.op ?? 'add') === op));

    // --- Speed: set → mul → add, never below 0 ---
    const sSet = of('speed', 'set');
    if (sSet.length) {
        const v = Math.min(...sSet.map((m) => Number(m.value) || 0));
        sheet.speed = Math.max(0, v);
        note(`Speed ${sheet.speed} ft.`, sSet.map((m) => m.source));
    } else {
        const mul = of('speed', 'mul');
        const add = of('speed', 'add');
        if (mul.length || add.length) {
            const k = mul.reduce((p, m) => p * (Number(m.value) || 1), 1);
            const plus = add.reduce((s, m) => s + val(m), 0);
            const before = sheet.speed;
            sheet.speed = Math.max(0, Math.floor(before * k + plus));
            for (const m of mul) note(`Speed ×${m.value === 0.5 ? '½' : m.value}`, [m.source]);
            for (const m of add) note(`Speed ${SIGN(val(m))} ft.`, [m.source]);
        }
    }

    // --- AC: add → min (acBase is applied in sheet.js) ---
    const acAdd = [...of('ac', 'add'), ...modifiers.filter((m) => m.kind === 'acBonus')];
    for (const m of acAdd) {
        sheet.ac += val(m);
        sheet.acSources?.push({ name: m.source, text: `${SIGN(val(m))} AC` });
        if (m.from === 'condition') note(`AC ${SIGN(val(m))}`, [m.source]);
    }
    for (const m of [...of('ac', 'min'), ...modifiers.filter((m) => m.kind === 'acMin')]) {
        const v = Number(m.value) || 0;
        if (sheet.ac < v) {
            sheet.ac = v;
            sheet.acSources?.push({ name: m.source, text: `AC at least ${v}` });
        }
    }

    // --- D20 Tests and their parts ---
    const d20 = of('d20');
    const d20Sum = d20.reduce((s, m) => s + val(m), 0);
    if (d20Sum) note(`D20 Tests ${SIGN(d20Sum)}`, d20.map((m) => m.source));

    const saveMods = of('save');
    sheet.saves = sheet.saves.map((s) => {
        const extra = saveMods.filter((m) => !m.ability || m.ability === s.key).reduce((t, m) => t + val(m), 0);
        return extra || d20Sum ? { ...s, value: s.value + extra + d20Sum, modified: true } : s;
    });
    for (const m of saveMods) note(`${m.ability ? `${ABBR(m.ability)} saves` : 'Saving throws'} ${SIGN(val(m))}`, [m.source]);

    const checkMods = of('check');
    const checkFor = (sk) =>
        checkMods.filter((m) => (!m.ability && !m.skill) || m.ability === sk.ability || m.skill === sk.id).reduce((t, m) => t + val(m), 0);
    sheet.skills = sheet.skills.map((sk) => {
        const extra = checkFor(sk);
        return extra || d20Sum ? { ...sk, value: sk.value + extra + d20Sum, modified: true } : sk;
    });
    // Passive Perception isn't a D20 Test: only check modifiers move it
    const perc = sheet.skills.find((sk) => sk.id === 'perception');
    if (perc) sheet.passivePerception += checkFor(perc);
    for (const m of checkMods) note(`${m.skill ?? (m.ability ? `${ABBR(m.ability)} checks` : 'Ability checks')} ${SIGN(val(m))}`, [m.source]);

    const atk = of('attack').reduce((t, m) => t + val(m), 0) + d20Sum;
    const dmg = of('damage');
    if (atk || dmg.length) {
        sheet.attacks = sheet.attacks.map((a) => ({
            ...a,
            toHit: a.toHit + atk,
            damage: dmg.reduce((d, m) => `${d} ${m.sign < 0 ? '−' : '+'} ${m.dice}${m.type ? ` ${m.type}` : ''}`, a.damage),
            modified: true,
        }));
        for (const m of dmg) note(`Weapon damage ${m.sign < 0 ? '−' : '+'}${m.dice}${m.type ? ` ${m.type}` : ''}`, [m.source]);
    }
    sheet.initiative += of('initiative').reduce((t, m) => t + val(m), 0) + d20Sum;

    // --- dice added to rolls (Bless +1d4, Bane −1d4, Guidance +1d4 to a skill): shown next to the number ---
    const dieTxt = (m) => `${m.sign < 0 ? '−' : '+'}${m.dice}`;
    const diceOn = (on) => of('dice').filter((m) => (m.on ?? 'checks') === on);
    const withDice = (row, list) => (list.length ? { ...row, dice: [...(row.dice ?? []), ...list.map(dieTxt)], modified: true } : row);
    sheet.saves = sheet.saves.map((s) => withDice(s, diceOn('saves').filter((m) => !m.ability || m.ability === s.key)));
    sheet.skills = sheet.skills.map((sk) =>
        withDice(sk, diceOn('checks').filter((m) => (!m.ability && !m.skill) || m.ability === sk.ability || m.skill === sk.id)),
    );
    sheet.attacks = sheet.attacks.map((a) => withDice(a, diceOn('attacks')));
    const DICE_ON = {
        checks: (m) => (m.skill ? SKILL_NAME[m.skill] ?? m.skill : m.ability ? `${ABBR(m.ability)} checks` : 'Ability checks'),
        saves: (m) => (m.ability ? `${ABBR(m.ability)} saving throws` : 'Saving throws'),
        attacks: () => 'Your attack rolls',
        attacksAgainst: () => 'Attack rolls against you',
        damageTaken: () => 'Damage you take',
    };
    for (const m of of('dice')) note(`${(DICE_ON[m.on ?? 'checks'] ?? (() => m.on))(m)} ${dieTxt(m)}`, [m.source]);

    // --- Hit Point maximum (Aid) and senses (Darkvision, True Seeing) ---
    for (const m of of('hpMax')) {
        sheet.hp += val(m);
        note(`HP maximum ${SIGN(val(m))}`, [m.source]);
    }
    for (const m of of('sense')) {
        if (m.sense === 'darkvision') sheet.darkvision = Math.max(sheet.darkvision ?? 0, Number(m.range) || 0);
        note(`${m.sense[0].toUpperCase() + m.sense.slice(1)} ${m.range} ft.`, [m.source]);
    }

    // --- flags: grouped by what they affect ---
    const flags = new Map();
    for (const m of of('flag')) {
        const key = `${m.mode}:${m.on}:${m.ability ?? ''}`;
        let f = flags.get(key);
        if (!f) flags.set(key, (f = { key, mode: m.mode, on: m.on, ability: m.ability ?? null, label: flagLabel(m), sources: [] }));
        f.sources.push({ source: m.source, note: m.note ?? '' });
    }
    // Advantage and Disadvantage on the same roll cancel out
    const list = [...flags.values()];
    for (const f of list) {
        if (f.mode !== 'advantage' && f.mode !== 'disadvantage') continue;
        const other = flags.get(`${f.mode === 'advantage' ? 'disadvantage' : 'advantage'}:${f.on}:${f.ability ?? ''}`);
        if (other) f.cancels = true;
    }

    const notes = [
        ...of('resistance').map((m) => ({ note: `Resistance to ${m.value === 'all' ? 'all damage' : `${m.value} damage`}`, source: m.source })),
        ...of('immunity').map((m) => ({ note: `Immunity: ${m.value}`, source: m.source })),
        ...of('note').filter((m) => m.from === 'condition').map((m) => ({ note: m.note, source: m.source })),
    ];

    return { changes, flags: list.sort((a, b) => FLAG_ORDER.indexOf(a.on) - FLAG_ORDER.indexOf(b.on)), notes };
}

const FLAG_ORDER = ['actions', 'bonusActions', 'reactions', 'speech', 'attacks', 'attacksAgainst', 'saves', 'checks', 'initiative'];

const TARGET = {
    attacks: 'Your attack rolls',
    attacksAgainst: 'Attack rolls against you',
    initiative: 'Initiative',
    actions: 'Actions',
    bonusActions: 'Bonus Actions',
    reactions: 'Reactions',
    speech: 'Speech',
};
const MODE = { advantage: 'Advantage', disadvantage: 'Disadvantage', autoFail: 'auto-fail', autoCrit: 'hits are Critical Hits', cant: "can't" };

/** "Your attack rolls: Disadvantage", "DEX saving throws: auto-fail", "Reactions: can't". */
export function flagLabel(m) {
    let target = TARGET[m.on];
    if (m.on === 'saves') target = m.ability ? `${ABBR(m.ability)} saving throws` : 'Saving throws';
    if (m.on === 'checks') target = m.ability ? `${ABBR(m.ability)} checks` : 'Ability checks';
    return { target: target ?? m.on, mode: MODE[m.mode] ?? m.mode };
}

/** One modifier as text — for the Conditions page and the editor preview. */
export function modifierText(m) {
    const per = m.perLevel ? ' per level' : '';
    const v = Number(m.value) || 0;
    switch (m.kind) {
        case 'speed':
            if ((m.op ?? 'add') === 'set') return `Speed ${v} ft.`;
            if (m.op === 'mul') return `Speed ×${v === 0.5 ? '½' : v}`;
            return `Speed ${SIGN(v)} ft.${per}`;
        case 'ac':
        case 'acBonus':
        case 'acMin':
            return m.op === 'min' || m.kind === 'acMin' ? `AC at least ${v}` : `AC ${SIGN(v)}`;
        case 'acBase':
            return `Base AC ${m.base}${m.ability ? ` + ${ABBR(m.ability)}` : ''}`;
        case 'd20':
            return `D20 Tests ${SIGN(v)}${per}`;
        case 'save':
            return `${m.ability ? `${ABBR(m.ability)} saving throws` : 'Saving throws'} ${SIGN(v)}`;
        case 'check':
            return `${m.skill ?? (m.ability ? `${ABBR(m.ability)} checks` : 'Ability checks')} ${SIGN(v)}`;
        case 'attack':
            return `Attack rolls ${SIGN(v)}`;
        case 'initiative':
            return `Initiative ${SIGN(v)}`;
        case 'damage':
            return `Weapon damage ${m.sign < 0 ? '−' : '+'}${m.dice}${m.type ? ` ${m.type}` : ''}`;
        case 'dice': {
            const on = {
                checks: m.skill ? (m.skill === '$choice' ? 'checks with the chosen skill' : SKILL_NAME[m.skill] ?? m.skill) : m.ability ? `${ABBR(m.ability)} checks` : 'ability checks',
                saves: m.ability ? `${ABBR(m.ability)} saving throws` : 'saving throws',
                attacks: 'your attack rolls',
                attacksAgainst: 'attack rolls against you',
                damageTaken: 'damage you take',
            }[m.on ?? 'checks'];
            return `${m.sign < 0 ? '−' : '+'}${m.dice} to ${on}`;
        }
        case 'hpMax':
            return `HP maximum ${SIGN(v)}`;
        case 'sense':
            return `${String(m.sense)[0].toUpperCase() + String(m.sense).slice(1)} ${m.range} ft.`;
        case 'die':
            return m.note ?? `die ×${m.multiply}`;
        case 'flag': {
            const l = flagLabel(m);
            return `${l.target}: ${l.mode}${m.note ? ` (${m.note})` : ''}`;
        }
        case 'resistance':
            return `Resistance to ${m.value === 'all' ? 'all damage' : `${m.value} damage`}`;
        case 'immunity':
            return `Immunity: ${m.value}`;
        case 'note':
            return m.note ?? '';
        case 'economy':
            return `${SIGN(v)} ${{ action: 'Action', bonus: 'Bonus Action', reaction: 'Reaction' }[m.action] ?? m.action} per turn`;
        default:
            return m.note ?? m.kind ?? '';
    }
}
