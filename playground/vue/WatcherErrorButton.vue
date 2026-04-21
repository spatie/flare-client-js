<script lang="ts" setup>
import { ref, watch } from 'vue';

import Button from './Button.vue';

const count = ref(0);

watch(count, (value) => {
    if (value > 0) {
        throw new Error(`Sync throw inside watch callback (count=${value})`);
    }
});
</script>

<template>
    <Button
        @click="
            () => {
                console.log('Mutating ref to trigger watch callback that throws');
                count++;
            }
        "
    >
        Error in watch callback (origin: watcher)
    </Button>
</template>
