<script setup lang="ts">
import type { ApiProduct } from '@flareapp/playgrounds-shared';
import { formatMoney, journeyGlows, recordGlow, testIds, unsplashUrl } from '@flareapp/playgrounds-shared';
import { RouterLink } from 'vue-router';

import { useCart } from '../cart';
import { flare } from '../flare';

const props = defineProps<{ product: ApiProduct }>();

const cart = useCart();

const addToCart = (): void => {
    cart.add(props.product.id);
    recordGlow(flare, journeyGlows.addedToCart(props.product.id, cart.count.value));
};
</script>

<template>
    <article
        class="group rounded-2xl bg-surface border border-surface-border overflow-hidden"
        :data-testid="testIds.productCard(product.id)"
    >
        <RouterLink :to="`/product/${product.id}`" class="block">
            <img
                :src="unsplashUrl(product.unsplashId, 400, 400)"
                :alt="product.title"
                class="aspect-square w-full object-cover"
                loading="lazy"
            />
        </RouterLink>
        <div class="p-4 flex items-center justify-between gap-3">
            <div>
                <h2 class="text-sm font-semibold">{{ product.title }}</h2>
                <p class="text-xs opacity-70">{{ product.photographer }}</p>
            </div>
            <div class="text-sm font-mono">{{ formatMoney(product.price) }}</div>
        </div>
        <div class="px-4 pb-4">
            <button
                type="button"
                class="w-full rounded-lg bg-brand-ink text-white text-sm py-2 hover:opacity-90"
                :data-testid="testIds.addToCart(product.id)"
                @click="addToCart"
            >
                Add to cart
            </button>
        </div>
    </article>
</template>
