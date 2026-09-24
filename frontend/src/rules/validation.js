/**
 * Проверка персонажа перед сохранением.
 *
 * validateBuild(build, { races }) → [{ tab, message }]
 *   tab — индекс вкладки билдера (см. BUILDER_TABS), чтобы подсветить её
 *   и перейти по клику.
 *
 * Подкласс НЕ проверяется: он выбирается на 3 уровне и сейчас
 * носит информативный характер.
 */
import { ABILITY_KEYS, ABILITIES } from './abilities.js';
import { BIO_GROUPS } from '../models/CharacterBuild.svelte.js';

export const BUILDER_TABS = ['Основа', 'Атрибуты', 'Раса', 'Класс', 'Снаряжение'];

export const TAB = { BASICS: 0, ABILITIES: 1, RACE: 2, CLASS: 3, EQUIPMENT: 4 };

const empty = (v) => v == null || String(v).trim() === '';

export function validateBuild(build, { races = [], classes = [] } = {}) {
    const errors = [];
    const add = (tab, message) => errors.push({ tab, message });

    // --- Основа: имя + все текстовые поля ---
    if (empty(build.name)) add(TAB.BASICS, 'Имя');
    for (const group of BIO_GROUPS) {
        for (const f of group.fields) {
            if (empty(build.bio?.[f.key])) add(TAB.BASICS, `${group.title}: ${f.label}`);
        }
    }

    // --- Атрибуты: все характеристики назначены ---
    const unset = ABILITY_KEYS.filter((k) => build.abilities?.[k] == null);
    if (unset.length) {
        add(TAB.ABILITIES, `Не распределены: ${unset.map((k) => ABILITIES[k].short).join(', ')}`);
    }

    // --- Происхождение: выбрано и бонусы распределены ---
    if (!build.backgroundId) {
        add(TAB.ABILITIES, 'Происхождение не выбрано');
    } else {
        const vals = Object.values(build.backgroundBonus ?? {});
        const need = build.backgroundBonusMode === '1-1-1' ? [1, 1, 1] : [1, 2];
        const ok = vals.length === need.length && [...vals].sort().join() === need.join();
        if (!ok) {
            add(TAB.ABILITIES, build.backgroundBonusMode === '1-1-1'
                ? 'Происхождение: выберите три характеристики по +1'
                : 'Происхождение: распределите +2 и +1');
        }
    }

    // --- Раса (+ подраса, если у расы они есть) ---
    if (!build.raceId) {
        add(TAB.RACE, 'Раса не выбрана');
    } else {
        const race = races.find((r) => r.id === build.raceId);
        if (race?.subraces?.length && !build.subraceId) add(TAB.RACE, 'Подраса не выбрана');
    }

    // --- Класс (подкласс не проверяем) ---
    if (!build.classId) add(TAB.CLASS, 'Класс не выбран');

    // --- Снаряжение ---
    const eq = build.equipment ?? {};
    // доспех обязателен, только если класс им владеет (маг, чародей, монах — без доспехов)
    const cls = classes.find((c) => c.id === build.classId);
    const armorless = cls && !(cls.data?.armorTraining ?? []).some((a) => a !== 'shield');
    if (!eq.armorId && !armorless) add(TAB.EQUIPMENT, 'Доспех не выбран');
    if (!eq.weaponIds?.length) add(TAB.EQUIPMENT, 'Оружие не выбрано');
    if (!eq.packId) add(TAB.EQUIPMENT, 'Набор снаряжения не выбран');

    return errors;
}
