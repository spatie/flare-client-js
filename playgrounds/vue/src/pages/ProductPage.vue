<script setup lang="ts">
import type { ApiProduct, ProductDetail } from '@flareapp/playgrounds-shared';
import { formatMoney, journeyGlows, recordGlow, shopApi, testIds, unsplashUrl } from '@flareapp/playgrounds-shared';
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import { useCart } from '../cart';
import { flare } from '../flare';

const route = useRoute();
const cart = useCart();

const detail = ref<ProductDetail | null>(null);
const recommended = ref<ApiProduct[]>([]);
const loaded = ref(false);

const product = computed(() => detail.value?.product);

const routeId = computed(() => (Array.isArray(route.params.id) ? route.params.id[0] : route.params.id));

watch(
    routeId,
    async (id) => {
        loaded.value = false;
        const [productDetail, picks] = await Promise.all([
            shopApi.product(id).catch(() => null),
            shopApi.recommendations(id),
        ]);

        detail.value = productDetail;
        recommended.value = picks;
        loaded.value = true;

        if (productDetail) recordGlow(flare, journeyGlows.viewedProduct(productDetail.product));
    },
    { immediate: true },
);

const addToCart = (): void => {
    if (!product.value) return;
    cart.add(product.value.id);
    recordGlow(flare, journeyGlows.addedToCart(product.value.id, cart.count.value));
};

const triggerBrokenSolution = (): void => {
    if (!product.value) return;
    void flare.report(new Error(`broken-solution:${product.value.id}`), {
        'context.product': { id: product.value.id, title: product.value.title },
    });
};
</script>

<template>
    <p v-if="!loaded" class="text-sm opacity-60">Loading print…</p>
    <p v-else-if="!product">Product not found.</p>
    <article v-else class="grid md:grid-cols-2 gap-8">
        <img
            :src="unsplashUrl(product.unsplashId, 800, 800)"
            :alt="product.title"
            class="aspect-square w-full object-cover rounded-2xl"
        />
        <div class="flex flex-col gap-4">
            <h1 class="text-2xl font-semibold">{{ product.title }}</h1>
            <p class="text-sm opacity-70">Photograph by {{ product.photographer }}</p>
            <p class="text-sm opacity-70">{{ detail?.description }}</p>
            <div class="text-xl font-mono">{{ formatMoney(product.price) }}</div>
            <button
                type="button"
                class="rounded-lg bg-brand-ink text-white py-3 hover:opacity-90"
                :data-testid="testIds.addToCart(product.id)"
                @click="addToCart"
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
            <p class="text-xs opacity-60">Also like: {{ recommended.map((other) => other.title).join(' · ') }}</p>
        </div>
    </article>
</template>
