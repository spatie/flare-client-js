import type { Attributes } from '../types';
import { DEFAULT_URL_DENYLIST, redactUrlQuery } from './redactUrl';

/**
 * The OTel `url.*` set for one absolute URL. Split off the redacted href rather than off the raw parts,
 * so `url.full` and `url.query` can never disagree about what was redacted.
 *
 * `url.query` is left out when there is no query string, and a URL that will not parse (a relative one
 * with no origin to resolve against) yields `url.full` on its own instead of throwing.
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

    // `protocol` carries the trailing colon; OTel's url.scheme does not.
    attributes['url.scheme'] = parsed.protocol.slice(0, -1);
    attributes['url.path'] = parsed.pathname;

    if (parsed.search) {
        attributes['url.query'] = parsed.search.slice(1);
    }

    return attributes;
}
