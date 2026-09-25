<script>
    /**
     * Choice grid: 250×250 cells — image + name.
     * items    — [{ id, name, image }]
     * onpick(id)
     * caption  — (item) => line below the name (optional)
     */
    let { items = [], onpick, caption = null } = $props();
</script>

<div class="grid">
    {#each items as item (item.id)}
        <button class="cell" onclick={() => onpick(item.id)} title={item.name}>
            {#if item.image}
                <img src={item.image} alt="" />
            {:else}
                <span class="img-empty"></span>
            {/if}
            <span class="cell-name">
                {item.name}
                {#if caption}
                    {@const c = caption(item)}
                    {#if c}<small>{c}</small>{/if}
                {/if}
            </span>
        </button>
    {/each}
</div>

<style>
    .grid {
        --cell: 250px;

        display: grid;
        grid-template-columns: repeat(auto-fill, var(--cell));
        grid-auto-rows: var(--cell);
        gap: 16px;
    }

    .cell {
        position: relative;
        width: var(--cell);
        height: var(--cell);
        padding: 0;
        overflow: hidden;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-border);
        border-radius: 10px;
        cursor: pointer;
        transition:
            border-color 0.15s,
            transform 0.15s;
    }

    .cell:hover {
        border-color: var(--color-gold);
        transform: translateY(-2px);
    }

    .cell:focus-visible {
        outline: 2px solid var(--color-gold);
        outline-offset: 2px;
    }

    img,
    .img-empty {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: cover;
    }

    .img-empty {
        background: var(--color-card);
    }

    .cell-name {
        position: absolute;
        inset: auto 0 0 0;
        padding: 28px 12px 12px;
        background: linear-gradient(transparent, var(--color-bg) 70%);
        font-family: var(--font-heading);
        font-size: 18px;
        color: var(--color-gold);
        text-align: center;
    }

    .cell-name small {
        display: block;
        margin-top: 2px;
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .cell:hover .cell-name {
        color: var(--color-gold-hover);
    }
</style>
