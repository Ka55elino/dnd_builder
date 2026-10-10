<script>
    /**
     * The app's confirmation popup (see confirm.svelte.js: ask()). Mounted once in App.svelte.
     * Focus starts on Cancel (Enter doesn't destroy anything by accident); Esc / a click
     * outside cancel.
     */
    import { confirmState, answer } from "../../confirm.svelte.js";

    const c = $derived(confirmState.current);

    function onKey(e) {
        if (!c || e.key !== "Escape") return;
        e.stopPropagation();
        answer(false);
    }
</script>

<svelte:window onkeydowncapture={onKey} />

{#if c}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="back" onclick={(e) => e.target === e.currentTarget && answer(false)}>
        <div class="dlg" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
            <h2 id="confirm-title">{c.title}</h2>
            {#if c.text}<p>{c.text}</p>{/if}
            <footer>
                <!-- svelte-ignore a11y_autofocus -->
                <button class="no" onclick={() => answer(false)} autofocus>{c.cancel}</button>
                <button class="yes" class:danger={c.danger} onclick={() => answer(true)}>{c.ok}</button>
            </footer>
        </div>
    </div>
{/if}

<style>
    .back {
        position: fixed;
        inset: 0;
        z-index: 3000; /* over everything, other dialogs included */
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        background: rgba(0, 0, 0, 0.6);
    }

    .dlg {
        width: min(420px, 100%);
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 20px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 10px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
        font-family: var(--font-ui);
    }

    h2 {
        margin: 0;
        font-family: var(--font-heading-alt);
        font-size: 20px;
        color: var(--color-text-primary);
        overflow-wrap: anywhere;
    }

    p {
        margin: 0;
        font-size: 14px;
        line-height: 1.45;
        color: var(--color-text-secondary);
        overflow-wrap: anywhere;
        white-space: pre-line;
    }

    footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 6px;
    }

    button {
        padding: 8px 16px;
        border-radius: 6px;
        font-family: var(--font-ui);
        font-size: 14px;
        cursor: pointer;
    }

    .no {
        background: transparent;
        border: 1px solid var(--color-border);
        color: var(--color-text-secondary);
    }

    .no:hover {
        border-color: var(--color-gold);
        color: var(--color-gold-hover);
    }

    .yes {
        background: var(--color-gold);
        border: 1px solid var(--color-gold);
        color: var(--color-bg);
        font-weight: var(--font-weight-semibold);
    }

    .yes.danger {
        background: var(--color-danger);
        border-color: var(--color-danger);
        color: var(--color-text-primary);
    }
</style>
