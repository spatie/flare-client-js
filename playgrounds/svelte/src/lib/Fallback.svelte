<script lang="ts">
    import { testIds } from '@flareapp/playgrounds-shared';

    interface Props {
        error: Error;
        reset: () => void;
    }

    let { error, reset }: Props = $props();
</script>

<div
    data-testid={testIds.boundaryFallback}
    class="rounded-2xl border border-surface-border bg-surface p-6"
>
    <h2 class="text-lg font-semibold mb-2">Something went wrong</h2>
    <p class="text-sm opacity-70 mb-4 font-mono">{error.message}</p>
    <button
        type="button"
        data-testid={testIds.boundaryReset}
        onclick={reset}
        class="rounded-lg bg-brand-ink text-white px-4 py-2 text-sm hover:opacity-90"
    >
        Reset boundary
    </button>
</div>
