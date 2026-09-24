/**
 * Общие справочные подписи: типы урона, действий, отдыха, школы магии.
 * Используются в карточках, таблицах и выборах. Иконки — по тем же id
 * (см. components/common/Icon.svelte, файлы src/assets/icons/<id>.svg).
 */

/** Типы урона. short — для узких мест (таблицы, чипы). */
export const DAMAGE_TYPES = {
    bludgeoning: { name: 'Дробящий', short: 'дроб.' },
    piercing: { name: 'Колющий', short: 'кол.' },
    slashing: { name: 'Рубящий', short: 'руб.' },
    acid: { name: 'Кислотой', short: 'кисл.' },
    cold: { name: 'Холодом', short: 'холод' },
    fire: { name: 'Огнём', short: 'огонь' },
    force: { name: 'Силовым полем', short: 'силов.' },
    lightning: { name: 'Электричеством', short: 'электр.' },
    necrotic: { name: 'Некротический', short: 'некр.' },
    poison: { name: 'Ядом', short: 'яд' },
    psychic: { name: 'Психический', short: 'псих.' },
    radiant: { name: 'Излучением', short: 'излуч.' },
    thunder: { name: 'Звуком', short: 'звук' },
    physical: { name: 'Физический', short: 'физ.' },
    weapon: { name: 'Урон оружия', short: 'оруж.' },
};

/** Типы действий (поле action у заклинаний и способностей). */
export const ACTION_TYPES = {
    action: { name: 'Действие', short: 'Д' },
    bonus: { name: 'Бонусное действие', short: 'Б' },
    reaction: { name: 'Реакция', short: 'Р' },
    free: { name: 'Свободное действие', short: 'С' },
};

/** Периоды восстановления (uses.per). */
export const REST_TYPES = {
    shortRest: { name: 'Короткий отдых', short: 'кор.' },
    longRest: { name: 'Долгий отдых', short: 'долг.' },
    day: { name: 'День', short: 'день' },
};

/** Школы магии. */
export const SCHOOLS = {
    abjuration: 'Ограждение',
    conjuration: 'Вызов',
    divination: 'Прорицание',
    enchantment: 'Очарование',
    evocation: 'Воплощение',
    illusion: 'Иллюзия',
    necromancy: 'Некромантия',
    transmutation: 'Преобразование',
};

/** Нормализация действия: 'bonus_action' → 'bonus'. */
export const normAction = (a) => (a ? String(a).replace(/_action$/, '') : null);

export const damageName = (t) => DAMAGE_TYPES[t]?.name ?? t ?? '';
/** Подпись для подсказки: «Урон огнём», «Колющий урон». */
export const damageLabel = (t) => {
    const n = DAMAGE_TYPES[t]?.name;
    if (!n) return t ?? '';
    if (t === 'weapon') return n;
    return /ий$/.test(n) ? `${n} урон` : `Урон ${n.toLowerCase()}`;
};
export const damageShort = (t) => DAMAGE_TYPES[t]?.short ?? t ?? '';
export const actionName = (a) => ACTION_TYPES[normAction(a)]?.name ?? a ?? '';
export const restName = (r) => REST_TYPES[r]?.name ?? r ?? '';
