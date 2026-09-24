/**
 * Character — ПРОИЗВОДНЫЙ слой.
 *
 *   CharacterBuild  (выбор игрока, build_json)
 *        +  справочники (расы, классы, снаряжение из БД)
 *        =  Character  (всё посчитанное: КД, хиты, атаки, ресурсы, ячейки…)
 *
 *   CharacterState  (текущие хиты, потраченные ресурсы — state_json)
 *   хранится отдельно и опирается на максимумы из Character.
 *
 * Character НЕ сохраняется — он всегда пересчитывается, поэтому при
 * изменении справочников или правил персонаж обновляется сам.
 *
 * Ресурсы собираются из грантов умений:
 *   { "type": "resource", "id": "rage", "name": "Ярость",
 *     "max": <формула, см. rules/formula.js>,
 *     "recharge": "long" | "short" | "none",
 *     "shortRestRegain": 1            // необязательно: сколько вернуть на коротком отдыхе
 *   }
 */
import { computeSheet } from '../rules/sheet.js';
import { evalFormula, byLevelPairs } from '../rules/formula.js';
import { spellSlots } from '../rules/spellcasting.js';
import { defaultEquipped, normalize, resolve } from '../rules/loadout.js';
import { summarizeChoices, spellcastingOf } from '../rules/progression.js';
import { collectPassives, normName } from '../rules/passives.js';

// эффекты черт и боевых стилей, которые учитывает лист (rules/sheet.js)
const PERKS = { tough: 'tough', alert: 'alert', defense: 'defense', archery: 'archery', dueling: 'dueling', twf: 'twf' };

