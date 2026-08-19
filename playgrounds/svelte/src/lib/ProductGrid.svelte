<script lang="ts">
    import type { ApiProduct } from '@flareapp/playgrounds-shared';
    import ProductCard from '$lib/ProductCard.svelte';

    let { products }: { products: ApiProduct[] } = $props();
</script>

<div class="grid grid-cols-2 md:grid-cols-3 gap-6">
    {#each products as product (product.id)}
        <ProductCard {product} />
    {/each}
</div>
