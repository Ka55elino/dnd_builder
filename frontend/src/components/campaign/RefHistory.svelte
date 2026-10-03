<script>
    /**
     * The history of one thing across the campaign's sessions (from the session logs):
     * “Session 1 — Met”, “Session 4 — friendly → ally”…  Shown in the editors (NPC, quest,
     * location, faction, encounter). Nothing is shown until it has been logged at least once.
     *
     * campaignId, refType (npc | quest | location | faction | encounter), refId
     */
    import {
        loadRefEvents, eventKind, eventText, NPC_ATTITUDES, NPC_STATUSES, QUEST_STATUSES,
        ENCOUNTER_OUTCOMES, SKIP_REASONS,
    } from "../../data/campaigns.js";

    let { campaignId, refType, refId } = $props();

    let events = $state([]);
    $effect(() => {
        if (!refId) return void (events = []);
        let cancelled = false;
        loadRefEvents(campaignId, refType, refId)
            .then((list) => !cancelled && (events = list))
            .catch(() => !cancelled && (events = []));
        return () => (cancelled = true);
    });

    const outcome = (o) => [...ENCOUNTER_OUTCOMES, ...SKIP_REASONS].find((x) => x.id === o)?.name ?? o;
    const text = (e) => eventText(e, { attitudes: NPC_ATTITUDES, statuses: NPC_STATUSES, questStatuses: QUEST_STATUSES });
</script>

{#if events.length}
    <p class="cp-h">History</p>
    <ol class="hist">
        {#each events as e (e.id)}
            <li>
                <span class="s" title={e.sessionTitle}>S{e.sessionNumber}</span>
                <span class="i" aria-hidden="true">{eventKind(e.kind).icon}</span>
                <span class="t">
                    {text(e)}{#if e.outcome} · {outcome(e.outcome)}{/if}
                    {#if e.note}<small>{e.note}</small>{/if}
                </span>
            </li>
        {/each}
    </ol>
{/if}

<style>
    .hist {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    li {
        display: flex;
        align-items: baseline;
        gap: 8px;
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .s {
        min-width: 28px;
        padding: 0 6px;
        border: 1px solid var(--color-border);
        border-radius: 999px;
        font-size: 11px;
        text-align: center;
        color: var(--color-gold);
    }

    .i {
        width: 18px;
        text-align: center;
        color: var(--color-gold);
    }

    .t {
        display: flex;
        flex-direction: column;
    }

    small {
        color: var(--color-text-muted);
    }
</style>
