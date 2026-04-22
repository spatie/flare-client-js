<script lang="ts" setup>
import { useRoute } from 'vue-router';

import RouteContextSection from './sections/RouteContextSection.vue';
import RouteDenylistSection from './sections/RouteDenylistSection.vue';

const route = useRoute();
</script>

<template>
    <p class="text-sm text-gray-600">
        Route: <code class="rounded bg-gray-100 px-1">{{ route.fullPath }}</code> &mdash; params:
        <code class="rounded bg-gray-100 px-1">{{ JSON.stringify(route.params) }}</code> &mdash; query:
        <code class="rounded bg-gray-100 px-1">{{ JSON.stringify(route.query) }}</code>
    </p>
    <RouteContextSection />
    <RouteDenylistSection />
</template>
