import { apiDelaysMs, createOrder, delay } from '@flareapp/playgrounds-shared/api/server';
import { json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    await delay(apiDelaysMs.checkout);

    const body = (await request.json()) as { totalCents?: number };

    return json(createOrder(body.totalCents ?? 0));
};
