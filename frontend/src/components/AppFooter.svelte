<script>
    /**
     * Global footer, on every screen: the app version. A player can only join a
     * DM with the same version (see lan/host.go), so it's worth seeing at a glance.
     *
     * Updates: at most once a day, on launch, the latest GitHub release is checked
     * (updates.go: CheckForUpdate); a newer one shows "v0.5.3 available · Update" here.
     * "Update" opens this platform's file (or the release page) in the browser — the user
     * installs it as usual; the database is kept (one dnd.db, see db.go).
     * The last answer is kept in localStorage, so the notice stays all day without asking
     * again; no network — nothing is shown, and the next launch tries again.
     */
    import { onMount } from "svelte";
    import { Browser } from "@wailsio/runtime";
    import { server } from "../server.svelte.js";
    import { CheckForUpdate } from "../api.js";

    const KEY = "dnd-update-check";
    const DAY = 24 * 60 * 60 * 1000;

    let info = $state(null); // UpdateInfo (updates.go)

    // a > b by major.minor.patch ("0.5.10" > "0.5.9"; a "-beta" suffix is ignored)
    function newer(a, b) {
        const p = (v) => (/^(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? "")) ?? []).slice(1).map(Number);
        const x = p(a), y = p(b);
        if (x.length !== 3 || y.length !== 3) return false;
        for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
        return false;
    }

    onMount(async () => {
        let cached = null;
        try {
            cached = JSON.parse(localStorage.getItem(KEY) ?? "null");
        } catch {
            // no storage (private mode…): ask every launch
        }
        if (!cached?.info || !(Date.now() - cached.at < DAY)) {
            try {
                cached = { at: Date.now(), info: await CheckForUpdate() };
                try {
                    localStorage.setItem(KEY, JSON.stringify(cached));
                } catch {
                    // not kept — fine
                }
            } catch {
                return; // offline / GitHub unavailable: nothing to show
            }
        }
        info = cached.info;
    });

    // newer than what runs now (an answer cached before this app was updated doesn't count)
    const available = $derived(!!info?.latest && !!server.appVersion && newer(info.latest, server.appVersion));

    function update() {
        const url = info?.downloadUrl || info?.pageUrl;
        if (!url) return;
        Browser.OpenURL(url).catch(() => window.open(url, "_blank", "noopener"));
    }
</script>

<footer class="app-footer">
    {#if available}
        <span class="upd" title={info.name || `Version ${info.latest}`}>
            v{info.latest} available
            <button onclick={update} title={info.downloadUrl ? "Download the new version" : "Open the release page"}
                >Update</button
            >
        </span>
    {/if}
    <span>DnD Builder</span>
    <span class="v" title="App version — players and the DM need the same one">v{server.appVersion || "—"}</span>
</footer>

<style>
    .app-footer {
        height: 22px;
        padding: 0 16px;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        background: var(--color-sidebar);
        border-top: 1px solid var(--color-border);
        font-family: var(--font-ui);
        font-size: 11px;
        color: var(--color-text-muted);
        user-select: none;
        white-space: nowrap;
        overflow: hidden;
    }

    .v {
        font-variant-numeric: tabular-nums;
        color: var(--color-text-secondary);
        user-select: text;
    }

    /* a newer release: "v0.5.3 available · Update" */
    .upd {
        margin-right: auto; /* to the left, away from the version */
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--color-gold);
    }

    .upd button {
        padding: 0 8px;
        height: 16px;
        background: var(--color-gold);
        border: none;
        border-radius: 4px;
        color: var(--color-bg);
        font-family: var(--font-ui);
        font-size: 10px;
        font-weight: var(--font-weight-semibold);
        line-height: 16px;
        cursor: pointer;
    }

    .upd button:hover {
        background: var(--color-gold-hover);
    }

    @media print {
        .app-footer {
            display: none;
        }
    }
</style>
