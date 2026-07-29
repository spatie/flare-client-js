<script lang="ts">
    import { __flareProfileComponent } from '../../../src/profileComponent.js';

    let { name, children }: { name: string; children?: () => unknown } = $props();

    // svelte-ignore state_referenced_locally -- only the mount-time name is ever recorded.
    __flareProfileComponent(name);

    const pending = new Promise((resolve) => setTimeout(() => resolve('ready'), 5));
</script>

<div>
    {#await pending}
        <span>loading</span>
    {:then}
        {#if children}{@render children()}{/if}
    {/await}
</div>
