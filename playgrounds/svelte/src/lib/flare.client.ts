import { flare } from '@flareapp/js';

export const initFlareClient = (): void => {
    const url = import.meta.env.VITE_FLARE_URL;
    const key = import.meta.env.VITE_FLARE_KEY ?? 'test-key-svelte';

    if (url) flare.configure({ ingestUrl: url });

    flare.configure({
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
