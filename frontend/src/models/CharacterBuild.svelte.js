/**
 * CharacterBuild — все данные, которые собирает билдер.
 *
 * Реактивный класс (Svelte 5 runes): поля объявлены через $state,
 * поэтому компоненты можно напрямую связывать с ними:
 *   <input bind:value={build.name} />
 *
 * Файл обязательно с суффиксом .svelte.js — иначе $state не сработает.
 *
 * Хранит только выбор игрока (id-шники, значения). Производные
 * показатели (КД, хиты, бонусы) считаются отдельно.
 */

import {
    ABILITY_KEYS,
    ABILITY_METHODS,
    STANDARD_ARRAY,
    POINT_BUY_MIN,
    POINT_BUY_MAX,
    POINT_BUY_BUDGET,
    POINT_BUY_COST,
    pointBuySpent,
    rollAbilitySet,
} from '../rules/abilities.js';

export { ABILITY_KEYS };

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 20;

/**
 * Текстовые поля описания персонажа, сгруппированные для UI.
 * Каждое поле: { key, label, wide } — wide = многострочное поле на всю ширину.
 */
export const BIO_GROUPS = [
    {
        title: 'Внешность',
        fields: [
            { key: 'gender', label: 'Пол', wide: false },
            { key: 'identity', label: 'Самоощущение', wide: false },
            { key: 'attraction', label: 'Влечение', wide: false },
            { key: 'age', label: 'Возраст', wide: false },
            { key: 'height', label: 'Рост', wide: false },
            { key: 'weight', label: 'Вес', wide: false },
            { key: 'eyes', label: 'Глаза', wide: false },
            { key: 'skin', label: 'Кожа', wide: false },
            { key: 'hair', label: 'Волосы', wide: false },
        ],
    },
    {
        title: 'Личность',
        fields: [
            { key: 'alignment', label: 'Мировоззрение', wide: true },
            { key: 'trait', label: 'Черта характера', wide: true },
            { key: 'ideal', label: 'Идеал', wide: true },
            { key: 'bond', label: 'Привязанность', wide: true },
            { key: 'flaw', label: 'Изъян / секрет', wide: true },
            { key: 'weakness', label: 'Слабость', wide: true },
        ],
    }
];

export const BIO_KEYS = BIO_GROUPS.flatMap((g) => g.fields.map((f) => f.key));

const defaultBio = () => Object.fromEntries(BIO_KEYS.map((k) => [k, '']));

const clampLevel = (n) =>
    Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(Number(n) || MIN_LEVEL)));

const byAbility = (fn) => Object.fromEntries(ABILITY_KEYS.map((k) => [k, fn(k)]));

const defaultPointBuy = () => byAbility(() => POINT_BUY_MIN);
const emptyAssign = () => byAbility(() => null);

const defaultEquipment = () => ({
    armorId: null,   // доспех (один)
    shield: false,
    weaponIds: [],   // оружие (несколько)
    packId: null,    // набор снаряжения (один)
    items: [],       // отдельные предметы: [{ id, qty }]
    bag: [],         // выданное позже («Дать предмет»): [{ kind: 'weapon'|'armor'|'item', id, qty }]
});

