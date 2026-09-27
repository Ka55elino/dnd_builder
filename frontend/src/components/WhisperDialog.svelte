<script>
    /**
     * Modal for the DM to whisper a private message to one player.
     *
     * to       — player name (title)
     * onSend(text) — may return a promise; the dialog closes when it resolves
     * onClose()
     *
     * Enter sends, Shift+Enter is a new line, Esc closes.
     */
    import { onMount } from "svelte";
    import { WHISPER_MAX } from "../game.js";

    let { to = "", onSend, onClose } = $props();

    let text = $state("");
    let sending = $state(false);
    let error = $state("");
    let area;

    onMount(() => area?.focus());

    async function send() {
        const t = text.trim();
        if (!t || sending) return;
        sending = true;
        error = "";
        try {
            await onSend?.(t);
            onClose?.();
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            sending = false;
        }
    }

    function onKey(e) {
        if (e.key === "Escape") {
            e.preventDefault();
            onClose?.();
        } else if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            send();
        }
    }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={(e) => e.target === e.currentTarget && onClose?.()}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Whisper to {to}">
        <header>
            <h2>Whisper to {to}</h2>
            <button class="x" onclick={() => onClose?.()} aria-label="Close">✕</button>
        </header>

        <textarea
            bind:this={area}
            bind:value={text}
            onkeydown={onKey}
            maxlength={WHISPER_MAX}
            rows="5"
            placeholder="Only {to || 'this player'} will see it…"
            disabled={sending}
        ></textarea>

        <footer>
            <span class="hint">{error || "Enter — send · Shift+Enter — new line"}</span>
            <button class="ghost" onclick={() => onClose?.()}>Cancel</button>
            <button class="primary" onclick={send} disabled={!text.trim() || sending}>
                {sending ? "Sending…" : "Whisper"}
            </button>
        </footer>
    </div>
</div>

<style>
    .backdrop {
        position: fixed;
        inset: 0;
        z-index: 950;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 96px 16px;
        background: rgba(0, 0, 0, 0.6);
    }

    .dialog {
        width: min(480px, 100%);
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 20px;
        background: var(--color-card);
        border: 1px solid var(--color-magic-purple);
        border-radius: 10px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
    }

    header {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    h2 {
        flex: 1;
        margin: 0;
        font-family: var(--font-heading-alt);
        font-size: 20px;
        color: var(--color-meta-concentration);
    }

    .x {
        width: 28px;
        height: 28px;
        padding: 0;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 6px;
        color: var(--color-text-muted);
        cursor: pointer;
    }

    .x:hover {
        border-color: var(--color-border);
        color: var(--color-text-primary);
    }

    textarea {
        resize: vertical;
        min-height: 96px;
        padding: 10px 12px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        color: var(--color-text-primary);
        font-family: var(--font-lore);
        font-size: 16px;
        line-height: 1.4;
    }

    textarea:focus {
        outline: none;
        border-color: var(--color-magic-purple);
    }

    footer {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .hint {
        flex: 1;
        min-width: 0;
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-muted);
    }

    button {
        font-family: var(--font-ui);
    }

    .ghost {
        padding: 6px 12px;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-secondary);
        cursor: pointer;
    }

    .ghost:hover {
        border-color: var(--color-gold);
        color: var(--color-gold-hover);
    }

    .primary {
        padding: 6px 16px;
        background: var(--color-magic-purple-dark);
        border: 1px solid var(--color-magic-purple);
        border-radius: 6px;
        color: var(--color-text-primary);
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
    }

    .primary:not(:disabled):hover {
        background: var(--color-magic-purple);
    }

    .primary:disabled {
        opacity: 0.5;
        cursor: default;
    }
</style>
