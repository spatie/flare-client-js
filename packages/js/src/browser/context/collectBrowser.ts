import type { Attributes, Config, ContextCollector, EntryPointType } from '@flareapp/core';
import { redactUrlQuery } from '@flareapp/core';

import cookie from './cookie';
import request from './request';

export function browserEntryPoint(config: Readonly<Config>, urlOverride?: URL): Attributes {
    if (typeof window === 'undefined') {
        return { 'flare.entry_point.type': 'web' satisfies EntryPointType };
    }

    const attrs: Attributes = {
        'flare.entry_point.type': 'web' satisfies EntryPointType,
    };

    // Prefer a caller-supplied destination (framework nav integrations pass it because the router
    // knows the destination before the URL commits); otherwise the live location.
    const href = urlOverride ? urlOverride.href : window?.location?.href;
    if (href) {
        attrs['flare.entry_point.value'] = redactUrlQuery(href, config.urlDenylist);
        const pathname = urlOverride ? urlOverride.pathname : window?.location?.pathname;
        if (pathname) {
            attrs['flare.entry_point.handler.identifier'] = pathname;
            attrs['http.route'] = pathname;
            attrs['flare.entry_point.handler.type'] = 'browser';
        }
    }

    return attrs;
}

export const collectBrowser: ContextCollector = (config: Readonly<Config>): Attributes => {
    const attrs: Attributes = { ...browserEntryPoint(config) };

    // No window (SSR/node): browserEntryPoint already returned the entry point type on its own.
    // request()/cookie() below touch window unguarded, so stop here.
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
    Object.assign(attrs, cookie(config.urlDenylist));

    return attrs;
};
