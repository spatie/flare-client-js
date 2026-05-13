<script lang="ts">
    import { FlareErrorBoundary } from '@flareapp/svelte';
    import { flare } from '../../shared/initFlare';
    import BuggyComponent from '../components/BuggyComponent.svelte';
    import Button from '../components/Button.svelte';
    import TestSection from '../components/TestSection.svelte';

    let showBuggy = $state(false);
</script>

<TestSection
    title="Render error caught by FlareErrorBoundary"
    description="Throws during render inside a FlareErrorBoundary. Fallback renders, afterSubmit fires, and resetting unmounts the component so it can be retried."
>
    <div class="flex flex-wrap items-center gap-3">
        <Button
            onclick={() => {
                console.log('Triggering render error via BuggyComponent');
                showBuggy = true;
            }}
        >
            Trigger render error
        </Button>
        <Button
            onclick={() => {
                showBuggy = false;
                console.log('Reset BuggyComponent state');
            }}
        >
            Reset render error
        </Button>
    </div>
    {#if showBuggy}
        <div class="mt-3">
            <FlareErrorBoundary
                afterSubmit={() => console.log('FlareErrorBoundary afterSubmit callback')}
                onReset={() => console.log('FlareErrorBoundary onReset callback')}
                beforeEvaluate={() => {
                    flare.addContext('playground', 'test');
                    flare.addContext('showBuggy', showBuggy);
                }}
            >
                <BuggyComponent />

                {#snippet failed(error, reset)}
                    <div class="space-y-1">
                        <p>Something went wrong: {error.message}</p>
                        <button class="rounded-md bg-black px-2 py-1 text-sm font-medium text-white" onclick={reset}>
                            Try again
                        </button>
                    </div>
                {/snippet}
            </FlareErrorBoundary>
        </div>
    {/if}
</TestSection>
