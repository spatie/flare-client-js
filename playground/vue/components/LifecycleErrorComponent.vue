<script lang="ts">
export default {
    name: 'LifecycleErrorComponent',
};
</script>

<script lang="ts" setup>
import { onMounted } from 'vue';

onMounted(() => {
    throw new Error('Error thrown in onMounted lifecycle hook');
});
</script>

<template>
    <span class="text-xs text-gray-500">lifecycle demo mounted (throws before you see this)</span>
</template>
