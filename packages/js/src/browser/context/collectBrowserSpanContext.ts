import type { Attributes, Config } from '@flareapp/core';

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

/** Normalize an override href once; undefined (fall back to live location) when unparseable. */
function resolveHref(hrefOverride?: string): string | undefined {
    if (hrefOverride === undefined) return undefined;
    try {
        return new URL(hrefOverride, window.location.href).href;
    } catch {
        return undefined;
    }
}
