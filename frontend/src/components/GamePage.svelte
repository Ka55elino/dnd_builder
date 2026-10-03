<script>
    /**
     * "Start Game" — Dungeon Master screen.
     * Not hosting: pick the campaign (its name is the game's name; its next planned session can
     *   start with the game, so combat and Give Item log into it) — or a quick game with just a
     *   name — then Start → Go starts the WebSocket server and announces it over mDNS.
     * Hosting: party — a CharacterBrief card per player from the snapshot they
     *   joined with; Start / End encounter — the initiative line above the party
     *   (LineupDM, combat.svelte.js); Stop (the address to share is in the header).
     * Leaving the screen keeps the game running (the header shows it).
     * onBack() — to the menu
     */
    import { untrack } from 'svelte';
    import { HostGame, StopGame, GetPlayerCharacter } from '../api.js';
    import { server, applyStatus, onGameEvent } from '../server.svelte.js';
    import { EV, sendHp, sendWhisper, sendGive, sendCondition } from '../game.js';
    import CharacterBrief from './CharacterBrief.svelte';
    import StartEncounterDialog from './combat/StartEncounterDialog.svelte';
    import LineupDM from './combat/LineupDM.svelte';
    import { combat, startEncounter, endEncounter, syncPlayers, broadcast, playerSheet, setConditionDefs, notePlayerConditions } from '../combat.svelte.js';
    import { loadRefs } from '../data/refs.js';
    import {
        loadActiveSession, loadCampaign, logToActiveSession, loadCampaigns, loadSessions, setSessionStatus,
        saveSession, loadSession,
    } from '../data/campaigns.js';
    import SessionView from './campaign/SessionView.svelte';

    let { onBack } = $props();

    let name = $state('');
    let error = $state('');
    let busy = $state(false);
    let confirmStop = $state(false);

    // ---------- encounter: the initiative line (combat.svelte.js) ----------
    let pickOpen = $state(false);
    let refs = $state(null); // for the players' AC / HP in the line
    loadRefs()
        .then((r) => {
            refs = r;
            setConditionDefs(r.conditions); // monsters' conditions in the line
        })
        .catch(() => {});

    // the session being played (Campaign → Sessions → ▶ Start): combat and Give Item log there
    // logTo — { label, campaign, session } of the session being played (the Log tab needs it)
    let logTo = $state(null);
    async function refreshLogTo() {
        try {
            const s = await loadActiveSession();
            if (!s) return void (logTo = null);
            const c = await loadCampaign(s.campaignId).catch(() => null);
            logTo = { label: `${c?.name ? `${c.name} · ` : ''}Session ${s.number}${s.title ? ` — ${s.title}` : ''}`, campaign: c, session: s };
        } catch {
            logTo = null;
        }
    }
    refreshLogTo();

    // the screen while hosting: Party (the character cards) | Log (the session)
    let tab = $state('party');
    $effect(() => {
        if (!logTo && tab !== 'party') tab = 'party';
    });

    // Give Item: send it, then log it
    async function give(p, kind, item) {
        await sendGive(p.id, kind, item);
        const who = snaps[p.id]?.build?.name || p.name;
        logToActiveSession({ kind: 'item_given', note: `${item.name} → ${who}` });
    }

    function begin(opts) {
        pickOpen = false;
        startEncounter({ ...opts, players: server.players });
    }

    // a player's numbers for the line, from their latest state
    const sheetOf = (pid) => playerSheet(snaps[pid], live[pid], refs, summaryOf(pid));
    // the player's own summary: the latest event, or the one the host kept with the snapshot
    const summaryOf = (pid) => liveSummary[pid] ?? snaps[pid]?.summary ?? null;

    // lobby changes: add/drop players in the line; newcomers get the current line
    // (or "no encounter", which also clears what they saw in a previous game)
    let lastIds = null;
    $effect(() => {
        const key = server.players.map((p) => p.id).join(',');
        if (!hosting || key === lastIds) return; // only when somebody joined or left
        lastIds = key;
        untrack(() => {
            if (!syncPlayers(server.players)) broadcast();
        });
    });

    let hosting = $derived(server.role === 'host' && server.game);

    // player id → character snapshot { build, state } | { error }
    let snaps = $state({});
    // player id → latest state reported by the player (newer than snaps[id].state)
    let live = $state({});
    // player id → the sheet summary the player's app computed (shown as is)
    let liveSummary = $state({});

    // players report their state after every change — keep the cards current
    $effect(() =>
        onGameEvent((ev) => {
            if (ev?.kind !== EV.STATE || !ev.from || !ev.data?.state) return;
            live[ev.from] = ev.data.state; // may arrive before the snapshot is fetched
            if (ev.data.summary) liveSummary[ev.from] = ev.data.summary;
            // the line everyone sees shows the player's conditions too
            if (Array.isArray(ev.data.summary?.conditions)) notePlayerConditions(ev.from, ev.data.summary.conditions);
        }),
    );

    // fetch snapshots of new players, drop those who left
    $effect(() => {
        const ids = new Set(server.players.map((p) => p.id));
        untrack(() => {
            for (const id of Object.keys(snaps)) if (!ids.has(id)) delete snaps[id];
            for (const id of Object.keys(live)) if (!ids.has(id)) delete live[id];
            for (const id of Object.keys(liveSummary)) if (!ids.has(id)) delete liveSummary[id];
            for (const id of ids) {
                if (id in snaps) continue;
                snaps[id] = null; // loading
                GetPlayerCharacter(id)
                    .then((s) => {
                        snaps[id] = s;
                    })
                    .catch((e) => {
                        snaps[id] = { error: e?.message ?? String(e) };
                    });
            }
        });
    });
    let isPlayer = $derived(server.role === 'player');

    // ---------- which campaign the game is for ----------
    const QUICK = '__quick'; // a game without a campaign: just a name
    let campaigns = $state([]);
    let campaignId = $state('');
    // the session the game is: continue one, start the planned one, a new one — or don't log
    let sessions = $state([]);
    let sessionChoice = $state(''); // 'continue:<id>' | 'planned:<id>' | 'new' | 'none' 
    loadCampaigns()
        .then((list) => {
            campaigns = list;
            campaignId = list.find((c) => c.status === 'active')?.id ?? list[0]?.id ?? QUICK;
        })
        .catch(() => (campaignId = QUICK));
    const chosen = $derived(campaigns.find((c) => c.id === campaignId) ?? null);
    $effect(() => {
        const cid = chosen?.id;
        sessions = [];
        if (!cid) return;
        let cancelled = false;
        loadSessions(cid)
            .then((list) => {
                if (cancelled) return;
                sessions = list;
                const o = sessionOptions(list);
                sessionChoice = (o.find((x) => x.kind === 'continue' && x.session.status === 'active') ?? o.find((x) => x.kind === 'planned') ?? o.find((x) => x.kind === 'continue') ?? o[0]).value;
            })
            .catch(() => {});
        return () => (cancelled = true);
    });
    // the choices: continue the active / last played one, the next planned one, a new one, or none
    function sessionOptions(list) {
        const nextNumber = Math.max(0, ...list.map((x) => x.number)) + 1;
        const active = list.find((x) => x.status === 'active');
        const last = active ?? [...list].filter((x) => x.status === 'played').sort((a, b) => b.number - a.number)[0];
        const planned = list.filter((x) => x.status === 'planned').sort((a, b) => a.number - b.number)[0];
        const out = [];
        if (last) out.push({ kind: 'continue', value: `continue:${last.id}`, session: last, label: `Continue ${sessionLabel(last)}${last.status === 'active' ? ' (in progress)' : ''}` });
        if (planned) out.push({ kind: 'planned', value: `planned:${planned.id}`, session: planned, label: `Start ${sessionLabel(planned)} (planned)` });
        out.push({ kind: 'new', value: 'new', label: `New session — Session ${nextNumber}` });
        out.push({ kind: 'none', value: 'none', label: "Don't log this game" });
        return out;
    }
    const options = $derived(chosen ? sessionOptions(sessions) : []);
    const gameName = $derived(chosen ? chosen.name : name.trim());
    const sessionLabel = (x) => `Session ${x.number}${x.title ? ` — ${x.title}` : ''}`;

    async function submit(e) {
        e.preventDefault();
        if (!gameName || busy) return;
        busy = true;
        error = '';
        try {
            applyStatus(await HostGame(gameName.slice(0, 60)));
            // the game is the session: make it the one being played, so combat and Give Item log into it
            const opt = options.find((o) => o.value === sessionChoice);
            if (chosen && opt?.session) {
                await setSessionStatus(opt.session.id, 'active').catch(() => {});
            } else if (chosen && opt?.kind === 'new') {
                // like "+ New session": the secrets not revealed last time carry over
                const last = [...sessions].sort((a, b) => b.number - a.number)[0];
                const carry = (last?.data?.secrets ?? []).filter((x) => !x.revealed).map((x) => ({ text: x.text, revealed: false }));
                await saveSession({
                    campaignId: chosen.id, status: 'active', title: '', playedOn: new Date().toISOString().slice(0, 10),
                    ingameDate: last?.ingameDate ?? '', data: { secrets: carry, planned: { npcs: [], locations: [], encounters: [], quests: [] } },
                }).catch(() => {});
            }
            await refreshLogTo();
            tab = 'party';
        } catch (err) {
            error = err?.message ?? String(err);
        } finally {
            busy = false;
        }
    }

    // ending the game with a session being played: write the "After" and end the session too
    let ending = $state(null); // { recap, notes, xp, loot } while the dialog is open
    let endBusy = $state(false);
    async function askEnd() {
        if (!logTo?.session) return void (confirmStop = true);
        tab = 'party'; // the Log tab closes and saves what was being typed
        const s = await loadSession(logTo.session.id).catch(() => logTo.session);
        const d = s?.data ?? {};
        ending = { recap: d.recap ?? '', notes: d.notes ?? '', xp: d.xp ?? '', loot: d.loot ?? '' };
    }
    async function endWithSession(close) {
        endBusy = true;
        try {
            if (close) {
                const fresh = await loadSession(logTo.session.id); // the latest, then only these fields change
                await saveSession({
                    ...fresh,
                    playedOn: fresh.playedOn || new Date().toISOString().slice(0, 10),
                    data: { ...(fresh.data ?? {}), recap: ending.recap.trim(), notes: ending.notes.trim(), xp: ending.xp.trim(), loot: ending.loot.trim() },
                });
                await setSessionStatus(fresh.id, 'played');
            }
            ending = null;
            await stop();
            await refreshLogTo();
        } catch (err) {
            error = err?.message ?? String(err);
        } finally {
            endBusy = false;
        }
    }

    async function stop() {
        confirmStop = false;
        if (combat.active) endEncounter();
        try {
            await StopGame();
        } catch (err) {
            error = err?.message ?? String(err);
        }
    }
