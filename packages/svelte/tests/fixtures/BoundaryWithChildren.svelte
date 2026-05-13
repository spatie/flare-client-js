<script lang="ts">
    import FlareErrorBoundary from '../../src/FlareErrorBoundary.svelte';
</script>

<FlareErrorBoundary>
    <p>Hello world</p>

    {#snippet failed(error, reset)}
        <p>Fallback</p>
    {/snippet}
</FlareErrorBoundary>
