/**
 * The character sheet as a PDF (pdf.go renders it with go-pdf/fpdf).
 *
 * The app computes every number (models/Character.js); Go only lays them out on the pages.
 * So this module turns the open sheet into a plain "print model" — strings and numbers,
 * nothing to recompute:
 *
 *   page 1 — header, abilities + saves + skills, combat, attacks, resources, effects
 *   page 2 — features & traits, actions, equipment, personality, appearance, notes
 *   page 3 — spellcasting (only for casters / characters with spells)
 *
 * Usage: savePdf(await pdfModel({ build, character, state, refs }))
 */
import { ABILITIES, ABILITY_KEYS, formatModifier } from './rules/abilities.js';
import { BIO_GROUPS } from './models/CharacterBuild.svelte.js';
import { damageName, actionName, restName } from './rules/labels.js';
import { slotOf } from './rules/loadout.js';
import { rowName } from './rules/modifiers.js';
import { SaveCharacterPDF } from './api.js';

export const PDF_MODEL_VERSION = 1;

const ARMOR = { light: 'Light', medium: 'Medium', heavy: 'Heavy', shield: 'Shields' };
const WEAPONS = { simple: 'Simple', martial: 'Martial' };
const SLOT_TAG = { main: 'main hand', off: 'off hand', armor: 'worn' };
const KIND_ORDER = { armor: 0, shield: 1, weapon: 2, item: 3 };
const RECHARGE = { short: 'Short Rest', long: 'Long Rest' };

/** Markdown-ish data text → plain text (the PDF has no rich text). */
export function plain(s) {
    return String(s ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1$2')
        .replace(/__(.+?)__/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^#+\s*/gm, '')
        .replace(/^\s*[-*]\s+/gm, '• ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

const ft = (n) => (n ? `${n} ft.` : '');
const signed = formatModifier;

/**
 * A portrait (an uploaded image, a built-in SVG…) as a JPEG data URL for the PDF —
 * fpdf only takes PNG / JPEG / GIF, so it is drawn on a canvas first.
 * Returns "" if there is none or it can't be loaded.
 */
export async function portraitJpeg(url, size = 480) {
    if (!url || typeof document === 'undefined') return '';
    try {
        const img = new Image();
        img.decoding = 'async';
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = url;
        });
        const w = img.naturalWidth || size;
        const h = img.naturalHeight || size;
        const k = Math.min(1, size / Math.max(w, h)) || 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * k));
        canvas.height = Math.max(1, Math.round(h * k));
        const g = canvas.getContext('2d');
        g.fillStyle = '#ffffff'; // transparent PNG / SVG → white, not black
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.9);
    } catch {
        return '';
    }
}

/** An action / spell card → a list row. */
function cardRow(c, { spell = false } = {}) {
    const it = c.item ?? {};
    const d = it.data ?? {};
    const tags = [];
    const act = actionName(it.action ?? d.action);
    if (act) tags.push(act);
    if (it.concentration || d.casting?.concentration) tags.push('Concentration');
    if (it.ritual || d.casting?.ritual || c.ritual) tags.push('Ritual');
    if (c.uses?.max) tags.push(`${c.uses.max}/${restName(c.uses.per) || c.uses.per}`);
    const dmg = d.damage?.dice ? `${c.boost?.die ?? d.damage.dice} ${damageName(d.damage.type)}`.trim() : '';
    if (dmg) tags.push(dmg);
    return {
        name: it.name ?? '',
        level: spell ? (it.level ?? 0) : null,
        tags: tags.join(' · '),
        damage: dmg,
        action: act,
        note: plain(c.note ?? ''),
        source: c.source ?? '',
        desc: plain(it.desc),
    };
}

/**
 * The print model of the open sheet.
 * build — CharacterBuild, character — Character, state — CharacterState (or null),
 * refs — reference data (backgrounds for the background name).
 */
