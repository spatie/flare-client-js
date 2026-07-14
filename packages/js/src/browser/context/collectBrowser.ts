import type { Attributes, Config, ContextCollector } from '@flareapp/core';
import { redactUrlQuery } from '@flareapp/core';

import cookie from './cookie';
import request from './request';
import requestData from './requestData';

export function browserEntryPoint(config: Readonly<Config>, hrefOverride?: string): Attributes {
    if (typeof window === 'undefined') {
        return { 'flare.entry_point.type': 'server' };
    }

    const attrs: Attributes = {
        'flare.entry_point.type': 'web',
    };

    // Prefer a caller-supplied destination href (framework nav integrations pass it because the
    // router knows the destination before the URL commits); otherwise the live location.
    const href = hrefOverride ?? window?.location?.href;
    if (href) {
        attrs['flare.entry_point.value'] = redactUrlQuery(href, config.urlDenylist);
        const pathname = hrefOverride ? pathnameOf(hrefOverride) : window?.location?.pathname;
        if (pathname) {
            attrs['flare.entry_point.handler.identifier'] = pathname;
            attrs['flare.entry_point.handler.type'] = 'browser';
        }
    }

    return attrs;
}

/** Pathname of an href; undefined when it cannot be parsed. */
function pathnameOf(href: string): string | undefined {
    try {
        return new URL(href, window.location.href).pathname;
    } catch {
        return undefined;
    }
}

export const collectBrowser: ContextCollector = (config: Readonly<Config>): Attributes => {
    const attrs: Attributes = { ...browserEntryPoint(config) };

    // No window (SSR/node): browserEntryPoint already returned { 'flare.entry_point.type': 'server' };
    // request()/requestData()/cookie() below touch window unguarded, so stop here.
    if (typeof window === 'undefined') {
        return attrs;
    }

    // host.name is resource-level (see partition.ts RESOURCE_PREFIXES) so it lands in
    // the Flare Logs "Hostname" column. The PHP SDK uses the machine hostname; the
    // browser equivalent is the page's hostname.
    if (window?.location?.hostname) {
        attrs['host.name'] = window.location.hostname;
    }

    Object.assign(attrs, request(config.urlDenylist));
    Object.assign(attrs, requestData(config.urlDenylist));
    Object.assign(attrs, cookie(config.urlDenylist));

    return attrs;
};
