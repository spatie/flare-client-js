<script setup lang="ts">
import { fireHttpScenario, sameOriginHttpScenarios, testIds } from '@flareapp/playgrounds-shared';
import { ref } from 'vue';

const result = ref('idle');

const onClick = async (scenario: (typeof sameOriginHttpScenarios)[number]): Promise<void> => {
    result.value = await fireHttpScenario(scenario);
};
</script>

<template>
    <section>
        <h1 class="text-xl font-semibold mb-2">HTTP playground</h1>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
                v-for="scenario in sameOriginHttpScenarios"
                :key="scenario.id"
                type="button"
                class="rounded-lg border border-surface-border bg-surface px-4 py-3 text-left text-sm hover:border-brand"
                :data-testid="testIds.httpTrigger(scenario.id)"
                @click="onClick(scenario)"
            >
                <div class="font-medium">{{ scenario.label }}</div>
                <div class="text-xs opacity-60 font-mono">{{ scenario.id }}</div>
            </button>
        </div>
        <p class="mt-6 text-sm font-mono opacity-70" :data-testid="testIds.httpResult">{{ result }}</p>
    </section>
</template>
