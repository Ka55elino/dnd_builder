<script>
    /**
     * Campaign → Sessions: every game night, newest first. A session is planned → played now
     * (“▶ Start”: the game's auto-log — combat, Give Item — writes into it) → played.
     * Opening one shows SessionView (prep, log, after). Notes live here too: the DM's notes
     * of a session are in its “After” tab.
     *
     * campaign — the campaign ({ id, … }); onChanged() — after a change (the counts)
     */
    import { onMount } from "svelte";
    import "./campaign.css";
    import { loadSessions, saveSession, deleteSession, setSessionStatus, SESSION_STATUSES } from "../../data/campaigns.js";
    import SessionView from "./SessionView.svelte";

    let { campaign, onChanged } = $props();

    let sessions = $state([]);
    let loading = $state(true);
    let error = $state("");
    let openId = $state(null);
    let confirmDelete = $state(null);

    const statusName = (s) => SESSION_STATUSES.find((x) => x.id === s)?.name ?? s;
    const date = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString() : "");

    async function reload() {
        sessions = await loadSessions(campaign.id);
    }

    onMount(async () => {
        try {
            await reload();
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            loading = false;
        }
    });

    // a new session: the next number; secrets not revealed last time carry over
    async function create() {
        try {
            const last = sessions.find((s) => s.status !== "planned") ?? sessions[0];
            const carry = (last?.data?.secrets ?? []).filter((x) => !x.revealed).map((x) => ({ text: x.text, revealed: false }));
            const id = await saveSession({
                campaignId: campaign.id,
                title: "",
                status: "planned",
                ingameDate: last?.ingameDate ?? "",
                data: { prep: "", secrets: carry, planned: { npcs: [], locations: [], encounters: [], quests: [] } },
            });
            await reload();
            onChanged?.();
            openId = id;
        } catch (e) {
            error = e?.message ?? String(e);
        }
    }

    async function status(s, st) {
        try {
            await setSessionStatus(s.id, st);
            await reload();
        } catch (e) {
            error = e?.message ?? String(e);
        }
    }

    async function remove(s) {
        confirmDelete = null;
        try {
            await deleteSession(s.id);
            await reload();
            onChanged?.();
        } catch (e) {
            error = e?.message ?? String(e);
        }
    }

    async function back() {
        openId = null;
        await reload();
        onChanged?.();
    }
</script>

{#if openId}
    {#key openId}
        <SessionView {campaign} id={openId} onBack={back} />
    {/key}
{:else}
    <div class="cp-toolbar">
        <span class="cp-muted">Prep, the log of what happened, and your notes — one session per game night.</span>
        <span class="cp-grow"></span>
        <button class="cp-btn cp-add" onclick={create}>+ New session</button>
    </div>

    {#if loading}
        <p class="cp-muted">Loading…</p>
    {:else if error}
        <p class="cp-error">{error}</p>
    {:else if !sessions.length}
        <div class="cp-empty">
            <p>No sessions yet. Plan the first one: where it starts, what can be found, which encounters may happen.</p>
            <button class="cp-btn cp-add" onclick={create}>+ Plan session 1</button>
        </div>
    {:else}
        <div class="sessions">
            {#each sessions as s (s.id)}
                <article class="sess st-{s.status}">
                    <button class="s-open" onclick={() => (openId = s.id)}>
                        <span class="s-num">{s.number}</span>
                        <span class="s-main">
                            <span class="s-title">{s.title || `Session ${s.number}`}</span>
                            <span class="s-meta">
                                <span class="cp-chip s-chip">{statusName(s.status)}</span>
                                {#if s.playedOn}<span>{date(s.playedOn)}</span>{/if}
                                {#if s.ingameDate}<span>· {s.ingameDate}</span>{/if}
                                {#if s.events}<span>· {s.events} log entr{s.events === 1 ? "y" : "ies"}</span>{/if}
                            </span>
                            {#if s.data?.recap || s.data?.prep}<span class="s-text">{s.data.recap || s.data.prep}</span>{/if}
                        </span>
                    </button>
                    <div class="s-act">
                        {#if s.status === "active"}
                            <button class="cp-btn cp-sm" onclick={() => status(s, "played")} title="End the session">■ End</button>
                        {:else if s.status === "planned"}
                            <button class="cp-btn cp-sm cp-add" onclick={() => status(s, "active")}
                                title="Start playing: the game's log (combat, Give Item) goes here">▶ Start</button>
                        {/if}
                        {#if confirmDelete === s.id}
                            <span class="cp-muted">Delete with its log?</span>
                            <button class="cp-btn cp-sm cp-danger" onclick={() => remove(s)}>Delete</button>
                            <button class="cp-btn cp-sm" onclick={() => (confirmDelete = null)}>No</button>
                        {:else}
                            <button class="cp-btn cp-sm" onclick={() => (confirmDelete = s.id)} title="Delete">✕</button>
                        {/if}
                    </div>
                </article>
            {/each}
        </div>
    {/if}
{/if}

<style>
    .sessions {
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-width: 960px;
    }

    .sess {
        display: flex;
        align-items: stretch;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-left: 3px solid var(--color-border);
        border-radius: 10px;
    }

    .sess.st-active {
        border-left-color: var(--color-success);
        box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-success) 40%, transparent);
    }

    .sess.st-planned {
        border-left-color: var(--color-gold);
    }

    .s-open {
        flex: 1;
        display: flex;
        gap: 14px;
        padding: 12px 14px;
        background: none;
        border: none;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
        min-width: 0;
    }

    .s-num {
        width: 40px;
        flex: none;
        font-family: var(--font-heading);
        font-size: 28px;
        line-height: 1;
        color: var(--color-gold);
        text-align: center;
    }

    .s-main {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
    }

    .s-title {
        font-family: var(--font-heading);
        font-size: 18px;
        color: var(--color-text-primary);
    }

    .s-open:hover .s-title {
        color: var(--color-gold-hover);
    }

    .s-meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .st-active .s-chip {
        border-color: var(--color-success);
        color: var(--color-success);
    }

    .s-text {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        font-size: 13px;
        line-height: 1.4;
        color: var(--color-text-secondary);
    }

    .s-act {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 0 12px;
    }
</style>
