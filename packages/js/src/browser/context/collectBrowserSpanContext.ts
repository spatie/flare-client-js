import type { Attributes, Config } from '@flareapp/core';
import { redactUrlQuery } from '@flareapp/core';

import { browserEntryPoint } from './collectBrowser';
import request from './request';

/**
 * Lean context a browser pageload/navigation root span carries: entry-point plus request identity
 * (url.full, user_agent.original, referrer, ready_state), redacted. Excludes cookies, structured
 * query params (requestData), and host.name (resource-level, sourced separately). Captured at span
 * start so a long-lived root reflects the page it represents, not the page current at close.
 *
 * @param hrefOverride destination href for a framework navigation root whose router reports the
 * destination before the URL commits. When set and parseable, the URL-derived keys (url.full,
 * flare.entry_point.value, flare.entry_point.handler.identifier) are computed from it; non-URL keys
 * always reflect the live document. An unparseable override is ignored (live location used), so a
 * bad destination URL can neither poison url.full nor throw into root creation.
 */
export const collectBrowserSpanContext = (config: Readonly<Config>, hrefOverride?: string): Attributes => {
    if (typeof window === 'undefined') {
        return {};
    }
    const href = resolveHref(hrefOverride);
    return { ...browserEntryPoint(config, href), ...request(config.urlDenylist, href) };
};

/**
 * The URL-derived subset of a root's context, for re-stamping a root whose destination changed
 * after it opened: a redirect hop, or a navigation superseded by a newer one. Both re-name a root
 * that `startNavigation` already stamped from the FIRST destination, which would otherwise keep
 * reporting a URL the user never landed on.
 *
 * Deliberately excludes `flare.entry_point.handler.identifier`: on a named root the route template
 * owns it, and re-deriving it from the href would clobber `/product/[id]` back to `/product/p01`.
 * Returns `{}` for an unparseable href, so a bad destination leaves the existing values intact.
 */
export const browserSpanUrlAttributes = (config: Readonly<Config>, href: string): Attributes => {
    if (typeof window === 'undefined') return {};
    const resolved = resolveHref(href);
    if (resolved === undefined) return {};
    const redacted = redactUrlQuery(resolved, config.urlDenylist);
    return { 'url.full': redacted, 'flare.entry_point.value': redacted };
};

/** Normalize an override href once; undefined (fall back to live location) when unparseable. */
function resolveHref(hrefOverride?: string): string | undefined {
    if (hrefOverride === undefined) return undefined;
    try {
        return new URL(hrefOverride, window.location.href).href;
    } catch {
        return undefined;
    }
}
