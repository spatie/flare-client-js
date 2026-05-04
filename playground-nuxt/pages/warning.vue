<script setup lang="ts">
import { ref } from 'vue';

const showBadComponent = ref(false);
</script>

<template>
    <div>
        <h1>Vue Warning Test</h1>
        <p>Click the button to render a component that triggers a Vue runtime warning.</p>
        <p>Expected: captureWarnings forwards to Flare without breaking Nuxt's own warning handling.</p>

        <button
            @click="showBadComponent = true"
            style="
                padding: 0.5rem 1rem;
                cursor: pointer;
                background: #ffc107;
                color: #000;
                border: none;
                border-radius: 0.25rem;
            "
        >
            Trigger Vue Warning
        </button>

        <div v-if="showBadComponent">
            <component :is="'div'" :unknown-prop="true" />
        </div>

        <NuxtLink to="/" style="display: block; margin-top: 2rem">Back to home</NuxtLink>
    </div>
</template>
