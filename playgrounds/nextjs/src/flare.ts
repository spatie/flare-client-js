import { flare } from '@flareapp/js';

let initialized = false;

export const initFlare = (): void => {
    if (initialized) return;
    initialized = true;

    const url = process.env.NEXT_PUBLIC_FLARE_URL;
    const key = process.env.NEXT_PUBLIC_FLARE_KEY ?? 'test-key-nextjs';

    if (url) {
        flare.configure({ ingestUrl: url });
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
