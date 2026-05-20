<script lang="ts">
    import Child from './Child.svelte';

    interface Props {
        show?: boolean;
    }

    let { show = true }: Props = $props();
</script>

{#if show}
    <Child />
{/if}
