import { flare } from '@flareapp/js';

export const initFlareClient = (): void => {
    const url = import.meta.env.VITE_FLARE_URL;
    const key = import.meta.env.VITE_FLARE_KEY ?? 'test-key-svelte';

    if (url) {
        flare.configure({
            ingestUrl: url,
            logsIngestUrl: url.replace('/v1/errors', '/v1/logs'),
        });
    }

    flare.configure({
        // Logging is always on in the playground so the log buttons exercise the
        // SDK even without a fake server (manual runs POST to the default ingest
        // and fail like the error reports do). The fake-server logsIngestUrl
        // override above only applies under e2e (VITE_FLARE_URL set).
        enableLogs: true,
        beforeEvaluate: (error) => (error.message === 'hook-drop-report' ? null : error),
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
};

export { flare };
