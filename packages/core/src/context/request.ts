import { Attributes } from '../types';
import { redactUrlQuery } from '../util';

export default function request(urlDenylist: RegExp): Attributes {
    return {
        'url.full': redactUrlQuery(window.location.href, urlDenylist),
        'user_agent.original': window.navigator.userAgent,
        'http.request.referrer': redactUrlQuery(window.document.referrer, urlDenylist),
        'document.ready_state': window.document.readyState,
    };
}
