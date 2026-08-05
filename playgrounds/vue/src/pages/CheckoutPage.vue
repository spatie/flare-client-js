<script setup lang="ts">
import type { CartSummary } from '@flareapp/playgrounds-shared';
import { formatMoney, journeyGlows, placeOrder, recordGlow, shopApi, testIds } from '@flareapp/playgrounds-shared';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { useCart } from '../cart';
import { flare } from '../flare';

const router = useRouter();
const cart = useCart();

const summary = ref<CartSummary | null>(null);

onMounted(async () => {
    summary.value = await shopApi.cartSummary(cart.lines.value);
    recordGlow(flare, journeyGlows.openedCheckout(summary.value.lines.length));
});

const submit = (): void => {
    if (!summary.value) return;

    // Throws synchronously when the cart holds the unpriced product, which is the showcase error.
    void placeOrder(summary.value).then(() => {
        cart.clear();
        void router.push('/confirmation');
    });
};
</script>

<template>
    <section class="max-w-md mx-auto">
        <h1 class="text-xl font-semibold mb-6">Checkout</h1>
        <ul class="mb-6 flex flex-col gap-1 text-sm">
            <li v-for="line in summary?.lines ?? []" :key="line.productId" class="flex justify-between">
                <span>{{ line.title }} x{{ line.quantity }}</span>
                <span class="font-mono">{{ formatMoney(line.price) }}</span>
            </li>
        </ul>
        <form class="flex flex-col gap-4" @submit.prevent="submit">
            <label class="flex flex-col gap-1 text-sm">
                Name
                <input
                    name="name"
                    required
                    value="Iris De Witte"
                    class="rounded border border-surface-border px-3 py-2"
                />
            </label>
            <label class="flex flex-col gap-1 text-sm">
                Email
                <input
                    name="email"
                    type="email"
                    required
                    value="iris.dewitte@example.com"
                    class="rounded border border-surface-border px-3 py-2"
                />
            </label>
            <label class="flex flex-col gap-1 text-sm">
                Card number
                <input
                    name="card"
                    required
                    value="4242 4242 4242 4242"
                    class="rounded border border-surface-border px-3 py-2 font-mono"
                />
            </label>
            <!-- Disabled until the summary lands, so paying can never silently no-op. -->
            <button
                type="submit"
                :disabled="!summary"
                class="rounded-lg bg-brand-ink text-white py-2 text-sm disabled:opacity-50"
                :data-testid="testIds.checkoutSubmit"
            >
                Pay
            </button>
        </form>
    </section>
</template>
