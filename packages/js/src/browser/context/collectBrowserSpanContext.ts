import type { Attributes, Config } from '@flareapp/core';
import { urlAttributes } from '@flareapp/core';

import { absoluteUrl } from '../../tracing/utils';
import { browserEntryPoint } from './collectBrowser';
import request from './request';

/**
 * Entry point plus request identity for a pageload/navigation root. Deliberately leaner than the report
 * context. Captured at span start, so a long-lived root reflects the page it represents rather than the
 * page at close.
 *
 * @param hrefOverride destination href for a router that reports where it is going before the URL commits.
 */
export function collectBrowserSpanContext(config: Readonly<Config>, hrefOverride?: string): Attributes {
    if (typeof window === 'undefined') {
        return {};
    }
    const url = absoluteUrl(hrefOverride);
    return { ...browserEntryPoint(config, url), ...request(config.urlDenylist, url?.href) };
}

/**
 * Updates a root's url after a redirect, or when a newer navigation replaces this one. The root opened
 * with the first destination, so without this it reports a page the user never reached.
 */
export function browserSpanUrlAttributes(config: Readonly<Config>, href: string): Attributes {
    if (typeof window === 'undefined') {
        return {};
    }
    const resolved = absoluteUrl(href);
    if (!resolved) {
        return {};
    }
    const attributes = urlAttributes(resolved.href, config.urlDenylist);
    return { 'url.query': '', ...attributes, 'flare.entry_point.value': attributes['url.full'] };
}
