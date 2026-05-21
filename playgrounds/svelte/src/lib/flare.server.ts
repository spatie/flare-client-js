import { env } from '$env/dynamic/private';
import { flare } from '@flareapp/js';

const url = env.VITE_FLARE_URL ?? process.env.VITE_FLARE_URL;
const key = env.VITE_FLARE_KEY ?? process.env.VITE_FLARE_KEY ?? 'test-key-svelte';

if (url) flare.configure({ ingestUrl: url });
flare.light(key, true);

export { flare };
