<script setup lang="ts">
import type { ApiProduct, CartSummary } from '@flareapp/playgrounds-shared';
import { formatMoney, shopApi, testIds } from '@flareapp/playgrounds-shared';
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';

import { useCart } from '../cart';
import ProductGrid from '../components/ProductGrid.vue';

const cart = useCart();

const products = ref<ApiProduct[] | null>(null);
const recommended = ref<ApiProduct[]>([]);
const summary = ref<CartSummary | null>(null);

onMounted(async () => {
    // Three requests in parallel, so the page load span has a waterfall under it rather than one bar.
    const [catalog, picks, cartSummary] = await Promise.all([
        shopApi.products(),
        shopApi.recommendations(),
        shopApi.cartSummary(cart.lines.value),
    ]);

    products.value = catalog;
    recommended.value = picks;
    summary.value = cartSummary;
});
</script>

<template>
    <section :data-testid="testIds.productGrid">
        <h1 class="text-xl font-semibold mb-6">Photographs</h1>
        <ProductGrid v-if="products" :products="products" />
        <p v-else class="text-sm opacity-60">Loading catalog…</p>
        <template v-if="summary">
            <h2 class="text-sm font-semibold mt-10 mb-3">Picked for you</h2>
            <div class="flex flex-wrap gap-3">
                <RouterLink
                    v-for="product in recommended"
                    :key="product.id"
                    :to="`/product/${product.id}`"
                    class="rounded-xl border border-surface-border bg-surface px-4 py-3 text-sm"
                >
                    {{ product.title }} <span class="opacity-60 font-mono">{{ formatMoney(product.price) }}</span>
                </RouterLink>
            </div>
            <p class="mt-6 text-xs opacity-60">{{ summary.lines.length }} line(s) in your cart</p>
        </template>
    </section>
</template>
