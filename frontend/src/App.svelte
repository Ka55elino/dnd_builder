<script>
    import MainMenu from './components/MainMenu.svelte';
    import StartPage from './components/StartPage.svelte';
    import SpellsPage from './components/SpellsPage.svelte';
    import ItemsPage from './components/ItemsPage.svelte';
    import Builder from './components/builder/Builder.svelte';
    import CharacterPage from './components/CharacterPage.svelte';
    import LevelUp from './components/LevelUp.svelte';
    import GiveItem from './components/GiveItem.svelte';
    import QueryLoader from './components/common/QueryLoader.svelte';
    import StatusBar from './components/StatusBar.svelte';
    import GamePage from './components/GamePage.svelte';
    import JoinPage from './components/JoinPage.svelte';
    import WhisperPopups from './components/WhisperPopups.svelte';
    import BestiaryPage from './components/bestiary/BestiaryPage.svelte';
    import HomebrewPage from './components/HomebrewPage.svelte';
    import AppFooter from './components/AppFooter.svelte';

    /**
     * Screens:
     *   'menu'       — main menu (start)
     *   'game'       — Start Game (DM: host a game on the local network)
     *   'join'       — Join Game (player: find a game, pick a character)
     *   'characters' — character list
     *   'spells'     — spell reference
     *   'items'      — item reference
     *   'bestiary'   — monsters and encounter presets (DM)
     *   'builder' | 'character' | 'levelup' | 'give' — working with a character
     */
    let screen = $state('menu');
    let characterId = $state(null); // for 'character' / 'levelup' / 'give'
    let editData = $state(null);    // for 'builder': null — new, otherwise the character data

    const showMenu = () => {
        screen = 'menu';
        characterId = null;
        editData = null;
    };
    const showCharacters = () => {
        screen = 'characters';
        characterId = null;
        editData = null;
    };
    const showBuilder = (data = null) => {
        editData = data;
        screen = 'builder';
    };
    const showCharacter = (id) => {
        characterId = id;
        editData = null;
        screen = 'character';
    };
</script>

<StatusBar />

<div class="screen">
{#if screen === 'builder'}
    {#key editData}
        <Builder initial={editData} onExit={showCharacters} onSaved={showCharacter} />
    {/key}
{:else if screen === 'give'}
    {#key characterId}
        <GiveItem id={characterId} onBack={() => showCharacter(characterId)} />
    {/key}
{:else if screen === 'levelup'}
    {#key characterId}
        <LevelUp id={characterId} onDone={showCharacter} onCancel={() => showCharacter(characterId)} />
    {/key}
{:else if screen === 'character'}
    {#key characterId}
        <CharacterPage
            id={characterId}
            onBack={showCharacters}
            onEdit={showBuilder}
            onLevelUp={() => (screen = 'levelup')}
            onGiveItem={() => (screen = 'give')}
        />
    {/key}
{:else if screen === 'characters'}
    <StartPage onCreate={() => showBuilder()} onOpen={showCharacter} onBack={showMenu} />
{:else if screen === 'spells'}
    <SpellsPage onBack={showMenu} />
{:else if screen === 'items'}
    <ItemsPage onBack={showMenu} />
{:else if screen === 'bestiary'}
    <BestiaryPage onBack={showMenu} />
{:else if screen === 'homebrew'}
    <HomebrewPage onBack={showMenu} />
{:else if screen === 'game'}
    <GamePage onBack={showMenu} />
{:else if screen === 'join'}
    <JoinPage onBack={showMenu} />
{:else}
    <MainMenu onNavigate={(s) => (screen = s)} />
{/if}
</div>

<AppFooter />

<WhisperPopups />
<QueryLoader />

<style>
    /* #app is a grid: global StatusBar on top, the current screen, the footer (version) */
    :global(#app) {
        display: grid;
        grid-template-rows: auto 1fr auto;
    }
    .screen {
        min-height: 0;
        overflow: auto;
    }
</style>
