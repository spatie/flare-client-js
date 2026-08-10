import type { Attributes } from '../types';
import { DEFAULT_URL_DENYLIST, redactUrlQuery } from './redactUrl';

/**
 * Builds the OTel `url.*` attributes for one absolute URL.
 *
 * Redacts the URL first and splits it after, so `url.full` and `url.query` always show the same
 * redacted values.
 *
 * Leaves out `url.query` when there is no query string. Returns only `url.full` when the URL cannot
 * be parsed, for example a relative one.
 */
export function urlAttributes(url: string, denylist: RegExp = DEFAULT_URL_DENYLIST): Attributes {
    const full = redactUrlQuery(url, denylist);
    const attributes: Attributes = { 'url.full': full };

    let parsed: URL;
    try {
        parsed = new URL(full);
    } catch {
        return attributes;
    }

    // `protocol` ends with a colon, url.scheme does not.
    attributes['url.scheme'] = parsed.protocol.slice(0, -1);
    attributes['url.path'] = parsed.pathname;

    if (parsed.search) {
        attributes['url.query'] = parsed.search.slice(1);
    }

    return attributes;
}
