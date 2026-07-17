<script lang="ts">
    import '@flareapp/playgrounds-shared/styles.css';

    import { FlareErrorBoundary } from '@flareapp/svelte';
    import { testIds } from '@flareapp/playgrounds-shared';
    import Fallback from '$lib/Fallback.svelte';
    import { cart } from '$lib/cart.svelte';

    let { children } = $props();
</script>

<div class="min-h-screen flex flex-col">
    <header class="border-b border-surface-border bg-surface">
        <div class="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
            <a href="/" class="text-lg font-semibold tracking-tight">Flare Pix</a>
            <nav class="flex items-center gap-6">
                <a href="/" class="text-sm font-medium hover:text-brand">Shop</a>
                <a href="/cart" class="text-sm font-medium hover:text-brand">Cart</a>
                <a href="/broken" class="text-sm font-medium hover:text-brand">Broken</a>
                <a href="/http" class="text-sm font-medium hover:text-brand">HTTP</a>
                <a
                    href="/cart"
                    class="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white"
                    data-testid={testIds.cartCount}
                >
                    {cart.count}
                </a>
            </nav>
        </div>
    </header>
    <main class="flex-1 mx-auto max-w-5xl w-full px-6 py-8">
        <FlareErrorBoundary>
            {@render children()}
            {#snippet failed(error, reset)}
                <Fallback {error} {reset} />
            {/snippet}
        </FlareErrorBoundary>
    </main>
</div>
