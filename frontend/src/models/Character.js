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
 *     "shortRestRegain": 1,           // optional: how many to regain on a Short Rest
 *     "startEmpty": true              // optional: you start with none and gain them (data.gain) —
 *                                     // Phantom's Soul Trinkets; CharacterState keeps how many you hold
 *   }
 */
import { computeSheet, proficiencyBonus, trainingOf } from '../rules/sheet.js';
import { classEntries, classAt, classSummary } from '../rules/multiclass.js';
import { ABILITIES, ABILITY_KEYS } from '../rules/abilities.js';

/**
 * Ability scores + feature grants { type: 'effect', effect: { kind: 'bonus', target: 'str', value: 4, max: 25 } }.
 * The data's max (25) is deliberately NOT applied — house rule: no cap. Null scores stay null.
 */
export function withFeatureScores(base, features = []) {
    const out = { ...base };
    for (const f of features) {
        for (const g of f.grants ?? []) {
            const e = g.type === 'effect' ? g.effect : null;
            if (e?.kind !== 'bonus' || !ABILITY_KEYS.includes(e.target) || out[e.target] == null) continue;
            out[e.target] += Number(e.value) || 0;
        }
    }
    return out;
}
import { evalFormula, byLevelPairs } from '../rules/formula.js';
import { multiclassSlots } from '../rules/spellcasting.js';
import { dieAt } from '../rules/damage.js';
import { defaultEquipped, normalize, resolve, isTwoHanded, SLOTS, wearOf } from '../rules/loadout.js';
import { summarizeChoices, subclassSpellIds, castersOf } from '../rules/progression.js';
import { wildShapeAbility, formTempHp, formHours, formCost } from '../rules/wildshape.js';
import { collectPassives, normName, fillTemplate } from '../rules/passives.js';
import { isBodyArmor } from '../rules/equipment.js';
import { DAMAGE_TYPES } from '../rules/labels.js';
import { resolveConditions, conditionModifiers, inlineDef, rowName, modifierText } from '../rules/modifiers.js';

