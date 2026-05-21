export type ErrorScenarioKind =
    | 'sync'
    | 'async'
    | 'unhandledRejection'
    | 'render'
    | 'boundaryReset'
    | 'manualReport'
    | 'sveltekitServer';

export type ErrorScenario = {
    id: string;
    label: string;
    kind: ErrorScenarioKind;
    expectedMessage: string;
    expectedReports: number;
    expectedContext?: Record<string, unknown>;
};

export const errorScenarios: ErrorScenario[] = [
    {
        id: 'sync-throw',
        label: 'Sync throw in handler',
        kind: 'sync',
        expectedMessage: 'sync-throw',
        expectedReports: 1,
    },
    {
        id: 'async-throw',
        label: 'Async throw after await',
        kind: 'async',
        expectedMessage: 'async-throw',
        expectedReports: 1,
    },
    {
        id: 'unhandled-rejection',
        label: 'Unhandled promise rejection',
        kind: 'unhandledRejection',
        expectedMessage: 'unhandled-rejection',
        expectedReports: 1,
    },
    {
        id: 'render-error',
        label: 'Throw during component render',
        kind: 'render',
        expectedMessage: 'render-error',
        expectedReports: 1,
    },
    {
        id: 'boundary-reset',
        label: 'Render error then reset boundary',
        kind: 'boundaryReset',
        expectedMessage: 'boundary-reset',
        expectedReports: 1,
    },
    {
        id: 'manual-report',
        label: 'flare.report with custom context',
        kind: 'manualReport',
        expectedMessage: 'manual-report',
        expectedReports: 1,
        expectedContext: { source: 'manual-report', userId: 'usr_42' },
    },
    {
        id: 'glow-then-throw',
        label: 'Add glows then throw',
        kind: 'sync',
        expectedMessage: 'glow-then-throw',
        expectedReports: 1,
    },
    {
        id: 'hook-drop-report',
        label: 'beforeEvaluate drops report',
        kind: 'sync',
        expectedMessage: 'hook-drop-report',
        expectedReports: 0,
    },
    {
        id: 'hook-mutate-report',
        label: 'beforeSubmit adds context',
        kind: 'sync',
        expectedMessage: 'hook-mutate-report',
        expectedReports: 1,
        expectedContext: { injectedBy: 'beforeSubmit' },
    },
    {
        id: 'sourcemap-mapped',
        label: 'Minified error resolves via sourcemap',
        kind: 'sync',
        expectedMessage: 'sourcemap-mapped',
        expectedReports: 1,
    },
    {
        id: 'sveltekit-server-throw',
        label: 'SvelteKit +page.server.ts throw',
        kind: 'sveltekitServer',
        expectedMessage: 'sveltekit-server-throw',
        expectedReports: 1,
    },
];

export const scenarioById = (id: string): ErrorScenario | undefined => errorScenarios.find((s) => s.id === id);
