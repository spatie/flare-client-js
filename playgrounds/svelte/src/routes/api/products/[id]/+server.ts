import { apiDelaysMs, delay, getProduct } from '@flareapp/playgrounds-shared/api/server';
import { error, json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
    await delay(apiDelaysMs.product);

    const detail = getProduct(params.id ?? '');
    if (!detail) error(404, 'Product not found');

    return json(detail);
};
