<script setup lang="ts">
import { testIds } from '@flareapp/playgrounds-shared';

defineProps<{
    error: Error;
    resetErrorBoundary: () => void;
}>();
</script>

<template>
    <section class="rounded-2xl border border-surface-border bg-surface p-6" :data-testid="testIds.boundaryFallback">
        <h2 class="text-lg font-semibold mb-2">Something broke</h2>
        <p class="text-sm opacity-70 mb-4 font-mono">{{ error.message }}</p>
        <button
            type="button"
            class="rounded-lg bg-brand-ink text-white px-4 py-2 text-sm hover:opacity-90"
            :data-testid="testIds.boundaryReset"
            @click="resetErrorBoundary"
        >
            Reset
        </button>
    </section>
</template>
