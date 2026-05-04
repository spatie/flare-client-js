<script setup lang="ts">
const shouldFetch = ref(false);

const { error } = useAsyncData(
    'failing-data',
    async () => {
        if (!shouldFetch.value) {
            return null;
        }
        throw new Error('Intentional async error from useAsyncData');
    },
    { watch: [shouldFetch] }
);

function triggerAsyncError() {
    shouldFetch.value = true;
}
</script>

<template>
    <div>
        <h1>Async Error Test</h1>
        <p>Click the button to trigger an error inside useAsyncData.</p>
        <p>Expected: Nuxt error handling kicks in. SDK does not interfere with SSR error recovery.</p>

        <button
            @click="triggerAsyncError"
            style="
                padding: 0.5rem 1rem;
                cursor: pointer;
                background: #dc3545;
                color: white;
                border: none;
                border-radius: 0.25rem;
            "
        >
            Trigger Async Error
        </button>

        <div v-if="error" style="margin-top: 1rem; padding: 1rem; background: #f8d7da; border-radius: 0.25rem">
            <strong>Error caught:</strong> {{ error.message }}
        </div>

        <NuxtLink to="/" style="display: block; margin-top: 2rem">Back to home</NuxtLink>
    </div>
</template>
