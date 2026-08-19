<script lang="ts">
    let { children }: { children?: () => unknown } = $props();
</script>

<div>
    {#if children}{@render children()}{/if}
</div>
