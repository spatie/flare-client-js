<script lang="ts" setup>
import { RouterLink, RouterView } from 'vue-router';
</script>

<template>
    <nav class="flex items-center gap-3 text-sm">
        <RouterLink to="/" class="rounded-md bg-gray-200 px-3 py-1 hover:bg-gray-300">Home</RouterLink>
        <RouterLink to="/users/42?tab=settings" class="rounded-md bg-gray-200 px-3 py-1 hover:bg-gray-300">
            User 42
        </RouterLink>
        <RouterLink to="/users/99" class="rounded-md bg-gray-200 px-3 py-1 hover:bg-gray-300">User 99</RouterLink>
    </nav>
    <RouterView />
</template>
