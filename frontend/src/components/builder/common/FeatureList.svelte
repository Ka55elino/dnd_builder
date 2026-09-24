<script>
    /**
     * Список черт / умений: [{ name, desc, level? }].
     * Уровень показывается пометкой «N ур.».
     */
    let { items = [], empty = "Описание пока не заполнено." } = $props();
</script>

{#if items?.length}
    <ul class="features">
        {#each items as f}
            <li>
                <span class="name">
                    {f.name}
                    {#if f.level}<span class="lvl">{f.level} ур.</span>{/if}
                </span>
                <span class="desc">{f.desc}</span>
            </li>
        {/each}
    </ul>
{:else}
    <p class="muted">{empty}</p>
{/if}

<style>
    .features {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    li {
        display: flex;
        flex-direction: column;
    }

    .name {
        font-family: var(--font-ui);
        font-weight: var(--font-weight-semibold);
        font-size: 13px;
        color: var(--color-text-primary);
    }

    .lvl {
        margin-left: 6px;
        font-weight: var(--font-weight-regular);
        font-size: 11px;
        color: var(--color-text-muted);
    }

    .desc {
        font-family: var(--font-spell);
        font-size: 15px;
        color: var(--color-text-secondary);
    }

    .muted {
        margin: 0;
        color: var(--color-text-muted);
    }
</style>
