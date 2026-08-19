<script setup lang="ts">
import type { ApiProduct } from '@flareapp/playgrounds-shared';

import ProductCard from './ProductCard.vue';

defineProps<{ products: ApiProduct[] }>();
</script>

<template>
    <div class="grid grid-cols-2 md:grid-cols-3 gap-6">
        <ProductCard v-for="product in products" :key="product.id" :product="product" />
    </div>
</template>
