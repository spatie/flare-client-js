import { apiDelaysMs, delay, listProducts } from '@flareapp/playgrounds-shared/api/server';
import { json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';

// Kit owns request handling here, so the playground catalog gets real routes instead of the vite
// middleware the SPA playgrounds use. Same handlers, same latency.
export const GET: RequestHandler = async () => {
    await delay(apiDelaysMs.products);

    return json(listProducts());
};
