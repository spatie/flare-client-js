<script setup lang="ts">
import { products, testIds, unsplashUrl } from '@flareapp/playgrounds-shared';
import { RouterLink } from 'vue-router';

import { useCart } from '../cart';

const cart = useCart();

const formatPrice = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
</script>

<template>
    <section :data-testid="testIds.productGrid">
        <h1 class="text-xl font-semibold mb-6">Photographs</h1>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-6">
            <article
                v-for="product in products"
                :key="product.id"
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
                    <div class="text-sm font-mono">{{ formatPrice(product.priceCents) }}</div>
                </div>
                <div class="px-4 pb-4">
                    <button
                        type="button"
                        class="w-full rounded-lg bg-brand-ink text-white text-sm py-2 hover:opacity-90"
                        :data-testid="testIds.addToCart(product.id)"
                        @click="cart.add(product.id)"
                    >
                        Add to cart
                    </button>
                </div>
            </article>
        </div>
    </section>
</template>
