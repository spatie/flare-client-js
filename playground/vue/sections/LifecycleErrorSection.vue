<script lang="ts" setup>
import { ref } from 'vue';

import Button from '../components/Button.vue';
import LifecycleErrorComponent from '../components/LifecycleErrorComponent.vue';
import TestSection from '../components/TestSection.vue';

const show = ref(false);
</script>

<template>
    <TestSection
        title="Error in onMounted lifecycle"
        description="Mounts a component that throws inside onMounted. Captured by flareVue with info indicating the lifecycle origin."
    >
        <div class="flex flex-wrap items-center gap-3">
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
        </div>
        <div v-if="show" class="mt-3">
            <LifecycleErrorComponent />
        </div>
    </TestSection>
</template>
