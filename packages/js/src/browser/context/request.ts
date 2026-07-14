import type { Attributes } from '@flareapp/core';
import { redactUrlQuery } from '@flareapp/core';

/**
 * @param hrefOverride when set, `url.full` is derived from it instead of the live
 * `window.location.href` (a framework navigation root whose router knows the destination
 * before the URL commits). The override is pre-validated by the caller.
 */
export default function request(urlDenylist: RegExp, hrefOverride?: string): Attributes {
    return {
        'url.full': redactUrlQuery(hrefOverride ?? window.location.href, urlDenylist),
        'user_agent.original': window.navigator.userAgent,
        'http.request.referrer': redactUrlQuery(window.document.referrer, urlDenylist),
        'document.ready_state': window.document.readyState,
    };
}
