import { page } from '$app/state';
import { DEFAULT_URL_DENYLIST } from '@flareapp/js';

import type { SvelteKitRouteContext } from '../types';

function redactQueryParams(searchParams: URLSearchParams): Record<string, string> {
    const result: Record<string, string> = {};

    searchParams.forEach((value, key) => {
        result[key] = DEFAULT_URL_DENYLIST.test(key) ? '[redacted]' : value;
    });

    return result;
}

export function getRouteContext(): SvelteKitRouteContext {
    return {
        routeId: page.route?.id ?? null,
        url: page.url.pathname,
        params: { ...page.params },
        query: redactQueryParams(page.url.searchParams),
    };
}
