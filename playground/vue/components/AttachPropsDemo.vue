<script setup lang="ts">
defineProps<{
    config: {
        theme: 'dark' | 'light';
        nested: { layers: { a: number; b: number } };
        onClick: () => void;
    };
}>();

throw new Error('attachProps demo error');
</script>

<template>
    <div></div>
</template>
