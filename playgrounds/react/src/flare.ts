import { flare } from '@flareapp/js';
import { showcaseUser } from '@flareapp/playgrounds-shared';

export const initFlare = (): void => {
    const url = import.meta.env.VITE_FLARE_URL;
    const key = import.meta.env.VITE_FLARE_KEY ?? 'test-key-react';

    if (url) {
        flare.configure({
            ingestUrl: url,
            logsIngestUrl: url.replace('/v1/errors', '/v1/logs'),
            tracesIngestUrl: url.replace('/v1/errors', '/v1/traces'),
            // e2e-only timing: keeps the pageload root open long enough for a Playwright
            // click to nest under it, then flushes fast so tests don't wait out the 5s default.
            idleTimeout: 2000,
            spanFlushIntervalMs: 500,
        });
    }

    flare.configure({
        // Logging stays on in the playground so the log buttons exercise the SDK even
        // without a fake server. The logsIngestUrl override above only applies under e2e.
        enableLogs: true,
        enableTracing: true,
        enableBreadcrumbs: true,
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

    // Every showcase report carries a signed-in shopper (see playgrounds/SCREENSHOTS.md).
    flare.setUser(showcaseUser);

    flare.light(key, true);

    // Expose the instance so the e2e suite can drive the tracer directly. Playground-only.
    (globalThis as { __flare?: typeof flare }).__flare = flare;
};

export { flare };
