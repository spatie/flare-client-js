import type { CartLineInput } from '@flareapp/playgrounds-shared';
import { apiDelaysMs, delay, getCartSummary } from '@flareapp/playgrounds-shared/api/server';
import { json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    await delay(apiDelaysMs.cartSummary);

    const body = (await request.json()) as { lines?: CartLineInput[] };

    return json(getCartSummary(body.lines ?? []));
};
