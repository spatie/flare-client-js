import { Attributes } from '../types';
import { redactFullPath } from '../util';

export default function request(urlDenylist: RegExp): Attributes {
    return {
        'url.full': redactFullPath(window.location.href, urlDenylist),
        'user_agent.original': window.navigator.userAgent,
        'http.request.referrer': redactFullPath(window.document.referrer, urlDenylist),
        'document.ready_state': window.document.readyState,
    };
}
