<script>
    import { onMount } from "svelte";
    import { ListCharacters } from "../api.js";
    import { importCharacter } from "../transfer.js";
    import CharacterGrid from "./CharacterGrid.svelte";

    let { onCreate, onOpen, onBack } = $props();

    // saved characters from the DB
    let characters = $state([]);
    let importing = $state(false);
    let notice = $state(null); // { ok: bool, text, id? }

    async function reload() {
        try {
            characters = await ListCharacters();
        } catch (e) {
            console.error("[characters]", e);
        }
    }

    onMount(reload);

    // Import a character from a JSON file (transfer.js): it's added to the list
    async function doImport() {
        if (importing) return;
        importing = true;
        notice = null;
        try {
            const r = await importCharacter();
            if (!r) return; // cancelled
            await reload();
            const parts = [`Imported “${r.name}”${r.copy ? " as a copy (this character was already here)" : ""}.`];
            const added = [];
            if (r.added.equipment) added.push(`${r.added.equipment} custom ${r.added.equipment === 1 ? "item" : "items"}`);
            if (r.added.spells) added.push(`${r.added.spells} custom ${r.added.spells === 1 ? "spell" : "spells"}`);
            if (added.length) parts.push(`Added ${added.join(" and ")}.`);
            if (r.missing.length) parts.push(`This app doesn't know the ${r.missing.join(", ")} — the sheet may be incomplete.`);
            notice = { ok: !r.missing.length, text: parts.join(" "), id: r.id };
        } catch (e) {
            notice = { ok: false, text: e?.message ?? String(e) };
        } finally {
            importing = false;
        }
    }
</script>

<main class="start">
    <CharacterGrid {characters} {onCreate} {onOpen}>
        {#snippet header()}
            <header class="top">
                {#if onBack}<button class="ghost back" onclick={onBack}>← Menu</button>{:else}<span></span>{/if}
                <h1>Characters</h1>
                <button class="ghost import" onclick={doImport} disabled={importing} title="Add a character from a .json file (Export on a character sheet)">
                    {importing ? "Importing…" : "Import"}
                </button>
            </header>
            {#if notice}
                <p class="notice" class:bad={!notice.ok}>
                    {notice.text}
                    {#if notice.id}<button class="link" onclick={() => onOpen?.(notice.id)}>Open</button>{/if}
                    <button class="link x" onclick={() => (notice = null)} aria-label="Dismiss">✕</button>
                </p>
            {/if}
        {/snippet}
    </CharacterGrid>
</main>

<style>
    .start {
        height: 100%;
        padding: 32px;
        display: flex;
        gap: 24px;
        flex-direction: column;
        justify-content: flex-start;
        align-items: center;
    }

    h1 {
        margin: 0;
        font-family: var(--font-heading);
        font-weight: var(--font-weight-bold);
        color: var(--color-gold);
    }

    /* back · title · import — over exactly the width of the card grid */
    .top {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        gap: 12px;
    }

    .top .back {
        justify-self: start;
    }

    .top .ghost {
        padding: 6px 12px;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        cursor: pointer;
    }

    .top .ghost:hover {
        border-color: var(--color-gold);
        color: var(--color-gold-hover);
    }

    .top .ghost.import {
        justify-self: end;
    }

    .top .ghost:disabled {
        opacity: 0.6;
        cursor: default;
    }

    .notice {
        margin: 0;
        padding: 8px 14px;
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 10px;
        background: var(--color-card);
        border: 1px solid var(--color-success);
        border-radius: 8px;
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-primary);
    }

    .notice.bad {
        border-color: var(--color-danger);
    }

    .link {
        padding: 0;
        background: none;
        border: none;
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-gold);
        cursor: pointer;
    }

    .link.x {
        margin-left: auto;
        color: var(--color-text-muted);
    }
</style>
