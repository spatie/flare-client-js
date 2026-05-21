<script setup lang="ts">
import { testIds } from '@flareapp/playgrounds-shared';
import { RouterLink } from 'vue-router';
</script>

<template>
    <section class="text-center py-16" :data-testid="testIds.confirmation">
        <h1 class="text-2xl font-semibold mb-2">Order confirmed</h1>
        <p class="text-sm opacity-70 mb-6">A receipt was sent to your inbox.</p>
        <RouterLink to="/" class="text-sm text-brand hover:underline">Continue shopping</RouterLink>
    </section>
</template>
