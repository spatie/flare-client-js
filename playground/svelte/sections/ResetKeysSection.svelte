<script lang="ts">
    import { FlareErrorBoundary } from '@flareapp/svelte';
    import Button from '../components/Button.svelte';
    import TestSection from '../components/TestSection.svelte';

    let shouldThrow = $state(false);
    let resetCounter = $state(0);
</script>

<TestSection
    title="resetKeys auto-reset"
    description="Triggers an error, then increments a resetKey to auto-reset the boundary. The onReset callback fires, and the child re-renders without error."
>
    <div class="flex flex-wrap items-center gap-3">
        <Button onclick={() => (shouldThrow = true)}>Trigger error</Button>
        <Button
            onclick={() => {
                shouldThrow = false;
                resetCounter++;
                console.log('Incremented resetKey to', resetCounter);
            }}
        >
            Increment resetKey (auto-reset)
        </Button>
    </div>
    <p class="mt-2 text-xs text-gray-500">
        resetCounter: {resetCounter} | shouldThrow: {String(shouldThrow)}
    </p>
    <div class="mt-3">
        <FlareErrorBoundary
            resetKeys={[resetCounter]}
            onReset={(error) => console.log('FlareErrorBoundary onReset via resetKeys, error was:', error?.message)}
        >
            {#if shouldThrow}
                {(() => {
                    throw new Error('ConditionallyBuggyComponent error');
                })()}
            {:else}
                <p class="text-sm text-green-700">Child rendered successfully (no error)</p>
            {/if}

            {#snippet failed(error)}
                <p class="text-sm text-red-700">
                    Boundary caught: {error.message} — increment resetKey to recover.
                </p>
            {/snippet}
        </FlareErrorBoundary>
    </div>
</TestSection>
