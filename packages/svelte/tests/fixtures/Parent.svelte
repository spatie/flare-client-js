<script lang="ts">
    import { __flareRegisterComponent } from '../../src/componentTree';
    import type { Snippet } from 'svelte';

    interface Props {
        children: Snippet;
    }

    let { children }: Props = $props();

    __flareRegisterComponent('Parent', 'src/Parent.svelte');
</script>

{@render children()}
