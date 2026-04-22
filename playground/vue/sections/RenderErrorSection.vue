<script lang="ts" setup>
import { FlareErrorBoundary } from '@flareapp/vue';
import { ref } from 'vue';

import { flare } from '../../shared/initFlare';

import BuggyComponent from '../components/BuggyComponent.vue';
import Button from '../components/Button.vue';
import TestSection from '../components/TestSection.vue';

const showBuggy = ref(false);
</script>

<template>
    <TestSection
        title="Render error caught by FlareErrorBoundary"
        description="Throws during render inside a <FlareErrorBoundary>. Fallback renders with componentHierarchy, beforeSubmit injects a marker into context.vue, and resetting unmounts the component so it can be retried."
    >
        <div class="flex flex-wrap items-center gap-3">
            <Button
                @click="
                    () => {
                        console.log('Triggering render error via BuggyComponent');
                        showBuggy = true;
                    }
                "
            >
                Trigger render error
            </Button>
            <Button
                @click="
                    () => {
                        showBuggy = false;
                        console.log('Reset BuggyComponent state');
                    }
                "
            >
                Reset render error
            </Button>
        </div>
        <div v-if="showBuggy" class="mt-3">
            <FlareErrorBoundary
                :before-evaluate="
                    ({ error, info }) => {
                        console.log(`FlareErrorBoundary beforeEvaluate: ${error.message} (${info})`);
                        flare.addContext('playground', 'vue-test');
                    }
                "
                :before-submit="
                    ({ error, context }) => {
                        console.log(`FlareErrorBoundary beforeSubmit: ${error.message}`);
                        return {
                            ...context,
                            vue: {
                                ...context.vue,
                                componentHierarchy: [...context.vue.componentHierarchy, 'injected-by-beforeSubmit'],
                            },
                        };
                    }
                "
                :after-submit="
                    ({ error, info }) => {
                        console.log(`FlareErrorBoundary afterSubmit: ${error.message} (${info}) reported to Flare`);
                    }
                "
                :on-reset="
                    (error) => {
                        console.log(`FlareErrorBoundary onReset: recovering from ${error?.message}`);
                    }
                "
            >
                <BuggyComponent message="BuggyComponent render error in Vue" />
                <template #fallback="{ error, componentHierarchy, componentHierarchyFrames, resetErrorBoundary }">
                    <div class="space-y-1">
                        <p>Something went wrong: {{ error.message }}</p>
                        <p class="text-xs text-gray-500">Hierarchy: {{ componentHierarchy.join(' > ') }}</p>
                        <details class="text-xs text-gray-500">
                            <summary>Hierarchy frames ({{ componentHierarchyFrames.length }})</summary>
                            <pre class="mt-1 overflow-auto text-xs">{{
                                JSON.stringify(componentHierarchyFrames, null, 2)
                            }}</pre>
                        </details>
                        <button
                            class="rounded-md bg-black px-2 py-1 text-sm font-medium text-white"
                            @click="resetErrorBoundary"
                        >
                            Try again
                        </button>
                    </div>
                </template>
            </FlareErrorBoundary>
        </div>
    </TestSection>
</template>
