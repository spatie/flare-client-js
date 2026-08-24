import type { ScopeProvider } from '../Scope';
import type { Attributes, Config } from '../types';

/** One URL on a breadcrumb never costs more than this. */
export const MAX_BREADCRUMB_URL_LENGTH = 256;

/**
 * Cuts a long URL down to size. The front identifies the endpoint, and the tail of a filter blob or a
 * signed token is what we would want gone anyway.
 *
 * No marker is added, because an ellipsis inside a URL reads as part of the URL.
 */
export function truncateBreadcrumbUrl(url: string): string {
    return url.length > MAX_BREADCRUMB_URL_LENGTH ? url.slice(0, MAX_BREADCRUMB_URL_LENGTH) : url;
}

/**
 * The one place a recorder writes. Every recorder calls this, so the rule about when we record and how
 * much we keep lives in one place.
 *
 * `startTimeUnixNano` is unix nanoseconds, the same as every other event on a report.
 */
export function recordBreadcrumb(
    scopeProvider: ScopeProvider,
    config: Config,
    type: string,
    attributes: Attributes,
    startTimeUnixNano: number,
): void {
    if (!config.enableBreadcrumbs) {
        return;
    }
    scopeProvider
        .active()
        .addBreadcrumb({ type, startTimeUnixNano, endTimeUnixNano: null, attributes }, config.maxBreadcrumbs);
}
