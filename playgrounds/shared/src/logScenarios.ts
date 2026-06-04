export type LogLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';

// Structurally identical to @flareapp/core's `AttributeValue`, redefined here so
// `playgrounds/shared` stays dependency-free. Because it is structurally the same,
// `Record<string, LogAttributeValue>` is assignable to the SDK's `Attributes`, so
// these attributes pass straight to `flare.logger.*` under strict TypeScript.
export type LogAttributeValue =
    | string
    | number
    | boolean
    | null
    | LogAttributeValue[]
    | { [key: string]: LogAttributeValue };

export type LogScenario = {
    id: string;
    label: string;
    level: LogLevel;
    message: string;
    context?: Record<string, LogAttributeValue>;
    count: number;
    flushOnTrigger: boolean;
};

export const logScenarios: LogScenario[] = [
    { id: 'log-info', label: 'Log info', level: 'info', message: 'playground-info', count: 1, flushOnTrigger: true },
    {
        id: 'log-warning',
        label: 'Log warning',
        level: 'warning',
        message: 'playground-warning',
        count: 1,
        flushOnTrigger: true,
    },
    {
        id: 'log-error',
        label: 'Log error',
        level: 'error',
        message: 'playground-error',
        count: 1,
        flushOnTrigger: true,
    },
    {
        id: 'log-context',
        label: 'Log info with context',
        level: 'info',
        message: 'playground-context',
        count: 1,
        flushOnTrigger: true,
        context: { 'context.scenario': { source: 'logger', userId: 'usr_42' } },
    },
    {
        id: 'log-burst',
        label: 'Log burst (5)',
        level: 'info',
        message: 'playground-burst',
        count: 5,
        flushOnTrigger: true,
    },
    {
        id: 'log-unload',
        label: 'Log then unload',
        level: 'info',
        message: 'e2e-unload-log',
        count: 1,
        flushOnTrigger: false,
    },
];

export const logScenarioById = (id: string): LogScenario | undefined => logScenarios.find((s) => s.id === id);
