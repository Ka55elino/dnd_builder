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
import { collectPassives, normName } from '../rules/passives.js';

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
     */
    constructor(build, refs = {}, equipped = null, bagAdjust = null) {
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
        const baseInventory = [
            ...(this.armor ? [{ key: `armor:${this.armor.id}`, kind: 'armor', name: this.armor.name, ref: this.armor, qty: 1 }] : []),
            ...(this.shieldItem ? [{ key: 'shield', kind: 'shield', name: this.shieldItem.name, ref: this.shieldItem, qty: 1 }] : []),
            ...this.weapons.map((w) => ({ key: `weapon:${w.id}`, kind: 'weapon', name: w.name, ref: w, qty: 1 })),
            ...(this.pack?.items ?? []).map((pi) => ({
                key: `item:${pi.item.id}`, kind: 'item', name: pi.item.name, ref: pi.item, qty: pi.qty,
            })),
        ];
        // granted: identical items stack into one row with a quantity
        this.inventory = [...baseInventory];
        for (const b of e.bag ?? []) {
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
            }),
        );
        this.maxHp = this.hp;

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
        const card = (sp, source) => ({ item: sp, source, uses: withUses(sp) });
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
        const byCircle = {};
        for (const sp of this.spellbook) (byCircle[sp.level] ??= []).push(sp);
        for (const c of Object.keys(byCircle).map(Number).sort((a, b) => a - b)) {
            const title = c === 0 ? 'Cantrips' : `Level ${c}`;
            this.actionGroups.push({ title, spells: true, cards: byCircle[c].map((sp) => spellCard(sp, title)) });
        }
        this.actionGroups = this.actionGroups.filter((g) => g.cards.length);

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
    }

    /** Resource by id. */
    resource(id) {
        return this.resources.find((r) => r.id === id) ?? null;
    }

    static resolve(build, refs) {
        return new Character(build, refs);
    }
}
