<script lang="ts">
    import { testIds } from '@flareapp/playgrounds-shared';

    let { data } = $props();
    let result = $state<string>('idle');

    const scenarios: Array<{ id: string; label: string; run: () => Promise<void> }> = [
        {
            id: 'fetch-ok',
            label: 'fetch: GET 200',
            run: async () => {
                const res = await fetch('/api/echo?scenario=fetch-ok&delay=50');
                result = `fetch-ok:${res.status}`;
            },
        },
        {
            id: 'fetch-404',
            label: 'fetch: GET 404 (span still ends)',
            run: async () => {
                const res = await fetch('/api/echo?scenario=fetch-404&status=404');
                result = `fetch-404:${res.status}`;
            },
        },
        {
            id: 'fetch-500',
            label: 'fetch: GET 500',
            run: async () => {
                const res = await fetch('/api/echo?scenario=fetch-500&status=500');
                result = `fetch-500:${res.status}`;
            },
        },
        {
            id: 'xhr-ok',
            label: 'XHR: GET 200',
            run: () =>
                new Promise((resolve) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open('GET', '/api/echo?scenario=xhr-ok&delay=50');
                    xhr.onloadend = () => {
                        result = `xhr-ok:${xhr.status}`;
                        resolve();
                    };
                    xhr.send();
                }),
        },
        {
            id: 'xhr-404',
            label: 'XHR: GET 404',
            run: () =>
                new Promise((resolve) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open('GET', '/api/echo?scenario=xhr-404&status=404');
                    xhr.onloadend = () => {
                        result = `xhr-404:${xhr.status}`;
                        resolve();
                    };
                    xhr.send();
                }),
        },
    ];
</script>

<section>
    <h1 class="text-xl font-semibold mb-2">HTTP playground</h1>
    <p class="text-sm opacity-70 mb-6">
        Each button fires one request. Loaded via Kit's load fetch: {data.loaded.at}
    </p>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        {#each scenarios as scenario (scenario.id)}
            <button
                type="button"
                data-testid={testIds.httpTrigger(scenario.id)}
                onclick={() => void scenario.run()}
                class="rounded-lg border border-surface-border bg-surface px-4 py-3 text-left text-sm hover:border-brand"
            >
                <div class="font-medium">{scenario.label}</div>
                <div class="text-xs opacity-60 font-mono">{scenario.id}</div>
            </button>
        {/each}
    </div>
    <p class="mt-6 text-sm font-mono opacity-70" data-testid={testIds.httpResult}>{result}</p>
</section>
