import type { ErrorScenario } from './errorScenarios';
import { errorScenarios } from './errorScenarios';
import { logScenarios, type LogScenario } from './logScenarios';

export type Framework = 'js' | 'react' | 'vue' | 'svelte';

const exclude: Record<Framework, string[]> = {
    js: ['render-error', 'boundary-reset', 'sveltekit-server-throw'],
    react: ['sourcemap-mapped', 'sveltekit-server-throw'],
    vue: ['sourcemap-mapped', 'sveltekit-server-throw'],
    svelte: ['sourcemap-mapped'],
};

export const coverageFor = (framework: Framework): ErrorScenario[] =>
    errorScenarios.filter((s) => !exclude[framework].includes(s.id));

export const supportsScenario = (framework: Framework, scenarioId: string): boolean =>
    !exclude[framework].includes(scenarioId);

const excludeLogs: Record<Framework, string[]> = {
    js: [],
    react: ['log-unload'],
    vue: ['log-unload'],
    svelte: ['log-unload'],
};

export const logCoverageFor = (framework: Framework): LogScenario[] =>
    logScenarios.filter((s) => !excludeLogs[framework].includes(s.id));
