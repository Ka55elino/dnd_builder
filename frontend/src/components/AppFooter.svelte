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
     * "Check for updates" (when there is no notice) asks right away, whatever the timer says.
     * Android: "Update" opens the release page in the default browser (download the APK there
     * and install it) — a direct APK link from inside the app hung or vanished.
     */
    import { onMount, onDestroy } from "svelte";
    import { openExternal, isAndroidApp } from "../device.js";
    import { server } from "../server.svelte.js";
    import { CheckForUpdate } from "../api.js";

    const KEY = "dnd-update-check";
    const DAY = 24 * 60 * 60 * 1000;

    let info = $state(null); // UpdateInfo (updates.go)
    let checking = $state(false);
    let result = $state(""); // after a manual check: "Up to date" / "Check failed" (for a few seconds)
    let resultTimer;

    // a > b by major.minor.patch ("0.5.10" > "0.5.9"; a "-beta" suffix is ignored)
    function newer(a, b) {
        const p = (v) => (/^(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? "")) ?? []).slice(1).map(Number);
        const x = p(a), y = p(b);
        if (x.length !== 3 || y.length !== 3) return false;
        for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
        return false;
    }

    // ask GitHub now; the answer is kept for the day. Returns false if it failed.
    async function ask() {
        try {
            const fresh = await CheckForUpdate();
            info = fresh;
            try {
                localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), info: fresh }));
            } catch {
                // not kept — fine
            }
            return true;
        } catch {
            return false; // offline / GitHub unavailable
        }
    }

    // on launch: the day's answer if there is one, otherwise ask
    onMount(async () => {
        let cached = null;
        try {
            cached = JSON.parse(localStorage.getItem(KEY) ?? "null");
        } catch {
            // no storage (private mode…): ask every launch
        }
        if (cached?.info && Date.now() - cached.at < DAY) info = cached.info;
        else await ask();
    });
    onDestroy(() => clearTimeout(resultTimer));

    // "Check for updates": right away, whatever the timer says
    async function checkNow() {
        if (checking) return;
        checking = true;
        result = "";
        const ok = await ask();
        checking = false;
        if (available) return; // the notice shows instead
        result = ok ? "Up to date" : "Check failed";
        clearTimeout(resultTimer);
        resultTimer = setTimeout(() => (result = ""), 4000);
    }

    // newer than what runs now (an answer cached before this app was updated doesn't count)
    const available = $derived(!!info?.latest && !!server.appVersion && newer(info.latest, server.appVersion));

    function update() {
        // Android: the release page in the default browser; elsewhere — this platform's file
        const url = isAndroidApp() ? info?.pageUrl : info?.downloadUrl || info?.pageUrl;
        if (url) openExternal(url);
    }
</script>

<footer class="app-footer">
    {#if available}
        <span class="upd" title={info.name || `Version ${info.latest}`}>
            v{info.latest} available
            <button onclick={update} title={info.downloadUrl && !isAndroidApp() ? "Download the new version" : "Open the release page"}
                >Update</button
            >
        </span>
    {:else}
        <span class="chk">
            <!-- the result for a few seconds, then the button again -->
            {#if result}
                <span class="res" class:bad={result !== "Up to date"}>{result}</span>
            {:else}
                <button onclick={checkNow} disabled={checking} title="Look for a newer version on GitHub"
                    >{checking ? "Checking…" : "Check for updates"}</button
                >
            {/if}
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

    /* no notice: "Check for updates" (asks right away) */
    .chk {
        margin-right: auto;
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .chk button {
        padding: 0;
        background: none;
        border: none;
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: 11px;
        cursor: pointer;
    }

    .chk button:hover:not(:disabled) {
        color: var(--color-gold);
        text-decoration: underline;
    }

    .chk button:disabled {
        cursor: default;
    }

    .res {
        color: var(--color-success);
    }

    .res.bad {
        color: var(--color-danger);
    }

    @media print {
        .app-footer {
            display: none;
        }
    }
</style>
