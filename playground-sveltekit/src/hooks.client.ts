import { handleErrorWithFlare } from '@flareapp/sveltekit/client';

export const handleError = handleErrorWithFlare({
    beforeSubmit: ({ error, context }) => {
        console.log('[hooks.client.ts] handleError caught:', error.message);
        return context;
    },
});
