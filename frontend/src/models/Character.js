/**
 * Character — the DERIVED layer.
 *
 *   CharacterBuild  (player choices, build_json)
 *        +  reference data (species, classes, equipment from the DB)
 *        =  Character  (everything computed: AC, Hit Points, attacks, resources, spell slots…)
 *
 *   CharacterState  (current Hit Points, spent resources — state_json)
 *   is stored separately and relies on the maximums from Character.
 *
 * Character is NOT saved — it is always recomputed, so when the
 * reference data or rules change, the character updates itself.
 *
 * Resources are collected from feature grants:
 *   { "type": "resource", "id": "rage", "name": "Rage",
 *     "max": <formula, see rules/formula.js>,
 *     "recharge": "long" | "short" | "none",
 *     "shortRestRegain": 1            // optional: how many to regain on a Short Rest
 *   }
 */
import { computeSheet } from '../rules/sheet.js';
import { ABILITIES } from '../rules/abilities.js';
import { evalFormula, byLevelPairs } from '../rules/formula.js';
import { spellSlots } from '../rules/spellcasting.js';
import { dieAt } from '../rules/damage.js';
import { defaultEquipped, normalize, resolve } from '../rules/loadout.js';
import { summarizeChoices, spellcastingOf } from '../rules/progression.js';
import { collectPassives, normName, fillTemplate } from '../rules/passives.js';
import { isBodyArmor } from '../rules/equipment.js';
import { resolveConditions, conditionModifiers, inlineDef, rowName, modifierText } from '../rules/modifiers.js';

// feat and Fighting Style effects that the sheet accounts for (rules/sheet.js)
const PERKS = { tough: 'tough', alert: 'alert', defense: 'defense', archery: 'archery', dueling: 'dueling', twf: 'twf' };

/**
 * Max uses from an ability's uses field (v2 format):
 *   { count, scale: [[level, count], ...] }        — table
 *   { ability: 'cha', bonus?: 1, min?: 1 }         — modifier (+bonus)
 *   { perLevel: 5, abilityBonus?: 'int' }          — N × level (+ modifier)
 *   { pb: true }                                   — Proficiency Bonus
 */
export function usesMax(u, { level, prof, mods }) {
    let v;
    if (u.pb) v = prof;
    else if (u.perLevel) v = u.perLevel * level + (u.abilityBonus ? mods[u.abilityBonus] ?? 0 : 0);
    else if (u.ability) v = (mods[u.ability] ?? 0) + (u.bonus ?? 0);
    else if (u.scale) v = byLevelPairs(u.scale, level) || (u.count ?? 0);
    else v = u.count ?? 0;
    if (u.min != null) v = Math.max(u.min, v);
    return v;
}

const fmtMod = (n) => (n >= 0 ? `+${n}` : `${n}`);

/** The spell/ability requires Concentration (DB column, casting.concentration, or a "Conc." duration). */
export const isConcentration = (sp) =>
    !!(sp?.concentration || sp?.data?.casting?.concentration || /^conc/i.test(sp?.data?.casting?.duration ?? ''));

/** Constitution saving throw DC to keep Concentration after taking damage (PHB 2024: max 30). */
export const concentrationDC = (damage) => Math.min(30, Math.max(10, Math.floor(damage / 2)));

/** The three things a turn has (rules/modifiers.js 'economy' modifiers add to them). */
export const ECONOMY = [
    { id: 'action', name: 'Action', icon: 'action', flag: 'actions' },
    { id: 'bonus', name: 'Bonus Action', icon: 'bonus', flag: 'bonusActions' },
    { id: 'reaction', name: 'Reaction', icon: 'reaction', flag: 'reactions' },
];

/** '1d6' × 2 → '2d6' (a die count multiplier); anything else is returned as is. */
export function multiplyDice(d, k) {
    const m = /^(\d+)d(\d+)$/.exec(String(d ?? ''));
    return m && k !== 1 ? `${Number(m[1]) * k}d${m[2]}` : d;
}

const WEAPON_LABEL = { pact: 'pact weapon', melee: 'melee weapon', ranged: 'ranged weapon' };

