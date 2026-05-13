<script lang="ts">
    import FlareErrorBoundary from '../../src/FlareErrorBoundary.svelte';
</script>

<FlareErrorBoundary>
    {(() => {
        throw new Error('BuggyComponent render error');
    })()}
</FlareErrorBoundary>
