<script setup lang="ts">
import type { NuxtError } from '#app';
import { flare } from '@flareapp/js';

const props = defineProps<{ error: NuxtError }>();

if (props.error) {
    flare.reportMessage(props.error.message || 'Unknown fatal error', 'error');
}

const handleClear = () => clearError({ redirect: '/' });
</script>

<template>
    <div style="font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem">
        <h1>Nuxt Error Page</h1>
        <p>Status: {{ error.statusCode }}</p>
        <p>Message: {{ error.message }}</p>
        <p style="color: #666; font-size: 0.875rem">This error was reported to Flare via flare.reportMessage().</p>
        <button @click="handleClear" style="margin-top: 1rem; padding: 0.5rem 1rem; cursor: pointer">
            Clear error and go home
        </button>
    </div>
</template>
