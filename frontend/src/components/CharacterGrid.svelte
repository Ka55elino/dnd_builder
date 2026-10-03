<script>
    let {
        characters = [],
        onCreate = () => console.log("[create]"),
        onOpen = (id) => console.log("[open]", id),
        showCreate = true, // false: pick-only grid (Join Game)
        header = null, // snippet above the cards — spans exactly the width of the card columns
    } = $props();
</script>

<div class="grid">
    {#if header}<div class="head">{@render header()}</div>{/if}
    {#if showCreate}
        <button class="cell create" onclick={onCreate} title="Create character">
            <span class="plus">+</span>
            <span class="label">Create</span>
        </button>
    {/if}

    {#each characters as c (c.id)}
        <button
            class="cell character"
            onclick={() => onOpen(c.id)}
            title={c.name}
        >
            {#if c.portrait}
                <img class="portrait" src={c.portrait} alt="" />
            {/if}
            <span class="label name">{c.name}</span>
            <span class="label meta">
                {[c.className, c.level ? `Level ${c.level}` : ""].filter(Boolean).join(" · ")}
            </span>
        </button>
    {/each}
</div>

<style>
    .grid {
        --cell-size: 200px;

        /* full width: otherwise inside a centered flex parent the grid
           shrinks to a single column and the cards stack vertically */
        width: 100%;
        display: grid;
        grid-template-columns: repeat(auto-fill, var(--cell-size));
        /* rows: the cards set their own height (a header row can be shorter) */
        justify-content: center; /* rows centered on the page */
        gap: 12px;
    }

    /* the header spans all the columns, so it is as wide as the cards below */
    .head {
        grid-column: 1 / -1;
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-bottom: 12px;
    }

    .cell {
        width: var(--cell-size);
        height: var(--cell-size);
        padding: 8px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;

        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        cursor: pointer;
        transition:
            background 0.15s,
            border-color 0.15s,
            color 0.15s;
    }

    .cell:hover {
        background: var(--color-card-elevated);
        border-color: var(--color-gold);
    }

    .cell:focus-visible {
        outline: 2px solid var(--color-gold);
        outline-offset: 2px;
    }

    .create {
        border-style: dashed;
        color: var(--color-gold);
    }

    .create:hover {
        color: var(--color-gold-hover);
    }

    .plus {
        font-size: 36px;
        line-height: 1;
        font-weight: var(--font-weight-light);
    }

    .character {
        position: relative;
        padding: 0;
        overflow: hidden;
        justify-content: flex-end;
    }

    .portrait {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .character .label {
        position: relative;
        padding: 0 8px;
    }

    .character .name {
        width: 100%;
        padding-top: 24px;
        background: linear-gradient(transparent, var(--color-bg) 60%);
        font-family: var(--font-heading);
        font-size: 16px;
        color: var(--color-gold);
    }

    .character .meta {
        width: 100%;
        padding-bottom: 8px;
        background: var(--color-bg);
        color: var(--color-text-secondary);
    }

    .label {
        max-width: 100%;
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
</style>