// feat and Fighting Style effects that the sheet accounts for (rules/sheet.js)
const PERKS = {
    tough: 'tough', alert: 'alert', defense: 'defense', archery: 'archery', dueling: 'dueling', twf: 'twf',
    mediumArmorMaster: 'mediumArmorMaster', // Dexterity up to +3 in Medium armor (rules/sheet.js)
};

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
    constructor(build, refs = {}, equipped = null, bagAdjust = null, effects = null, ammoSel = null) {
        const races = refs.races ?? [];
        const classes = refs.classes ?? [];
        const eq = refs.eq ?? {};

        this.build = build;
        this.level = build.level ?? 1;
        Object.defineProperty(this, 'refs', { value: refs, enumerable: false }); // for wildShapeInfo

        // --- sources ---
        this.race = races.find((r) => r.id === build.raceId) ?? null;
        this.subrace = this.race?.subraces?.find((s) => s.id === build.subraceId) ?? null;
        this.cls = classes.find((c) => c.id === build.classId) ?? null; // the primary class
        this.subclass = this.cls?.subclasses?.find((s) => s.id === build.subclassId) ?? null;
        // multiclassing: every class with its level and subclass, [0] — the primary one
        this.classList = classEntries(build)
            .map((e) => {
                const cls = classes.find((c) => c.id === e.classId) ?? null;
                return { cls, level: e.level, subclass: cls?.subclasses?.find((s) => s.id === e.subclassId) ?? null };
            })
            .filter((e) => e.cls);
        // class and subclass features each up to its own class level
        const clsFeatures = (e) => (e.cls.data?.features ?? []).filter((f) => !f.level || f.level <= e.level);
        const subFeatures = (e) => (e.subclass?.data?.features ?? []).filter((f) => !f.level || f.level <= e.level);
        this.classFeatures = this.classList.flatMap((e) => [...clsFeatures(e), ...subFeatures(e)]);
        const multi = this.classList.length > 1;
        // for headers / summary / PDF: "Fighter 3 / Wizard 2" (one class — its name), subclasses "Champion / Evoker"
        this.className = classSummary(build, refs) || (this.cls?.name ?? '');
        this.subclassName = this.classList.map((x) => x.subclass?.name).filter(Boolean).join(' / ');
        // the class with Wild Shape (multiclassing: not necessarily the primary one)
        const ws = this.classList.find((x) => wildShapeAbility(refs, x.cls.id));
        this.wildShapeLevel = ws?.level ?? 0;
        this.wildShapeSubclass = ws?.subclass ?? null;

        // --- equipment ---
        const e = build.equipment ?? {};
        this.armor = (eq.armor ?? []).find((a) => a.id === e.armorId) ?? null;
        this.clothing = e.clothingId && e.clothingId !== e.armorId ? (eq.armor ?? []).find((a) => a.id === e.clothingId) ?? null : null;
        // weaponIds repeats an id for several of the same weapon (2 daggers)
        const weaponQty = {};
        for (const id of e.weaponIds ?? []) weaponQty[id] = (weaponQty[id] ?? 0) + 1;
        this.weapons = (eq.weapons ?? []).filter((w) => weaponQty[w.id]);
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
            ...(this.clothing ? [{ key: `armor:${this.clothing.id}`, kind: 'armor', name: this.clothing.name, ref: this.clothing, qty: 1 }] : []),
            ...this.weapons.map((w) => ({ key: `weapon:${w.id}`, kind: 'weapon', name: w.name, ref: w, qty: weaponQty[w.id] })),
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
        // ammunition for the ranged weapons chosen in the builder (weapon data.ammo: 'arrow' | 'bolt' |
        // 'stone'): the plain kind (item data.ammo: { type, start: 20 }) — once per ammunition type
        const allItems = pool(catalog.items, eq.items);
        for (const type of new Set(this.weapons.map((w) => w.data?.ammo).filter(Boolean))) {
            const ref = allItems.find((x) => x.data?.ammo?.type === type && x.data.ammo.start);
            if (!ref) continue;
            const same = baseInventory.find((x) => x.kind === 'item' && x.ref?.id === ref.id);
            if (same) same.qty += ref.data.ammo.start;
            else baseInventory.push({ key: `item:${ref.id}`, kind: 'item', name: ref.name, ref, qty: ref.data.ammo.start });
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
        // worn wearables (gloves, boots, helmet, necklace, rings): their data.modifiers apply —
        // the same vocabulary as conditions (rules/modifiers.js), the item's name as the source
        this.wornItems = SLOTS.filter((s) => s.wear)
            .map((s) => this.loadout[s.id])
            .filter((it, i, all) => wearOf(it) && all.indexOf(it) === i); // a pair of one ring: once
        const itemModifiers = this.wornItems.flatMap((it) =>
            (it.ref?.data?.modifiers ?? []).map((m) => ({ ...m, source: it.name, from: 'item' })),
        );

        // --- level choices: skills, feats, styles, spells ---
        this.chosen = summarizeChoices(build, refs);
        const perkIds = [...this.chosen.feats, ...this.chosen.fightingStyles];
        const perks = new Set(perkIds.map((id) => PERKS[id]).filter(Boolean));

        const wearing = isBodyArmor(this.loadout.armor?.ref); // clothing doesn't count

        // --- feats: what was chosen for each (rules/progression.js featFollowUps) ---
        //   the key a feat was taken with (L4:class:feat, L1:background:feat, L1:race:feat:…) and its
        //   follow-ups: `${key}:asi` (which ability got the +1), `${key}:choice` (Elemental Adept's
        //   element), `${key}:spells` / `${key}:cantrips` (Fey-Touched, Ritual Caster, Spell Sniper)
        const featKeys = new Map(); // feat id → [choice key]
        const addFeatKey = (id, k) => (featKeys.get(id) ?? featKeys.set(id, []).get(id)).push(k);
        for (const [k, c] of Object.entries(build.choices ?? {})) if (c?.kind === 'feat') for (const id of c.ids ?? []) addFeatKey(id, k);
        const bgFeat = (refs.backgrounds ?? []).find((b) => b.id === build.backgroundId)?.feat;
        if (bgFeat) addFeatKey(bgFeat, 'L1:background:feat');
        const featFollow = (id, sub) => (featKeys.get(id) ?? []).flatMap((k) => build.choices?.[`${k}:${sub}`]?.ids ?? []);
        // the ability a feat raised (its +1): the feat's spellcasting ability, Inspiring Leader's numbers
        const featAbility = (f) => {
            for (const k of featKeys.get(f.id) ?? []) {
                const a = Object.keys(build.choices?.[`${k}:asi`]?.asi ?? {})[0];
                if (a) return a;
            }
            const opts = Array.isArray(f.data?.asi) ? f.data.asi : f.data?.asi?.options;
            return opts?.length === 1 ? opts[0] : null;
        };
        const featDefs = [...this.chosen.feats, ...this.chosen.fightingStyles, ...this.chosen.invocations]
            .map((id) => (refs.feats ?? []).find((f) => f.id === id))
            .filter(Boolean);
        // a feat's effects / modifiers apply only when (when: { shield: true } — a shield in hand,
        // { armor: 'heavy' | 'medium' } — that armor worn); '$choice' — its chosen option
        const heldShield = hands.find((h) => h.item?.kind === 'shield')?.item?.ref ?? null;
        const wornCat = wearing ? this.loadout.armor?.ref?.category : null;
        const whenOk = (w) => !w || ((!w.shield || !!heldShield) && (!w.armor || w.armor === wornCat));
        const prof0 = proficiencyBonus(build.level ?? 1);
        const featValue = (m) =>
            m.valueFrom === 'shield' ? Number(heldShield?.data?.acBonus) || 2 : m.valueFrom === 'prof' ? prof0 : m.value;
        const withFeatChoice = (m, f) => {
            const ch = featFollow(f.id, 'choice')[0];
            const out = {};
            for (const [k, v] of Object.entries(m)) {
                out[k] = typeof v === 'string' && v.includes('$choice') ? v.replaceAll('$choice', ch ? (DAMAGE_TYPES[ch]?.name ?? ch) : '…') : v;
            }
            return out;
        };
        // numbers a feat changes (data.modifiers, rules/modifiers.js): Speedy +10 ft., Shield Master DEX
        // saves, Sharpshooter damage, Observant passive Perception — next to items and conditions
        const featModifiers = featDefs.flatMap((f) =>
            (f.data?.modifiers ?? [])
                .filter((m) => whenOk(m.when))
                .map((m) => ({ ...withFeatChoice(m, f), value: featValue(m), source: f.name, from: 'feat' })),
        );
        // proficiencies a feat gives (data.proficiencies: { weapons: ['martial'], armor: ['heavy'] } —
        // Martial Weapon Training); with the classes' → this.training (Features & Traits)
        const featArmor = featDefs.flatMap((f) => f.data?.proficiencies?.armor ?? []);
        const featWeapons = featDefs.flatMap((f) => f.data?.proficiencies?.weapons ?? []);
        const training = trainingOf(this.classList, { armor: featArmor, weapons: featWeapons });
        // gear without training (PHB 2024): armor / a shield — Disadvantage on any D20 Test that uses
        // Strength or Dexterity, and no spellcasting; a weapon — no Proficiency Bonus to its attacks
        const untrained = [];
        const wornArmor = wearing ? this.loadout.armor?.ref : null;
        for (const g of [wornArmor && { ref: wornArmor, cat: wornArmor.category }, heldShield && { ref: heldShield, cat: 'shield' }]) {
            if (!g || training.armor.has(g.cat)) continue;
            const source = `${g.ref.name} (no training)`;
            for (const ability of ['str', 'dex']) {
                untrained.push({ kind: 'flag', mode: 'disadvantage', on: 'checks', ability, source, from: 'gear' });
                untrained.push({ kind: 'flag', mode: 'disadvantage', on: 'saves', ability, source, from: 'gear' });
            }
            untrained.push({ kind: 'flag', mode: 'disadvantage', on: 'attacks', note: 'Strength or Dexterity', source, from: 'gear' });
            untrained.push({ kind: 'note', note: "can't cast spells", source, from: 'gear' });
        }
        for (const h of hands) {
            const w = h.item?.kind === 'weapon' ? h.item.ref : null;
            if (!w || training.weapons.has(w.category) || training.weapons.has(w.id) || training.weapons.has(w.data?.base)) continue;
            untrained.push({ kind: 'note', note: `no Proficiency Bonus to attacks with ${w.name}`, source: `${w.name} (not proficient)`, from: 'gear' });
        }
        // what a feat shows among the passives (data.effects): the same conditions and '$choice'
        const featEffects = (f) =>
            (f.effects ?? f.data?.effects ?? []).filter((e) => whenOk(e.when)).map((e) => withFeatChoice(e, f));

        // --- conditions (Prone, Grappled, Exhaustion…) and named effects (Slowed, Enlarged…) ---
        // immunities from species traits, class features and feats ({ kind: 'immunity', value: 'charmed' })
        const lvlOk = (f) => !f.level || f.level <= (build.level ?? 1);

        // --- ability scores: the build's (base + origin + level choices) + class/subclass features
        //     (Primal Champion: STR / CON +4, Body and Mind: DEX / WIS +4), no cap ---
        this.scores = withFeatureScores(
            build.totalAbilities ?? build.abilities ?? {},
            this.classFeatures,
        );
        const immuneTo = new Set(
            [...(this.race?.data?.traits ?? []), ...(this.subrace?.data?.traits ?? [])]
                .filter(lvlOk)
                .concat(this.classFeatures)
                .flatMap((f) => (f.grants ?? []).filter((g) => g.type === 'effect').map((g) => g.effect))
                .concat(
                    [...this.chosen.feats, ...this.chosen.invocations]
                        .map((id) => (refs.feats ?? []).find((f) => f.id === id))
                        .flatMap((f) => f?.data?.effects ?? []),
                )
                .concat(itemModifiers) // Periapt of Proof against Poison: Poisoned
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
        // Shillelagh & co. (they change a weapon you hold): no effect without such a weapon in hand
        const held = hands.filter((h) => h.item?.kind === 'weapon').map((h) => h.item.ref);
        for (const r of this.conditions) {
            const mods = (r.def.data ?? r.def).modifiers ?? [];
            if (wearing && mods.length && mods.every((m) => m.kind === 'acBase' && m.unarmored)) r.inactive = 'no effect while wearing armor';
            const wm = mods.filter((m) => m.kind === 'weapon');
            if (wm.length && !held.some((w) => wm.some((m) => (m.weapons ?? []).some((id) => id === w?.id || id === (w?.data?.base ?? w?.base))))) {
                r.inactive = `no effect: hold a ${wm.flatMap((m) => m.weapons ?? []).map((id) => id[0].toUpperCase() + id.slice(1)).join(' or ')}`;
            }
        }
        // everything on the character as modifiers, each with its source (rules/modifiers.js)
        const modifiers = [...conditionModifiers(this.conditions), ...itemModifiers, ...featModifiers, ...untrained];
        // class/subclass features that add to an effect while it is on (Elemental Cleaver during Rage):
        //   grants: [{ type: 'while', condition: 'raging', modifiers: [...] }]
        const activeIds = new Set(this.conditions.filter((r) => !r.immune && !r.inactive).map((r) => r.id));
        for (const f of this.classFeatures) {
            for (const g of f.grants ?? []) {
                if (g.type !== 'while' || !activeIds.has(g.condition)) continue;
                for (const m of g.modifiers ?? []) modifiers.push({ ...m, source: f.name, from: 'condition' });
            }
        }
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
                scores: this.scores,
                race: this.race,
                subrace: this.subrace,
                cls: this.cls,
                classList: this.classList,
                levelClasses: build.levelClasses,
                extraArmor: featArmor,
                extraWeapons: featWeapons,
                // Resilient: proficiency in the saving throws of the ability it raised (data.saveProficiency: 'asi')
                extraSaves: featDefs.filter((f) => f.data?.saveProficiency === 'asi').map(featAbility).filter(Boolean),
                armor: this.loadout.armor?.ref ?? null,
                shield: hands.find((h) => h.item?.kind === 'shield')?.item?.ref ?? false,
                hands: hands
                    .filter((h) => h.item?.kind === 'weapon')
                    .map((h) => ({ hand: h.hand, weapon: h.item.ref })),
                // really empty: nothing in it and the other hand isn't holding a two-handed weapon
                emptyHands: hands
                    .filter((h) => !h.item && !hands.some((o) => o !== h && isTwoHanded(o.item)))
                    .map((h) => h.hand),
                skills: [...this.chosen.skills],
                expertise: [...this.chosen.expertise],
                perks,
                modifiers,
                spellAbility: castersOf(build, refs)[0]?.sc.ability ?? null, // the first spellcasting class
            }),
        );
        this.maxHp = this.hp;

        // --- ammunition: a ranged weapon that shoots it (data.ammo, or its base weapon's) gets
        //   attack.ammo = { type, options: [{ key, name, qty }], key, name, qty } — what's in the backpack
        //   for it and which one is loaded (ammoSel[weapon id], or the first); special ammunition adds its
        //   data.extraDamage to the attack (Poison Arrows: +1d4 Poison)
        const weaponRefs = pool(catalog.weapons, eq.weapons);
        const ammoTypeOf = (w) => w?.data?.ammo ?? weaponRefs.find((x) => x.id === w?.data?.base)?.data?.ammo ?? null;
        for (const a of this.attacks ?? []) {
            const w = hands.find((h) => h.hand === a.hand)?.item?.ref;
            const type = w?.id === a.id ? ammoTypeOf(w) : null;
            if (!type) continue;
            const options = this.inventory.filter((it) => it.kind === 'item' && it.ref?.data?.ammo?.type === type);
            const sel = options.find((o) => o.key === ammoSel?.[a.id]) ?? options[0] ?? null;
            a.ammo = {
                type,
                options: options.map((o) => ({ key: o.key, name: o.name, qty: o.qty })),
                key: sel?.key ?? null,
                name: sel?.name ?? null,
                qty: sel?.qty ?? 0,
            };
            const extra = (sel?.ref?.data?.extraDamage ?? []).filter((x) => x?.dice).map((x) => ({ ...x, source: sel.name }));
            if (extra.length) a.extra = [...(a.extra ?? []), ...extra];
            if (!sel) a.note = [a.note, 'no ammunition'].filter(Boolean).join(' · ');
        }

        // --- action economy: Action, Bonus Action, Reaction per turn ---
        //   { kind: 'economy', action: 'action' | 'bonus' | 'reaction', value: +1 } — from conditions
        //   (Hasted: +1 action), spell effects and class/subclass feature grants (Thief: +1 Bonus Action);
        //   a "can't" flag (Incapacitated: actions, bonusActions, reactions) blocks it
        const featureEcon = this.classFeatures
            .flatMap((f) =>
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
        // level — for templates in the texts ({level}: the class level for class features)
        this.featureGroups = [
            { source: 'race', title: this.race?.name, items: upTo(this.race?.data?.traits), level: this.level },
            { source: 'subrace', title: this.subrace?.name, items: upTo(this.subrace?.data?.traits), level: this.level },
            ...this.classList.flatMap((e) => [
                { source: 'class', classId: e.cls.id, title: multi ? `${e.cls.name} ${e.level}` : e.cls.name, items: clsFeatures(e), level: e.level },
                { source: 'subclass', classId: e.cls.id, title: e.subclass?.name, items: subFeatures(e), level: e.level },
            ]),
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
            g.items.flatMap((f) => (f.grants ?? []).map((gr) => ({ ...gr, feature: f.name, lvl: g.level ?? this.level }))),
        );

        // --- abilities (spells table: kind = class | martial | action) ---
        //   class:    kind 'class', classes ∋ one of the character's classes, level ≤ that class level
        //   subclass: subclass = one of the chosen subclasses, level ≤ that class level
        //   species:  via trait grants { type: 'ability', id }
        const spells = refs.spells ?? [];
        const lvl = this.level;
        const raceAbilityIds = new Set(grants.filter((g) => g.type === 'ability').map((g) => g.id));
        // abilities a chosen feat grants (feat.data.grants { type: 'ability', id } — Charger: Charge
        // Attack): ability id → the feat's name (the card's source)
        const featAbilityOf = new Map();
        for (const f of chosenFeats)
            for (const g of f.data?.grants ?? []) if (g.type === 'ability' && g.id && !featAbilityOf.has(g.id)) featAbilityOf.set(g.id, f);
        // pool options chosen through species traits (choice keys L<n>:race:… / L<n>:subrace:…)
        const racePoolIds = new Set(
            Object.entries(build.choices ?? {})
                .filter(([k, c]) => /^L\d+:(race|subrace):/.test(k) && c?.kind === 'pool')
                .flatMap(([, c]) => c.ids ?? []),
        );
        // the class an ability belongs to (the highest level one if it's on several classes' lists)
        const ownerOf = (sp) => {
            const d = sp.data ?? {};
            if (d.subclass) return this.classList.find((e) => e.subclass?.id === d.subclass) ?? null;
            if (sp.kind !== 'class') return null;
            return this.classList
                .filter((e) => (d.classes ?? []).includes(e.cls.id))
                .reduce((a, e) => (!a || e.level > a.level ? e : a), null);
        };
        const powerOwner = new Map(); // ability id → class entry (species abilities — none)
        this.powers = spells.filter((sp) => {
            if (sp.kind === 'spell') return false;
            const d = sp.data ?? {};
            if (raceAbilityIds.has(sp.id) || featAbilityOf.has(sp.id)) return true;
            // pool options (maneuvers, arcane shots) — only the chosen ones;
            // picked through a species trait they don't need the subclass
            if (d.pool) {
                if (!this.chosen.pool.includes(sp.id)) return false;
                if (racePoolIds.has(sp.id)) return true;
            }
            const owner = ownerOf(sp);
            if (sp.level > (owner?.level ?? lvl)) return false;
            // with: '<pool option id>' — only if that option is chosen (a rune's invocation comes with the rune);
            // showWhile: '<condition id>' — only while that effect is on (the rune is inscribed)
            if (d.with && !this.chosen.pool.includes(d.with)) return false;
            if (d.showWhile && !this.conditions.some((r) => r.id === d.showWhile && !r.immune)) return false;
            if (!owner) return false;
            powerOwner.set(sp.id, owner);
            return true;
        });
        // the level an ability scales with: its class level (species abilities — the character level)
        const lvlFor = (sp) => powerOwner.get(sp?.id)?.level ?? this.level;
        this.powerLevel = Object.fromEntries([...powerOwner].map(([id, e]) => [id, e.level])); // rules/casting.js

        // --- resources ---
        //   1) from abilities with uses (Channel Divinity, Focus Points, Wild Shape…)
        //   2) from { type: 'resource' } grants in the data (for the future / homebrew)
        const ctx = { level: this.level, prof: this.prof, mods: this.mods };
        const ctxFor = (sp) => ({ ...ctx, level: lvlFor(sp) });
        // data.resource — id of a shared resource: abilities with the same one form a single
        // pool (e.g. the Warrior Orc's Superiority Dice add to the Battle Master's)
        const fromUsesRaw = this.powers
            .filter((sp) => sp.data?.uses)
            .map((sp) => ({
                id: sp.data.resource ?? sp.id,
                name: sp.name,
                feature: sp.name,
                max: Math.max(0, usesMax(sp.data.uses, ctxFor(sp))),
                recharge: sp.data.uses.per === 'shortRest' ? 'short' : 'long',
                shortRestRegain: sp.data.uses.shortRestRegain ?? null, // Wild Shape: one back on a Short Rest
                die: dieAt(sp.data.scaleDie, lvlFor(sp)) || null,
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
                max: Math.max(0, evalFormula(g.max, { ...ctx, level: g.lvl })),
                recharge: g.recharge ?? 'long',
                shortRestRegain: g.shortRestRegain ?? null,
                die: g.die ?? null,
                startEmpty: !!g.startEmpty,
            }));
        const seen = new Set();
        this.resources = [...fromUses, ...fromGrants]
            .filter((r) => r.max > 0 && !seen.has(r.id) && seen.add(r.id));

        // --- spellcasting ---
        // class or subclass spellcasting (Eldritch Knight / Arcane Trickster), one per class:
        // each has its own ability, DC and attack; the slots are shared (multiclassSlots)
        const casters = castersOf(build, refs);
        this.spellcastings = casters.map((c) => ({
            classId: c.classId,
            name: c.cls.data?.spellcasting ? c.cls.name : c.subclass?.name ?? c.cls.name,
            ability: c.sc.ability,
            progression: c.progression,
            level: c.level,
            saveDC: 8 + this.prof + (this.mods[c.sc.ability] ?? 0),
            attack: this.prof + (this.mods[c.sc.ability] ?? 0),
        }));
        this.spellcasting = this.spellcastings[0] ?? null; // the first one (summons, templates)
        this.spellSlots = multiclassSlots(casters, this.level);

        // --- known spells: chosen + fixed species grants ---
        const raceSpellIds = grants.filter((g) => g.type === 'spell' && g.id).map((g) => g.id);
        // which class a spell is cast with: chosen at a level → the class of that level;
        // Domain / Oath / Patron / Circle spells → the subclass's class
        const spellOwner = new Map();
        for (const [k, c] of Object.entries(build.choices ?? {})) {
            const m = /^L(\d+):(class|subclass):/.exec(k);
            if (!m || !['cantrips', 'spells'].includes(c?.kind)) continue;
            const owner = classAt(build, Number(m[1]));
            for (const id of c.ids ?? []) if (owner && !spellOwner.has(id)) spellOwner.set(id, owner);
        }
        // Domain / Oath / Patron / Circle spells: always prepared, cast with the class ability
        this.subclassSpellIds = new Set();
        const subclassOfSpell = new Map();
        for (const e of this.classList) {
            for (const { id } of subclassSpellIds(e.subclass, e.cls, e.level)) {
                this.subclassSpellIds.add(id);
                subclassOfSpell.set(id, e.subclass);
                spellOwner.set(id, e.cls.id);
            }
        }
        // feat spells (data.spells: { fixed: [ids], choose: {…} } — Fey-Touched, Shadow-Touched,
        // Ritual Caster, Spell Sniper, Telekinetic): cast with the ability the feat raised, shown under
        // "Feat Spells" — not in the class's spellbook. featSpellsOf: [{ feat, ability, sp, fixed }]
        const featSpellKeys = new Set();
        const featSpellsOf = [];
        for (const f of featDefs) {
            const fs = f.data?.spells;
            if (!fs) continue;
            for (const k of featKeys.get(f.id) ?? []) featSpellKeys.add(`${k}:spells`).add(`${k}:cantrips`);
            // more picks later, as the Proficiency Bonus grows (Ritual Caster): L<n>:feat:<id>:spells
            const later = Object.keys(build.choices ?? {}).filter((k) => k.startsWith('L') && k.endsWith(`:feat:${f.id}:spells`) && /^L\d+:feat:/.test(k));
            for (const k of later) featSpellKeys.add(k);
            const ability = featAbility(f);
            const fixed = (fs.fixed ?? []).map((id) => ({ id, fixed: true }));
            const chosen = [...featFollow(f.id, 'cantrips'), ...featFollow(f.id, 'spells'), ...later.flatMap((k) => build.choices[k]?.ids ?? [])]
                .map((id) => ({ id, fixed: false }));
            for (const x of [...fixed, ...chosen]) {
                const sp = spells.find((s) => s.id === x.id);
                if (sp) featSpellsOf.push({ feat: f, ability, sp, fixed: x.fixed, ritual: !!fs.choose?.ritual && !x.fixed });
            }
        }
        const featChosenSpellIds = new Set(
            [...featSpellKeys].flatMap((k) => build.choices?.[k]?.ids ?? []),
        );
        const spellIds = [...new Set([...this.chosen.cantrips, ...this.chosen.spells, ...this.subclassSpellIds, ...raceSpellIds])]
            .filter((id) => !featChosenSpellIds.has(id));

        // species spells have their own spellcasting ability (see speciesSpellAbility):
        // fixed grants + spells chosen through species traits (choice keys L<n>:race:… / L<n>:subrace:…)
        const classSpellIds = new Set(
            Object.entries(build.choices ?? {})
                .filter(([k, c]) => !/^L\d+:(race|subrace):/.test(k) && !featSpellKeys.has(k) && ['cantrips', 'spells'].includes(c?.kind))
                .flatMap(([, c]) => c.ids ?? []),
        );
        const raceChosenIds = Object.entries(build.choices ?? {})
            .filter(([k, c]) => /^L\d+:(race|subrace):/.test(k) && ['cantrips', 'spells'].includes(c?.kind))
            .flatMap(([, c]) => c.ids ?? []);
        for (const id of this.subclassSpellIds) classSpellIds.add(id);
        // a spell the class also grants is cast with the class ability
        this.raceSpellIds = new Set([...raceSpellIds, ...raceChosenIds].filter((id) => !classSpellIds.has(id)));
        // Magic Initiate (its spells go to the spellbook — rules/progression.js): spell id → the feat
        const magicInitiateOf = new Map();
        for (const id of featKeys.keys()) {
            if (!/^magicInitiate/.test(id)) continue;
            const f = (refs.feats ?? []).find((x) => x.id === id);
            if (f) for (const sid of featFollow(id, 'spells')) magicInitiateOf.set(sid, f);
        }
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
            sp.data?.uses ? { max: usesMax(sp.data.uses, ctxFor(sp)), per: sp.data.uses.per } : null;
        // descriptions with placeholders ({sporesHp}, {saveDc}…) get the character's numbers
        // ({level} — the level of the ability's class)
        const tpl = { ...ctx, saveDC: this.spellcasting?.saveDC ?? null };
        this.tplCtx = tpl;
        // a feat's ability card: the ability the feat raised ({featDc}, {levelPlusFeatMod} — Telekinetic
        // shove DC, Inspiring Leader's Temporary Hit Points)
        const featCtx = (sp) => {
            const f = featAbilityOf.get(sp?.id);
            const a = f && featAbility(f);
            return a ? { featMod: this.mods[a] ?? 0, featDc: 8 + this.prof + (this.mods[a] ?? 0) } : {};
        };
        const fill = (sp) =>
            sp?.desc && /\{\w+\}/.test(sp.desc) ? { ...sp, desc: fillTemplate(sp.desc, { ...tpl, level: lvlFor(sp), ...featCtx(sp) }) } : sp;
        // active effects that change a card's die (Symbiotic Entity: Halo of Spores ×2)
        const dieBoost = (sp) => {
            const fx = modifiers
                .filter((x) => x.kind === 'die' && [].concat(x.target ?? []).includes(sp.id))
                .map((x) => ({ ...x, from: x.source }));
            const base = fx.length ? dieAt(sp.data?.scaleDie, lvlFor(sp)) : null;
            if (!base) return null;
            const die = fx.reduce((d, x) => multiplyDice(d, Number(x.multiply) || 1), base);
            return { die, base, from: [...new Set(fx.map((x) => x.from))].join(', ') };
        };
        const card = (sp, source) => ({ item: fill(sp), source, uses: withUses(sp), boost: dieBoost(sp) });
        // spell card: species spells use the species ability for the DC and get a note
        const spellCard = (sp, title) => {
            if (!this.raceSpellIds.has(sp.id)) {
                const sub = this.subclassSpellIds.has(sp.id) && subclassOfSpell.get(sp.id);
                // multiclassing: the spell's class — its DC and attack
                const sc = this.spellcastings.find((x) => x.classId === spellOwner.get(sp.id)) ?? this.spellcasting;
                const abil = sc && this.spellcastings.length > 1 ? ABILITIES[sc.ability]?.short : null;
                const note = [
                    sub ? (sp.level > 0 ? 'always prepared' : 'from the subclass') : '',
                    abil ? `${sc.name}: ${abil} · DC ${sc.saveDC} · attack ${fmtMod(sc.attack)}` : '',
                ].filter(Boolean).join(' · ');
                // Magic Initiate's level 1 spell: once per Long Rest without a slot (see card.freeCast)
                const mi = sp.level > 0 && magicInitiateOf.get(sp.id);
                return {
                    ...card(sp, sub ? `${title} · ${sub.name}` : title),
                    saveDC: sc?.saveDC ?? null,
                    ...(mi ? { freeCast: { id: `free:${mi.id}:${sp.id}`, name: `${sp.name} (${mi.name})`, max: 1, recharge: 'long' } } : {}),
                    ...(note || mi ? { note: [note, mi ? `${mi.name}: free cast 1/Long Rest` : ''].filter(Boolean).join(' · ') } : {}),
                };
            }
            const rs = this.raceSpellcasting;
            const abil = rs?.ability ? ABILITIES[rs.ability]?.short : null;
            // level 1+ species spell: once per Long Rest without a slot — a 1-use counter on the card
            // (the same as feat spells, see card.freeCast below)
            const free = freeCastIds.has(sp.id) && sp.level > 0;
            return {
                ...card(sp, `${title} · ${speciesName}`),
                saveDC: rs?.saveDC ?? null,
                freeCast: free ? { id: `free:species:${sp.id}`, name: `${sp.name} (${speciesName})`, max: 1, recharge: 'long' } : null,
                note: [
                    abil ? `${abil} · DC ${rs.saveDC} · attack ${fmtMod(rs.attack)}` : 'choose a spellcasting ability',
                    free ? 'free cast 1/Long Rest' : '',
                ].filter(Boolean).join(' · '),
            };
        };
        const isRace = (sp) => raceAbilityIds.has(sp.id) || racePoolIds.has(sp.id);
        const isFeat = (sp) => featAbilityOf.has(sp.id) && !isRace(sp);
        const racePowers = this.powers.filter(isRace);
        const featPowers = this.powers.filter(isFeat);
        const classPowers = this.powers.filter((sp) => !isRace(sp) && !isFeat(sp) && !sp.data?.subclass);
        const subPowers = this.powers.filter((sp) => !isRace(sp) && !isFeat(sp) && sp.data?.subclass);

        const subNames = [...new Set(subPowers.map((sp) => powerOwner.get(sp.id)?.subclass?.name).filter(Boolean))];
        this.actionGroups = [
            { title: 'Class Actions', cards: classPowers.map((sp) => card(sp, powerOwner.get(sp.id)?.cls.name ?? this.cls?.name ?? 'Class')) },
            { title: subNames.join(' / ') || 'Subclass', cards: subPowers.map((sp) => card(sp, powerOwner.get(sp.id)?.subclass?.name ?? '')) },
            { title: 'Species Abilities', cards: racePowers.map((sp) => card(sp, speciesName)) },
            { title: 'Feat Abilities', cards: featPowers.map((sp) => card(sp, featAbilityOf.get(sp.id).name)) },
            { title: 'Metamagic', cards: this.chosen.metamagic.map(byId).filter(Boolean).map((f) => card(f, 'Metamagic')) },
        ];

        // spells granted by chosen invocations / feats (feat.data.grants { type: 'spell', id, atWill?, ritual?, perLongRest?, note? }):
        // Armor of Shadows → Mage Armor at will, Pact of the Chain → Find Familiar as a Ritual…
        const grantCards = { invocation: [], other: [] };
        for (const f of chosenFeats) {
            for (const g of f.data?.grants ?? []) {
                if (g.type !== 'spell' || !g.id) continue;
                const sp = spells.find((s) => s.id === g.id);
                if (!sp) continue;
                const how = g.atWill ? 'at will, without a spell slot' : g.ritual ? 'as a Ritual' : g.perLongRest ? 'free cast 1/Long Rest' : '';
                const note = [how, g.note].filter(Boolean).join(' · ');
                const list = f.category === 'invocation' ? grantCards.invocation : grantCards.other;
                if (list.some((c) => c.item.id === sp.id)) continue;
                // free: at will (no slot); ritual: can be cast as a Ritual (rules/casting.js)
                // perLongRest: n — cast n times per Long Rest without a slot (Gift of the Depths), see card.freeCast
                const freeCast = g.perLongRest && !g.atWill
                    ? { id: `free:${f.id}:${sp.id}`, name: `${sp.name} (${f.name})`, max: Number(g.perLongRest) || 1, recharge: 'long' }
                    : null;
                list.push({ ...card(sp, f.name), saveDC: this.spellcasting?.saveDC ?? null, note, free: !!g.atWill, freeCast, ritual: !!g.ritual });
            }
        }
        // feat spells (see featSpellsOf): the feat's ability, DC and attack; Ritual Caster's — Rituals.
        // A level 1+ spell that's fixed, or any spell of a feat with spells.free (Fey-Touched,
        // Shadow-Touched), is also cast once per Long Rest without a slot: card.freeCast — a 1-use
        // counter kept on the card only (not in Resources), spent from the slot dropdown (rules/casting.js);
        // CharacterState.longRest resets it with the other resources
        for (const x of featSpellsOf) {
            if (grantCards.other.some((c) => c.item.id === x.sp.id)) continue;
            const a = x.ability;
            const dc = a ? 8 + this.prof + (this.mods[a] ?? 0) : null;
            const freeCast = x.sp.level > 0 && (x.fixed || x.feat.data?.spells?.free)
                ? { id: `free:${x.feat.id}:${x.sp.id}`, name: `${x.sp.name} (${x.feat.name})`, max: 1, recharge: 'long' }
                : null;
            const note = [
                a ? `${ABILITIES[a]?.short ?? a} · DC ${dc} · attack ${fmtMod(this.prof + (this.mods[a] ?? 0))}` : 'choose the feat\'s ability',
                freeCast ? 'free cast 1/Long Rest' : '',
                x.ritual ? 'as a Ritual' : '',
            ].filter(Boolean).join(' · ');
            grantCards.other.push({ ...card(x.sp, x.feat.name), saveDC: dc, note, free: false, freeCast, ritual: x.ritual });
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

        // feats that add forms to a summon (Pact of the Chain: imp, pseudodragon… for Find Familiar)
        const moreForms = {};
        for (const f of chosenFeats)
            for (const [id, list] of Object.entries(f.data?.summonOptions ?? {})) (moreForms[id] ??= []).push(...list);
        if (Object.keys(moreForms).length) {
            for (const g of this.actionGroups) {
                g.cards = g.cards.map((c) => {
                    const sm = c.item?.data?.summon;
                    const extra = moreForms[c.item?.id];
                    if (!sm || !extra) return c;
                    const options = [...new Set([...(sm.options ?? []), ...extra])];
                    return { ...c, item: { ...c.item, data: { ...c.item.data, summon: { ...sm, options } } } };
                });
            }
        }

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
            // effects: only those that apply now (Heavy Armor Master — in Heavy armor), '$choice' filled in
            .map((f) => ({ ...f, sourceTitle: FEAT_SOURCE[f.category] ?? 'Feat', effects: featEffects(f) }));
        this.passives = collectPassives({
            raceTraits: [...upTo(this.race?.data?.traits), ...upTo(this.subrace?.data?.traits)],
            raceName: speciesName,
            classGroups: this.classList.flatMap((e) => [
                { features: clsFeatures(e), name: e.cls.name, level: e.level },
                { features: subFeatures(e), name: e.subclass?.name ?? 'Subclass', level: e.level },
            ]),
            feats: passiveFeats,
            activeNames: new Set([...this.powers, ...this.resources].map((x) => normName(x.name))),
            ctx,
        });

        // placeholders in feature texts too ({chaMod} in Aura of Protection, {level}…)
        const fillDesc = (f, level) =>
            f?.desc && /\{\w+\}/.test(f.desc) ? { ...f, desc: fillTemplate(f.desc, { ...tpl, level: level ?? this.level }) } : f;
        this.featureGroups = this.featureGroups.map((g) => ({ ...g, items: g.items.map((f) => fillDesc(f, g.level)) }));
        this.passives.abilities = this.passives.abilities.map((a) => fillDesc(a, a.ctxLevel));

        // Darkvision from class/subclass features and feats (Umbral Sight, Eyes of the Dark,
        // Devil's Sight) — the sheet itself counts only species traits and active effects
        const dv = this.passives.effects
            .find((g) => g.id === 'sense')
            ?.items.find((l) => l.key === 'sense:darkvision')?.range;
        if (Number(dv) > (this.darkvision ?? 0)) this.darkvision = Number(dv);

        // --- attacks per Attack action ---
        //   class/subclass features: grant { type: 'effect', effect: { kind: 'set', target: 'attacksPerAction', value } }
        //   (Extra Attack → 2, Two Extra Attacks → 3…); invocations/feats: the same effect in their effects field.
        //   An effect with when.weapon (Thirsting Blade: pact weapon) counts only for that weapon.
        // Extra Attack from several classes doesn't stack: attacksPerAction takes the highest
        this.attackCount = attacksPerAction(this.classFeatures, passiveFeats);
    }

    /**
     * Wild Shape: the forms this character knows (links refs.wildShapeForms, in short — the stat
     * block is the bestiary's) and the numbers of a transformation; null if the class has none.
     *   { forms: [form], resource, tempHp, hours, cost(form) }
     */
    get wildShapeInfo() {
        // the class that has Wild Shape (multiclassing: not necessarily the primary one), by its level
        const e = (this.classList ?? []).find((x) => wildShapeAbility(this.refs, x.cls.id));
        const ab = e && wildShapeAbility(this.refs, e.cls.id);
        if (!ab || e.level < (ab.level ?? 2)) return null;
        const known = new Set(this.chosen.wildShapeForms ?? []);
        const forms = (this.refs?.wildShapeForms ?? []).filter(
            (f) => known.has(f.monsterId) && f.classId === e.cls.id && (!f.subclassId || f.subclassId === e.subclass?.id),
        );
        const seen = new Set();
        return {
            forms: forms.filter((f) => !seen.has(f.monsterId) && seen.add(f.monsterId)),
            resource: this.resource(ab.data?.resource ?? ab.id),
            tempHp: formTempHp(this.refs, e.cls.id, e.subclass, e.level),
            hours: formHours(e.level),
            cost: (f) => formCost(f, e.subclass),
        };
    }

    /** Resource by id. */
    resource(id) {
        return this.resources.find((r) => r.id === id) ?? null;
    }

    static resolve(build, refs) {
        return new Character(build, refs);
    }
}
