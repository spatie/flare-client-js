<script lang="ts">
    import { products, unsplashUrl, testIds } from '@flareapp/playgrounds-shared';
    import { cart } from '$lib/cart.svelte';
</script>

<section data-testid={testIds.productGrid}>
    <h1 class="text-xl font-semibold mb-6">Photographs</h1>
    <div class="grid grid-cols-2 md:grid-cols-3 gap-6">
        {#each products as product (product.id)}
            <article
                class="group rounded-2xl bg-surface border border-surface-border overflow-hidden"
                data-testid={testIds.productCard(product.id)}
            >
                <a href="/product/{product.id}" class="block">
                    <img
                        src={unsplashUrl(product.unsplashId, 400, 400)}
                        alt={product.title}
                        class="aspect-square w-full object-cover"
                        loading="lazy"
                    />
                </a>
                <div class="p-4 flex items-center justify-between gap-3">
                    <div>
                        <h2 class="text-sm font-semibold">{product.title}</h2>
                        <p class="text-xs opacity-70">{product.photographer}</p>
                    </div>
                    <div class="text-sm font-mono">${(product.priceCents / 100).toFixed(2)}</div>
                </div>
                <div class="px-4 pb-4">
                    <button
                        type="button"
                        data-testid={testIds.addToCart(product.id)}
                        onclick={() => cart.add(product.id)}
                        class="w-full rounded-lg bg-brand-ink text-white text-sm py-2 hover:opacity-90"
                    >
                        Add to cart
                    </button>
                </div>
            </article>
        {/each}
    </div>
</section>
