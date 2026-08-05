<script setup lang="ts">
import type { CartSummary } from '@flareapp/playgrounds-shared';
import { displayTotalCents, formatMoney, testIds } from '@flareapp/playgrounds-shared';
import { computed } from 'vue';
import { RouterLink } from 'vue-router';

import { useCart } from '../cart';

const props = defineProps<{ summary: CartSummary }>();

const cart = useCart();

const total = computed(() => displayTotalCents(props.summary.lines));
</script>

<template>
    <table class="w-full text-left">
        <thead class="text-xs uppercase opacity-60">
            <tr>
                <th class="py-2">Item</th>
                <th class="py-2">Qty</th>
                <th class="py-2">Price</th>
                <th></th>
            </tr>
        </thead>
        <tbody>
            <tr
                v-for="line in summary.lines"
                :key="line.productId"
                class="border-b border-surface-border"
                :data-testid="testIds.cartItem(line.productId)"
            >
                <td class="py-3">{{ line.title }}</td>
                <td class="py-3 font-mono text-sm">{{ line.quantity }}</td>
                <td class="py-3 font-mono text-sm">{{ formatMoney(line.price) }}</td>
                <td class="py-3 text-right">
                    <button
                        type="button"
                        class="text-xs text-brand hover:underline"
                        @click="cart.remove(line.productId)"
                    >
                        Remove
                    </button>
                </td>
            </tr>
        </tbody>
    </table>
    <div class="mt-6 flex items-center justify-between">
        <div class="text-sm">
            Total: <span class="font-mono">{{ formatMoney({ amountCents: total, currency: 'USD' }) }}</span>
        </div>
        <RouterLink to="/checkout" class="rounded-lg bg-brand-ink text-white px-4 py-2 text-sm">Checkout</RouterLink>
    </div>
</template>
