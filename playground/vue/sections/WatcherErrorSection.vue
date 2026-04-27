<script lang="ts" setup>
import { ref, watch } from 'vue';

import Button from '../components/Button.vue';
import TestSection from '../components/TestSection.vue';

const count = ref(0);

watch(count, (value) => {
    if (value > 0) {
        throw new Error(`Sync throw inside watch callback (count=${value})`);
    }
});
</script>

<template>
    <TestSection
        title="Sync throw in watch callback"
        description="Mutates a ref to trigger a watcher that throws synchronously. Captured by flareVue with info indicating the watcher origin."
    >
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
    </TestSection>
</template>
