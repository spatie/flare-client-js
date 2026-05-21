<script setup lang="ts">
import { testIds } from '@flareapp/playgrounds-shared';
import { useRouter } from 'vue-router';

import { useCart } from '../cart';

const router = useRouter();
const cart = useCart();

const submit = (): void => {
    cart.clear();
    void router.push('/confirmation');
};
</script>

<template>
    <section class="max-w-md mx-auto">
        <h1 class="text-xl font-semibold mb-6">Checkout</h1>
        <form class="flex flex-col gap-4" @submit.prevent="submit">
            <label class="flex flex-col gap-1 text-sm">
                Name
                <input name="name" required value="Test User" class="rounded border border-surface-border px-3 py-2" />
            </label>
            <label class="flex flex-col gap-1 text-sm">
                Email
                <input
                    name="email"
                    type="email"
                    required
                    value="test@example.com"
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
            <button
                type="submit"
                class="rounded-lg bg-brand-ink text-white py-2 text-sm"
                :data-testid="testIds.checkoutSubmit"
            >
                Pay
            </button>
        </form>
    </section>
</template>
