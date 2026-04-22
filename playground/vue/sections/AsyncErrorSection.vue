<script lang="ts" setup>
import { ref, watch } from 'vue';

import Button from '../components/Button.vue';
import TestSection from '../components/TestSection.vue';

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
    <TestSection
        title="Async error in watcher (Promise rejection)"
        description="Rejects a promise from inside a watcher. Not caught by flareVue's handler; captured via window.onunhandledrejection instead."
    >
        <Button @click="trigger = true">Async error in watch</Button>
    </TestSection>
</template>
