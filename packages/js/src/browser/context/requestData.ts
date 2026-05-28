import type { Attributes } from '@flareapp/core';
import { redactUrlQuery } from '@flareapp/core';

export default function requestData(urlDenylist: RegExp): Attributes {
    if (!window.location.search) {
        return {};
    }

    return {
        'url.query': redactUrlQuery(window.location.search, urlDenylist).replace(/^\?/, ''),
    };
}
