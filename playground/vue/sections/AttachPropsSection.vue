<script lang="ts" setup>
import { FlareErrorBoundary } from '@flareapp/vue';
import { ref } from 'vue';

import AttachPropsDemo from '../components/AttachPropsDemo.vue';
import Button from '../components/Button.vue';
import TestSection from '../components/TestSection.vue';

const show = ref(false);
</script>

<template>
    <TestSection
        title="attachProps serialization"
        description="Boundary with attachProps=true captures the throwing component's props (including nested objects up to propsMaxDepth) and exposes them via the fallback slot."
    >
        <Button
            @click="
                () => {
                    console.log('Triggering attachProps demo');
                    show = true;
                }
            "
        >
            Trigger attachProps demo
        </Button>
        <div v-if="show" class="mt-3">
            <FlareErrorBoundary :attach-props="true" :props-max-depth="2">
                <AttachPropsDemo
                    :config="{
                        theme: 'dark',
                        nested: { layers: { a: 1, b: 2 } },
                        onClick: () => console.log('clicked'),
                    }"
                />
                <template #fallback="{ error, componentProps, resetErrorBoundary }">
                    <div class="space-y-1">
                        <p>attachProps demo caught: {{ error.message }}</p>
                        <details class="text-xs text-gray-500" open>
                            <summary>Serialized componentProps</summary>
                            <pre class="mt-1 overflow-auto text-xs">{{ JSON.stringify(componentProps, null, 2) }}</pre>
                        </details>
                        <button
                            class="rounded-md bg-black px-2 py-1 text-sm font-medium text-white"
                            @click="
                                () => {
                                    show = false;
                                    resetErrorBoundary();
                                }
                            "
                        >
                            Reset
                        </button>
                    </div>
                </template>
            </FlareErrorBoundary>
        </div>
    </TestSection>
</template>
