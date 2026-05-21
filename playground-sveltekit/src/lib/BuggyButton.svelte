<script lang="ts">
    let { shouldThrow = false }: { shouldThrow?: boolean } = $props();
</script>

{#if shouldThrow}
    {(() => {
        throw new Error('BuggyButton render error');
    })()}
{:else}
    <button
        class="cursor-pointer rounded-md bg-gray-100 px-4 py-2 text-[13px] text-gray-900 transition hover:bg-gray-200"
    >
        I am a BuggyButton
    </button>
{/if}
