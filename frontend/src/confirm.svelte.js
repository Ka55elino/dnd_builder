/**
 * Confirmations — one popup for the whole app (components/common/ConfirmDialog.svelte,
 * mounted once in App.svelte). In-app, not the OS dialog: looks and works the same on every
 * platform and in the browser.
 *
 *   import { ask } from '../confirm.svelte.js';
 *   if (await ask({ title: 'Delete “Goblin”?', text: 'A custom monster…', ok: 'Delete' })) remove(m);
 *
 * ask({ title, text?, ok?, cancel?, danger? }) → Promise<boolean>
 *   ok      — the confirm button's label (default "Delete")
 *   danger  — a red confirm button (default true: most confirmations destroy something)
 * Cancel / Esc / a click outside → false. A new ask() while one is open answers the old one false.
 */

export const confirmState = $state({ current: null }); // { title, text, ok, cancel, danger, resolve } | null

export function ask({ title, text = '', ok = 'Delete', cancel = 'Cancel', danger = true } = {}) {
    confirmState.current?.resolve(false);
    return new Promise((resolve) => {
        confirmState.current = { title, text, ok, cancel, danger, resolve };
    });
}

/** Answer the open confirmation (the dialog calls it). */
export function answer(yes) {
    const c = confirmState.current;
    if (!c) return;
    confirmState.current = null;
    c.resolve(!!yes);
}

/** Close the open confirmation without an answer from the user (= cancel). */
export function dismissConfirm() {
    answer(false);
}
