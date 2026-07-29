<script lang="ts">
    import { __flareProfileComponent } from '../../../src/profileComponent.js';
    import Leaf from './Leaf.svelte';

    let { show }: { show: boolean } = $props();

    __flareProfileComponent('Layout');
</script>

<div>
    {#if show}
        <Leaf name="ProductPage" />
    {/if}
</div>
