<script>
    /**
     * Choice grid: 250×250 cells — image + name.
     * items    — [{ id, name, image }]
     * onpick(id)
     * caption  — (item) => line below the name (optional)
     * badge    — (item) => a count / mark in the corner (optional; falsy — none): "×2"
     * small    — smaller cells (160px) for long lists (weapons)
     */
    let { items = [], onpick, caption = null, badge = null, small = false } = $props();
</script>

<div class="grid" class:small>
    {#each items as item (item.id)}
        {@const b = badge?.(item)}
        <button class="cell" class:marked={!!b} onclick={() => onpick(item.id)} title={item.name}>
            {#if b}<span class="badge">{b}</span>{/if}
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
        /* auto-fit collapses empty tracks, so a short row (few items) is centered too */
        grid-template-columns: repeat(auto-fit, var(--cell));
        grid-auto-rows: var(--cell);
        justify-content: center;
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

    .grid.small {
        --cell: 160px;
    }

    .grid.small .cell-name {
        padding: 22px 8px 8px;
        font-size: 15px;
    }

    .cell.marked {
        border-color: var(--color-gold);
    }

    .badge {
        position: absolute;
        top: 6px;
        right: 6px;
        z-index: 1;
        min-width: 26px;
        padding: 2px 7px;
        background: var(--color-gold);
        border-radius: 999px;
        font-family: var(--font-ui);
        font-size: 13px;
        font-weight: var(--font-weight-bold);
        color: var(--color-bg);
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

    /* phones: two square cells per row, filling the width */
    @media (max-width: 640px) {
        .grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            grid-auto-rows: auto;
            gap: 10px;
        }

        .cell {
            width: auto;
            height: auto;
            aspect-ratio: 1;
        }

        .cell-name {
            padding: 20px 6px 8px;
            font-size: 14px;
        }

        .cell:hover {
            transform: none;
        }

        /* long lists (weapons): three per row */
        .grid.small {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
        }

        .grid.small .cell-name {
            padding: 16px 4px 6px;
            font-size: 12px;
        }

        .grid.small .cell-name small {
            font-size: 10px;
        }
    }
</style>
