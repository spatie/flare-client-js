import { redactQueryParams } from '../redactQueryParams.js';
import type { SvelteKitRouteContext } from '../types.js';

interface RequestEvent {
    url: URL;
    params: Record<string, string>;
    route: { id: string | null };
}

function isRequestEvent(value: unknown): value is RequestEvent {
    return (
        typeof value === 'object' &&
        value !== null &&
        'url' in value &&
        value.url instanceof URL &&
        'params' in value &&
        'route' in value
    );
}

/** Extracts route context from SvelteKit's server-side RequestEvent via duck typing. */
export function getRouteContext(event?: unknown): SvelteKitRouteContext {
    if (!isRequestEvent(event)) {
        return { routeId: null, url: '', params: {}, query: {} };
    }

    return {
        routeId: event.route?.id ?? null,
        url: event.url.pathname,
        params: { ...event.params },
        query: redactQueryParams(event.url.searchParams),
    };
}
