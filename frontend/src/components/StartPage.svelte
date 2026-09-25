<script>
    import { onMount } from "svelte";
    import { ListCharacters } from "../../wailsjs/go/main/App.js";
    import CharacterGrid from "./CharacterGrid.svelte";

    let { onCreate, onOpen, onBack } = $props();

    // saved characters from the DB
    let characters = $state([]);

    onMount(async () => {
        try {
            characters = await ListCharacters();
        } catch (e) {
            console.error("[characters]", e);
        }
    });
</script>

<main class="start">
    <header class="top">
        {#if onBack}<button class="ghost" onclick={onBack}>← Menu</button>{/if}
        <h1>Characters</h1>
    </header>
    <CharacterGrid {characters} {onCreate} {onOpen} />
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

    .top {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
    }

    .top .ghost {
        position: absolute;
        left: 0;
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
</style>
