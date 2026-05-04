<script lang="ts" setup>
import { FlareErrorBoundary } from '@flareapp/vue';
import { ref } from 'vue';

import BuggyComponent from '../components/BuggyComponent.vue';
import Button from '../components/Button.vue';
import TestSection from '../components/TestSection.vue';

const show = ref(false);
</script>

<template>
    <TestSection
        title="Nested boundaries"
        description="Two nested FlareErrorBoundary instances. The inner must catch the error and report it; the outer must remain silent and not render its fallback or fire its submit hooks."
    >
        <div class="flex flex-wrap items-center gap-3">
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
        <div v-if="show" class="mt-3">
            <FlareErrorBoundary
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
    </TestSection>
</template>
