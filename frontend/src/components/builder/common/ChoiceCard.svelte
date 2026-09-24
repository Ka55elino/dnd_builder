<script>
    /**
     * Выбранная карточка: картинка слева, описание справа, × — отменить выбор.
     * item     — { name, image }
     * badge    — подпись над названием ('Раса', 'Класс'...)
     * sub      — вариант для под-выбора (подраса/подкласс): фиолетовая рамка
     * compact  — маленькая картинка (для списков: оружие, предметы)
     * onclear()
     * children — содержимое описания
     */
    let { item, badge = "", sub = false, compact = false, onclear, children } = $props();
</script>

<article class="active" class:sub class:compact>
    <button
        class="clear"
        onclick={onclear}
        title="Отменить выбор"
        aria-label="Отменить выбор">×</button
    >

    <div class="active-img">
        {#if item.image}
            <img src={item.image} alt="" />
        {:else}
            <span class="img-empty"></span>
        {/if}
    </div>

    <div class="active-body">
        <span class="badge">{badge} · выбрано</span>
        <h3>{item.name}</h3>
        {@render children?.()}
    </div>
</article>

<style>
    .active {
        --cell: 250px;

        position: relative;
        display: flex;
        gap: 20px;
        padding: 16px;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-gold);
        border-radius: 10px;
    }

    .active.compact {
        --cell: 96px;
        gap: 14px;
        padding: 12px;
    }

    .active.compact h3 {
        font-size: 18px;
    }

    .active.sub {
        border-color: var(--color-magic-purple);
    }

    .active-img {
        flex: 0 0 var(--cell);
        height: var(--cell);
        border-radius: 8px;
        overflow: hidden;
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

    .active-body {
        flex: 1;
        min-width: 0;
        padding-right: 32px;
    }

    .clear {
        position: absolute;
        top: 10px;
        right: 10px;
        width: 30px;
        height: 30px;
        padding: 0;
        display: grid;
        place-items: center;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 50%;
        color: var(--color-text-secondary);
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
    }

    .clear:hover {
        border-color: var(--color-danger);
        color: var(--color-danger);
    }

    .badge {
        font-family: var(--font-ui);
        font-size: 11px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-success);
    }

    h3 {
        margin: 2px 0 8px;
        font-family: var(--font-heading);
        font-size: 24px;
        color: var(--color-gold);
    }

    .sub h3 {
        font-family: var(--font-heading-alt);
        color: var(--color-text-primary);
    }
</style>
