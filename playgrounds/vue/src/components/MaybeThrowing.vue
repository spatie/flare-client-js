<script setup lang="ts">
const props = defineProps<{
    trigger: string | null;
}>();

if (props.trigger === 'render-error') {
    throw new Error('render-error');
}

if (props.trigger === 'boundary-reset') {
    throw new Error('boundary-reset');
}
</script>

<template>
    <span class="hidden" />
</template>