export async function pdfModel({ build, character: ch, state, refs = {}, appVersion = '' }) {
    const saves = Object.fromEntries((ch.saves ?? []).map((s) => [s.key, s]));
    const background = (refs.backgrounds ?? []).find((b) => b.id === build.backgroundId);
    const bio = build.bio ?? {};

    // --- page 1 ---
    const abilities = ABILITY_KEYS.map((k) => ({
        key: k,
        name: ABILITIES[k].name,
        short: ABILITIES[k].short,
        score: build.totalAbilities?.[k] ?? 10,
        mod: signed(ch.mods?.[k] ?? 0),
        save: signed(saves[k]?.value ?? ch.mods?.[k] ?? 0),
        saveProf: !!saves[k]?.proficient,
    }));
    const skills = (ch.skills ?? []).map((s) => ({
        name: s.name,
        ability: ABILITIES[s.ability]?.short ?? '',
        value: signed(s.value),
        prof: !!s.proficient,
        expert: !!s.expertise,
    }));
    const attacks = (ch.attacks ?? []).map((a) => ({
        name: a.name + (a.hand === 'off' ? ' (off hand)' : ''),
        bonus: signed(a.toHit),
        damage: [
            `${a.damage} ${damageName(a.damageType)}`.trim(),
            ...(a.extra ?? []).map((x) => `+ ${x.dice} ${damageName(x.type)}`.trim()),
        ].join(' '),
        notes: [a.action === 'bonus' ? 'Bonus Action' : '', a.magic ? 'magic' : '', a.note ?? '']
            .filter(Boolean)
            .join(', '),
    }));
    const resources = (ch.resources ?? []).map((r) => ({
        name: r.name + (r.die ? ` (${r.die})` : ''),
        max: r.max,
        left: state ? state.resourceLeft(r) : r.max,
        recharge: RECHARGE[r.recharge] ?? restName(r.recharge) ?? '',
    }));
    const effects = (ch.passives?.effects ?? []).map((g) => ({
        title: g.title,
        items: g.items.map((l) => l.label),
    }));

    const worn = ch.loadout?.armor;
    const shield = [ch.loadout?.main, ch.loadout?.off].find((x) => x?.kind === 'shield');
    const armorLine = [worn ? worn.name : 'No armor', shield ? `${shield.name} (+${shield.ref?.data?.acBonus ?? 2})` : '']
        .filter(Boolean)
        .join(' + ');

    const clsData = ch.cls?.data ?? {};
    const proficiencies = [
        { label: 'Armor', value: (clsData.armorTraining ?? []).map((k) => ARMOR[k] ?? k).join(', ') },
        { label: 'Weapons', value: (clsData.weaponProficiencies ?? []).map((k) => WEAPONS[k] ?? k).join(', ') },
        { label: 'Tools', value: background?.data?.tool ?? '' },
    ].filter((p) => p.value);

    // --- page 2 ---
    const features = (ch.featureGroups ?? []).map((g) => ({
        title: g.title,
        items: g.items.map((f) => ({
            name: f.name,
            meta: f.level ? `Level ${f.level}` : '',
            desc: plain(f.desc),
        })),
    }));
    const actions = (ch.actionGroups ?? [])
        .filter((g) => !g.spells)
        .map((g) => ({ title: g.title, items: g.cards.map((c) => cardRow(c)) }));
    const equipment = [...(ch.inventory ?? [])]
        .sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9))
        .map((it) => ({
            name: it.name,
            qty: it.qty ?? 1,
            tag: SLOT_TAG[slotOf(it.key, ch.equipped)] ?? '',
        }));
    const bioGroups = BIO_GROUPS.map((g) => ({
        title: g.title,
        fields: g.fields
            .filter((f) => f.key !== 'alignment')
            .map((f) => ({ label: f.label, value: bio[f.key] ?? '' })),
    }));

    // --- page 3 ---
    const sc = ch.spellcasting;
    const rsc = ch.raceSpellcasting;
    const spellGroups = (ch.actionGroups ?? [])
        .filter((g) => g.spells)
        .map((g) => ({ title: g.title, items: g.cards.map((c) => cardRow(c, { spell: true })) }));
    const slots = (ch.spellSlots ?? []).map((s) => {
        const key = s.pact ? 'pact' : s.level;
        return {
            level: s.level,
            max: s.max,
            used: Math.min(s.max, state?.slotsUsed?.[key] ?? 0),
            pact: !!s.pact,
        };
    });
    const casting = [];
    if (sc) {
        casting.push({
            title: ch.subclass && !ch.cls?.caster ? ch.subclass.name : ch.cls?.name ?? 'Spellcasting',
            ability: ABILITIES[sc.ability]?.name ?? sc.ability ?? '',
            dc: sc.saveDC,
            attack: signed(sc.attack),
        });
    }
    if (rsc) {
        casting.push({
            title: ch.subrace?.name ?? ch.race?.name ?? 'Species',
            ability: rsc.ability ? ABILITIES[rsc.ability]?.name ?? rsc.ability : 'not chosen',
            dc: rsc.saveDC ?? null,
            attack: rsc.attack != null ? signed(rsc.attack) : '',
        });
    }

    const hpMax = ch.maxHp ?? 0;
    return {
        v: PDF_MODEL_VERSION,
        appVersion,
        createdAt: new Date().toISOString(),

        name: build.name || 'Unnamed',
        level: build.level ?? 1,
        className: ch.cls?.name ?? build.classId ?? '',
        subclassName: ch.subclass?.name ?? '',
        species: [ch.race?.name ?? build.raceId ?? '', ch.subrace?.name ?? ''].filter(Boolean).join(' · '),
        size: ch.race?.data?.size ?? '',
        background: background?.name ?? '',
        alignment: bio.alignment ?? '',
        portrait: await portraitJpeg(build.portrait || ch.subrace?.image || ch.race?.image || ''),

        abilities,
        skills,
        prof: signed(ch.prof),
        ac: ch.ac,
        armorLine,
        initiative: signed(ch.initiative),
        speed: ft(ch.speed),
        hpMax,
        hpCurrent: state ? state.currentHp(ch) : hpMax,
        hpTemp: state?.tempHp ?? 0,
        hitDice: `${build.level ?? 1}d${ch.hitDie ?? ch.cls?.data?.hitDie ?? ''}`,
        hitDiceLeft: Math.max(0, (build.level ?? 1) - (state?.hitDiceUsed ?? 0)),
        deathSaves: { success: state?.deathSaves?.success ?? 0, fail: state?.deathSaves?.fail ?? 0 },
        inspiration: !!state?.inspiration,
        passivePerception: ch.passivePerception ?? 10,
        darkvision: ft(ch.darkvision),
        attackCount: ch.attackCount?.count ?? 1,
        attackNote: (ch.attackCount?.conditional ?? []).map((c) => `${c.count} with ${c.label}`).join(', '),
        attacks,
        resources,
        effects,
        conditions: (ch.conditions ?? []).filter((c) => !c.immune).map((c) => rowName(c)).filter(Boolean),
        proficiencies,

        features,
        actions,
        equipment,
        bio: bioGroups,
        notes: state?.notes ?? '',

        casting,
        slots,
        spells: spellGroups,
    };
}

const fileName = (m) => `${m.name} (level ${m.level})`;

/** Download PDF: asks where to save. Returns the path or "" (cancelled). */
export async function savePdf(model) {
    return SaveCharacterPDF(fileName(model), JSON.stringify(model));
}
