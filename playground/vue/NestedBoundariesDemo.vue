<script lang="ts">
export default {
    name: 'NestedBoundariesDemo',
};
</script>

<script lang="ts" setup>
import { FlareErrorBoundary } from '@flareapp/vue';
import { ref } from 'vue';

import BuggyComponent from './BuggyComponent.vue';
import Button from './Button.vue';

const show = ref(false);
</script>

<template>
    <div class="space-y-2">
        <p class="text-xs font-medium text-gray-500">Nested boundaries (inner must catch, outer must stay silent)</p>
        <div class="flex gap-2">
            <Button
                @click="
                    () => {
                        console.log('Mounting nested boundaries demo');
                        show = true;
                    }
                "
            >
                Trigger nested boundaries
            </Button>
            <Button
                v-if="show"
                @click="
                    () => {
                        show = false;
                        console.log('Reset nested boundaries demo');
                    }
                "
            >
                Reset
            </Button>
        </div>

        <FlareErrorBoundary
            v-if="show"
            :before-submit="
                ({ error, context }) => {
                    console.log('[OUTER boundary] beforeSubmit (SHOULD NOT FIRE):', error.message);
                    return context;
                }
            "
            :after-submit="
                ({ error }) => {
                    console.log('[OUTER boundary] afterSubmit (SHOULD NOT FIRE):', error.message);
                }
            "
        >
            <FlareErrorBoundary
                :before-submit="
                    ({ error, context }) => {
                        console.log('[inner boundary] beforeSubmit:', error.message);
                        return context;
                    }
                "
                :after-submit="
                    ({ error }) => {
                        console.log('[inner boundary] afterSubmit:', error.message);
                    }
                "
            >
                <BuggyComponent message="Error thrown inside nested boundary test" />
                <template #fallback="{ error }">
                    <p class="text-sm text-red-600">
                        Inner boundary caught: {{ error.message }} (outer should not render)
                    </p>
                </template>
            </FlareErrorBoundary>
            <template #fallback>
                <p class="text-sm font-bold text-red-700">OUTER boundary rendered &mdash; THIS SHOULD NOT HAPPEN</p>
            </template>
        </FlareErrorBoundary>
    </div>
</template>
