<script setup lang="ts">
import { productById, testIds, unsplashUrl } from '@flareapp/playgrounds-shared';
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import { useCart } from '../cart';
import { flare } from '../flare';

const route = useRoute();
const cart = useCart();

const product = computed(() => {
    const id = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id;
    return productById(id);
});

const formatPrice = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

const triggerBrokenSolution = (): void => {
    if (!product.value) return;
    void flare.report(new Error(`broken-solution:${product.value.id}`), {
        'context.product': { id: product.value.id, title: product.value.title },
    });
};
</script>

<template>
    <p v-if="!product">Product not found.</p>
    <article v-else class="grid md:grid-cols-2 gap-8">
        <img
            :src="unsplashUrl(product.unsplashId, 800, 800)"
            :alt="product.title"
            class="aspect-square w-full object-cover rounded-2xl"
        />
        <div class="flex flex-col gap-4">
            <h1 class="text-2xl font-semibold">{{ product.title }}</h1>
            <p class="text-sm opacity-70">Photograph by {{ product.photographer }}</p>
            <div class="text-xl font-mono">{{ formatPrice(product.priceCents) }}</div>
            <button
                type="button"
                class="rounded-lg bg-brand-ink text-white py-3 hover:opacity-90"
                :data-testid="testIds.addToCart(product.id)"
                @click="cart.add(product.id)"
            >
                Add to cart
            </button>
            <button
                type="button"
                class="rounded-lg border border-brand text-brand py-3 hover:bg-brand-soft"
                @click="triggerBrokenSolution"
            >
                Trigger broken solution
            </button>
        </div>
    </article>
</template>
