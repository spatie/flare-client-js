import type { ScopeProvider } from '../Scope';
import type { Attributes, Config } from '../types';
import { redactUrlQuery } from '../util/redactUrl';

export const MAX_BREADCRUMB_URL_LENGTH = 256;

// Redact before truncating, so a token past the cap cannot survive the cut. No ellipsis marker:
// inside a URL it would read as part of the URL.
export function breadcrumbUrl(href: string, denylist: RegExp): string {
    const redacted = redactUrlQuery(href, denylist);
    return redacted.length > MAX_BREADCRUMB_URL_LENGTH ? redacted.slice(0, MAX_BREADCRUMB_URL_LENGTH) : redacted;
}

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
