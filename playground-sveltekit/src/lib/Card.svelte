<script lang="ts">
    import type { Snippet } from 'svelte';

    interface Props {
        label: string;
        children: Snippet;
    }

    let { label, children }: Props = $props();
</script>

<div class="rounded-md border border-gray-200 bg-white p-3">
    <p class="mb-2 text-xs font-medium text-gray-500">{label}</p>
    {@render children()}
</div>
