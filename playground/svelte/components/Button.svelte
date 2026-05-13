<script lang="ts">
    import type { HTMLButtonAttributes } from 'svelte/elements';

    let { children, ...rest }: HTMLButtonAttributes = $props();
</script>

<button
    class="cursor-pointer rounded-md bg-gray-100 px-4 py-2 text-[13px] text-gray-900 transition hover:bg-gray-200"
    {...rest}
>
    {@render children?.()}
</button>