/**
 * Attacks per Attack action.
 * @param features class + subclass features (already filtered by level)
 * @param feats    chosen feats / styles / invocations ({ name, data.effects, sourceTitle })
 * @returns {{ count, conditional: [{ count, label }], sources: [{ name, from, count, label }] }}
 *   count       — attacks with any weapon (1 without Extra Attack)
 *   conditional — higher counts that apply only to a specific weapon (Thirsting Blade)
 */
export function attacksPerAction(features = [], feats = []) {
    const isAttacks = (e) => e?.kind === 'set' && e.target === 'attacksPerAction' && Number(e.value) > 0;
    const sources = [];
    for (const f of features) {
        const effects = (f.grants ?? []).filter((g) => g.type === 'effect').map((g) => g.effect).filter(isAttacks);
        // homebrew without the grant: a feature named "Extra Attack" still means 2
        if (!effects.length && /^extra attack$/i.test(f.name ?? '')) effects.push({ value: 2 });
        for (const e of effects) sources.push({ name: f.name, desc: f.desc, count: Number(e.value), label: WEAPON_LABEL[e.when?.weapon] ?? e.when?.weapon ?? '' });
    }
    for (const f of feats) {
        for (const e of (f.effects ?? f.data?.effects ?? []).filter(isAttacks))
            sources.push({ name: f.name, desc: f.desc, from: f.sourceTitle, count: Number(e.value), label: WEAPON_LABEL[e.when?.weapon] ?? e.when?.weapon ?? '' });
    }
    const count = Math.max(1, ...sources.filter((s) => !s.label).map((s) => s.count));
    const best = new Map(); // label → the highest count for that weapon
    for (const s of sources) if (s.label && s.count > count && s.count > (best.get(s.label) ?? 0)) best.set(s.label, s.count);
    const conditional = [...best].map(([label, n]) => ({ count: n, label }));
    // only the sources that matter: the highest unconditional one + the conditional winners
    const used = sources.filter((s) => (s.label ? best.get(s.label) === s.count : s.count === count));
    return { count, conditional, sources: used };
}

/**
 * Spellcasting ability for species spells: data.spellAbility on the subspecies,
 * otherwise on the species. A string ('int') is fixed; an array (or nothing) means the
 * player chooses at level 1 (choice L1:race:spellAbility, see progression.js).
 */
export function speciesSpellAbility(race, subrace, build) {
    const def = subrace?.data?.spellAbility ?? race?.data?.spellAbility;
    if (typeof def === 'string') return def;
    return build.choices?.['L1:race:spellAbility']?.ids?.[0] ?? null;
}

