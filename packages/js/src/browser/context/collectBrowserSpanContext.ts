import type { Attributes, Config } from '@flareapp/core';
import { redactUrlQuery } from '@flareapp/core';

import { absoluteUrl } from '../../tracing/absoluteHref';
import { browserEntryPoint } from './collectBrowser';
import request from './request';

/**
 * Entry point plus request identity for a pageload/navigation root. Deliberately leaner than the report
 * context: no cookies, no structured query params, no host.name (that is resource-level). Captured at
 * span start, so a long-lived root reflects the page it represents rather than the page at close.
 *
 * @param hrefOverride destination href for a router that reports where it is going before the URL
 * commits. Only the URL-derived keys come from it; the rest always reflect the live document. An
 * unparseable override falls back to the live location instead of throwing into root creation.
 */
export function collectBrowserSpanContext(config: Readonly<Config>, hrefOverride?: string): Attributes {
    if (typeof window === 'undefined') {
        return {};
    }
    const url = absoluteUrl(hrefOverride);
    return { ...browserEntryPoint(config, url), ...request(config.urlDenylist, url?.href) };
}

/**
 * Re-stamps a root's url after a redirect, or when a newer navigation replaces this one: the root opened
 * with the first destination, so it would otherwise report a page the user never landed on.
 *
 * Leaves `flare.entry_point.handler.identifier` alone. The route template owns that, and deriving it from
 * the href would turn `/product/[id]` back into `/product/p01`.
 */
export function browserSpanUrlAttributes(config: Readonly<Config>, href: string): Attributes {
    if (typeof window === 'undefined') {
        return {};
    }
    const resolved = absoluteUrl(href);
    if (!resolved) {
        return {};
    }
    const redacted = redactUrlQuery(resolved.href, config.urlDenylist);
    return { 'url.full': redacted, 'flare.entry_point.value': redacted };
}
