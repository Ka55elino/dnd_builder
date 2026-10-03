<script>
    /**
     * "Join Game" — player screen.
     *   1. games found on the local network (mDNS) or an address typed by hand
     *   2. pick a character
     *   3. joined: the character's sheet (CharacterPage) with "Leave game" in its header;
     *      during an encounter the DM's initiative line is shown above it (LineupPlayer); when
     *      the DM's encounter has a map, Sheet | Map tabs appear (the map: read-only, PlayerMap)
     * Leaving the screen keeps the connection (the header shows it).
     * onBack() — to the menu
     */
    import { onMount } from 'svelte';
    import { StartDiscovery, StopDiscovery, JoinGame, LeaveGame, ListCharacters } from '../api.js';
    import { server, discovered, applyStatus, gameAddress } from '../server.svelte.js';
    import CharacterGrid from './CharacterGrid.svelte';
    import CharacterPage from './CharacterPage.svelte';
    import LineupPlayer from './combat/LineupPlayer.svelte';
    import PlayerMap from './combat/PlayerMap.svelte';
    import { resetSeen, seen } from '../combat.svelte.js';

    let { onBack } = $props();

    // target: { name, address } — chosen game; null — step 1
    let target = $state(null);
    let manual = $state('');
    let characters = $state([]);
    let error = $state('');
    let busy = $state(false);
    let searching = $state(false);

    let joined = $derived(server.role === 'player' && server.game);

    // the encounter's map: a Map tab next to the sheet; a new map opens it
    const hasMap = $derived(seen.active && !!seen.map);
    let view = $state('sheet'); // 'sheet' | 'map'
    let lastMap = 0;
    $effect(() => {
        const at = hasMap ? seen.map.at : 0;
        if (at && at !== lastMap) view = 'map';
        if (!at) view = 'sheet';
        lastMap = at;
    });
    let isHost = $derived(server.role === 'host');

    // search only while choosing a game
    $effect(() => {
        if (joined || isHost || target) return;
        searching = true;
        StartDiscovery()?.catch?.((e) => (error = e?.message ?? String(e)));
        return () => {
            searching = false;
            StopDiscovery()?.catch?.(() => {});
        };
    });

    onMount(async () => {
        try {
            characters = await ListCharacters();
        } catch (e) {
            console.error('[join]', e);
        }
    });

    const pickGame = (g) => {
        error = '';
        target = { name: g.name, address: gameAddress(g) };
    };

    const pickManual = (e) => {
        e.preventDefault();
        if (!manual.trim()) return;
        error = '';
        target = { name: manual.trim(), address: manual.trim() };
    };

    async function join(characterId) {
        if (busy) return;
        busy = true;
        error = '';
        try {
            resetSeen(); // a line from a previous game must not linger
            applyStatus(await JoinGame(target.address, characterId));
            target = null;
        } catch (err) {
            error = err?.message ?? String(err);
        } finally {
            busy = false;
        }
    }

    async function leave() {
        try {
            await LeaveGame();
        } catch (err) {
            error = err?.message ?? String(err);
        }
    }
</script>

