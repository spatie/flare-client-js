import { Flare } from '@flareapp/js';

const flare = new Flare();
flare.light(process.env.FLARE_KEY || '');
flare.setFramework({ name: 'Nuxt', version: '3' });

export default defineNitroPlugin((nitroApp) => {
    nitroApp.hooks.hook('error', (error, { event }) => {
        const err = error instanceof Error ? error : new Error(String(error));

        flare.report(err, {
            'flare.entry_point.type': 'http',
            'flare.entry_point.value': event?.path ?? 'unknown',
            'flare.entry_point.handler.type': 'nitro',
            'flare.entry_point.handler.identifier': event?.path ?? 'unknown',
        });
    });
});
