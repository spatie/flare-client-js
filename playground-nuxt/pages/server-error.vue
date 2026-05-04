<script setup lang="ts">
const result = ref<string | null>(null);
const errorMessage = ref<string | null>(null);

async function triggerServerError() {
    result.value = null;
    errorMessage.value = null;

    try {
        await $fetch('/api/error');
        result.value = 'Unexpected success';
    } catch (e: unknown) {
        errorMessage.value = e instanceof Error ? e.message : String(e);
    }
}
</script>

<template>
    <div>
        <h1>Server Error Test</h1>
        <p>Click the button to call /api/error, which throws a server-side error.</p>
        <p>Expected: Nitro error hook fires in server plugin. Client receives error response.</p>

        <button
            @click="triggerServerError"
            style="
                padding: 0.5rem 1rem;
                cursor: pointer;
                background: #dc3545;
                color: white;
                border: none;
                border-radius: 0.25rem;
            "
        >
            Call /api/error
        </button>

        <div v-if="result" style="margin-top: 1rem; padding: 1rem; background: #d4edda; border-radius: 0.25rem">
            {{ result }}
        </div>
        <div v-if="errorMessage" style="margin-top: 1rem; padding: 1rem; background: #f8d7da; border-radius: 0.25rem">
            <strong>Server error:</strong> {{ errorMessage }}
        </div>

        <NuxtLink to="/" style="display: block; margin-top: 2rem">Back to home</NuxtLink>
    </div>
</template>
