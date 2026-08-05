<script lang="ts">
    import { page } from '$app/state';
    import type { ApiProduct, ProductDetail } from '@flareapp/playgrounds-shared';
    import { formatMoney, journeyGlows, recordGlow, unsplashUrl } from '@flareapp/playgrounds-shared';
    import { shopApi } from '@flareapp/playgrounds-shared';
    import AddToCartButton from '$lib/AddToCartButton.svelte';
    import { flare } from '$lib/flare.client';

    let detail = $state<ProductDetail | null>(null);
    let recommended = $state<ApiProduct[]>([]);
    let loaded = $state(false);

    const product = $derived(detail?.product);

    $effect(() => {
        const id = page.params.id ?? '';
        let cancelled = false;
        loaded = false;

        void Promise.all([shopApi.product(id).catch(() => null), shopApi.recommendations(id)]).then(
            ([productDetail, picks]) => {
                if (cancelled) return;

                detail = productDetail;
                recommended = picks;
                loaded = true;

                if (productDetail) recordGlow(flare, journeyGlows.viewedProduct(productDetail.product));
            },
        );

        return () => {
            cancelled = true;
        };
    });
</script>

{#if !loaded}
    <p class="text-sm opacity-60">Loading print…</p>
{:else if product}
    <article class="grid md:grid-cols-2 gap-8">
        <img
            src={unsplashUrl(product.unsplashId, 800, 800)}
            alt={product.title}
            class="aspect-square w-full object-cover rounded-2xl"
        />
        <div class="flex flex-col gap-4">
            <h1 class="text-2xl font-semibold">{product.title}</h1>
            <p class="text-sm opacity-70">Photograph by {product.photographer}</p>
            <p class="text-sm opacity-70">{detail?.description}</p>
            <div class="text-xl font-mono">{formatMoney(product.price)}</div>
            <AddToCartButton productId={product.id} />
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
            <p class="text-xs opacity-60">Also like: {recommended.map((other) => other.title).join(' · ')}</p>
        </div>
    </article>
{:else}
    <p>Product not found.</p>
{/if}
