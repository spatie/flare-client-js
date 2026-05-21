import { flare } from '@flareapp/js';

export const initFlare = (): void => {
    const url = import.meta.env.VITE_FLARE_URL;
    const key = import.meta.env.VITE_FLARE_KEY ?? 'test-key-vue';

    if (url) {
        flare.configure({ ingestUrl: `${url}/api/reports` });
    }

    flare.configure({
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
};

export { flare };