{#snippet gameActions(guard)}
    {#if error}<span class="error small">{error}</span>{/if}
    <button class="ghost leave" onclick={guard(leave)}>Leave game</button>
{/snippet}

{#if joined && server.characterId}
    <LineupPlayer />
    {#if hasMap}
        <nav class="ptabs" aria-label="Game screen">
            <button class:on={view === 'sheet'} onclick={() => (view = 'sheet')}>Character</button>
            <button class:on={view === 'map'} onclick={() => (view = 'map')}>Map</button>
        </nav>
    {/if}
    {#if hasMap && view === 'map'}<PlayerMap />{/if}
    <!-- the sheet stays mounted under the map: it keeps the game state in sync -->
    <div class="sheet" class:hidden={hasMap && view === 'map'}>
        {#key server.characterId}
            <CharacterPage id={server.characterId} onBack={onBack} backLabel="← Menu" actions={gameActions} inGame />
        {/key}
    </div>
{:else}
<div class="page">
    <header class="top">
        {#if target && !joined}
            <button class="ghost" onclick={() => (target = null)}>← Games</button>
        {:else}
            <button class="ghost" onclick={onBack}>← Menu</button>
        {/if}
        <h1>{target ? 'Choose a character' : 'Join Game'}</h1>
    </header>

    {#if isHost}
        <p class="note">You are hosting a game. Stop it in “Start Game” to join another one.</p>
    {:else if target}
        <p class="sub">Joining “{target.name}” at {target.address}</p>
        {#if characters.length === 0}
            <p class="note">You have no characters yet — create one in “Characters”.</p>
        {:else}
            <div class="pick" class:busy>
                <CharacterGrid {characters} showCreate={false} onOpen={join} />
            </div>
        {/if}
    {:else}
        {#if server.error}
            <p class="error">{server.error}</p>
        {/if}

        <section>
            <h2>
                Games on your network
                {#if searching}<span class="searching">searching…</span>{/if}
            </h2>
            {#if discovered.games.length === 0}
                <p class="note">No games found yet. Make sure you're on the same Wi-Fi as the DM.</p>
            {:else}
                <ul class="games">
                    {#each discovered.games as g (g.id)}
                        {@const other = !!(g.version && server.appVersion && g.version !== server.appVersion)}
                        <li>
                            <button class="game" class:other onclick={() => pickGame(g)} disabled={other}
                                title={other ? `The DM has version ${g.version}, you have ${server.appVersion}` : ''}>
                                <span class="name">{g.name}</span>
                                <span class="meta">
                                    {g.players} {g.players === 1 ? 'player' : 'players'} · {gameAddress(g)}
                                    {#if g.version}· v{g.version}{/if}
                                </span>
                                {#if other}
                                    <span class="mismatch">Different version: the DM has {g.version}, you have {server.appVersion}. Both need the same version.</span>
                                {/if}
                            </button>
                        </li>
                    {/each}
                </ul>
            {/if}
        </section>

        <section>
            <h2>Connect by address</h2>
            <form class="manual" onsubmit={pickManual}>
                <input bind:value={manual} placeholder="192.168.1.42:47800" autocomplete="off" spellcheck="false" />
                <button type="submit" class="primary" disabled={!manual.trim()}>Next</button>
            </form>
            <p class="hint">The DM sees the address on the “Start Game” screen.</p>
        </section>
    {/if}

    {#if error}
        <p class="error">{error}</p>
    {/if}
</div>
{/if}

<style>
    .ptabs {
        display: flex;
        gap: 4px;
        margin: 8px 24px 8px;
        border-bottom: 1px solid var(--color-border);
    }

    .ptabs button {
        padding: 6px 14px;
        background: transparent;
        border: 0;
        border-bottom: 2px solid transparent;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: 13px;
        cursor: pointer;
    }

    .ptabs button.on {
        color: var(--color-text-primary);
        border-bottom-color: var(--color-gold);
    }

    .sheet.hidden {
        display: none;
    }

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
        display: flex;
        align-items: baseline;
        gap: 10px;
        font-family: var(--font-heading);
        font-size: 18px;
        color: var(--color-text-accent);
    }

    .searching {
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-muted);
        animation: pulse 1.2s ease-in-out infinite;
    }

    @keyframes pulse {
        50% {
            opacity: 0.4;
        }
    }

    .sub {
        margin: 0;
        font-size: 14px;
        color: var(--color-text-secondary);
    }

    .hint,
    .note {
        margin: 6px 0 0;
        font-size: 13px;
        color: var(--color-text-muted);
    }

    .games {
        max-width: 520px;
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .game {
        width: 100%;
        padding: 12px 16px;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 4px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        text-align: left;
        cursor: pointer;
        transition: border-color 0.15s, background 0.15s;
    }

    .game:disabled {
        cursor: not-allowed;
        opacity: 0.7;
    }

    .game.other {
        border-color: color-mix(in srgb, var(--color-danger) 50%, var(--color-border));
    }

    .mismatch {
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-danger);
    }

    .game:not(:disabled):hover {
        background: var(--color-card-elevated);
        border-color: var(--color-gold);
    }

    .game .name {
        font-family: var(--font-heading);
        font-size: 18px;
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
    }

    .game .meta {
        font-family: var(--font-ui);
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .manual {
        max-width: 420px;
        display: flex;
        gap: 8px;
    }

    input {
        flex: 1;
        padding: 8px 12px;
        background: var(--color-card);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-primary);
        font-family: var(--font-form);
        font-size: 15px;
    }

    input:focus {
        outline: none;
        border-color: var(--color-gold);
    }

    .ghost.leave:hover {
        border-color: var(--color-danger);
        color: var(--color-danger);
    }

    .error.small {
        font-size: 13px;
    }

    .pick.busy {
        opacity: 0.6;
        pointer-events: none;
    }

    .error {
        margin: 0;
        color: var(--color-danger);
    }

    button {
        font-family: var(--font-ui);
    }

    .primary {
        padding: 8px 20px;
        background: var(--color-gold);
        border: 1px solid var(--color-gold);
        border-radius: 6px;
        color: var(--color-bg);
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
    }

    .primary:disabled {
        opacity: 0.5;
        cursor: default;
    }

    .primary:not(:disabled):hover {
        background: var(--color-gold-hover);
    }

    .ghost {
        padding: 6px 12px;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-secondary);
        cursor: pointer;
    }

    .ghost:hover {
        border-color: var(--color-gold);
        color: var(--color-gold-hover);
    }
</style>
