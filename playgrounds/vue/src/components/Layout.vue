<script setup lang="ts">
import { testIds } from '@flareapp/playgrounds-shared';
import { FlareErrorBoundary } from '@flareapp/vue';
import { RouterLink, RouterView } from 'vue-router';

import { clearBrokenTrigger } from '../brokenTrigger';
import { useCart } from '../cart';
import Fallback from './Fallback.vue';

const cart = useCart();

const onBoundaryReset = (): void => {
    clearBrokenTrigger();
};
</script>

<template>
    <div class="min-h-screen flex flex-col">
        <header class="border-b border-surface-border bg-surface">
            <div class="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
                <RouterLink to="/" class="text-lg font-semibold tracking-tight">Flare Pix</RouterLink>
                <nav class="flex items-center gap-6">
                    <RouterLink to="/" class="text-sm font-medium hover:text-brand">Shop</RouterLink>
                    <RouterLink to="/cart" class="text-sm font-medium hover:text-brand">Cart</RouterLink>
                    <RouterLink to="/broken" class="text-sm font-medium hover:text-brand">Broken</RouterLink>
                    <RouterLink
                        to="/cart"
                        class="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white"
                        :data-testid="testIds.cartCount"
                    >
                        {{ cart.count.value }}
                    </RouterLink>
                </nav>
            </div>
        </header>
        <main class="flex-1 mx-auto max-w-5xl w-full px-6 py-8">
            <FlareErrorBoundary :on-reset="onBoundaryReset">
                <RouterView />
                <template #fallback="{ error, resetErrorBoundary }">
                    <Fallback :error="error as Error" :reset-error-boundary="resetErrorBoundary as () => void" />
                </template>
            </FlareErrorBoundary>
        </main>
    </div>
</template>
