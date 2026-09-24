/**
 * Экипировка: что в руках и что надето.
 *
 * Инвентарь (рюкзак) — всё, что есть у персонажа; строится в Character:
 *   [{ key, kind: 'weapon' | 'shield' | 'armor' | 'item', name, ref, qty }]
 *   key: 'weapon:<id>' | 'shield' | 'armor:<id>' | 'item:<id>'
 *
 * Экипировка (хранится в CharacterState.equipped):
 *   { main: key | null,   // правая рука — оружие или щит
 *     off:  key | null,   // левая рука  — оружие или щит
 *     armor: key | null } // только доспех
 *
 * Правила:
 *   - в руки — только оружие или щит; в доспех — только доспех;
 *   - один предмет нельзя держать в двух руках сразу;
 *   - двуручное оружие занимает обе руки: вторая рука становится пустой.
 */

export const SLOTS = [
    { id: 'main', label: 'Правая рука' },
    { id: 'off', label: 'Левая рука' },
    { id: 'armor', label: 'Доспех' },
];

export const EMPTY = { main: null, off: null, armor: null };

const isHandItem = (it) => it.kind === 'weapon' || it.kind === 'shield';
export const isTwoHanded = (it) =>
    it?.kind === 'weapon' && (it.ref?.data?.properties ?? []).includes('twoHanded');

const byKey = (inventory, key) => (key ? inventory.find((it) => it.key === key) ?? null : null);

/** Варианты для слота (для селекта). */
export function slotOptions(slot, inventory) {
    return slot === 'armor'
        ? inventory.filter((it) => it.kind === 'armor')
        : inventory.filter(isHandItem);
}

/** Экипировка по умолчанию — из того, что выбрано в билдере. */
export function defaultEquipped(inventory) {
    const armor = inventory.find((it) => it.kind === 'armor')?.key ?? null;
    const weapons = inventory.filter((it) => it.kind === 'weapon');
    const shield = inventory.find((it) => it.kind === 'shield')?.key ?? null;

    let main = weapons[0]?.key ?? null;
    let off = shield;
    if (isTwoHanded(weapons[0])) off = null; // двуручное — щит остаётся в рюкзаке
    return normalize({ main, off, armor }, inventory);
}

/**
 * Приводит экипировку к правилам: убирает несуществующие предметы,
 * предметы не того типа, дубли и конфликт с двуручным оружием.
 */
export function normalize(equipped, inventory) {
    const e = { ...EMPTY, ...(equipped ?? {}) };
    const main = byKey(inventory, e.main);
    const off = byKey(inventory, e.off);
    const armor = byKey(inventory, e.armor);

    e.main = main && isHandItem(main) ? main.key : null;
    e.off = off && isHandItem(off) && off.key !== e.main ? off.key : null;
    e.armor = armor?.kind === 'armor' ? armor.key : null;

    if (isTwoHanded(byKey(inventory, e.main))) e.off = null;
    else if (isTwoHanded(byKey(inventory, e.off))) e.main = null;
    return e;
}

/** Положить предмет в слот (null — снять). Возвращает новую экипировку. */
export function equip(equipped, slot, key, inventory) {
    const e = { ...EMPTY, ...(equipped ?? {}) };
    e[slot] = key || null;

    if (slot !== 'armor' && key) {
        const other = slot === 'main' ? 'off' : 'main';
        // тот же предмет в другой руке — перекладываем
        if (e[other] === key) e[other] = null;
        // двуручное — вторая рука пустеет
        if (isTwoHanded(byKey(inventory, key))) e[other] = null;
        // во второй руке двуручное — его приходится убрать
        else if (isTwoHanded(byKey(inventory, e[other]))) e[other] = null;
    }
    return normalize(e, inventory);
}

/** Разрешённые предметы экипировки → объекты. */
export function resolve(equipped, inventory) {
    return {
        main: byKey(inventory, equipped.main),
        off: byKey(inventory, equipped.off),
        armor: byKey(inventory, equipped.armor),
    };
}

/** Где предмет сейчас: 'main' | 'off' | 'armor' | null. */
export function slotOf(key, equipped) {
    return SLOTS.find((s) => equipped[s.id] === key)?.id ?? null;
}
