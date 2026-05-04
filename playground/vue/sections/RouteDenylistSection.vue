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
        title="Route denylist"
        description="Boundary's beforeSubmit hook logs context.vue.route to the console so you can verify that denylisted query params (token, session_id, etc.) are redacted while other keys pass through."
    >
        <Button
            @click="
                () => {
                    console.log('Mounting route-denylist demo (inspect context.vue.route in console)');
                    show = true;
                }
            "
        >
            Route denylist demo (log context.vue.route)
        </Button>
        <div v-if="show" class="mt-3">
            <FlareErrorBoundary
                :before-submit="
                    ({ context }) => {
                        console.log('[route denylist demo] context.vue.route:', context.vue.route);
                        return context;
                    }
                "
                :on-reset="
                    () => {
                        show = false;
                    }
                "
            >
                <BuggyComponent message="Route denylist demo error" />
                <template #fallback="{ error, resetErrorBoundary }">
                    <div class="space-y-1">
                        <p class="text-sm">
                            Caught: {{ error.message }} &mdash; check console for redacted route context
                        </p>
                        <button
                            class="rounded-md bg-black px-2 py-1 text-sm font-medium text-white"
                            @click="resetErrorBoundary"
                        >
                            Reset
                        </button>
                    </div>
                </template>
            </FlareErrorBoundary>
        </div>
    </TestSection>
</template>
