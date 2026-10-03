<script>
    /**
     * One session: three tabs.
     *   Prep  — the plan, secrets & clues (a checklist: ticking one logs “revealed”), what's
     *           planned (NPCs, locations, encounters, quests — they come first in the log bar)
     *   Log   — what happened. The log bar adds an entry; entries that change something
     *           (quest received, NPC met, reputation…) change it right away, and deleting the
     *           entry puts the old value back. Combat and Give Item log themselves while the
     *           session is being played (▶ Start).
     *   After — recap, the DM's notes, who played, XP, loot (none of it is shown to the players)
     * Everything typed is saved by itself a moment later.
     *
     * campaign — the campaign; id — the session; onBack()
     */
    import { onMount, onDestroy, untrack } from "svelte";
    import "./campaign.css";
    import {
        loadSession, saveSession, setSessionStatus, loadEvents, addEvent, updateEvent, deleteEvent,
        loadNpcs, loadLocations, loadQuests, loadFactions, loadCampaignEncounters, locationTree,
        EVENT_KINDS, eventKind, eventText, ENCOUNTER_OUTCOMES, SKIP_REASONS, SESSION_STATUSES,
        NPC_ATTITUDES, NPC_STATUSES, QUEST_STATUSES,
    } from "../../data/campaigns.js";

    // embedded — inside the DM's game screen: no "← Sessions", opens on the Log
    let { campaign, id, onBack = null, embedded = false } = $props();

    let session = $state(null);
    let form = $state(null); // what's edited: title, playedOn, ingameDate, data
    let events = $state([]);
    let npcs = $state([]);
    let locations = $state([]);
    let quests = $state([]);
    let factions = $state([]);
    let encounters = $state([]);
    let loading = $state(true);
    let error = $state("");
    let tab = $state("log");

    // ---------- loading ----------
    async function reloadLists() {
        [npcs, locations, quests, factions, encounters] = await Promise.all([
            loadNpcs(campaign.id), loadLocations(campaign.id), loadQuests(campaign.id),
            loadFactions(campaign.id), loadCampaignEncounters(campaign.id),
        ]);
    }
    async function reloadSession() {
        session = await loadSession(id);
        // the server changes secrets (revealed) through the log — take them from it
        if (form) form.data.secrets = (session.data?.secrets ?? []).map((x) => ({ ...x }));
    }
    const reloadEvents = async () => (events = await loadEvents(id));

    onMount(async () => {
        try {
            session = await loadSession(id);
            const d = session.data ?? {};
            form = {
                title: session.title,
                playedOn: session.playedOn,
                ingameDate: session.ingameDate,
                data: {
                    ...d,
                    prep: d.prep ?? "",
                    secrets: (d.secrets ?? []).map((x) => ({ text: x.text ?? "", revealed: !!x.revealed })),
                    planned: { npcs: [], locations: [], encounters: [], quests: [], ...(d.planned ?? {}) },
                    recap: d.recap ?? "",
                    notes: d.notes ?? "",
                    attendees: (d.attendees ?? []).join(", "),
                    xp: d.xp ?? "",
                    loot: d.loot ?? "",
                },
            };
            savedJson = untrack(() => JSON.stringify(toSave()));
            tab = embedded ? "log" : session.status === "planned" ? "prep" : "log";
            await Promise.all([reloadLists(), reloadEvents()]);
        } catch (e) {
            error = e?.message ?? String(e);
        } finally {
            loading = false;
        }
    });

    // ---------- autosave ----------
    function toSave() {
        const d = form.data;
        return {
            ...session,
            title: form.title.trim(),
            playedOn: form.playedOn,
            ingameDate: form.ingameDate.trim(),
            data: {
                ...d,
                secrets: d.secrets.map((x) => ({ text: x.text.trim(), revealed: !!x.revealed })),
                attendees: d.attendees.split(",").map((x) => x.trim()).filter(Boolean),
            },
        };
    }
    let savedJson = $state("");
    let saving = $state(false);
    let saveError = $state("");
    let timer;
    const formJson = $derived(form && session ? JSON.stringify(toSave()) : "");
    const dirty = $derived(!!formJson && formJson !== savedJson);
    $effect(() => {
        if (!dirty) return;
        clearTimeout(timer);
        timer = setTimeout(saveNow, 800);
        return () => clearTimeout(timer);
    });
    async function saveNow() {
        clearTimeout(timer);
        if (!form || !dirty) return;
        const json = formJson;
        saving = true;
        try {
            await saveSession(JSON.parse(json));
            savedJson = json;
            saveError = "";
        } catch (e) {
            saveError = e?.message ?? String(e);
        } finally {
            saving = false;
        }
    }

    // closing (e.g. switching the game screen's tab): don't lose the last second of typing
    onDestroy(() => {
        if (dirty) saveNow();
    });

    async function back() {
        await saveNow();
        onBack?.();
    }

    async function setStatus(st) {
        await saveNow();
        try {
            await setSessionStatus(id, st);
            session = { ...session, status: st };
            savedJson = JSON.stringify(toSave());
        } catch (e) {
            error = e?.message ?? String(e);
        }
    }

    // ---------- names ----------
    const tree = $derived(locationTree(locations));
    const plannedOf = (type) => form?.data.planned?.[type] ?? [];
    const SUBJECTS = $derived({
        npc: npcs.map((n) => ({ id: n.id, name: n.name })),
        quest: quests.map((q) => ({ id: q.id, name: q.name })),
        location: tree.map((t) => ({ id: t.loc.id, name: t.path })),
        faction: factions.map((f) => ({ id: f.id, name: f.name })),
        encounter: encounters.map((e) => ({ id: e.id, name: e.name })),
    });
    const PLAN_KEY = { npc: "npcs", location: "locations", encounter: "encounters", quest: "quests" };
    // planned ones first
    const subjects = (type) => {
        const all = SUBJECTS[type] ?? [];
        const planned = new Set(plannedOf(PLAN_KEY[type]));
        return [...all.filter((x) => planned.has(x.id)), ...all.filter((x) => !planned.has(x.id))].map((x) => ({ ...x, planned: planned.has(x.id) }));
    };
    const objectivesById = $derived(Object.fromEntries(quests.map((q) => [q.id, q.data?.objectives ?? []])));
    const textOf = (e) =>
        eventText(e, {
            attitudes: NPC_ATTITUDES,
            statuses: NPC_STATUSES,
            questStatuses: QUEST_STATUSES,
            secrets: form?.data.secrets ?? [],
            objectives: objectivesById,
        });
    const outcomeName = (o) => [...ENCOUNTER_OUTCOMES, ...SKIP_REASONS].find((x) => x.id === o)?.name ?? o;

    // ---------- the log bar ----------
    let kind = $state("npc_met");
    let subject = $state("");
    let param = $state("");
    let note = $state("");
    let adding = $state(false);
    let logError = $state("");
    const K = $derived(eventKind(kind));
    const groups = [...new Set(EVENT_KINDS.map((k) => k.group))];

    // a fresh parameter when the kind / subject changes
    $effect(() => {
        const k = kind;
        untrack(() => {
            const list = K.ref && K.ref !== "session" ? subjects(K.ref) : [];
            if (!list.some((x) => x.id === subject)) subject = list[0]?.id ?? "";
            param = defaultParam(k);
        });
    });
    function defaultParam(k) {
        switch (eventKind(k).param) {
            case "outcome": return "victory";
            case "skip": return "skipped";
            case "attitude": return "friendly";
            case "npcStatus": return "dead";
            case "questStatus": return "completed";
            case "delta": return 1;
            case "objective": {
                const i = (objectivesById[subject] ?? []).findIndex((o) => !o.done);
                return i >= 0 ? i : "";
            }
            case "secret": {
                const i = (form?.data.secrets ?? []).findIndex((x) => !x.revealed && x.text.trim());
                return i >= 0 ? i : "";
            }
        }
        return "";
    }
    // the objective list follows the quest
    $effect(() => {
        void subject; // re-run when the quest changes
        untrack(() => {
            if (K.param === "objective") param = defaultParam(kind);
        });
    });

    const canAdd = $derived.by(() => {
        if (adding) return false;
        if (K.ref && K.ref !== "session" && !subject) return false;
        if (["objective", "secret"].includes(K.param) && (param === "" || param == null)) return false;
        return true;
    });

    async function log(k = kind, subj = subject, prm = param, nt = note) {
        const meta = eventKind(k);
        const e = { sessionId: id, kind: k, note: nt.trim() };
        if (meta.ref === "session") Object.assign(e, { refType: "session", refId: id });
        else if (meta.ref) Object.assign(e, { refType: meta.ref, refId: subj });
        switch (meta.param) {
            case "outcome":
            case "skip": e.outcome = prm; break;
            case "attitude":
            case "npcStatus":
            case "questStatus": e.change = { to: prm }; break;
            case "delta": e.change = { delta: Math.round(Number(prm) || 0) }; break;
            case "objective":
            case "secret": e.change = { index: Number(prm) }; break;
        }
        adding = true;
        logError = "";
        try {
            await saveNow(); // the secrets the server changes must not be overwritten by an older save
            await addEvent(e);
            if (k === kind) note = "";
            await Promise.all([reloadEvents(), reloadLists(), reloadSession()]);
            savedJson = JSON.stringify(toSave());
            param = defaultParam(kind);
        } catch (err) {
            logError = err?.message ?? String(err);
        } finally {
            adding = false;
        }
    }

    async function undo(e) {
        try {
            await saveNow();
            await deleteEvent(e.id);
            await Promise.all([reloadEvents(), reloadLists(), reloadSession()]);
            savedJson = JSON.stringify(toSave());
        } catch (err) {
            logError = err?.message ?? String(err);
        }
    }

    // edit a note in place
    let editingNote = $state(null); // event id
    let noteDraft = $state("");
    async function saveNote(e) {
        if (noteDraft !== e.note) {
            try {
                await updateEvent(e.id, noteDraft, e.outcome, e.position);
                await reloadEvents();
            } catch (err) {
                logError = err?.message ?? String(err);
            }
        }
        editingNote = null;
    }

    async function move(e, dir) {
        const i = events.indexOf(e);
        const other = events[i + dir];
        if (!other) return;
        try {
            await updateEvent(e.id, e.note, e.outcome, other.position);
            await updateEvent(other.id, other.note, other.outcome, e.position === other.position ? e.position + dir : e.position);
            await reloadEvents();
        } catch (err) {
            logError = err?.message ?? String(err);
        }
    }

    const changeText = (e) => {
        const c = e.change;
        if (!c) return "";
        if (c.field === "visible") return c.from ? "" : "now known to the players";
        if (c.field === "status" && e.kind === "quest_received") return `${c.from} → active`;
        return "";
    };

    // ---------- prep: secrets and planned ----------
    let newSecret = $state("");
    function addSecret() {
        const t = newSecret.trim();
        if (!t) return;
        form.data.secrets = [...form.data.secrets, { text: t, revealed: false }];
        newSecret = "";
    }
    // ticking a secret logs "revealed" (the log keeps it); unticking deletes that entry
    async function toggleSecret(i) {
        const s = form.data.secrets[i];
        if (!s.text.trim()) return;
        if (!s.revealed) return log("secret_revealed", "", i, "");
        const ev = events.find((e) => e.kind === "secret_revealed" && e.change?.index === i);
        if (ev) return undo(ev);
        form.data.secrets[i].revealed = false;
    }
    // a secret the log refers to (by its place) can't be removed — the entries would point elsewhere
    const lastRefSecret = $derived(Math.max(-1, ...events.filter((e) => e.kind === "secret_revealed").map((e) => e.change?.index ?? -1)));

    let planPick = $state({ npcs: "", locations: "", encounters: "", quests: "" });
    const PLAN = [
        { key: "npcs", title: "NPCs", type: "npc" },
        { key: "locations", title: "Locations", type: "location" },
        { key: "encounters", title: "Encounters", type: "encounter" },
        { key: "quests", title: "Quests", type: "quest" },
    ];
    const nameIn = (type, idv) => SUBJECTS[type]?.find((x) => x.id === idv)?.name ?? "(deleted)";
    function plan(key, idv) {
        if (!idv || form.data.planned[key].includes(idv)) return;
        form.data.planned[key] = [...form.data.planned[key], idv];
        planPick[key] = "";
    }
    const unplan = (key, idv) => (form.data.planned[key] = form.data.planned[key].filter((x) => x !== idv));

    // quick buttons for what's planned
    const QUICK = [
        { type: "npc", key: "npcs", acts: [["npc_met", "Met"], ["npc_talked", "Talked"]] },
        { type: "encounter", key: "encounters", acts: [["encounter_done", "Fought"], ["encounter_skipped", "Skipped"]] },
        { type: "quest", key: "quests", acts: [["quest_received", "Received"], ["quest_status", "Done"]] },
        { type: "location", key: "locations", acts: [["location_visited", "Visited"]] },
    ];
    const quickParam = (k) => ({ encounter_done: "victory", encounter_skipped: "skipped", quest_status: "completed" })[k] ?? "";

    const statusName = (s) => SESSION_STATUSES.find((x) => x.id === s)?.name ?? s;
    const hhmm = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    function onKey(e) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            saveNow();
        }
    }
