<script lang="ts">
    import { goto } from '$app/navigation';
    import { FlareErrorBoundary } from '@flareapp/svelte';
    import { coverageFor, testIds } from '@flareapp/playgrounds-shared';
    import { flare } from '$lib/flare.client';
    import MaybeThrowing from '$lib/MaybeThrowing.svelte';
    import Fallback from '$lib/Fallback.svelte';

    const scenarios = coverageFor('svelte');

    let renderTrigger: string | null = $state(null);

    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

    const triggers: Record<string, () => void | Promise<void>> = {
        'sync-throw': () => {
            throw new Error('sync-throw');
        },
        'async-throw': async () => {
            await sleep(20);
            throw new Error('async-throw');
        },
        'unhandled-rejection': () => {
            void Promise.reject(new Error('unhandled-rejection'));
        },
        'render-error': () => {
            renderTrigger = 'render-error';
        },
        'boundary-reset': () => {
            renderTrigger = 'boundary-reset';
        },
        'manual-report': () => {
            void flare.report(new Error('manual-report'), {
                'context.scenario': { source: 'manual-report', userId: 'usr_42' },
            });
        },
        'glow-then-throw': () => {
            flare.glow('clicked checkout', 'info', { step: 1 });
            flare.glow('validated cart', 'info', { step: 2 });
            flare.glow('called payment', 'warning', { step: 3 });
            throw new Error('glow-then-throw');
        },
        'hook-drop-report': () => {
            void flare.report(new Error('hook-drop-report'));
        },
        'hook-mutate-report': () => {
            void flare.report(new Error('hook-mutate-report'));
        },
        'sveltekit-server-throw': () => {
            void goto('/server-error');
        },
    };

    const run = (id: string): void => {
        const trigger = triggers[id];
        if (!trigger) return;
        void trigger();
    };
</script>

<section>
    <h1 class="text-xl font-semibold mb-2">Error playground</h1>
    <p class="text-sm opacity-70 mb-6">Each button triggers a deterministic error scenario.</p>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        {#each scenarios as scenario (scenario.id)}
            <button
                type="button"
                data-testid={testIds.brokenTrigger(scenario.id)}
                onclick={() => run(scenario.id)}
                class="rounded-lg border border-surface-border bg-surface px-4 py-3 text-left text-sm hover:border-brand"
            >
                <div class="font-medium">{scenario.label}</div>
                <div class="text-xs opacity-60 font-mono">{scenario.id}</div>
            </button>
        {/each}
    </div>

    <FlareErrorBoundary onReset={() => (renderTrigger = null)}>
        {#key renderTrigger}
            <MaybeThrowing trigger={renderTrigger} />
        {/key}
        {#snippet failed(error, reset)}
            <Fallback {error} {reset} />
        {/snippet}
    </FlareErrorBoundary>
</section>
