<script setup lang="ts">
import { productById, testIds } from '@flareapp/playgrounds-shared';
import { computed } from 'vue';
import { RouterLink } from 'vue-router';

import { useCart } from '../cart';

const cart = useCart();

type Row = {
    productId: string;
    title: string;
    quantity: number;
    subtotalCents: number;
};

const rows = computed<Row[]>(() =>
    cart.lines.value
        .map((line) => {
            const product = productById(line.productId);
            if (!product) return null;
            return {
                productId: product.id,
                title: product.title,
                quantity: line.quantity,
                subtotalCents: product.priceCents * line.quantity,
            };
        })
        .filter((row): row is Row => row !== null)
);

const totalCents = computed(() => rows.value.reduce((sum, row) => sum + row.subtotalCents, 0));

const formatPrice = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
</script>

<template>
    <section v-if="rows.length === 0">
        <h1 class="text-xl font-semibold mb-6">Cart</h1>
        <p class="text-sm opacity-70">Cart is empty.</p>
    </section>
    <section v-else>
        <h1 class="text-xl font-semibold mb-6">Cart</h1>
        <table class="w-full text-left">
            <thead class="text-xs uppercase opacity-60">
                <tr>
                    <th class="py-2">Item</th>
                    <th class="py-2">Qty</th>
                    <th class="py-2">Subtotal</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                <tr
                    v-for="row in rows"
                    :key="row.productId"
                    class="border-b border-surface-border"
                    :data-testid="testIds.cartItem(row.productId)"
                >
                    <td class="py-3">{{ row.title }}</td>
                    <td class="py-3 font-mono text-sm">{{ row.quantity }}</td>
                    <td class="py-3 font-mono text-sm">{{ formatPrice(row.subtotalCents) }}</td>
                    <td class="py-3 text-right">
                        <button
                            type="button"
                            class="text-xs text-brand hover:underline"
                            @click="cart.remove(row.productId)"
                        >
                            Remove
                        </button>
                    </td>
                </tr>
            </tbody>
        </table>
        <div class="mt-6 flex items-center justify-between">
            <div class="text-sm">
                Total: <span class="font-mono">{{ formatPrice(totalCents) }}</span>
            </div>
            <RouterLink to="/checkout" class="rounded-lg bg-brand-ink text-white px-4 py-2 text-sm">
                Checkout
            </RouterLink>
        </div>
    </section>
</template>