</script>

<svelte:window onkeydown={onKey} />

{#if loading}
    <p class="cp-muted">Loading…</p>
{:else if error && !session}
    <p class="cp-error">{error}</p>
{:else if session && form}
    <div class="head">
        {#if onBack}<button class="cp-btn cp-sm" onclick={back}>← Sessions</button>{/if}
        <span class="num">Session {session.number}</span>
        <input class="cp-input title" bind:value={form.title} placeholder="Title…" maxlength="120" aria-label="Title" />
        <span class="cp-chip st st-{session.status}">{statusName(session.status)}</span>
        {#if session.status === "active"}
            <button class="cp-btn cp-sm" onclick={() => setStatus("played")}>■ End session</button>
        {:else}
            <button class="cp-btn cp-sm cp-add" onclick={() => setStatus("active")}
                title="Start playing: combat and Give Item log themselves into this session">▶ {session.status === "played" ? "Resume" : "Start"}</button
            >
        {/if}
        <span class="save" class:dirty>{saveError ? `Not saved: ${saveError}` : saving ? "Saving…" : dirty ? "…" : "Saved"}</span>
    </div>
    <div class="dates">
        <label class="cp-field"><span>Played on</span><input class="cp-input" type="date" bind:value={form.playedOn} /></label>
        <label class="cp-field"><span>In-game date</span><input class="cp-input" bind:value={form.ingameDate} placeholder="Day 12, late autumn" /></label>
    </div>

    <nav class="tabs">
        {#each [["prep", "Prep"], ["log", `Log${events.length ? ` · ${events.length}` : ""}`], ["after", "After"]] as [t, label]}
            <button class:on={tab === t} onclick={() => (tab = t)}>{label}</button>
        {/each}
    </nav>

    {#if tab === "prep"}
        <section class="panel">
            <label class="cp-field"><span>The plan — how it starts, possible scenes</span>
                <textarea class="cp-textarea" rows="6" bind:value={form.data.prep}></textarea></label>

            <p class="cp-h">Secrets & clues <span class="cp-muted">— tick when the players learn it (it's logged)</span></p>
            <ul class="secrets">
                {#each form.data.secrets as s, i}
                    <li class:rev={s.revealed}>
                        <input type="checkbox" checked={s.revealed} onchange={(e) => { e.currentTarget.checked = s.revealed; toggleSecret(i); }}
                            aria-label="Revealed" disabled={adding || !s.text.trim()} />
                        <input class="cp-input grow" bind:value={s.text} />
                        <button class="cp-btn cp-sm cp-danger" disabled={s.revealed || i <= lastRefSecret}
                            title={i <= lastRefSecret ? "The log refers to it" : "Remove"}
                            onclick={() => (form.data.secrets = form.data.secrets.filter((_, j) => j !== i))}>✕</button>
                    </li>
                {/each}
            </ul>
            <div class="row">
                <input class="cp-input grow" bind:value={newSecret} placeholder="Something the players can find out…"
                    onkeydown={(e) => e.key === "Enter" && addSecret()} />
                <button class="cp-btn cp-sm" onclick={addSecret}>+ Secret</button>
            </div>

            <p class="cp-h">Planned <span class="cp-muted">— they come first in the log</span></p>
            <div class="planned">
                {#each PLAN as p (p.key)}
                    <div class="plan-col">
                        <span class="plan-t">{p.title}</span>
                        <div class="chips">
                            {#each form.data.planned[p.key] as pid (pid)}
                                <span class="pchip">{nameIn(p.type, pid)}<button onclick={() => unplan(p.key, pid)} aria-label="Remove">×</button></span>
                            {/each}
                        </div>
                        <select class="cp-select" bind:value={planPick[p.key]} onchange={() => plan(p.key, planPick[p.key])}>
                            <option value="">+ add…</option>
                            {#each SUBJECTS[p.type].filter((x) => !form.data.planned[p.key].includes(x.id)) as x (x.id)}<option value={x.id}>{x.name}</option>{/each}
                        </select>
                    </div>
                {/each}
            </div>
        </section>
    {:else if tab === "log"}
        <!-- the log bar -->
        <section class="panel bar">
            <div class="row">
                <select class="cp-select" bind:value={kind} aria-label="What happened">
                    {#each groups as g}
                        <optgroup label={g}>
                            {#each EVENT_KINDS.filter((k) => k.group === g) as k (k.id)}<option value={k.id}>{k.icon} {k.name}</option>{/each}
                        </optgroup>
                    {/each}
                </select>
                {#if K.ref && K.ref !== "session"}
                    <select class="cp-select grow" bind:value={subject} aria-label="About">
                        {#each subjects(K.ref) as x (x.id)}<option value={x.id}>{x.planned ? "★ " : ""}{x.name}</option>{:else}<option value="">— none in this campaign —</option>{/each}
                    </select>
                {/if}
                {#if K.param === "outcome"}
                    <select class="cp-select" bind:value={param}>{#each ENCOUNTER_OUTCOMES as o (o.id)}<option value={o.id}>{o.name}</option>{/each}</select>
                {:else if K.param === "skip"}
                    <select class="cp-select" bind:value={param}>{#each SKIP_REASONS as o (o.id)}<option value={o.id}>{o.name}</option>{/each}</select>
                {:else if K.param === "attitude"}
                    <select class="cp-select" bind:value={param}>{#each NPC_ATTITUDES as o (o.id)}<option value={o.id}>→ {o.name}</option>{/each}</select>
                {:else if K.param === "npcStatus"}
                    <select class="cp-select" bind:value={param}>{#each NPC_STATUSES as o (o.id)}<option value={o.id}>→ {o.name}</option>{/each}</select>
                {:else if K.param === "questStatus"}
                    <select class="cp-select" bind:value={param}>{#each QUEST_STATUSES as o (o.id)}<option value={o.id}>→ {o.name}</option>{/each}</select>
                {:else if K.param === "delta"}
                    <input class="cp-input delta" type="number" min="-20" max="20" bind:value={param} aria-label="Reputation change" />
                {:else if K.param === "objective"}
                    <select class="cp-select grow" bind:value={param}>
                        {#each objectivesById[subject] ?? [] as o, i}<option value={i} disabled={o.done}>{o.done ? "✓ " : ""}{o.text}</option>{:else}<option value="">— no objectives —</option>{/each}
                    </select>
                {:else if K.param === "secret"}
                    <select class="cp-select grow" bind:value={param}>
                        {#each form.data.secrets as s, i}<option value={i} disabled={s.revealed || !s.text.trim()}>{s.revealed ? "✓ " : ""}{s.text}</option>{:else}<option value="">— add secrets in Prep —</option>{/each}
                    </select>
                {/if}
            </div>
            <div class="row">
                <input class="cp-input grow" bind:value={note} placeholder="Note (optional)…" onkeydown={(e) => e.key === "Enter" && canAdd && log()} />
                <button class="cp-btn cp-primary" disabled={!canAdd} onclick={() => log()}>{adding ? "…" : "Log it"}</button>
            </div>
            {#if K.changes}<p class="hint">Changes the {K.ref === "session" ? "secret" : K.ref}'s {K.changes} — deleting the entry puts it back.</p>{/if}
            {#if logError}<p class="cp-error">{logError}</p>{/if}

            {#if QUICK.some((g) => plannedOf(g.key).length)}
                <div class="quick">
                    {#each QUICK as g (g.type)}
                        {#each plannedOf(g.key) as pid (pid)}
                            <span class="qchip">
                                <b>{nameIn(g.type, pid)}</b>
                                {#each g.acts as [k, label] (k)}
                                    <button disabled={adding} onclick={() => log(k, pid, quickParam(k), "")}>{label}</button>
                                {/each}
                            </span>
                        {/each}
                    {/each}
                </div>
            {/if}
        </section>

        <!-- the log -->
        {#if events.length}
            <ol class="log">
                {#each events as e, i (e.id)}
                    <li class="ev k-{e.kind}" class:auto={e.auto}>
                        <span class="ev-ico" aria-hidden="true">{eventKind(e.kind).icon}</span>
                        <div class="ev-main">
                            <span class="ev-text">
                                {textOf(e)}
                                {#if e.outcome}<span class="cp-chip">{outcomeName(e.outcome)}</span>{/if}
                                {#if changeText(e)}<span class="ev-change">{changeText(e)}</span>{/if}
                                {#if e.auto}<span class="ev-auto" title="Logged by the game">auto</span>{/if}
                            </span>
                            {#if editingNote === e.id}
                                <!-- svelte-ignore a11y_autofocus -->
                                <input class="cp-input" bind:value={noteDraft} autofocus onblur={() => saveNote(e)}
                                    onkeydown={(ev) => ev.key === "Enter" && ev.currentTarget.blur()} />
                            {:else}
                                <button class="ev-note" onclick={() => ((editingNote = e.id), (noteDraft = e.note))}>{e.note || "add a note…"}</button>
                            {/if}
                        </div>
                        <span class="ev-time">{hhmm(e.at)}</span>
                        <span class="ev-act">
                            <button class="cp-btn cp-sm" disabled={i === 0} onclick={() => move(e, -1)} aria-label="Up">↑</button>
                            <button class="cp-btn cp-sm" disabled={i === events.length - 1} onclick={() => move(e, 1)} aria-label="Down">↓</button>
                            <button class="cp-btn cp-sm cp-danger" onclick={() => undo(e)}
                                title={e.change ? "Delete — and undo what it changed" : "Delete"} aria-label="Delete">✕</button>
                        </span>
                    </li>
                {/each}
            </ol>
        {:else}
            <div class="cp-empty">Nothing logged yet. {session.status === "active" ? "Combat and Give Item log themselves while the session is on." : ""}</div>
        {/if}
    {:else}
        <section class="panel">
            <label class="cp-field"><span>Recap — what happened (for “last time…”)</span>
                <textarea class="cp-textarea" rows="6" bind:value={form.data.recap}></textarea></label>
            <label class="cp-field"><span>DM notes — what worked, ideas, what to change</span>
                <textarea class="cp-textarea cp-secret" rows="6" bind:value={form.data.notes}></textarea></label>
            <div class="cp-row">
                <label class="cp-field"><span>Who played (comma separated)</span><input class="cp-input" bind:value={form.data.attendees} /></label>
                <label class="cp-field"><span>XP / milestone</span><input class="cp-input" bind:value={form.data.xp} /></label>
            </div>
            <label class="cp-field"><span>Loot</span><textarea class="cp-textarea" rows="2" bind:value={form.data.loot}></textarea></label>
        </section>
    {/if}
{/if}

<style>
    .head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
    }

    .num {
        font-family: var(--font-heading);
        font-size: 22px;
        color: var(--color-gold);
    }

    .title {
        flex: 1 1 260px;
        font-family: var(--font-heading);
        font-size: 18px;
    }

    .st-active {
        border-color: var(--color-success);
        color: var(--color-success);
    }

    .st-planned {
        border-color: var(--color-gold);
        color: var(--color-gold);
    }

    .save {
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .save.dirty {
        color: var(--color-gold);
    }

    .dates {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
    }

    .tabs {
        display: flex;
        gap: 4px;
        border-bottom: 1px solid var(--color-border);
    }

    .tabs button {
        padding: 6px 14px;
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        color: var(--color-text-secondary);
        font: inherit;
        font-size: 14px;
        cursor: pointer;
    }

    .tabs button.on {
        border-bottom-color: var(--color-gold);
        color: var(--color-text-primary);
    }

    .panel {
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-width: 960px;
        padding: 16px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 10px;
    }

    .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
    }

    .grow {
        flex: 1 1 200px;
        min-width: 0;
    }

    .delta {
        width: 72px;
    }

    .hint {
        margin: 0;
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .secrets {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .secrets li {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .secrets li.rev .cp-input {
        color: var(--color-text-muted);
        text-decoration: line-through;
    }

    .planned {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 12px;
    }

    .plan-col {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .plan-t {
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }

    .pchip {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 0 4px 0 8px;
        border: 1px solid var(--color-border);
        border-radius: 999px;
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .pchip button {
        padding: 0 4px;
        background: none;
        border: none;
        color: var(--color-text-muted);
        cursor: pointer;
    }

    .quick {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding-top: 8px;
        border-top: 1px dashed var(--color-border);
    }

    .qchip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 4px 2px 8px;
        border: 1px solid var(--color-border);
        border-radius: 999px;
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .qchip b {
        font-weight: 600;
        color: var(--color-text-primary);
    }

    .qchip button {
        padding: 1px 8px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 999px;
        color: var(--color-text-secondary);
        font: inherit;
        font-size: 11px;
        cursor: pointer;
    }

    .qchip button:hover:not(:disabled) {
        border-color: var(--color-gold);
        color: var(--color-gold);
    }

    .log {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-width: 960px;
    }

    .ev {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 8px 10px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 8px;
    }

    .ev.auto {
        border-style: dashed;
    }

    .ev-ico {
        width: 22px;
        text-align: center;
        color: var(--color-gold);
    }

    .ev-main {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .ev-text {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        font-size: 14px;
        color: var(--color-text-primary);
    }

    .ev-change {
        font-size: 11px;
        color: var(--color-text-accent);
    }

    .ev-auto {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--color-text-muted);
    }

    .ev-note {
        padding: 0;
        background: none;
        border: none;
        color: var(--color-text-secondary);
        font: inherit;
        font-size: 13px;
        text-align: left;
        cursor: text;
    }

    .ev-time {
        font-size: 11px;
        color: var(--color-text-muted);
        white-space: nowrap;
    }

    .ev-act {
        display: flex;
        gap: 4px;
    }

    .k-encounter_skipped .ev-ico,
    .k-npc_status .ev-ico {
        color: var(--color-text-muted);
    }
</style>
