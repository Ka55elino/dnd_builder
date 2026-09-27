<script>
    /**
     * "Start Game" — Dungeon Master screen.
     * Not hosting: game name + Submit → Go starts the WebSocket server and announces it over mDNS.
     * Hosting: party — a CharacterBrief card per player from the snapshot they
     *   joined with; Stop (the address to share is in the header).
     * Leaving the screen keeps the game running (the header shows it).
     * onBack() — to the menu
     */
    import { untrack } from 'svelte';
    import { HostGame, StopGame, GetPlayerCharacter } from '../api.js';
    import { server, applyStatus } from '../server.svelte.js';
    import CharacterBrief from './CharacterBrief.svelte';

    let { onBack } = $props();

    let name = $state('');
    let error = $state('');
    let busy = $state(false);
    let confirmStop = $state(false);

    let hosting = $derived(server.role === 'host' && server.game);

    // player id → character snapshot { build, state } | { error }
    let snaps = $state({});

    // fetch snapshots of new players, drop those who left
    $effect(() => {
        const ids = new Set(server.players.map((p) => p.id));
        untrack(() => {
            for (const id of Object.keys(snaps)) if (!ids.has(id)) delete snaps[id];
            for (const id of ids) {
                if (id in snaps) continue;
                snaps[id] = null; // loading
                GetPlayerCharacter(id)
                    .then((s) => (snaps[id] = s))
                    .catch((e) => (snaps[id] = { error: e?.message ?? String(e) }));
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
    </header>

    {#if hosting}
        <section>
            <h2>Party <span class="count">{server.players.length}</span></h2>
            {#if server.players.length === 0}
                <p class="note">Waiting for players to join…</p>
            {:else}
                <div class="party">
                    {#each server.players as p (p.id)}
                        {@const snap = snaps[p.id]}
                        {#if snap?.build}
                            <CharacterBrief build={snap.build} state={snap.state} fallback={p} />
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

        <footer>
            {#if confirmStop}
                <span class="ask">End the game for everyone?</span>
                <button class="danger" onclick={stop}>End game</button>
                <button class="ghost" onclick={() => (confirmStop = false)}>Cancel</button>
            {:else}
                <button class="ghost" onclick={() => (confirmStop = true)}>Stop game</button>
            {/if}
        </footer>
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

    footer {
        display: flex;
        align-items: center;
        gap: 12px;
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