const newId = () =>
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export class CharacterBuild {
    // --- служебное ---
    id = $state('');
    createdAt = $state('');
    updatedAt = $state('');

    // --- Основа ---
    name = $state('');
    portrait = $state(null);   // картинка персонажа, data URL (image/jpeg) или null
    bio = $state(defaultBio()); // Личность + Внешность, см. BIO_GROUPS
    level = $state(MIN_LEVEL);
    backgroundId = $state(null);

    // --- Атрибуты ---
    abilityMethod = $state('array');       // 'array' | 'pointbuy' | 'roll'
    pointBuy = $state(defaultPointBuy());  // { str: 8..15, ... } — для 'pointbuy'
    abilityRolls = $state(null);           // [{ dice: [4], total }] ×6 — для 'roll'
    abilityAssign = $state(emptyAssign()); // { str: индекс в пуле | null } — для 'array' и 'roll'

    /** Пул значений для распределения (array / roll). */
    abilityPool = $derived(
        this.abilityMethod === 'array'
            ? STANDARD_ARRAY
            : this.abilityMethod === 'roll'
                ? (this.abilityRolls ?? []).map((r) => r.total)
                : [],
    );

    /** Итоговые базовые значения { str, ... } (null — ещё не назначено). */
    abilities = $derived(
        this.abilityMethod === 'pointbuy'
            ? { ...this.pointBuy }
            : byAbility((k) => {
                const i = this.abilityAssign[k];
                return i == null ? null : (this.abilityPool[i] ?? null);
            }),
    );

    // --- Происхождение (предыстория 2024): бонусы к характеристикам ---
    // режим '2-1': одной +2, другой +1; '1-1-1': трём по +1 (из списка предыстории)
    backgroundBonusMode = $state('2-1');
    backgroundBonus = $state({});          // { str: 2, dex: 1 }

    /**
     * Итоговые характеристики: база + происхождение + повышения из выборов
     * уровней (choices[*].asi). Максимум 20. null — база ещё не назначена.
     */
    totalAbilities = $derived(
        byAbility((k) => {
            const base = this.abilities[k];
            if (base == null) return null;
            const fromChoices = Object.values(this.choices ?? {}).reduce(
                (sum, c) => sum + (c?.asi?.[k] ?? 0),
                0,
            );
            return Math.min(20, base + (this.backgroundBonus[k] ?? 0) + fromChoices);
        }),
    );

    pointsSpent = $derived(pointBuySpent(this.pointBuy));
    pointsLeft = $derived(POINT_BUY_BUDGET - this.pointsSpent);

    // --- Раса ---
    raceId = $state(null);
    subraceId = $state(null);

    // --- Класс ---
    classId = $state(null);
    subclassId = $state(null);

    // --- Снаряжение ---
    equipment = $state(defaultEquipment());

    // --- Прочие выборы (навыки, языки, черты и т.п.) ---
    // ключ — источник выбора, например 'class:skills', 'background:abilities'
    choices = $state({});

    constructor(data = {}) {
        const now = new Date().toISOString();

        this.id = data.id ?? newId();
        this.createdAt = data.createdAt ?? now;
        this.updatedAt = data.updatedAt ?? now;

        this.name = data.name ?? '';
        this.portrait = data.portrait ?? null;
        this.bio = { ...defaultBio(), ...(data.bio ?? {}) };
        this.level = clampLevel(data.level);
        this.backgroundId = data.backgroundId ?? null;
        this.backgroundBonusMode = data.backgroundBonusMode === '1-1-1' ? '1-1-1' : '2-1';
        this.backgroundBonus = { ...(data.backgroundBonus ?? {}) };

        this.abilityMethod = data.abilityMethod in ABILITY_METHODS ? data.abilityMethod : 'array';
        this.pointBuy = { ...defaultPointBuy(), ...(data.pointBuy ?? {}) };
        this.abilityRolls = Array.isArray(data.abilityRolls) ? data.abilityRolls : null;
        this.abilityAssign = { ...emptyAssign(), ...(data.abilityAssign ?? {}) };

        this.raceId = data.raceId ?? null;
        this.subraceId = data.subraceId ?? null;

        this.classId = data.classId ?? null;
        this.subclassId = data.subclassId ?? null;

        this.equipment = { ...defaultEquipment(), ...(data.equipment ?? {}) };

        this.choices = { ...(data.choices ?? {}) };
    }

    // --- изменения ---

    setLevel(n) {
        this.level = clampLevel(n);
        this.touch();
    }

    // --- атрибуты ---

    setAbilityMethod(method) {
        if (!(method in ABILITY_METHODS) || method === this.abilityMethod) return;
        this.abilityMethod = method;
        this.abilityAssign = emptyAssign();
        if (method === 'roll' && !this.abilityRolls) this.abilityRolls = rollAbilitySet();
        this.touch();
    }

    /** Покупка очков: изменить значение на delta (+1 / -1), если хватает очков. */
    pointBuyStep(key, delta) {
        const next = this.pointBuy[key] + delta;
        if (next < POINT_BUY_MIN || next > POINT_BUY_MAX) return false;
        const cost = POINT_BUY_COST[next] - POINT_BUY_COST[this.pointBuy[key]];
        if (cost > this.pointsLeft) return false;
        this.pointBuy[key] = next;
        this.touch();
        return true;
    }

    resetPointBuy() {
        this.pointBuy = defaultPointBuy();
        this.touch();
    }

    /**
     * Назначить характеристике значение из пула (индекс) или снять (null).
     * Если индекс уже занят другой характеристикой — значения меняются местами.
     */
    assignAbility(key, index) {
        const prev = this.abilityAssign[key];
        const owner = ABILITY_KEYS.find((k) => k !== key && this.abilityAssign[k] === index);
        if (index != null && owner) this.abilityAssign[owner] = prev;
        this.abilityAssign[key] = index;
        this.touch();
    }

    clearAssign() {
        this.abilityAssign = emptyAssign();
        this.touch();
    }

    reroll() {
        this.abilityRolls = rollAbilitySet();
        this.abilityAssign = emptyAssign();
        this.touch();
    }

    /** Выбрать расу (null — снять выбор). Подраса при этом сбрасывается. */
    setRace(raceId, subraceId = null) {
        this.raceId = raceId ?? null;
        this.subraceId = this.raceId ? subraceId : null;
        this.touch();
    }

    /** Выбрать подрасу текущей расы (null — снять выбор). */
    setSubrace(subraceId) {
        if (!this.raceId) return;
        this.subraceId = subraceId ?? null;
        this.touch();
    }

    /** Выбрать класс (null — снять выбор). Подкласс при этом сбрасывается. */
    setClass(classId, subclassId = null) {
        this.classId = classId ?? null;
        this.subclassId = this.classId ? subclassId : null;
        this.touch();
    }

    /** Выбрать подкласс текущего класса (null — снять выбор). */
    setSubclass(subclassId) {
        if (!this.classId) return;
        this.subclassId = subclassId ?? null;
        this.touch();
    }

    // --- снаряжение ---

    /** Доспех (null — снять). */
    setArmor(armorId) {
        this.equipment.armorId = armorId ?? null;
        this.touch();
    }

    /** Щит: взят / не взят. */
    setShield(on) {
        this.equipment.shield = !!on;
        this.touch();
    }

    /** Добавить / убрать оружие. */
    toggleWeapon(weaponId) {
        const list = this.equipment.weaponIds;
        const i = list.indexOf(weaponId);
        if (i === -1) list.push(weaponId);
        else list.splice(i, 1);
        this.touch();
    }

    /** Набор снаряжения (null — снять). */
    setPack(packId) {
        this.equipment.packId = packId ?? null;
        this.touch();
    }

    /** Выдать предмет в рюкзак (оружие, доспех или предмет из каталога). */
    addToBag(kind, id, qty = 1) {
        const bag = this.equipment.bag ?? (this.equipment.bag = []);
        const it = bag.find((b) => b.kind === kind && b.id === id);
        if (it) it.qty += qty;
        else bag.push({ kind, id, qty });
        this.touch();
    }

    /** Убрать выданный предмет (qty штук; 0 — все). */
    removeFromBag(kind, id, qty = 1) {
        const bag = this.equipment.bag ?? [];
        const i = bag.findIndex((b) => b.kind === kind && b.id === id);
        if (i === -1) return;
        if (!qty || bag[i].qty <= qty) bag.splice(i, 1);
        else bag[i].qty -= qty;
        this.touch();
    }

    /** Сколько такого предмета выдано. */
    bagCount(kind, id) {
        return (this.equipment.bag ?? []).find((b) => b.kind === kind && b.id === id)?.qty ?? 0;
    }

    /** Добавить / убрать отдельный предмет. */
    toggleItem(itemId, qty = 1) {
        const list = this.equipment.items;
        const i = list.findIndex((it) => it.id === itemId);
        if (i === -1) list.push({ id: itemId, qty });
        else list.splice(i, 1);
        this.touch();
    }

    // --- происхождение ---

    setBackground(backgroundId) {
        if (backgroundId === this.backgroundId) return;
        this.backgroundId = backgroundId ?? null;
        this.backgroundBonus = {};
        // выборы, завязанные на черту предыстории, больше не актуальны
        for (const k of Object.keys(this.choices)) if (k.includes(':background')) delete this.choices[k];
        this.touch();
    }

    setBackgroundBonusMode(mode) {
        this.backgroundBonusMode = mode === '1-1-1' ? '1-1-1' : '2-1';
        this.backgroundBonus = {};
        this.touch();
    }

    /**
     * Назначить бонус характеристике.
     * '2-1': value 2 или 1 (у каждого значения — одна характеристика);
     * '1-1-1': переключатель +1.
     */
    setBackgroundBonus(key, value) {
        const b = { ...this.backgroundBonus };
        if (this.backgroundBonusMode === '1-1-1') {
            if (b[key]) delete b[key];
            else b[key] = 1;
        } else {
            for (const k of Object.keys(b)) if (b[k] === value || k === key) delete b[k];
            if (value) b[key] = value;
        }
        this.backgroundBonus = b;
        this.touch();
    }

    // --- выборы уровней (см. rules/progression.js) ---

    /** value: { kind, ids?: [...], asi?: { str: 1 } } или null — снять. */
    setChoice(key, value) {
        if (value == null) delete this.choices[key];
        else this.choices[key] = value;
        this.touch();
    }

    /** Удалить выборы уровней выше указанного (например, при отмене повышения). */
    dropChoicesAbove(level) {
        for (const k of Object.keys(this.choices)) {
            const m = /^L(\d+):/.exec(k);
            if (m && Number(m[1]) > level) delete this.choices[k];
        }
    }

    touch() {
        this.updatedAt = new Date().toISOString();
    }

    // --- сериализация ---

    /** Простой объект для сохранения (JSON / Go-бэкенд). */
    toJSON() {
        return $state.snapshot({
            id: this.id,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            name: this.name,
            portrait: this.portrait,
            bio: this.bio,
            level: this.level,
            backgroundId: this.backgroundId,
            backgroundBonusMode: this.backgroundBonusMode,
            backgroundBonus: this.backgroundBonus,
            abilityMethod: this.abilityMethod,
            pointBuy: this.pointBuy,
            abilityRolls: this.abilityRolls,
            abilityAssign: this.abilityAssign,
            abilities: this.abilities, // производное, для удобства чтения
            totalAbilities: this.totalAbilities, // производное: с бонусами
            raceId: this.raceId,
            subraceId: this.subraceId,
            classId: this.classId,
            subclassId: this.subclassId,
            equipment: this.equipment,
            choices: this.choices,
        });
    }

    static fromJSON(data) {
        return new CharacterBuild(typeof data === 'string' ? JSON.parse(data) : data);
    }
}
