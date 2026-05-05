<script lang="ts" setup>
import { FlareErrorBoundary } from '@flareapp/vue';
import { ref } from 'vue';

import Button from '../components/Button.vue';
import DenylistPropsDemo from '../components/DenylistPropsDemo.vue';
import TestSection from '../components/TestSection.vue';

const show = ref(false);
</script>

<template>
    <TestSection
        title="Default prop denylist"
        description="attachProps=true with default denylist: password, authToken, apiKey, sessionId, pin, cvv, etc. should appear as [redacted] in the serialized componentProps. Non-sensitive fields pass through."
    >
        <Button
            @click="
                () => {
                    console.log('Triggering default denylist props demo');
                    show = true;
                }
            "
        >
            Trigger default denylist demo
        </Button>
        <div v-if="show" class="mt-3">
            <FlareErrorBoundary :attach-props="true" :props-max-depth="3">
                <DenylistPropsDemo
                    :username="'alice'"
                    :password="'super-secret-pw'"
                    :auth-token="'bearer-abc-123'"
                    :api-key="'sk_live_abcdef'"
                    :session-id="'sess_xyz'"
                    :config="{ theme: 'dark', pin: '1234', cvv: '987', regular: 'visible' }"
                />
                <template #fallback="{ error, componentProps, resetErrorBoundary }">
                    <div class="space-y-1">
                        <p>Denylist demo caught: {{ error.message }}</p>
                        <details class="text-xs text-gray-500" open>
                            <summary>Serialized componentProps (sensitive fields should be [redacted])</summary>
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
