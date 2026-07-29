<!--
    Deliberately contains NO call to __flareProfileComponent. Everything under this directory is
    instrumented by the real preprocessor, configured in vitest.config.mts.
-->
<script lang="ts">
    let { children }: { children?: () => unknown } = $props();
</script>

<div data-testid="layout">
    {#if children}{@render children()}{/if}
</div>