export class Character {
    /**
     * @param build CharacterBuild (or its JSON object with the same fields)
     * @param refs  { races, classes, eq: { armor, weapons, packs } }
     * @param equipped loadout from CharacterState ({ main, off, armor }) or null —
     *                 then the default from the builder choices is used
     * @param bagAdjust CharacterState.bagAdjust — { [item key]: qty delta } or null
     * @param effects   CharacterState.effects — what is on the character now, or null:
     *                  spell/ability effects [{ id, name }] (what they do: the spell's data.apply,
     *                  e.g. Mage Armor → AC) and conditions [{ id, type: 'condition', level? }]
     *                  (refs.conditions; Prone, Exhaustion 2, Slowed…) — see rules/modifiers.js
     */
    constructor(build, refs = {}, equipped = null, bagAdjust = null, effects = null) {
        const races = refs.races ?? [];
        const classes = refs.classes ?? [];
        const eq = refs.eq ?? {};

        this.build = build;
        this.level = build.level ?? 1;

        // --- sources ---
        this.race = races.find((r) => r.id === build.raceId) ?? null;
        this.subrace = this.race?.subraces?.find((s) => s.id === build.subraceId) ?? null;
        this.cls = classes.find((c) => c.id === build.classId) ?? null;
        this.subclass = this.cls?.subclasses?.find((s) => s.id === build.subclassId) ?? null;

        // --- equipment ---
        const e = build.equipment ?? {};
        this.armor = (eq.armor ?? []).find((a) => a.id === e.armorId) ?? null;
        this.weapons = (eq.weapons ?? []).filter((w) => (e.weaponIds ?? []).includes(w.id));
        this.pack = (eq.packs ?? []).find((p) => p.id === e.packId) ?? null;
        this.shieldItem = e.shield
            ? (eq.armor ?? []).find((a) => a.category === 'shield') ?? null
            : null;

        // --- backpack: everything owned (armor, shield, weapons, pack items, granted) ---
        const catalog = refs.catalog ?? {};
        const pool = (list, extra) => [...(list ?? []), ...(extra ?? [])];
        const findIn = (kind, id) => {
            if (kind === 'weapon') return pool(catalog.weapons, eq.weapons).find((w) => w.id === id);
            if (kind === 'armor') return pool(catalog.armor, eq.armor).find((a) => a.id === id);
            return pool(catalog.items, eq.items).find((x) => x.id === id);
        };
        // clothes used to be items: an old { kind: 'item', id: 'robe' } grant now finds the armor record
        const legacyClothes = (b) =>
            b.kind === 'item' && !findIn('item', b.id) && findIn('armor', b.id) ? { ...b, kind: 'armor' } : b;
        const baseInventory = [
            ...(this.armor ? [{ key: `armor:${this.armor.id}`, kind: 'armor', name: this.armor.name, ref: this.armor, qty: 1 }] : []),
            ...(this.shieldItem ? [{ key: 'shield', kind: 'shield', name: this.shieldItem.name, ref: this.shieldItem, qty: 1 }] : []),
            ...this.weapons.map((w) => ({ key: `weapon:${w.id}`, kind: 'weapon', name: w.name, ref: w, qty: 1 })),
            ...(this.pack?.items ?? []).map((pi) => ({
                key: `item:${pi.item.id}`, kind: 'item', name: pi.item.name, ref: pi.item, qty: pi.qty,
            })),
        ];
        // clothes from the pack (armor table, category 'clothing'): wearable in the Armor slot
        for (const pa of this.pack?.armor ?? []) {
            const same = baseInventory.find((x) => x.kind === 'armor' && x.ref?.id === pa.armor.id);
            if (same) same.qty += pa.qty;
            else baseInventory.push({ key: `armor:${pa.armor.id}`, kind: 'armor', name: pa.armor.name, ref: pa.armor, qty: pa.qty });
        }
        // granted: identical items stack into one row with a quantity
        this.inventory = [...baseInventory];
        for (const raw of e.bag ?? []) {
            const b = legacyClothes(raw);
            const ref = findIn(b.kind, b.id);
            if (!ref) continue;
            const isShield = b.kind === 'armor' && ref.category === 'shield';
            const kind = isShield ? 'shield' : b.kind;
            const key = isShield ? (this.inventory.some((x) => x.key === 'shield') ? `shield:${ref.id}` : 'shield') : `${b.kind}:${ref.id}`;
            const same = this.inventory.find((x) => x.kind === kind && x.ref?.id === ref.id);
            if (same) same.qty += b.qty;
            else this.inventory.push({ key, kind, name: ref.name, ref, qty: b.qty, given: true });
        }
        // in-play changes from CharacterState.bagAdjust: +/- per row, 0 — thrown away
        this.inventory = this.inventory
            .map((it) => ({ ...it, qty: Math.min(1000, it.qty + (bagAdjust?.[it.key] ?? 0)) }))
            .filter((it) => it.qty > 0);

        // --- loadout: what's in hand and what's worn ---
        this.equipped = equipped
            ? normalize(equipped, this.inventory)
            : defaultEquipped(this.inventory);
        this.loadout = resolve(this.equipped, this.inventory);
        const hands = [
            { hand: 'main', item: this.loadout.main },
            { hand: 'off', item: this.loadout.off },
        ];

        // --- level choices: skills, feats, styles, spells ---
        this.chosen = summarizeChoices(build, refs);
        const perkIds = [...this.chosen.feats, ...this.chosen.fightingStyles];
        const perks = new Set(perkIds.map((id) => PERKS[id]).filter(Boolean));

        const wearing = isBodyArmor(this.loadout.armor?.ref); // clothing doesn't count

        // --- conditions (Prone, Grappled, Exhaustion…) and named effects (Slowed, Enlarged…) ---
        // immunities from species traits, class features and feats ({ kind: 'immunity', value: 'charmed' })
        const lvlOk = (f) => !f.level || f.level <= (build.level ?? 1);
        const immuneTo = new Set(
            [
                ...(this.race?.data?.traits ?? []), ...(this.subrace?.data?.traits ?? []),
                ...(this.cls?.data?.features ?? []), ...(this.subclass?.data?.features ?? []),
            ]
                .filter(lvlOk)
                .flatMap((f) => (f.grants ?? []).filter((g) => g.type === 'effect').map((g) => g.effect))
                .concat(
                    [...this.chosen.feats, ...this.chosen.invocations]
                        .map((id) => (refs.feats ?? []).find((f) => f.id === id))
                        .flatMap((f) => f?.data?.effects ?? []),
                )
                .filter((x) => x?.kind === 'immunity')
                .map((x) => x.value),
        );
        // + custom conditions that came with their definition (the DM's homebrew over the LAN)
        const known = new Set((refs.conditions ?? []).map((d) => d.id));
        this.conditionDefs = [
            ...(refs.conditions ?? []),
            ...(effects ?? []).filter((e) => e?.type === 'condition' && e.def && !known.has(e.id)).map((e) => inlineDef(e.def)),
        ];
        this.conditionImmune = immuneTo; // condition ids the character can't get
        this.conditions = resolveConditions(effects ?? [], this.conditionDefs, immuneTo);
        // Mage Armor & co. (only a base AC "without armor"): no effect while wearing armor
        for (const r of this.conditions) {
            const mods = (r.def.data ?? r.def).modifiers ?? [];
            if (wearing && mods.length && mods.every((m) => m.kind === 'acBase' && m.unarmored)) r.inactive = 'no effect while wearing armor';
        }
        // everything on the character as modifiers, each with its source (rules/modifiers.js)
        const modifiers = conditionModifiers(this.conditions);
        // spell effects that are on (Mage Armor, Bless, Guidance…) — the "Active effects" list;
        // other named effects (Slowed, Hasted…) are in the Effects grid
        this.activeEffects = this.conditions
            .filter((r) => r.explicit && (r.def.data ?? r.def).spell)
            .map((r) => {
                const d = r.def.data ?? r.def;
                return {
                    id: r.id,
                    name: rowName(r),
                    conc: !!r.instance?.conc,
                    duration: d.duration ?? '',
                    lines: conditionModifiers([{ ...r, inactive: null }]).map(modifierText).filter(Boolean),
                    inactive: r.inactive ?? '',
                    instance: r.instance,
                };
            });

        // --- sheet: AC, Hit Points, saving throws, skills, attacks ---
        Object.assign(
            this,
            computeSheet(build, {
                race: this.race,
                subrace: this.subrace,
                cls: this.cls,
                armor: this.loadout.armor?.ref ?? null,
                shield: hands.find((h) => h.item?.kind === 'shield')?.item?.ref ?? false,
                hands: hands
                    .filter((h) => h.item?.kind === 'weapon')
                    .map((h) => ({ hand: h.hand, weapon: h.item.ref })),
                skills: [...this.chosen.skills],
                expertise: [...this.chosen.expertise],
                perks,
                modifiers,
            }),
        );
        this.maxHp = this.hp;

        // --- action economy: Action, Bonus Action, Reaction per turn ---
        //   { kind: 'economy', action: 'action' | 'bonus' | 'reaction', value: +1 } — from conditions
        //   (Hasted: +1 action), spell effects and class/subclass feature grants (Thief: +1 Bonus Action);
        //   a "can't" flag (Incapacitated: actions, bonusActions, reactions) blocks it
        const featureEcon = [
            ...(this.cls?.data?.features ?? []).map((f) => [f, this.cls?.name]),
            ...(this.subclass?.data?.features ?? []).map((f) => [f, this.subclass?.name]),
        ]
            .filter(([f]) => lvlOk(f))
            .flatMap(([f]) =>
                (f.grants ?? [])
                    .filter((g) => g.type === 'effect' && g.effect?.kind === 'economy')
                    .map((g) => ({ ...g.effect, source: f.name })),
            );
        const econ = [...modifiers.filter((m) => m.kind === 'economy'), ...featureEcon];
        const blockedBy = (on) =>
            (this.effectSummary?.flags ?? [])
                .filter((f) => f.mode === 'cant' && f.on === on)
                .flatMap((f) => f.sources.map((s) => s.source));
        this.economy = ECONOMY.map((e) => {
            const extra = econ.filter((m) => m.action === e.id);
            const blocked = blockedBy(e.flag);
            return {
                ...e,
                count: Math.max(0, 1 + extra.reduce((n, m) => n + (Number(m.value) || 0), 0)),
                sources: extra.map((m) => m.source),
                blocked: blocked.length ? blocked : null,
            };
        });

        // --- features (up to the current level), grouped by source ---
        const upTo = (list) => (list ?? []).filter((f) => !f.level || f.level <= this.level);
        this.featureGroups = [
            { source: 'race', title: this.race?.name, items: upTo(this.race?.data?.traits) },
            { source: 'subrace', title: this.subrace?.name, items: upTo(this.subrace?.data?.traits) },
            { source: 'class', title: this.cls?.name, items: upTo(this.cls?.data?.features) },
            { source: 'subclass', title: this.subclass?.name, items: upTo(this.subclass?.data?.features) },
        ].filter((g) => g.title && g.items.length);

        // feats, Fighting Styles, invocations, Metamagic — as a separate group
        const feats = refs.feats ?? [];
        const byId = (id) => feats.find((f) => f.id === id);
        const chosenFeats = [
            ...this.chosen.feats, ...this.chosen.fightingStyles,
            ...this.chosen.invocations, ...this.chosen.metamagic,
        ].map(byId).filter(Boolean);
        this.feats = chosenFeats;
        if (chosenFeats.length) {
            this.featureGroups.push({
                source: 'feats',
                title: 'Feats and chosen features',
                items: chosenFeats.map((f) => ({ name: f.name, desc: f.desc })),
            });
        }

        const grants = this.featureGroups.flatMap((g) =>
            g.items.flatMap((f) => (f.grants ?? []).map((gr) => ({ ...gr, feature: f.name }))),
        );

        // --- abilities (spells table: kind = class | martial | action) ---
        //   class:    kind 'class', classes ∋ classId, no subclass, level ≤ character level
        //   subclass: subclass = subclassId, level ≤ character level
        //   species:  via trait grants { type: 'ability', id }
        const spells = refs.spells ?? [];
        const lvl = this.level;
        const raceAbilityIds = new Set(grants.filter((g) => g.type === 'ability').map((g) => g.id));
        // pool options chosen through species traits (choice keys L<n>:race:… / L<n>:subrace:…)
        const racePoolIds = new Set(
            Object.entries(build.choices ?? {})
                .filter(([k, c]) => /^L\d+:(race|subrace):/.test(k) && c?.kind === 'pool')
                .flatMap(([, c]) => c.ids ?? []),
        );
        this.powers = spells.filter((sp) => {
            if (sp.kind === 'spell') return false;
            const d = sp.data ?? {};
            if (raceAbilityIds.has(sp.id)) return true;
            // pool options (maneuvers, arcane shots) — only the chosen ones;
            // picked through a species trait they don't need the subclass
            if (d.pool) {
                if (!this.chosen.pool.includes(sp.id)) return false;
                if (racePoolIds.has(sp.id)) return true;
            }
            if (sp.level > lvl) return false;
            if (d.subclass) return d.subclass === build.subclassId && !!build.subclassId;
            return sp.kind === 'class' && (d.classes ?? []).includes(build.classId);
        });

        // --- resources ---
        //   1) from abilities with uses (Channel Divinity, Focus Points, Wild Shape…)
        //   2) from { type: 'resource' } grants in the data (for the future / homebrew)
        const ctx = { level: this.level, prof: this.prof, mods: this.mods };
        // data.resource — id of a shared resource: abilities with the same one form a single
        // pool (e.g. the Warrior Orc's Superiority Dice add to the Battle Master's)
        const fromUsesRaw = this.powers
            .filter((sp) => sp.data?.uses)
            .map((sp) => ({
                id: sp.data.resource ?? sp.id,
                name: sp.name,
                feature: sp.name,
                max: Math.max(0, usesMax(sp.data.uses, ctx)),
                recharge: sp.data.uses.per === 'shortRest' ? 'short' : 'long',
                shortRestRegain: null,
                die: dieAt(sp.data.scaleDie, this.level) || null,
            }));
        const DIE = (d) => Number(String(d ?? '').replace(/^\d*d/, '')) || 0;
        const fromUses = [];
        for (const r of fromUsesRaw) {
            const same = fromUses.find((x) => x.id === r.id);
            if (!same) fromUses.push(r);
            else {
                same.max += r.max;
                if (DIE(r.die) > DIE(same.die)) same.die = r.die;
                if (r.recharge === 'short') same.recharge = 'short';
            }
        }
        const fromGrants = grants
            .filter((g) => g.type === 'resource' && g.id)
            .map((g) => ({
                id: g.id,
                name: g.name ?? g.feature,
                feature: g.feature,
                max: Math.max(0, evalFormula(g.max, ctx)),
                recharge: g.recharge ?? 'long',
                shortRestRegain: g.shortRestRegain ?? null,
                die: g.die ?? null,
            }));
        const seen = new Set();
        this.resources = [...fromUses, ...fromGrants]
            .filter((r) => r.max > 0 && !seen.has(r.id) && seen.add(r.id));

        // --- spellcasting ---
        // class or subclass spellcasting (Eldritch Knight / Arcane Trickster)
        const sc = spellcastingOf(this.cls, this.subclass);
        const progression = sc?.progression ?? this.cls?.caster ?? 'none';
        this.spellcasting = sc
            ? {
                ability: sc.ability,
                progression,
                saveDC: 8 + this.prof + (this.mods[sc.ability] ?? 0),
                attack: this.prof + (this.mods[sc.ability] ?? 0),
            }
            : null;
        this.spellSlots = sc && this.level >= (sc.startLevel ?? 1) ? spellSlots(progression, this.level) : [];

        // --- known spells: chosen + fixed species grants ---
        const raceSpellIds = grants.filter((g) => g.type === 'spell' && g.id).map((g) => g.id);
        const spellIds = [...new Set([...this.chosen.cantrips, ...this.chosen.spells, ...raceSpellIds])];

        // species spells have their own spellcasting ability (see speciesSpellAbility):
        // fixed grants + spells chosen through species traits (choice keys L<n>:race:… / L<n>:subrace:…)
        const classSpellIds = new Set(
            Object.entries(build.choices ?? {})
                .filter(([k, c]) => !/^L\d+:(race|subrace):/.test(k) && ['cantrips', 'spells'].includes(c?.kind))
                .flatMap(([, c]) => c.ids ?? []),
        );
        const raceChosenIds = Object.entries(build.choices ?? {})
            .filter(([k, c]) => /^L\d+:(race|subrace):/.test(k) && ['cantrips', 'spells'].includes(c?.kind))
            .flatMap(([, c]) => c.ids ?? []);
        // a spell the class also grants is cast with the class ability
        this.raceSpellIds = new Set([...raceSpellIds, ...raceChosenIds].filter((id) => !classSpellIds.has(id)));
        const freeCastIds = new Set(
            grants.filter((g) => g.type === 'spell' && g.id && (g.level ?? 1) > 0).map((g) => g.id),
        );
        const rsa = speciesSpellAbility(this.race, this.subrace, build);
        this.raceSpellcasting = this.raceSpellIds.size
            ? {
                ability: rsa,
                saveDC: rsa ? 8 + this.prof + (this.mods[rsa] ?? 0) : null,
                attack: rsa ? this.prof + (this.mods[rsa] ?? 0) : null,
            }
            : null;
        this.spellbook = spellIds
            .map((id) => spells.find((sp) => sp.id === id))
            .filter(Boolean)
            .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

        // --- action and spell cards (groups for the sheet) ---
        const speciesName = this.subrace?.name ?? this.race?.name ?? 'Species';
        const withUses = (sp) =>
            sp.data?.uses ? { max: usesMax(sp.data.uses, ctx), per: sp.data.uses.per } : null;
        // descriptions with placeholders ({sporesHp}, {saveDc}…) get the character's numbers
        const tpl = { ...ctx, saveDC: this.spellcasting?.saveDC ?? null };
        this.tplCtx = tpl;
        const fill = (sp) => (sp?.desc && /\{\w+\}/.test(sp.desc) ? { ...sp, desc: fillTemplate(sp.desc, tpl) } : sp);
        // active effects that change a card's die (Symbiotic Entity: Halo of Spores ×2)
        const dieBoost = (sp) => {
            const fx = modifiers
                .filter((x) => x.kind === 'die' && [].concat(x.target ?? []).includes(sp.id))
                .map((x) => ({ ...x, from: x.source }));
            const base = fx.length ? dieAt(sp.data?.scaleDie, this.level) : null;
            if (!base) return null;
            const die = fx.reduce((d, x) => multiplyDice(d, Number(x.multiply) || 1), base);
            return { die, base, from: [...new Set(fx.map((x) => x.from))].join(', ') };
        };
        const card = (sp, source) => ({ item: fill(sp), source, uses: withUses(sp), boost: dieBoost(sp) });
        // spell card: species spells use the species ability for the DC and get a note
        const spellCard = (sp, title) => {
            if (!this.raceSpellIds.has(sp.id)) return { ...card(sp, title), saveDC: this.spellcasting?.saveDC ?? null };
            const rs = this.raceSpellcasting;
            const abil = rs?.ability ? ABILITIES[rs.ability]?.short : null;
            return {
                ...card(sp, `${title} · ${speciesName}`),
                saveDC: rs?.saveDC ?? null,
                note: [
                    abil ? `${abil} · DC ${rs.saveDC} · attack ${fmtMod(rs.attack)}` : 'choose a spellcasting ability',
                    freeCastIds.has(sp.id) ? 'free cast 1/Long Rest' : '',
                ].filter(Boolean).join(' · '),
            };
        };
        const isRace = (sp) => raceAbilityIds.has(sp.id) || racePoolIds.has(sp.id);
        const racePowers = this.powers.filter(isRace);
        const classPowers = this.powers.filter((sp) => !isRace(sp) && !sp.data?.subclass);
        const subPowers = this.powers.filter((sp) => !isRace(sp) && sp.data?.subclass);

        this.actionGroups = [
            { title: 'Class Actions', cards: classPowers.map((sp) => card(sp, this.cls?.name ?? 'Class')) },
            { title: this.subclass?.name ?? 'Subclass', cards: subPowers.map((sp) => card(sp, this.subclass?.name ?? '')) },
            { title: 'Species Abilities', cards: racePowers.map((sp) => card(sp, speciesName)) },
            { title: 'Metamagic', cards: this.chosen.metamagic.map(byId).filter(Boolean).map((f) => card(f, 'Metamagic')) },
        ];

        // spells granted by chosen invocations / feats (feat.data.grants { type: 'spell', id, atWill?, ritual?, note? }):
        // Armor of Shadows → Mage Armor at will, Pact of the Chain → Find Familiar as a Ritual…
        const grantCards = { invocation: [], other: [] };
        for (const f of chosenFeats) {
            for (const g of f.data?.grants ?? []) {
                if (g.type !== 'spell' || !g.id) continue;
                const sp = spells.find((s) => s.id === g.id);
                if (!sp) continue;
                const how = g.atWill ? 'at will, without a spell slot' : g.ritual ? 'as a Ritual' : '';
                const note = [how, g.note].filter(Boolean).join(' · ');
                const list = f.category === 'invocation' ? grantCards.invocation : grantCards.other;
                if (list.some((c) => c.item.id === sp.id)) continue;
                // free: at will (no slot); ritual: can be cast as a Ritual (rules/casting.js)
                list.push({ ...card(sp, f.name), saveDC: this.spellcasting?.saveDC ?? null, note, free: !!g.atWill, ritual: !!g.ritual });
            }
        }
        this.actionGroups.push(
            { title: 'Eldritch Invocations', spells: true, cards: grantCards.invocation },
            { title: 'Feat Spells', spells: true, cards: grantCards.other },
        );
        const byCircle = {};
        for (const sp of this.spellbook) (byCircle[sp.level] ??= []).push(sp);
        for (const c of Object.keys(byCircle).map(Number).sort((a, b) => a - b)) {
            const title = c === 0 ? 'Cantrips' : `Level ${c}`;
            this.actionGroups.push({ title, spells: true, cards: byCircle[c].map((sp) => spellCard(sp, title)) });
        }
        this.actionGroups = this.actionGroups.filter((g) => g.cards.length);

        // --- what the character can concentrate on: known spells, invocation/feat spells, abilities ---
        const seenConc = new Set();
        this.concentrationSpells = [
            ...this.spellbook,
            ...grantCards.invocation.map((c) => c.item),
            ...grantCards.other.map((c) => c.item),
            ...this.powers,
        ]
            .filter((sp) => isConcentration(sp) && !seenConc.has(sp.id) && seenConc.add(sp.id))
            .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

        // --- passive effects: resistances, senses, advantages + passive features ---
        // invocations live here (not in "Actions"): almost all of them are always on
        const FEAT_SOURCE = { origin: 'Feat', general: 'Feat', boon: 'Boon', fightingStyle: 'Fighting Style', invocation: 'Invocation' };
        const passiveFeats = [...this.chosen.feats, ...this.chosen.fightingStyles, ...this.chosen.invocations]
            .filter((id) => id !== 'abilityScoreImprovement') // on its own — only + to ability scores
            .map(byId)
            .filter(Boolean)
            .map((f) => ({ ...f, sourceTitle: FEAT_SOURCE[f.category] ?? 'Feat' }));
        this.passives = collectPassives({
            raceTraits: [...upTo(this.race?.data?.traits), ...upTo(this.subrace?.data?.traits)],
            raceName: speciesName,
            classFeatures: upTo(this.cls?.data?.features),
            className: this.cls?.name ?? 'Class',
            subclassFeatures: upTo(this.subclass?.data?.features),
            subclassName: this.subclass?.name ?? 'Subclass',
            feats: passiveFeats,
            activeNames: new Set([...this.powers, ...this.resources].map((x) => normName(x.name))),
            ctx,
        });

        // placeholders in feature texts too ({chaMod} in Aura of Protection, {level}…)
        const fillDesc = (f) => (f?.desc && /\{\w+\}/.test(f.desc) ? { ...f, desc: fillTemplate(f.desc, tpl) } : f);
        this.featureGroups = this.featureGroups.map((g) => ({ ...g, items: g.items.map(fillDesc) }));
        this.passives.abilities = this.passives.abilities.map(fillDesc);

        // --- attacks per Attack action ---
        //   class/subclass features: grant { type: 'effect', effect: { kind: 'set', target: 'attacksPerAction', value } }
        //   (Extra Attack → 2, Two Extra Attacks → 3…); invocations/feats: the same effect in their effects field.
        //   An effect with when.weapon (Thirsting Blade: pact weapon) counts only for that weapon.
        this.attackCount = attacksPerAction(
            [...upTo(this.cls?.data?.features), ...upTo(this.subclass?.data?.features)],
            passiveFeats,
        );
    }

    /** Resource by id. */
    resource(id) {
        return this.resources.find((r) => r.id === id) ?? null;
    }

    static resolve(build, refs) {
        return new Character(build, refs);
    }
}
