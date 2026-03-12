<script lang="ts" setup>
import { useRoute } from 'vue-router';

import { flare } from '../shared/initFlare';

import Button from './Button.vue';

const route = useRoute();
</script>

<template>
    <p class="text-sm text-gray-600">
        Route: <code class="rounded bg-gray-100 px-1">{{ route.fullPath }}</code> &mdash; params:
        <code class="rounded bg-gray-100 px-1">{{ JSON.stringify(route.params) }}</code> &mdash; query:
        <code class="rounded bg-gray-100 px-1">{{ JSON.stringify(route.query) }}</code>
    </p>
    <Button
        @click="
            () => {
                console.log(`Throwing error on route ${route.fullPath}`);
                throw new Error(`Error on user profile ${route.params.id}`);
            }
        "
    >
        Throw error on this route
    </Button>
    <Button
        @click="
            () => {
                console.log(`Reporting message on route ${route.fullPath}`);
                flare.report(new Error(`Manually reported from user profile ${route.params.id}`));
            }
        "
    >
        flare.report() on this route
    </Button>
</template>
