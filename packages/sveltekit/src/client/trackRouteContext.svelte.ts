import { page } from '$app/state';
import { flare, type AttributeValue } from '@flareapp/js';

import { redactQueryParams } from '../redactQueryParams.js';

let tracking = false;

/**
 * Track the current SvelteKit route, syncing it to Flare's persistent context. Call once during
 * client init (e.g. +layout.svelte or hooks.client.ts). Every subsequent report (including manual
 * flare.report() calls) then carries the route ID, URL, params, and redacted query parameters.
 */
export function trackRouteContext(): void {
    if (tracking) return;
    tracking = true;

    $effect.root(() => {
        $effect(() => {
            flare.addContext('svelteKit', {
                routeId: page.route?.id ?? null,
                url: page.url.pathname,
                params: { ...page.params },
                query: redactQueryParams(page.url.searchParams),
            } as unknown as AttributeValue);
        });
    });
}
