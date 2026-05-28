import type { Attributes, Config, ContextCollector } from '@flareapp/core';
import { redactUrlQuery } from '@flareapp/core';

import cookie from './cookie';
import request from './request';
import requestData from './requestData';

export const collectBrowser: ContextCollector = (config: Readonly<Config>): Attributes => {
    const attrs: Attributes = {
        'flare.entry_point.type': 'web',
    };

    if (typeof window !== 'undefined' && window?.location?.href) {
        attrs['flare.entry_point.value'] = redactUrlQuery(window.location.href, config.urlDenylist);
        if (window.location.pathname) {
            attrs['flare.entry_point.handler.identifier'] = window.location.pathname;
            attrs['flare.entry_point.handler.type'] = 'browser';
        }
    }

    Object.assign(attrs, request(config.urlDenylist));
    Object.assign(attrs, requestData(config.urlDenylist));
    Object.assign(attrs, cookie());

    return attrs;
};
