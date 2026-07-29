<!-- No profiling code here on purpose. vitest.config.mts injects it. -->
<script lang="ts">
    let { children }: { children?: () => unknown } = $props();
</script>

<div data-testid="layout">
    {#if children}{@render children()}{/if}
</div>
