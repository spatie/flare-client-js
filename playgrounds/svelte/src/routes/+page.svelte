<script lang="ts">
    import type { ApiProduct, CartSummary } from '@flareapp/playgrounds-shared';
    import { formatMoney, shopApi, testIds } from '@flareapp/playgrounds-shared';
    import { onMount } from 'svelte';
    import { cart } from '$lib/cart.svelte';
    import ProductGrid from '$lib/ProductGrid.svelte';

    let products = $state<ApiProduct[] | null>(null);
    let recommended = $state<ApiProduct[]>([]);
    let summary = $state<CartSummary | null>(null);

    // Fetched in the browser rather than in a load function, so the requests show up as spans under
    // the page load root instead of happening server side.
    onMount(async () => {
        const [catalog, picks, cartSummary] = await Promise.all([
            shopApi.products(),
            shopApi.recommendations(),
            shopApi.cartSummary(cart.lines),
        ]);

        products = catalog;
        recommended = picks;
        summary = cartSummary;
    });
</script>

<section data-testid={testIds.productGrid}>
    <h1 class="text-xl font-semibold mb-6">Photographs</h1>
    {#if products}
        <ProductGrid {products} />
    {:else}
        <p class="text-sm opacity-60">Loading catalog…</p>
    {/if}
    {#if summary}
        <h2 class="text-sm font-semibold mt-10 mb-3">Picked for you</h2>
        <div class="flex flex-wrap gap-3">
            {#each recommended as product (product.id)}
                <a
                    href="/product/{product.id}"
                    class="rounded-xl border border-surface-border bg-surface px-4 py-3 text-sm"
                >
                    {product.title} <span class="opacity-60 font-mono">{formatMoney(product.price)}</span>
                </a>
            {/each}
        </div>
        <p class="mt-6 text-xs opacity-60">{summary.lines.length} line(s) in your cart</p>
    {/if}
</section>
