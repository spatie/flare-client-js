<script lang="ts" setup>
import { FlareErrorBoundary } from '@flareapp/vue';
import { ref } from 'vue';

import BuggyComponent from './BuggyComponent.vue';
import Button from './Button.vue';

const showBuggy = ref(false);
const resetCounter = ref(0);
</script>

<template>
    <div class="space-y-2">
        <p class="text-xs font-medium text-gray-500">resetKeys test (counter: {{ resetCounter }})</p>
        <div class="flex gap-2">
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
                Increment reset key
            </Button>
        </div>
        <FlareErrorBoundary
            v-if="showBuggy"
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
</template>
