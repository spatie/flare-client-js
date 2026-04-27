<script lang="ts" setup>
import { useRoute } from 'vue-router';

import { flare } from '../../shared/initFlare';

import Button from '../components/Button.vue';
import TestSection from '../components/TestSection.vue';

const route = useRoute();
</script>

<template>
    <TestSection
        title="Route context in reports"
        description="Both buttons produce a report while on the active route. context.vue.route should contain the current path, params, and query."
        body-class="flex flex-wrap items-center gap-3"
    >
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
                    console.log(`Reporting error on route ${route.fullPath}`);
                    flare.report(new Error(`Manually reported from user profile ${route.params.id}`));
                }
            "
        >
            flare.report() on this route
        </Button>
    </TestSection>
</template>
