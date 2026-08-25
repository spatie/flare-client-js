import type { ScopeProvider } from '../Scope';
import type { Attributes, Config } from '../types';
import { redactUrlQuery } from '../util/redactUrl';

/** One URL on a breadcrumb never costs more than this. */
export const MAX_BREADCRUMB_URL_LENGTH = 256;

/**
 * How a breadcrumb carries a URL: credentials out first, then cut to length. Both steps, in that
 * order, or a token sitting past the cap survives the cut and ships.
 *
 * The front of a URL identifies the endpoint, and the tail of a filter blob is what we want gone
 * anyway. No marker is added, because an ellipsis inside a URL reads as part of the URL.
 */
export function breadcrumbUrl(href: string, denylist: RegExp): string {
    const redacted = redactUrlQuery(href, denylist);
    return redacted.length > MAX_BREADCRUMB_URL_LENGTH ? redacted.slice(0, MAX_BREADCRUMB_URL_LENGTH) : redacted;
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
