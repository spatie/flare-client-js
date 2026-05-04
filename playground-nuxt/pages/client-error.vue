<script setup lang="ts">
function triggerError() {
    throw new Error('Intentional client-side error from Nuxt playground');
}

function triggerRenderError() {
    // This will cause a render error by calling a non-existent method
    (null as any).crash();
}
</script>

<template>
    <div>
        <h1>Client Error Test</h1>
        <p>Click a button to trigger an error inside this Vue component.</p>
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
                margin-right: 0.5rem;
            "
        >
            Trigger Event Handler Error
        </button>

        <button
            @click="triggerRenderError"
            style="
                padding: 0.5rem 1rem;
                cursor: pointer;
                background: #dc3545;
                color: white;
                border: none;
                border-radius: 0.25rem;
            "
        >
            Trigger Render Error
        </button>

        <NuxtLink to="/" style="display: block; margin-top: 2rem">Back to home</NuxtLink>
    </div>
</template>
