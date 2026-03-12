<script lang="ts" setup>
import { onMounted, ref, watch } from 'vue';

import Button from './Button.vue';

const trigger = ref(false);

watch(trigger, (value) => {
    if (value) {
        trigger.value = false;
        console.log('Triggering async error in watch');
        Promise.reject(new Error('Async error in Vue watch'));
    }
});
</script>

<template>
    <Button @click="trigger = true">Async error in watch</Button>
</template>
