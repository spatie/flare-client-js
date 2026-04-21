<script lang="ts" setup>
import { FlareErrorBoundary } from '@flareapp/vue';
import { ref } from 'vue';
import { useRoute } from 'vue-router';

import { flare } from '../shared/initFlare';

import BuggyComponent from './BuggyComponent.vue';
import Button from './Button.vue';

const route = useRoute();
const showRouteDemo = ref(false);
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
    <Button
        @click="
            () => {
                console.log('Mounting route-denylist demo (inspect context.vue.route in console)');
                showRouteDemo = true;
            }
        "
    >
        Route denylist demo (log context.vue.route)
    </Button>
    <FlareErrorBoundary
        v-if="showRouteDemo"
        :before-submit="
            ({ context }) => {
                console.log('[route denylist demo] context.vue.route:', context.vue.route);
                return context;
            }
        "
        :on-reset="
            () => {
                showRouteDemo = false;
            }
        "
    >
        <BuggyComponent message="Route denylist demo error" />
        <template #fallback="{ error, resetErrorBoundary }">
            <div class="space-y-1">
                <p class="text-sm">Caught: {{ error.message }} &mdash; check console for redacted route context</p>
                <button
                    class="rounded-md bg-black px-2 py-1 text-sm font-medium text-white"
                    @click="resetErrorBoundary"
                >
                    Reset
                </button>
            </div>
        </template>
    </FlareErrorBoundary>
</template>
