import { apiDelaysMs, delay, getRecommendations } from '@flareapp/playgrounds-shared/api/server';
import { json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
    await delay(apiDelaysMs.recommendations);

    return json(getRecommendations(url.searchParams.get('exclude') ?? undefined));
};
