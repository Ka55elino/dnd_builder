/**
 * Подписи и расчёты для снаряжения (оружие, доспехи).
 * Общие для вкладки «Снаряжение» билдера и страницы «Дать предмет».
 */

export const ARMOR_CAT = { light: 'Лёгкий', medium: 'Средний', heavy: 'Тяжёлый', shield: 'Щит' };
export const WEAPON_CAT = { simple: 'Простое', martial: 'Воинское' };

export const WEAPON_PROPS = {
    finesse: 'фехтовальное',
    light: 'лёгкое',
    thrown: 'метательное',
    versatile: 'универсальное',
    ranged: 'дальнобойное',
    twoHanded: 'двуручное',
    heavy: 'тяжёлое',
    reach: 'досягаемость',
    loading: 'перезарядка',
    ammunition: 'боеприпасы',
};

/** КД доспеха текстом: «13 + Лов (макс. 2)», для щита «+2». */
export function acText(a) {
    const d = a.data ?? {};
    if (a.category === 'shield') return `+${d.acBonus ?? 2}`;
    if (!d.addDex) return `${a.baseAC}`;
    return d.maxDex != null ? `${a.baseAC} + Лов (макс. ${d.maxDex})` : `${a.baseAC} + Лов`;
}

const fmtBonus = (n) => (n > 0 ? `+${n}` : `${n}`);

/**
 * Описание предмета для подсказки: { title, tag, lines: [строки характеристик], desc }.
 * item — запись рюкзака (Character.inventory): { kind: 'weapon'|'armor'|'shield'|'item', ref, qty }
 */
export function describeItem(item, { damageShort = (t) => t } = {}) {
    const r = item.ref ?? {};
    const d = r.data ?? {};
    const lines = [];

    if (item.kind === 'weapon') {
        lines.push(WEAPON_CAT[r.category] ?? r.category ?? '');
        lines.push(['Урон:', r.damage, damageShort(r.damageType)].filter(Boolean).join(' '));
        if (d.attackBonus || d.damageBonus) {
            lines.push(
                [d.attackBonus ? `${fmtBonus(d.attackBonus)} к попаданию` : '', d.damageBonus ? `${fmtBonus(d.damageBonus)} к урону` : '']
                    .filter(Boolean)
                    .join(', '),
            );
        }
        for (const x of d.extraDamage ?? []) lines.push(`Доп. урон: ${x.dice} ${damageShort(x.type)}`);
        if (d.mastery) lines.push(`Мастерство: ${d.mastery}`);
        if (d.properties?.length) lines.push(d.properties.map((p) => WEAPON_PROPS[p] ?? p).join(', '));
    } else if (item.kind === 'armor' || item.kind === 'shield') {
        lines.push(ARMOR_CAT[r.category] ?? r.category ?? '');
        lines.push(`КД: ${acText(r)}${d.acBonus && r.category !== 'shield' ? ` ${fmtBonus(d.acBonus)}` : ''}`);
        if (d.strengthReq) lines.push(`Требует Силу ${d.strengthReq}`);
        if (d.stealthDisadvantage) lines.push('Помеха на Скрытность');
    } else {
        if (r.weight) lines.push(`Вес: ${r.weight} фнт.`);
        if (r.cost) lines.push(`Цена: ${r.cost}`);
    }
    if (item.qty > 1) lines.push(`Количество: ${item.qty}`);

    return {
        title: r.name ?? item.name,
        tag: d.custom ? 'своё' : r.isDefault === false ? 'именное' : '',
        lines: lines.filter(Boolean),
        desc: r.desc ?? d.desc ?? '',
    };
}
