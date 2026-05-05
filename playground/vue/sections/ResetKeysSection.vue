<script lang="ts" setup>
import { FlareErrorBoundary } from '@flareapp/vue';
import { ref } from 'vue';

import BuggyComponent from '../components/BuggyComponent.vue';
import Button from '../components/Button.vue';
import TestSection from '../components/TestSection.vue';

const showBuggy = ref(false);
const resetCounter = ref(0);
</script>

<template>
    <TestSection
        title="resetKeys auto-recovery"
        description="Passes a counter as resetKeys to the boundary. Incrementing it auto-recovers the boundary without the user clicking the fallback's reset button."
    >
        <div class="flex flex-wrap items-center gap-3">
            <Button
                @click="
                    () => {
                        console.log('Triggering render error for resetKeys test');
                        showBuggy = true;
                    }
                "
            >
                Trigger error
            </Button>
            <Button
                @click="
                    () => {
                        resetCounter++;
                        console.log(`Incrementing resetKeys counter to ${resetCounter}`);
                    }
                "
            >
                Increment reset key (counter: {{ resetCounter }})
            </Button>
        </div>
        <div v-if="showBuggy" class="mt-3">
            <FlareErrorBoundary
                :reset-keys="[resetCounter]"
                :on-reset="
                    (error) => {
                        console.log('resetKeys onReset called, previous error:', error?.message);
                        showBuggy = false;
                    }
                "
            >
                <BuggyComponent />
                <template #fallback="{ error }">
                    <p class="text-sm text-red-600">
                        Error caught: {{ error.message }}. Click "Increment reset key" to auto-reset.
                    </p>
                </template>
            </FlareErrorBoundary>
        </div>
    </TestSection>
</template>
