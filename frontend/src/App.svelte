<script>
    import MainMenu from './components/MainMenu.svelte';
    import StartPage from './components/StartPage.svelte';
    import SpellsPage from './components/SpellsPage.svelte';
    import ItemsPage from './components/ItemsPage.svelte';
    import Builder from './components/builder/Builder.svelte';
    import CharacterPage from './components/CharacterPage.svelte';
    import LevelUp from './components/LevelUp.svelte';
    import GiveItem from './components/GiveItem.svelte';

    /**
     * Экраны:
     *   'menu'       — главное меню (старт)
     *   'characters' — список персонажей
     *   'spells'     — справочник заклинаний
     *   'items'      — справочник предметов
     *   'builder' | 'character' | 'levelup' | 'give' — работа с персонажем
     */
    let screen = $state('menu');
    let characterId = $state(null); // для 'character' / 'levelup' / 'give'
    let editData = $state(null);    // для 'builder': null — новый, иначе данные персонажа

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
{:else}
    <MainMenu onNavigate={(s) => (screen = s)} />
{/if}
