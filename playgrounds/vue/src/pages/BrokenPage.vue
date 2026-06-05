<script setup lang="ts">
import {
    coverageFor,
    fireLogScenario,
    logCoverageFor,
    testIds,
    type ErrorScenario,
} from '@flareapp/playgrounds-shared';

import { brokenTrigger } from '../brokenTrigger';
import MaybeThrowing from '../components/MaybeThrowing.vue';
import { flare } from '../flare';

const scenarios: ErrorScenario[] = coverageFor('vue');
const logScenarios = logCoverageFor('vue');

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const handleScenario = async (id: string): Promise<void> => {
    switch (id) {
        case 'sync-throw':
            throw new Error('sync-throw');
        case 'async-throw':
            await sleep(20);
            throw new Error('async-throw');
        case 'unhandled-rejection':
            void Promise.reject(new Error('unhandled-rejection'));
            return;
        case 'render-error':
        case 'boundary-reset':
            brokenTrigger.value = id;
            return;
        case 'manual-report':
            void flare.report(new Error('manual-report'), {
                'context.scenario': { source: 'manual-report', userId: 'usr_42' },
            });
            return;
        case 'glow-then-throw':
            flare.glow('clicked checkout', 'info', { step: 1 });
            flare.glow('validated cart', 'info', { step: 2 });
            flare.glow('called payment', 'warning', { step: 3 });
            throw new Error('glow-then-throw');
        case 'hook-drop-report':
            void flare.report(new Error('hook-drop-report'));
            return;
        case 'hook-mutate-report':
            void flare.report(new Error('hook-mutate-report'));
            return;
        default:
            return;
    }
};

const onClick = (scenarioId: string): void => {
    void handleScenario(scenarioId);
};
</script>

<template>
    <section>
        <MaybeThrowing v-if="brokenTrigger" :key="brokenTrigger" :trigger="brokenTrigger" />
        <h1 class="text-xl font-semibold mb-2">Error playground</h1>
        <p class="text-sm opacity-70 mb-6">Each button triggers a deterministic error scenario.</p>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
                v-for="scenario in scenarios"
                :key="scenario.id"
                type="button"
                class="rounded-lg border border-surface-border bg-surface px-4 py-3 text-left text-sm hover:border-brand"
                :data-testid="testIds.brokenTrigger(scenario.id)"
                @click="onClick(scenario.id)"
            >
                <div class="font-medium">{{ scenario.label }}</div>
                <div class="text-xs opacity-60 font-mono">{{ scenario.id }}</div>
            </button>
        </div>
        <h2 class="text-lg font-semibold mt-8 mb-2">Logging</h2>
        <p class="text-sm opacity-70 mb-4">Each button records one or more structured logs.</p>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
                v-for="scenario in logScenarios"
                :key="scenario.id"
                type="button"
                class="rounded-lg border border-surface-border bg-surface px-4 py-3 text-left text-sm hover:border-brand"
                :data-testid="testIds.logTrigger(scenario.id)"
                @click="fireLogScenario(flare, scenario)"
            >
                <div class="font-medium">{{ scenario.label }}</div>
                <div class="text-xs opacity-60 font-mono">{{ scenario.id }}</div>
            </button>
        </div>
    </section>
</template>
