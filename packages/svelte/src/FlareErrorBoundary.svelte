<script lang="ts">
    import type { Snippet } from 'svelte';

    import { resolveDenylist } from './constants';
    import { createFlareErrorHandler, type FlareErrorHandlerOptions } from './createFlareErrorHandler';
    import { serializeProps } from './serializeProps';

    interface Props {
        children: Snippet;
        failed?: Snippet<[error: Error, reset: () => void]>;
        resetKeys?: unknown[];
        beforeEvaluate?: FlareErrorHandlerOptions['beforeEvaluate'];
        beforeSubmit?: FlareErrorHandlerOptions['beforeSubmit'];
        afterSubmit?: FlareErrorHandlerOptions['afterSubmit'];
        onReset?: (error: Error | null) => void;
        attachProps?: boolean;
        propsMaxDepth?: number;
        propsDenylist?: RegExp;
        replaceDefaultDenylist?: boolean;
    }

    let {
        children,
        failed: fallbackSnippet,
        resetKeys,
        beforeEvaluate,
        beforeSubmit,
        afterSubmit,
        onReset,
        attachProps = false,
        propsMaxDepth = 2,
        propsDenylist,
        replaceDefaultDenylist = false,
    }: Props = $props();

    let currentError: Error | null = $state(null);
    let resetBoundary: (() => void) | null = $state(null);

    let previousKeys: string | undefined;
    $effect(() => {
        const serialized = JSON.stringify(resetKeys);
        if (previousKeys !== undefined && serialized !== previousKeys && currentError) {
            handleReset();
        }
        previousKeys = serialized;
    });

    function handleReset() {
        const error = currentError;
        currentError = null;
        onReset?.(error);
        resetBoundary?.();
        resetBoundary = null;
    }

    const resolvedDenylist = $derived(resolveDenylist(propsDenylist, replaceDefaultDenylist));
    const handler = $derived(createFlareErrorHandler({ beforeEvaluate, beforeSubmit, afterSubmit }));

    function onerror(rawError: unknown, reset: () => void) {
        resetBoundary = reset;
        const error = rawError instanceof Error ? rawError : new Error(String(rawError));
        currentError = error;

        const capturedProps = attachProps
            ? serializeProps(
                  $state.snapshot({
                      resetKeys,
                      beforeEvaluate,
                      beforeSubmit,
                      afterSubmit,
                      onReset,
                      attachProps,
                      propsMaxDepth,
                      propsDenylist,
                      replaceDefaultDenylist,
                  }) as Record<string, unknown>,
                  propsMaxDepth,
                  resolvedDenylist,
              )
            : undefined;

        handler(rawError, reset, { componentProps: capturedProps });
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
