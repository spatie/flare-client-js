import { page } from '$app/state';

import { redactQueryParams } from '../redactQueryParams.js';
import type { SvelteKitRouteContext } from '../types.js';

export function getRouteContext(): SvelteKitRouteContext {
    return {
        routeId: page.route?.id ?? null,
        url: page.url.pathname,
        params: { ...page.params },
        query: redactQueryParams(page.url.searchParams),
    };
}
