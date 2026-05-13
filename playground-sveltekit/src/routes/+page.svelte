<script lang="ts">
    import { flare } from '@flareapp/js';
    import { FlareErrorBoundary } from '@flareapp/svelte';

    import BuggyComponent from '$lib/BuggyComponent.svelte';
    import Button from '$lib/Button.svelte';
    import NestedParent from '$lib/NestedParent.svelte';
    import TestSection from '$lib/TestSection.svelte';

    let showBuggy = $state(false);
    let showHierarchy = $state(false);
    let shouldThrow = $state(false);
    let resetCounter = $state(0);
</script>

<h1 class="text-2xl font-bold">SvelteKit</h1>

<!-- Render error -->
<TestSection
    title="Render error caught by FlareErrorBoundary"
    description="Throws during render inside a FlareErrorBoundary. Fallback renders, report sent with component context."
>
    <div class="flex flex-wrap items-center gap-3">
        <Button onclick={() => (showBuggy = true)}>Trigger render error</Button>
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
                onReset={(error) => console.log('FlareErrorBoundary onReset:', error?.message)}
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

<!-- Component hierarchy -->
<TestSection
    title="Component hierarchy"
    description="Nested components: Page > NestedParent > NestedChild. Report should include componentHierarchy showing the chain."
>
    <Button onclick={() => (showHierarchy = true)}>Trigger nested error</Button>
    {#if showHierarchy}
        <div class="mt-3">
            <FlareErrorBoundary>
                <NestedParent />

                {#snippet failed(error, reset)}
                    <p class="text-sm text-red-700">
                        Hierarchy error caught: {error.message}
                    </p>
                {/snippet}
            </FlareErrorBoundary>
        </div>
    {/if}
</TestSection>

<!-- Reset keys -->
<TestSection
    title="resetKeys auto-reset"
    description="Triggers an error, then increments a resetKey to auto-reset the boundary."
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

<!-- OnClick error -->
<TestSection
    title="Uncaught error in an event handler"
    description="Throws synchronously inside onclick. Caught by handleError hook."
>
    <Button
        onclick={() => {
            console.log('Throwing error in onclick handler');
            throw new Error('Error in SvelteKit onclick handler');
        }}
    >
        Throw in onclick
    </Button>
</TestSection>

<!-- Async error -->
<TestSection title="Async error" description="Triggers an unhandled promise rejection.">
    <Button
        onclick={() => {
            console.log('Triggering async error');
            Promise.reject(new Error('Async error in SvelteKit component'));
        }}
    >
        Async error (unhandled rejection)
    </Button>
</TestSection>

<!-- Manual report -->
<TestSection title="Manual flare.report()" description="Calls flare.report() directly with a synthetic error.">
    <Button
        onclick={() => {
            console.log('Calling flare.report() from SvelteKit component');
            flare.report(new Error('Manually reported from SvelteKit'));
        }}
    >
        flare.report() from component
    </Button>
</TestSection>

<!-- Manual reportMessage -->
<TestSection title="Manual flare.reportMessage()" description="Calls flare.reportMessage() to send a log-type report.">
    <Button
        onclick={() => {
            console.log('Calling flare.reportMessage() from SvelteKit');
            flare.reportMessage('manually reported message from SvelteKit');
        }}
    >
        flare.reportMessage()
    </Button>
</TestSection>

<!-- flare.test() -->
<TestSection title="flare.test()" description="Sends a synthetic test report to verify the connection.">
    <Button
        onclick={() => {
            console.log('Calling flare.test()');
            flare.test();
        }}
    >
        flare.test()
    </Button>
</TestSection>
