import { flare } from '@flareapp/js';

export function initFlare(apiKey: string | undefined) {
    if (!apiKey) {
        console.warn('[Playground] No Flare API key configured. Copy .env.example to .env and add your key.');
    }

    flare.light(apiKey, true);
}

export { flare };
