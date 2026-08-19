import { json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';

/**
 * Echo endpoint for the HTTP tracing scenarios. `status` forces a response code so a failing
 * request can be traced too; `delay` widens the request window so a span has measurable duration.
 */
export const GET: RequestHandler = async ({ url }) => {
    const status = Number(url.searchParams.get('status') ?? '200');
    const delay = Number(url.searchParams.get('delay') ?? '0');
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 2000)));
    if (status !== 200) return new Response(`echo-${status}`, { status });
    return json({ ok: true, at: url.searchParams.get('scenario') ?? 'unknown' });
};
