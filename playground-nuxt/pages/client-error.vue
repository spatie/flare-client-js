<script setup lang="ts">
import { ref } from 'vue';

const shouldThrow = ref(false);

function triggerError() {
    shouldThrow.value = true;
}

if (shouldThrow.value) {
    throw new Error('Intentional client-side error from Nuxt playground');
}
</script>

<template>
    <div>
        <h1>Client Error Test</h1>
        <p>Click the button to throw a synchronous error inside this Vue component.</p>
        <p>Expected: flareVue errorHandler captures it and reports to Flare.</p>

        <button
            @click="triggerError"
            style="
                padding: 0.5rem 1rem;
                cursor: pointer;
                background: #dc3545;
                color: white;
                border: none;
                border-radius: 0.25rem;
            "
        >
            Trigger Client Error
        </button>

        <div v-if="shouldThrow">
            {{ shouldThrow.nonExistentProperty.deepAccess }}
        </div>

        <NuxtLink to="/" style="display: block; margin-top: 2rem">Back to home</NuxtLink>
    </div>
</template>
