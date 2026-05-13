<script lang="ts">
    import FlareErrorBoundary from '../../src/FlareErrorBoundary.svelte';
    import type { FlareSvelteContext } from '../../src/types';

    interface Props {
        shouldThrow?: boolean;
        beforeEvaluate?: (params: { error: Error }) => void;
        beforeSubmit?: (params: { error: Error; context: FlareSvelteContext }) => FlareSvelteContext;
        afterSubmit?: (params: { error: Error; context: FlareSvelteContext }) => void;
        onReset?: (error: Error | null) => void;
        resetKeys?: unknown[];
        attachProps?: boolean;
        propsMaxDepth?: number;
        propsDenylist?: RegExp;
        replaceDefaultDenylist?: boolean;
    }

    let {
        shouldThrow = true,
        beforeEvaluate,
        beforeSubmit,
        afterSubmit,
        onReset,
        resetKeys,
        attachProps,
        propsMaxDepth,
        propsDenylist,
        replaceDefaultDenylist,
    }: Props = $props();
</script>

<FlareErrorBoundary
    {beforeEvaluate}
    {beforeSubmit}
    {afterSubmit}
    {onReset}
    {resetKeys}
    {attachProps}
    {propsMaxDepth}
    {propsDenylist}
    {replaceDefaultDenylist}
>
    {#if shouldThrow}
        {(() => {
            throw new Error('BuggyComponent render error');
        })()}
    {:else}
        <p>Child rendered successfully</p>
    {/if}

    {#snippet failed(error, reset)}
        <div>
            <p data-testid="error-message">Error: {error.message}</p>
            <button data-testid="reset-button" onclick={reset}>Reset</button>
        </div>
    {/snippet}
</FlareErrorBoundary>
