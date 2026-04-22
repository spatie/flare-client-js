<script lang="ts" setup>
defineProps<{
    count: number;
}>();
</script>

<template>
    <span class="text-xs text-gray-500">count={{ count }}</span>
</template>
