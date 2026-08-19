<script setup lang="ts">
import type { CartSummary as CartSummaryData } from '@flareapp/playgrounds-shared';
import { shopApi } from '@flareapp/playgrounds-shared';
import { ref, watch } from 'vue';

import { useCart } from '../cart';
import CartSummary from '../components/CartSummary.vue';

const cart = useCart();

const summary = ref<CartSummaryData | null>(null);

watch(
    cart.lines,
    async (lines) => {
        if (lines.length === 0) {
            summary.value = null;
            return;
        }
        summary.value = await shopApi.cartSummary(lines);
    },
    { immediate: true },
);
</script>

<template>
    <section v-if="cart.lines.value.length === 0">
        <h1 class="text-xl font-semibold mb-6">Cart</h1>
        <p class="text-sm opacity-70">Cart is empty.</p>
    </section>
    <section v-else>
        <h1 class="text-xl font-semibold mb-6">Cart</h1>
        <CartSummary v-if="summary" :summary="summary" />
        <p v-else class="text-sm opacity-60">Pricing your cart…</p>
    </section>
</template>
