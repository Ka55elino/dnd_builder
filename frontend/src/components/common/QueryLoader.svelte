<script>
    /** Overlay with a spinner while backend (SQL) calls are running — see loader.svelte.js. */
    import { fade } from 'svelte/transition';
    import { loader } from '../../loader.svelte.js';
</script>

{#if loader.visible}
    <div class="query-loader" role="status" aria-live="polite" transition:fade={{ duration: 150 }}>
        <div class="spinner"></div>
        <span class="sr-only">Loading…</span>
    </div>
{/if}

<style>
    .query-loader {
        position: fixed;
        inset: 0;
        z-index: 900;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(17, 16, 20, 0.45);
        backdrop-filter: blur(1px);
        cursor: progress;
    }
    .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
    }
</style>
