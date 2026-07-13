import type { Attributes, Config, ContextCollector } from '@flareapp/core';
import { redactUrlQuery } from '@flareapp/core';

import cookie from './cookie';
import request from './request';
import requestData from './requestData';

export function browserEntryPoint(config: Readonly<Config>): Attributes {
    if (typeof window === 'undefined') {
        return { 'flare.entry_point.type': 'server' };
    }

    const attrs: Attributes = {
        'flare.entry_point.type': 'web',
    };

    if (window?.location?.href) {
        attrs['flare.entry_point.value'] = redactUrlQuery(window.location.href, config.urlDenylist);
        if (window.location.pathname) {
            attrs['flare.entry_point.handler.identifier'] = window.location.pathname;
            attrs['flare.entry_point.handler.type'] = 'browser';
        }
    }

    return attrs;
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
