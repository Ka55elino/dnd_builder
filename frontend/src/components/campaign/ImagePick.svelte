<script>
    /**
     * A picture field: shows the image (or a letter), "Choose…" picks a file, "Remove" clears it.
     * The file is scaled down to `max` px and becomes a data URL; Go stores it in the images
     * table on save (images.go) and the record keeps its /img/db/ URL.
     *
     * value — bind: URL / data URL / ""; letter — shown without an image; round — a circle (portraits)
     */
    let { value = $bindable(""), letter = "?", round = false, max = 512, label = "Image" } = $props();
    let input;

    function pick(e) {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = "";
        if (!file || !file.type.startsWith("image/")) return;
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const k = Math.min(1, max / Math.max(img.width, img.height));
            const c = document.createElement("canvas");
            c.width = Math.round(img.width * k);
            c.height = Math.round(img.height * k);
            c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
            value = c.toDataURL("image/jpeg", 0.88);
            URL.revokeObjectURL(url);
        };
        img.src = url;
    }
</script>

<div class="pick">
    <div class="pic" class:round>
        {#if value}<img src={value} alt="" />{:else}<span>{letter}</span>{/if}
    </div>
    <div class="btns">
        <span class="lbl">{label}</span>
        <button type="button" class="cp-btn cp-sm" onclick={() => input.click()}>Choose…</button>
        {#if value}<button type="button" class="cp-btn cp-sm cp-danger" onclick={() => (value = "")}>Remove</button>{/if}
    </div>
    <input bind:this={input} type="file" accept="image/*" onchange={pick} hidden />
</div>

<style>
    .pick {
        display: flex;
        align-items: center;
        gap: 14px;
    }

    .pic {
        width: 88px;
        height: 88px;
        flex: none;
        display: grid;
        place-items: center;
        overflow: hidden;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-border);
        border-radius: 10px;
        font-family: var(--font-heading);
        font-size: 32px;
        color: var(--color-text-muted);
    }

    .pic.round {
        border-radius: 50%;
    }

    .pic img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .btns {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
    }

    .lbl {
        font-size: 12px;
        color: var(--color-text-muted);
    }
</style>
