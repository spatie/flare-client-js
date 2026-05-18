import { flare } from '@flareapp/js';
import { handleErrorWithFlare } from '@flareapp/sveltekit/server';

flare.light(process.env.VITE_FLARE_SVELTEKIT_KEY ?? 'test-key-sveltekit');

export const handleError = handleErrorWithFlare({
    beforeSubmit: ({ error, context }) => {
        console.log('[hooks.server.ts] handleError caught:', error.message);
        return context;
    },
});
