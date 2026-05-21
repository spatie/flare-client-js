<script lang="ts">
    import type { Snippet } from 'svelte';

    import { getComponentTreeContext } from './componentTree.js';
    import { createFlareErrorHandler, type FlareErrorHandlerOptions } from './createFlareErrorHandler.js';

    interface Props {
        children: Snippet;
        failed?: Snippet<[error: Error, reset: () => void]>;
        resetKeys?: unknown[];
        beforeEvaluate?: FlareErrorHandlerOptions['beforeEvaluate'];
        beforeSubmit?: FlareErrorHandlerOptions['beforeSubmit'];
        afterSubmit?: FlareErrorHandlerOptions['afterSubmit'];
        onReset?: (error: Error | null) => void;
    }

    let {
        children,
        failed: fallbackSnippet,
        resetKeys,
        beforeEvaluate,
        beforeSubmit,
        afterSubmit,
        onReset,
    }: Props = $props();

    let currentError: Error | null = $state(null);
    let resetBoundary: (() => void) | null = $state(null);

    let previousKeys: unknown[] | undefined;
    $effect(() => {
        if (!currentError || !resetKeys) {
            previousKeys = resetKeys ? [...resetKeys] : undefined;
            return;
        }

        const lengthChanged = previousKeys?.length !== resetKeys.length;
        const valuesChanged = resetKeys.some((key, i) => !Object.is(key, previousKeys?.[i]));

        if (lengthChanged || valuesChanged) {
            handleReset();
        }

        previousKeys = [...resetKeys];
    });

    function handleReset() {
        const error = currentError;
        currentError = null;
        onReset?.(error);
        resetBoundary?.();
        resetBoundary = null;
    }

    const ancestor = __flareRegisterComponent('FlareErrorBoundary', '@flareapp/svelte/FlareErrorBoundary.svelte');

    const handler = $derived(
        createFlareErrorHandler({ ancestor, beforeEvaluate, beforeSubmit, afterSubmit }),
    );

    function onerror(rawError: unknown, reset: () => void) {
        resetBoundary = reset;
        const error = rawError instanceof Error ? rawError : new Error(String(rawError));
        currentError = error;

        handler(rawError, reset);
    }
</script>

<svelte:boundary {onerror}>
    {@render children()}

    {#snippet failed(error, reset)}
        {#if fallbackSnippet}
            {@render fallbackSnippet(error instanceof Error ? error : new Error(String(error)), handleReset)}
        {/if}
    {/snippet}
</svelte:boundary>
