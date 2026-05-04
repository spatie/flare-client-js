<script setup lang="ts">
const config = useRuntimeConfig();
const hasKey = !!config.public.flareKey;
</script>

<template>
    <div>
        <h1>Flare Nuxt SSR Playground</h1>

        <div
            :style="{
                padding: '1rem',
                marginBottom: '1.5rem',
                borderRadius: '0.5rem',
                backgroundColor: hasKey ? '#d4edda' : '#f8d7da',
                color: hasKey ? '#155724' : '#721c24',
            }"
        >
            <template v-if="hasKey">Flare API key configured.</template>
            <template v-else>No FLARE_KEY set. Copy .env.example to .env and add your key.</template>
        </div>

        <h2>Test Scenarios</h2>
        <nav>
            <ul style="list-style: none; padding: 0">
                <li style="margin-bottom: 0.75rem">
                    <NuxtLink to="/client-error">Client Error</NuxtLink>
                    — Trigger a synchronous error in a Vue component
                </li>
                <li style="margin-bottom: 0.75rem">
                    <NuxtLink to="/async-error">Async Error</NuxtLink>
                    — Error in useAsyncData (SSR path)
                </li>
                <li style="margin-bottom: 0.75rem">
                    <NuxtLink to="/server-error">Server Error</NuxtLink>
                    — Call /api/error endpoint
                </li>
                <li style="margin-bottom: 0.75rem">
                    <NuxtLink to="/warning">Vue Warning</NuxtLink>
                    — Trigger a Vue runtime warning
                </li>
            </ul>
        </nav>
    </div>
</template>
