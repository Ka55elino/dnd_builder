<script>
    /**
     * "Start Game" — Dungeon Master screen.
     * Not hosting: game name + Submit → Go starts the WebSocket server and announces it over mDNS.
     * Hosting: party — a CharacterBrief card per player from the snapshot they
     *   joined with; Start / End encounter — the initiative line above the party
     *   (LineupDM, combat.svelte.js); Stop (the address to share is in the header).
     * Leaving the screen keeps the game running (the header shows it).
     * onBack() — to the menu
     */
    import { untrack } from 'svelte';
    import { HostGame, StopGame, GetPlayerCharacter } from '../api.js';
    import { server, applyStatus, onGameEvent } from '../server.svelte.js';
    import { EV, sendHp, sendWhisper, sendGive } from '../game.js';
    import CharacterBrief from './CharacterBrief.svelte';
    import StartEncounterDialog from './combat/StartEncounterDialog.svelte';
    import LineupDM from './combat/LineupDM.svelte';
    import { combat, startEncounter, endEncounter, syncPlayers, broadcast, playerSheet } from '../combat.svelte.js';
    import { loadRefs } from '../data/refs.js';

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
        })
        .catch(() => {});

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

    async function submit(e) {
        e.preventDefault();
        if (!name.trim() || busy) return;
        busy = true;
        error = '';
        try {
            applyStatus(await HostGame(name.trim()));
        } catch (err) {
            error = err?.message ?? String(err);
        } finally {
            busy = false;
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
                <button class="ghost stop" onclick={() => (confirmStop = true)}>Stop game</button>
            {/if}
        {/if}
    </header>

    {#if hosting}
        {#if combat.active}
            <LineupDM {sheetOf} onPlayerHp={(pid, op, n) => sendHp(pid, op, n)} />
        {/if}
        <section>
            <h2>Party <span class="count">{server.players.length}</span></h2>
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
                                onGive={(kind, item) => sendGive(p.id, kind, item)}
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

    {:else}
        <form class="create" onsubmit={submit}>
            <label for="game-name">Game name</label>
            <!-- svelte-ignore a11y_autofocus -->
            <input
                id="game-name"
                bind:value={name}
                maxlength="60"
                placeholder="The Lost Mine"
                autocomplete="off"
                autofocus
                disabled={isPlayer || busy}
            />
            <button type="submit" class="primary" disabled={!name.trim() || isPlayer || busy}>
                {busy ? 'Starting…' : 'Submit'}
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

    input:focus {
        outline: none;
        border-color: var(--color-gold);
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
</style>
