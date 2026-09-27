<script>
    /**
     * Player side: messages from the DM, shown as popups in the corner on any
     * screen (see game.js). A popup stays until the player closes it with ✕.
     *   "whisper" — a private message;
     *   "give"    — a named or the DM's own item: stored in the character's backpack in the
     *               local DB right away (even if the sheet is not open), then announced;
     *               the DM's own item is first saved as a custom record here (game.js).
     * Mounted once in App.svelte.
     */
    import { fly } from "svelte/transition";
    import { onGameEvent, server } from "../server.svelte.js";
    import { EV, storeGift } from "../game.js";
    import { loadRefs } from "../data/refs.js";

    let list = $state([]); // [{ id, type: 'whisper' | 'gift' | 'error', title, text, at }]
    let seq = 0;

    const push = (type, title, text) => list.push({ id: ++seq, type, title, text, at: new Date() });

    async function onGift(data) {
        const characterId = server.characterId;
        try {
            const { catalog } = await loadRefs();
            const { item, qty } = await storeGift(characterId, data, catalog);
            const own = data?.def ? " It's the DM's own item — now it's in your items too." : "";
            push("gift", "The DM gives you", `${item.name}${qty > 1 ? ` ×${qty}` : ""} — added to your backpack.${own}`);
        } catch (e) {
            push("error", "An item from the DM was lost", e?.message ?? String(e));
        }
    }

    $effect(() =>
        onGameEvent((ev) => {
            if (server.role !== "player") return;
            if (ev?.kind === EV.WHISPER) {
                const text = String(ev.data?.text ?? "").trim();
                if (text) push("whisper", "The DM whispers", text);
            } else if (ev?.kind === EV.GIVE) {
                onGift(ev.data);
            }
        }),
    );

    // a new game starts with a clean corner
    $effect(() => {
        if (server.role !== "player") list = [];
    });

    const close = (id) => (list = list.filter((w) => w.id !== id));
    const hhmm = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
</script>

{#if list.length}
    <div class="whispers" aria-live="polite">
        {#each list as w (w.id)}
            <div class="whisper {w.type}" role="alert" transition:fly={{ x: 40, duration: 200 }}>
                <header>
                    <span class="from">{w.title}</span>
                    <span class="time">{hhmm(w.at)}</span>
                    <button class="x" onclick={() => close(w.id)} aria-label="Close">✕</button>
                </header>
                <p>{w.text}</p>
            </div>
        {/each}
    </div>
{/if}

<style>
    .whispers {
        position: fixed;
        top: 44px; /* below the status bar */
        right: 16px;
        z-index: 800;
        width: min(340px, calc(100vw - 32px));
        max-height: calc(100vh - 60px);
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .whisper {
        padding: 12px 14px;
        background: var(--color-card);
        border: 1px solid var(--color-magic-purple);
        border-left-width: 3px;
        border-radius: 8px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    }

    .whisper.gift {
        border-color: var(--color-gold);
    }

    .whisper.gift .from {
        color: var(--color-gold);
    }

    .whisper.error {
        border-color: var(--color-danger);
    }

    .whisper.error .from {
        color: var(--color-danger);
    }

    header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
    }

    .from {
        flex: 1;
        font-family: var(--font-heading);
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-meta-concentration);
    }

    .time {
        font-family: var(--font-ui);
        font-size: 11px;
        color: var(--color-text-muted);
    }

    .x {
        width: 22px;
        height: 22px;
        padding: 0;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 4px;
        color: var(--color-text-muted);
        font-size: 12px;
        cursor: pointer;
    }

    .x:hover {
        border-color: var(--color-border);
        color: var(--color-text-primary);
    }

    p {
        margin: 0;
        font-family: var(--font-lore);
        font-size: 16px;
        line-height: 1.4;
        color: var(--color-text-primary);
        white-space: pre-wrap;
        word-break: break-word;
    }
</style>
