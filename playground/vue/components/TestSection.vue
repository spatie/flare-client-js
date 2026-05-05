<script lang="ts" setup>
defineProps<{
    title: string;
    description: string;
    bodyClass?: string;
}>();
</script>

<template>
    <section class="border-t border-gray-200 py-6 first:border-t-0 first:pt-0">
        <h2 class="text-base font-semibold text-gray-900">{{ title }}</h2>
        <p class="mt-1 text-sm text-gray-600">{{ description }}</p>
        <div :class="['mt-3', bodyClass]">
            <slot />
        </div>
    </section>
</template>