</script>

<div class="page">
    <header class="top">
        <button class="ghost" onclick={onBack}>← Menu</button>
        <h1>{hosting ? server.game.name : 'New Game'}</h1>
        {#if hosting}
            <button class="logto" class:on={logTo} onclick={refreshLogTo}
                title={logTo ? 'Combat and Give Item are logged into this session (click to refresh)' : 'Start a session in Campaign → Sessions to log combat and Give Item (click to refresh)'}
                >{logTo ? `● Logging to ${logTo.label}` : '○ No session being played'}</button
            >
        {/if}
        {#if hosting}
            <span class="spacer"></span>
            {#if !confirmStop}
                {#if combat.active}
                    <button class="primary start end" onclick={endEncounter}>End encounter</button>
                {:else}
                    <button class="primary start" onclick={() => (pickOpen = true)}>Start encounter</button>
                {/if}
            {/if}
            {#if confirmStop}
                <span class="ask">End the game for everyone?</span>
                <button class="danger" onclick={stop}>End game</button>
                <button class="ghost" onclick={() => (confirmStop = false)}>Cancel</button>
            {:else}
                <button class="ghost stop" onclick={askEnd}>Stop game</button>
            {/if}
        {/if}
    </header>

    {#if hosting}
        {#if combat.active}
            <LineupDM
                {sheetOf}
                conditionDefs={refs?.conditions ?? []}
                onPlayerHp={(pid, op, n) => sendHp(pid, op, n)}
                onPlayerCondition={(pid, data) => sendCondition(pid, data, refs?.conditions ?? [])}
            />
        {/if}
        <!-- the screen: the party, the campaign's map, the session's log -->
        {#if logTo?.campaign}
            <nav class="tabs" aria-label="Game screen">
                <button class:on={tab === 'party'} onclick={() => (tab = 'party')}>Party <span class="count">{server.players.length}</span></button>
                <button class:on={tab === 'log'} onclick={() => (tab = 'log')}>Log · Session {logTo.session.number}</button>
            </nav>
        {/if}
        {#if tab === 'log' && logTo?.campaign}
            {#key logTo.session.id}
                <div class="tabpane"><SessionView campaign={logTo.campaign} id={logTo.session.id} embedded /></div>
            {/key}
        {:else}
        <section>
            {#if !logTo?.campaign}<h2>Party <span class="count">{server.players.length}</span></h2>{/if}
            {#if server.players.length === 0}
                <p class="note">Waiting for players to join…</p>
            {:else}
                <div class="party">
                    {#each server.players as p (p.id)}
                        {@const snap = snaps[p.id]}
                        {#if snap?.build}
                            <CharacterBrief
                                build={snap.build}
                                state={live[p.id] ?? snap.state}
                                summary={summaryOf(p.id)}
                                fallback={p}
                                onHp={(op, n) => sendHp(p.id, op, n)}
                                onWhisper={(text) => sendWhisper(p.id, text)}
                                onGive={(kind, item) => give(p, kind, item)}
                                onCondition={(data) => sendCondition(p.id, data, refs?.conditions ?? [])}
                            />
                        {:else}
                            <!-- loading or unavailable: what the lobby row knows -->
                            <CharacterBrief
                                build={{ name: p.name }}
                                fallback={p}
                                note={snap === null ? "Loading…" : "Character sheet unavailable"}
                            />
                        {/if}
                    {/each}
                </div>
            {/if}
        </section>
        {/if}

    {:else}
        <form class="create" onsubmit={submit}>
            <label for="game-campaign">Campaign</label>
            <select id="game-campaign" bind:value={campaignId} disabled={isPlayer || busy}>
                {#each campaigns as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
                <option value={QUICK}>Quick game (no campaign)</option>
            </select>

            {#if chosen}
                {#if chosen.description}<p class="note">{chosen.description}</p>{/if}
                <fieldset class="sess" disabled={isPlayer || busy}>
                    <legend>Session</legend>
                    {#each options as o (o.value)}
                        <label class="check">
                            <input type="radio" name="game-session" value={o.value} bind:group={sessionChoice} />
                            <span>{o.label}{#if o.session?.data?.prep && o.kind === 'planned'}<small>{o.session.data.prep}</small>{/if}</span>
                        </label>
                    {/each}
                    <p class="note">Combat and Give Item are logged into the session; the map and the log are in the game screen.</p>
                </fieldset>
            {:else}
                <label for="game-name">Game name</label>
                <!-- svelte-ignore a11y_autofocus -->
                <input
                    id="game-name"
                    bind:value={name}
                    maxlength="60"
                    placeholder="One-shot"
                    autocomplete="off"
                    autofocus={!campaigns.length}
                    disabled={isPlayer || busy}
                />
                {#if !campaigns.length}<p class="note">No campaigns yet — create one in Campaign to tie games to it.</p>{/if}
            {/if}
            <button type="submit" class="primary" disabled={!gameName || isPlayer || busy}>
                {busy ? 'Starting…' : 'Start game'}
            </button>
            {#if isPlayer}
                <p class="note">You are in a game as a player. Leave it in “Join Game” to host your own.</p>
            {/if}
            {#if error}
                <p class="error">{error}</p>
            {/if}
        </form>
    {/if}
</div>

{#if ending}
    <!-- the game ends: the session's "After", then end it -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="dlg-back" onclick={(e) => e.target === e.currentTarget && !endBusy && (ending = null)}>
        <div class="dlg" role="dialog" aria-modal="true" aria-label="End the session">
            <h2>End {logTo?.label ?? 'the session'}</h2>
            <p class="note">Write down what happened while it's fresh — it goes into the session's “After”. Nothing here is shown to the players.</p>
            <label class="fld">Recap — what happened<textarea rows="5" bind:value={ending.recap}></textarea></label>
            <label class="fld">DM notes — what worked, ideas for next time<textarea rows="4" bind:value={ending.notes}></textarea></label>
            <div class="two">
                <label class="fld">XP / milestone<input bind:value={ending.xp} /></label>
                <label class="fld">Loot<input bind:value={ending.loot} /></label>
            </div>
            <div class="btns">
                <button class="ghost" disabled={endBusy} onclick={() => (ending = null)}>Cancel</button>
                <button class="ghost" disabled={endBusy} onclick={() => endWithSession(false)} title="Stop the game; the session stays in progress (continue it next time)">Stop, keep the session open</button>
                <button class="primary" disabled={endBusy} onclick={() => endWithSession(true)}>{endBusy ? 'Saving…' : 'Save & end the session'}</button>
            </div>
        </div>
    </div>
{/if}

{#if pickOpen}
    <StartEncounterDialog onStart={begin} onClose={() => (pickOpen = false)} />
{/if}

<style>
    .page {
        min-height: 100%;
        padding: 32px;
        display: flex;
        flex-direction: column;
        gap: 28px;
    }

    .top {
        display: flex;
        align-items: center;
        gap: 16px;
    }

    h1 {
        margin: 0;
        font-family: var(--font-heading);
        font-weight: var(--font-weight-bold);
        color: var(--color-gold);
    }

    h2 {
        margin: 0 0 12px;
        font-family: var(--font-heading);
        font-size: 18px;
        color: var(--color-text-accent);
    }

    .create {
        width: 100%;
        max-width: 420px;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    label {
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    input {
        padding: 10px 12px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-primary);
        font-family: var(--font-form);
        font-size: 16px;
    }

    input:focus,
    select:focus {
        outline: none;
        border-color: var(--color-gold);
    }

    select {
        padding: 10px 12px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-primary);
        font-family: var(--font-form);
        font-size: 16px;
    }

    .check {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        line-height: 1.4;
    }

    .check input {
        margin-top: 3px;
        padding: 0;
    }

    .note {
        margin: 0;
        font-size: 13px;
        color: var(--color-text-muted);
    }

    .party {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 16px;
        align-items: start;
    }

    .party > :global(.brief) {
        max-width: none;
    }

    .count {
        margin-left: 6px;
        font-family: var(--font-ui);
        font-size: 13px;
        color: var(--color-text-muted);
    }

    .spacer {
        flex: 1;
    }

    .primary.start {
        align-self: auto;
        padding: 6px 16px;
    }

    .primary.start.end,
    .primary.start.end:not(:disabled):hover {
        background: var(--color-danger);
        border-color: var(--color-danger);
        color: var(--color-text-primary);
    }

    .ghost.stop:hover {
        border-color: var(--color-danger);
        color: var(--color-danger);
    }

    .ask {
        font-size: 14px;
        color: var(--color-text-secondary);
    }

    .error {
        margin: 0;
        color: var(--color-danger);
    }

    button {
        font-family: var(--font-ui);
        cursor: pointer;
    }

    button:disabled {
        opacity: 0.5;
        cursor: default;
    }

    .primary {
        align-self: flex-start;
        padding: 8px 20px;
        background: var(--color-gold);
        border: 1px solid var(--color-gold);
        border-radius: 6px;
        color: var(--color-bg);
        font-weight: var(--font-weight-semibold);
    }

    .primary:not(:disabled):hover {
        background: var(--color-gold-hover);
    }

    .danger {
        padding: 6px 12px;
        background: var(--color-danger);
        border: 1px solid var(--color-danger);
        border-radius: 6px;
        color: var(--color-text-primary);
    }

    .ghost {
        padding: 6px 12px;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-secondary);
    }

    .ghost:hover {
        border-color: var(--color-gold);
        color: var(--color-gold-hover);
    }

    .logto {
        padding: 2px 10px;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 999px;
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: 12px;
        cursor: pointer;
    }

    .logto.on {
        border-color: var(--color-success);
        color: var(--color-success);
    }

    .tabs {
        display: flex;
        gap: 4px;
        border-bottom: 1px solid var(--color-border);
    }

    .tabs button {
        padding: 8px 16px;
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: 14px;
        cursor: pointer;
    }

    .tabs button.on {
        border-bottom-color: var(--color-gold);
        color: var(--color-text-primary);
    }

    .tabpane {
        display: flex;
        flex-direction: column;
        gap: 14px;
        min-height: 0;
    }

    .sess {
        margin: 0;
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
    }

    .sess legend {
        padding: 0 4px;
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .sess small {
        display: block;
        margin-top: 2px;
        color: var(--color-text-muted);
        font-size: 12px;
    }

    .dlg-back {
        position: fixed;
        inset: 0;
        z-index: 950;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 72px 16px;
        background: rgba(0, 0, 0, 0.6);
        overflow-y: auto;
    }

    .dlg {
        width: min(620px, 100%);
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 20px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 10px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
    }

    .dlg h2 {
        margin: 0;
    }

    .fld {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 12px;
        color: var(--color-text-muted);
    }

    .fld textarea,
    .fld input {
        padding: 8px 10px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-primary);
        font-family: var(--font-form);
        font-size: 14px;
        resize: vertical;
    }

    .two {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
    }

    .btns {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
    }
</style>
