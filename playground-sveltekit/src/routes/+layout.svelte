<script lang="ts">
    import { flare } from '@flareapp/js';
    import { browser } from '$app/environment';
    import { page } from '$app/state';

    import '../app.css';

    let { children } = $props();

    if (browser) {
        flare.light(import.meta.env.VITE_FLARE_SVELTEKIT_KEY ?? 'test-key-sveltekit', true);
    }
</script>

<div class="min-h-screen bg-gray-50 text-gray-900">
    <nav class="border-b border-gray-200 bg-white px-6 py-3">
        <div class="flex items-center gap-6">
            <a href="/" class="text-base font-bold">SvelteKit Playground</a>
            <a href="/" class="text-sm hover:underline" class:font-semibold={page.url.pathname === '/'}> Home </a>
            <a
                href="/users/42?tab=settings"
                class="text-sm hover:underline"
                class:font-semibold={page.url.pathname.startsWith('/users')}
            >
                User 42
            </a>
            <a href="/users/77?token=secret123&session_id=abc&tab=public" class="text-sm hover:underline">
                User 77 (denylisted query)
            </a>
        </div>
    </nav>
    <main class="p-10 space-y-4">
        {@render children()}
    </main>
</div>
