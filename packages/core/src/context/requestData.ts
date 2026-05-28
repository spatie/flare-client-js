import { Attributes } from '../types';
import { redactUrlQuery } from '../util';

export default function requestData(urlDenylist: RegExp): Attributes {
    if (!window.location.search) {
        return {};
    }

    return {
        'url.query': redactUrlQuery(window.location.search, urlDenylist).replace(/^\?/, ''),
    };
}
