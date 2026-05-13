<script lang="ts">
    import { flare } from '@flareapp/js';
    import { FlareErrorBoundary } from '@flareapp/svelte';
    import { page } from '$app/state';

    import BuggyComponent from '$lib/BuggyComponent.svelte';
    import Button from '$lib/Button.svelte';
    import TestSection from '$lib/TestSection.svelte';

    let showDenylist = $state(false);
</script>

<h1 class="text-2xl font-bold">User Profile</h1>
<p class="text-sm text-gray-600">
    Route: <code class="rounded bg-gray-100 px-1">{page.url.pathname}</code>
    — params: <code class="rounded bg-gray-100 px-1">{JSON.stringify(page.params)}</code>
    — query: <code class="rounded bg-gray-100 px-1">{page.url.search}</code>
</p>

<TestSection
    title="Route context in reports"
    description="Throws an error on this route. Report should include route context with id, url, params, and query."
>
    <div class="flex flex-wrap items-center gap-3">
        <Button
            onclick={() => {
                console.log(`Throwing error on route ${page.url.pathname}`);
                throw new Error(`Error on user profile ${page.params.id}`);
            }}
        >
            Throw error on this route
        </Button>
        <Button
            onclick={() => {
                console.log(`Reporting error on route ${page.url.pathname}`);
                flare.report(new Error(`Manually reported from user profile ${page.params.id}`));
            }}
        >
            flare.report() on this route
        </Button>
    </div>
</TestSection>

<TestSection
    title="Route denylist"
    description="Error boundary on a route with sensitive query params. context.svelte.route.query should have token and session_id redacted."
>
    <Button onclick={() => (showDenylist = true)}>Route denylist demo</Button>
    {#if showDenylist}
        <div class="mt-3">
            <FlareErrorBoundary
                beforeSubmit={({ context }) => {
                    console.log('[route denylist demo] context.svelte.route:', JSON.stringify(context.svelte.route));
                    return context;
                }}
                onReset={() => (showDenylist = false)}
            >
                <BuggyComponent />

                {#snippet failed(error, reset)}
                    <div class="space-y-1">
                        <p class="text-sm">
                            Caught: {error.message} — check console for redacted route context
                        </p>
                        <button class="rounded-md bg-black px-2 py-1 text-sm font-medium text-white" onclick={reset}>
                            Reset
                        </button>
                    </div>
                {/snippet}
            </FlareErrorBoundary>
        </div>
    {/if}
</TestSection>
