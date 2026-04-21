<script lang="ts" setup>
import { ref } from 'vue';

import Button from './Button.vue';
import LifecycleErrorComponent from './LifecycleErrorComponent.vue';

const show = ref(false);
</script>

<template>
    <Button
        @click="
            () => {
                console.log('Mounting LifecycleErrorComponent (throws in onMounted)');
                show = true;
            }
        "
    >
        Error in onMounted (origin: lifecycle)
    </Button>
    <Button
        v-if="show"
        @click="
            () => {
                show = false;
                console.log('Reset LifecycleErrorComponent');
            }
        "
    >
        Reset lifecycle demo
    </Button>
    <LifecycleErrorComponent v-if="show" />
</template>
