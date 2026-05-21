<script lang="ts">
    import { page } from '$app/state';
    import { productById, unsplashUrl, testIds } from '@flareapp/playgrounds-shared';
    import { cart } from '$lib/cart.svelte';
    import { flare } from '$lib/flare.client';

    const product = $derived(productById(page.params.id ?? ''));
</script>

{#if product}
    <article class="grid md:grid-cols-2 gap-8">
        <img
            src={unsplashUrl(product.unsplashId, 800, 800)}
            alt={product.title}
            class="aspect-square w-full object-cover rounded-2xl"
        />
        <div class="flex flex-col gap-4">
            <h1 class="text-2xl font-semibold">{product.title}</h1>
            <p class="text-sm opacity-70">Photograph by {product.photographer}</p>
            <div class="text-xl font-mono">${(product.priceCents / 100).toFixed(2)}</div>
            <button
                type="button"
                data-testid={testIds.addToCart(product.id)}
                onclick={() => cart.add(product.id)}
                class="rounded-lg bg-brand-ink text-white py-3 hover:opacity-90"
            >
                Add to cart
            </button>
            <button
                type="button"
                onclick={() => {
                    void flare.report(new Error(`broken-solution:${product.id}`), {
                        'context.product': { id: product.id, title: product.title },
                    });
                }}
                class="rounded-lg border border-brand text-brand py-3 hover:bg-brand-soft"
            >
                Trigger broken solution
            </button>
        </div>
    </article>
{:else}
    <p>Product not found.</p>
{/if}
