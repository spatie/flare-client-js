import { flare } from '@flareapp/js';

export const initFlare = (): void => {
    const url = import.meta.env.VITE_FLARE_URL;
    const key = import.meta.env.VITE_FLARE_KEY ?? 'test-key-js';

    if (url) {
        flare.configure({
            ingestUrl: url,
            logsIngestUrl: url.replace('/api/reports', '/api/logs'),
            tracesIngestUrl: url.replace('/api/reports', '/api/traces'),
            // e2e-only timing: keep the pageload/navigation root active long enough for a
            // prompt Playwright click to land and nest under it, then flush an ended root
            // fast so arrival assertions don't need to wait out the (5s) production default.
            idleTimeout: 2000,
            spanFlushIntervalMs: 500,
        });
    }

    flare.configure({
        // Logging is always on in the playground so the log buttons exercise the
        // SDK even without a fake server (manual runs POST to the default ingest
        // and fail like the error reports do). The fake-server logsIngestUrl
        // override above only applies under e2e (VITE_FLARE_URL set).
        enableLogs: true,
        enableTracing: true,
        tracesSampleRate: 1,
        beforeEvaluate: (error) => {
            if (error.message === 'hook-drop-report') return null;
            return error;
        },
        beforeSubmit: (report) => {
            if (report.message === 'hook-mutate-report') {
                report.attributes = {
                    ...report.attributes,
                    'context.custom_hook': { injectedBy: 'beforeSubmit' },
                };
            }
            return report;
        },
    });

    flare.light(key, true);

    // Expose the instance so the e2e suite can drive the logger directly (e.g. lower
    // keepaliveMaxBytes and simulate visibilitychange:hidden). Playground-only.
    (globalThis as { __flare?: typeof flare }).__flare = flare;
};

export { flare };
