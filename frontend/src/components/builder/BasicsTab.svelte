<script>
    /**
     * "Basics" tab: portrait, name, Personality, Appearance.
     * build — a CharacterBuild instance (reactive); fields are edited directly.
     */
    import { BIO_GROUPS } from "../../models/CharacterBuild.svelte.js";

    let { build } = $props();

    const PORTRAIT_MAX = 512; // px — large images are downscaled to keep saves small

    let fileInput;

    function pickPortrait(e) {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = "";
        if (!file || !file.type.startsWith("image/")) return;

        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, PORTRAIT_MAX / Math.max(img.width, img.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            build.portrait = canvas.toDataURL("image/jpeg", 0.85);
            build.touch();
            URL.revokeObjectURL(url);
        };
        img.src = url;
    }

    function clearPortrait() {
        build.portrait = null;
        build.touch();
    }
</script>

<div class="basics">
    <div class="identity">
        <div class="portrait">
            <button
                class="portrait-box"
                onclick={() => fileInput.click()}
                title="Choose image"
            >
                {#if build.portrait}
                    <img src={build.portrait} alt="Character portrait" />
                {:else}
                    <span class="placeholder">
                        <span class="plus">+</span>
                        Portrait
                    </span>
                {/if}
            </button>
            {#if build.portrait}
                <button class="link" onclick={clearPortrait}>Remove</button>
            {/if}
            <input
                bind:this={fileInput}
                type="file"
                accept="image/*"
                hidden
                onchange={pickPortrait}
            />
        </div>

        <label class="field name">
            <span>Name</span>
            <input
                type="text"
                placeholder="E.g. Thorin"
                bind:value={build.name}
                oninput={() => build.touch()}
            />
        </label>
    </div>

    {#each BIO_GROUPS as group}
        <fieldset class="group">
            <legend>{group.title}</legend>
            <div class="fields">
                {#each group.fields as f (f.key)}
                    <label class="field" class:wide={f.wide}>
                        <span>{f.label}</span>
                        {#if f.wide}
                            <textarea
                                rows="2"
                                bind:value={build.bio[f.key]}
                                oninput={() => build.touch()}
                            ></textarea>
                        {:else}
                            <input
                                type="text"
                                bind:value={build.bio[f.key]}
                                oninput={() => build.touch()}
                            />
                        {/if}
                    </label>
                {/each}
            </div>
        </fieldset>
    {/each}
</div>

<style>
    .basics {
        display: flex;
        flex-direction: column;
        gap: 24px;
    }

    /* --- portrait + name --- */
    .identity {
        display: flex;
        align-items: flex-start;
        gap: 20px;
    }

    .portrait {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
    }

    .portrait-box {
        width: 140px;
        height: 140px;
        padding: 0;
        overflow: hidden;
        background: var(--color-card-elevated);
        border: 1px dashed var(--color-border);
        border-radius: 8px;
        color: var(--color-gold);
        cursor: pointer;
    }

    .portrait-box:hover {
        border-color: var(--color-gold);
    }

    .portrait-box img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }

    .placeholder {
        display: flex;
        flex-direction: column;
        align-items: center;
        font-family: var(--font-ui);
        font-size: 12px;
    }

    .plus {
        font-size: 32px;
        line-height: 1;
        font-weight: var(--font-weight-light);
    }

    .link {
        padding: 0;
        background: none;
        border: none;
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: 12px;
        cursor: pointer;
    }

    .link:hover {
        color: var(--color-danger);
    }

    .name {
        flex: 1;
        max-width: 420px;
    }

    .name input {
        font-family: var(--font-heading);
        font-size: 20px;
    }

    /* --- groups --- */
    .group {
        margin: 0;
        padding: 16px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
    }

    legend {
        padding: 0 8px;
        font-family: var(--font-heading-alt);
        font-size: 18px;
        color: var(--color-gold);
    }

    .fields {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 12px;
    }

    /* --- field --- */
    .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .field.wide {
        grid-column: 1 / -1;
    }

    .field span {
        font-family: var(--font-form);
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    input,
    textarea {
        width: 100%;
        padding: 8px 10px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-primary);
        font-family: var(--font-form);
        font-size: 14px;
        outline: none;
    }

    textarea {
        resize: vertical;
        font-family: var(--font-lore);
        font-size: 15px;
    }

    input:focus,
    textarea:focus {
        border-color: var(--color-gold);
    }

    input::placeholder {
        color: var(--color-text-muted);
    }
</style>
