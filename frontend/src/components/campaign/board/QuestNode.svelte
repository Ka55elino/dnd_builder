<script>
    /**
     * A quest on the campaign board: route steps leave from the bottom handle (to locations),
     * "unlocks" leave from the right one (to another quest) and arrive on the left.
     * data: { quest, color, progress: { done, total } }
     */
    import { Handle, Position } from "@xyflow/svelte";

    let { data, selected = false } = $props();
    const q = $derived(data.quest);
    const STATUS = { open: "Open", active: "Active", completed: "Completed", failed: "Failed", abandoned: "Abandoned" };
</script>

<div class="quest st-{q.status}" class:selected style:--qc={data.color}>
    <Handle type="target" position={Position.Left} id="unlocked" />
    <div class="top">
        <span class="kind">{q.kind}</span>
        <span class="status">{STATUS[q.status] ?? q.status}</span>
    </div>
    <span class="name" title={q.name}>{q.name}</span>
    {#if data.progress.total}
        <span class="bar" title="{data.progress.done} of {data.progress.total} steps done">
            {#each Array(data.progress.total) as _, i}<i class:on={i < data.progress.done}></i>{/each}
        </span>
    {:else}
        <span class="hint">drag from ● to a location to add a step</span>
    {/if}
    <Handle type="source" position={Position.Bottom} />
    <Handle type="source" position={Position.Right} id="unlocks" />
</div>

<style>
    .quest {
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 8px 12px;
        background: var(--color-card-elevated);
        border: 1px solid var(--color-border);
        border-left: 5px solid var(--qc);
        border-radius: 10px;
        font-family: var(--font-ui);
        color: var(--color-text-primary);
    }

    .quest.selected {
        border-color: var(--qc);
        box-shadow: 0 0 0 1px var(--qc);
    }

    .quest.st-completed,
    .quest.st-failed,
    .quest.st-abandoned {
        opacity: 0.7;
    }

    .top {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-text-muted);
    }

    .st-active .status {
        color: var(--qc);
    }

    .st-completed .status {
        color: var(--color-success);
    }

    .st-failed .status {
        color: var(--color-danger);
    }

    .name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--font-heading);
        font-size: 15px;
    }

    .bar {
        display: flex;
        gap: 3px;
    }

    .bar i {
        flex: 1;
        height: 5px;
        border-radius: 3px;
        background: var(--color-bg);
    }

    .bar i.on {
        background: var(--qc);
    }

    .hint {
        font-size: 10px;
        color: var(--color-text-muted);
    }
</style>