/**
 * Максимум использований из поля uses способности (формат v2):
 *   { count, scale: [[уровень, кол-во], ...] }     — таблица
 *   { ability: 'cha', bonus?: 1, min?: 1 }         — модификатор (+бонус)
 *   { perLevel: 5, abilityBonus?: 'int' }          — N × уровень (+ модификатор)
 *   { pb: true }                                   — бонус мастерства
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

export class Character {
    /**
     * @param build CharacterBuild (или его JSON-объект с тем же набором полей)
     * @param refs  { races, classes, eq: { armor, weapons, packs } }
     * @param equipped экипировка из CharacterState ({ main, off, armor }) или null —
     *                 тогда берётся по умолчанию из выбора в билдере
     */
    constructor(build, refs = {}, equipped = null) {
        const races = refs.races ?? [];
        const classes = refs.classes ?? [];
        const eq = refs.eq ?? {};

        this.build = build;
        this.level = build.level ?? 1;

        // --- источники ---
        this.race = races.find((r) => r.id === build.raceId) ?? null;
        this.subrace = this.race?.subraces?.find((s) => s.id === build.subraceId) ?? null;
        this.cls = classes.find((c) => c.id === build.classId) ?? null;
        this.subclass = this.cls?.subclasses?.find((s) => s.id === build.subclassId) ?? null;

        // --- снаряжение ---
        const e = build.equipment ?? {};
        this.armor = (eq.armor ?? []).find((a) => a.id === e.armorId) ?? null;
        this.weapons = (eq.weapons ?? []).filter((w) => (e.weaponIds ?? []).includes(w.id));
        this.pack = (eq.packs ?? []).find((p) => p.id === e.packId) ?? null;
        this.shieldItem = e.shield
            ? (eq.armor ?? []).find((a) => a.category === 'shield') ?? null
            : null;

        // --- рюкзак: всё, что есть (доспех, щит, оружие, предметы набора, выданное) ---
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
        // выданное: одинаковые предметы складываются в одну строку с количеством
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

        // --- экипировка: что в руках и что надето ---
        this.equipped = equipped
            ? normalize(equipped, this.inventory)
            : defaultEquipped(this.inventory);
        this.loadout = resolve(this.equipped, this.inventory);
        const hands = [
            { hand: 'main', item: this.loadout.main },
            { hand: 'off', item: this.loadout.off },
        ];

        // --- выборы уровней: навыки, черты, стили, заклинания ---
        this.chosen = summarizeChoices(build, refs);
        const perkIds = [...this.chosen.feats, ...this.chosen.fightingStyles];
        const perks = new Set(perkIds.map((id) => PERKS[id]).filter(Boolean));

        // --- лист: КД, хиты, спасброски, навыки, атаки ---
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

        // --- умения (до текущего уровня), сгруппированные по источнику ---
        const upTo = (list) => (list ?? []).filter((f) => !f.level || f.level <= this.level);
        this.featureGroups = [
            { source: 'race', title: this.race?.name, items: upTo(this.race?.data?.traits) },
            { source: 'subrace', title: this.subrace?.name, items: upTo(this.subrace?.data?.traits) },
            { source: 'class', title: this.cls?.name, items: upTo(this.cls?.data?.features) },
            { source: 'subclass', title: this.subclass?.name, items: upTo(this.subclass?.data?.features) },
        ].filter((g) => g.title && g.items.length);

        // черты, боевые стили, воззвания, метамагия — отдельной группой
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
                title: 'Черты и выбранные умения',
                items: chosenFeats.map((f) => ({ name: f.name, desc: f.desc })),
            });
        }

        const grants = this.featureGroups.flatMap((g) =>
            g.items.flatMap((f) => (f.grants ?? []).map((gr) => ({ ...gr, feature: f.name }))),
        );

        // --- способности (таблица spells: kind = class | martial | action) ---
        //   класс:    kind 'class', classes ∋ classId, без подкласса, level ≤ уровня
        //   подкласс: subclass = subclassId, level ≤ уровня
        //   раса:     по грантам черт { type: 'ability', id }
        const spells = refs.spells ?? [];
        const lvl = this.level;
        const raceAbilityIds = new Set(grants.filter((g) => g.type === 'ability').map((g) => g.id));
        this.powers = spells.filter((sp) => {
            if (sp.kind === 'spell') return false;
            const d = sp.data ?? {};
            if (raceAbilityIds.has(sp.id)) return true;
            // варианты пула (приёмы, выстрелы) — только выбранные
            if (d.pool && !this.chosen.pool.includes(sp.id)) return false;
            if (sp.level > lvl) return false;
            if (d.subclass) return d.subclass === build.subclassId && !!build.subclassId;
            return sp.kind === 'class' && (d.classes ?? []).includes(build.classId);
        });

        // --- ресурсы ---
        //   1) из способностей с uses (Божественный канал, ци, дикий облик…)
        //   2) из грантов { type: 'resource' } в данных (на будущее / свои правила)
        const ctx = { level: this.level, prof: this.prof, mods: this.mods };
        const fromUses = this.powers
            .filter((sp) => sp.data?.uses)
            .map((sp) => ({
                id: sp.id,
                name: sp.name,
                feature: sp.name,
                max: Math.max(0, usesMax(sp.data.uses, ctx)),
                recharge: sp.data.uses.per === 'shortRest' ? 'short' : 'long',
                shortRestRegain: null,
                die: null,
            }));
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

        // --- заклинательство ---
        // заклинательство класса или подкласса (Мистический рыцарь / ловкач)
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

        // --- известные заклинания: выбранные + фиксированные гранты расы ---
        const raceSpellIds = grants.filter((g) => g.type === 'spell' && g.id).map((g) => g.id);
        const spellIds = [...new Set([...this.chosen.cantrips, ...this.chosen.spells, ...raceSpellIds])];
        this.spellbook = spellIds
            .map((id) => spells.find((sp) => sp.id === id))
            .filter(Boolean)
            .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

        // --- карточки действий и заклинаний (группы для листа) ---
        const withUses = (sp) =>
            sp.data?.uses ? { max: usesMax(sp.data.uses, ctx), per: sp.data.uses.per } : null;
        const card = (sp, source) => ({ item: sp, source, uses: withUses(sp) });
        const racePowers = this.powers.filter((sp) => raceAbilityIds.has(sp.id));
        const classPowers = this.powers.filter((sp) => !raceAbilityIds.has(sp.id) && !sp.data?.subclass);
        const subPowers = this.powers.filter((sp) => !raceAbilityIds.has(sp.id) && sp.data?.subclass);
        const speciesName = this.subrace?.name ?? this.race?.name ?? 'Вид';

        this.actionGroups = [
            { title: 'Действия класса', cards: classPowers.map((sp) => card(sp, this.cls?.name ?? 'Класс')) },
            { title: this.subclass?.name ?? 'Подкласс', cards: subPowers.map((sp) => card(sp, this.subclass?.name ?? '')) },
            { title: 'Способности вида', cards: racePowers.map((sp) => card(sp, speciesName)) },
            { title: 'Метамагия', cards: this.chosen.metamagic.map(byId).filter(Boolean).map((f) => card(f, 'Метамагия')) },
        ];
        const byCircle = {};
        for (const sp of this.spellbook) (byCircle[sp.level] ??= []).push(sp);
        for (const c of Object.keys(byCircle).map(Number).sort((a, b) => a - b)) {
            const title = c === 0 ? 'Заговоры' : `${c} круг`;
            this.actionGroups.push({ title, spells: true, cards: byCircle[c].map((sp) => card(sp, title)) });
        }
        this.actionGroups = this.actionGroups.filter((g) => g.cards.length);

        // --- пассивные эффекты: сопротивления, чувства, преимущества + пассивные умения ---
        // воззвания живут здесь (а не в «Действиях»): почти все они действуют постоянно
        const FEAT_SOURCE = { origin: 'Черта', general: 'Черта', boon: 'Дар', fightingStyle: 'Боевой стиль', invocation: 'Воззвание' };
        const passiveFeats = [...this.chosen.feats, ...this.chosen.fightingStyles, ...this.chosen.invocations]
            .filter((id) => id !== 'abilityScoreImprovement') // сама по себе — только +к характеристикам
            .map(byId)
            .filter(Boolean)
            .map((f) => ({ ...f, sourceTitle: FEAT_SOURCE[f.category] ?? 'Черта' }));
        this.passives = collectPassives({
            raceTraits: [...upTo(this.race?.data?.traits), ...upTo(this.subrace?.data?.traits)],
            raceName: speciesName,
            classFeatures: upTo(this.cls?.data?.features),
            className: this.cls?.name ?? 'Класс',
            subclassFeatures: upTo(this.subclass?.data?.features),
            subclassName: this.subclass?.name ?? 'Подкласс',
            feats: passiveFeats,
            activeNames: new Set([...this.powers, ...this.resources].map((x) => normName(x.name))),
            ctx,
        });
    }

    /** Ресурс по id. */
    resource(id) {
        return this.resources.find((r) => r.id === id) ?? null;
    }

    static resolve(build, refs) {
        return new Character(build, refs);
    }
}
