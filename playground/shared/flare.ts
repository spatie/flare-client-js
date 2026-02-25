import { flare } from '@flareapp/js';

const apiKey = import.meta.env.VITE_FLARE_API_KEY;

if (!apiKey || apiKey === 'your-flare-api-key-here') {
    console.warn('[Playground] No Flare API key configured. Copy .env.example to .env and add your key.');
}

flare.light(apiKey, true);

export { flare };
