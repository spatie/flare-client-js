import { page } from '$app/state';
import { flare, type AttributeValue } from '@flareapp/js';

import { redactQueryParams } from '../redactQueryParams.js';

let tracking = false;

/**
 * Starts tracking the current SvelteKit route and syncing it to Flare's persistent context.
 * Call once during client-side initialization (e.g. in +layout.svelte or hooks.client.ts).
 * After calling this, every report (including manual flare.report() calls) includes the
 * current route ID, URL, params, and redacted query parameters.
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
