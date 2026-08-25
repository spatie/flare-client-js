import type { FetchInput } from './types';

/** Follows OTel/Sentry `tracePropagationTargets`: same-origin by default, `[]` disables all. */
export function shouldPropagate(
    url: string,
    absoluteUrl: URL | null,
    currentOrigin: string,
    targets?: (string | RegExp)[],
): boolean {
    if (targets) {
        if (targets.length === 0) {
            return false;
        }
        return targets.some((t) => (typeof t === 'string' ? url.includes(t) : t.test(url)));
    }
    return absoluteUrl !== null && absoluteUrl.origin === currentOrigin;
}

/** Null on a throwing or malformed entry: the caller then passes the source through untouched, so a
 *  bad merge never breaks the host request. */
function headerPairsFrom(source: Iterable<unknown>): [string, string][] | null {
    try {
        const pairs: [string, string][] = [];
        for (const entry of source) {
            if (entry === null || typeof entry !== 'object') {
                return null;
            }
            const pair = Array.from(entry as ArrayLike<unknown>);
            if (pair.length !== 2) {
                return null;
            }
            pairs.push([String(pair[0]), String(pair[1])]);
        }
        return pairs;
    } catch {
        return null;
    }
}

/** Fetch accepts any iterable of string pairs as HeadersInit (Map, URLSearchParams, cross-realm Headers). */
function isIterable(value: unknown): value is Iterable<unknown> {
    return (
        value !== null &&
        (typeof value === 'object' || typeof value === 'function') &&
        typeof (value as Partial<Iterable<unknown>>)[Symbol.iterator] === 'function'
    );
}

type RequestInitWithDuplex = RequestInit & { duplex?: 'half' };

/**
 * A new `RequestInit` carrying `traceparent`, without mutating the caller's `Request` or `init`.
 * Caller-wins: a `traceparent` the caller already set is left alone, matching XHR's
 * `hasAppTraceparent` skip. Returning an init rather than a rebuilt `Request` keeps the caller's
 * single-shot body intact.
 */
export function mergeTraceparentHeader(
    input: FetchInput,
    init: RequestInit | undefined,
    traceparent: string,
): RequestInit | undefined {
    const source: HeadersInit | undefined =
        init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined);

    // Caller-wins is decided inside each branch, alongside injection, so a source is walked at most
    // once. A separate detect-then-inject pass would walk a pair iterable twice, and the first walk
    // exhausts a one-shot iterator, dropping every caller header on the second.
    let headers: HeadersInit;
    if (source instanceof Headers) {
        if (source.has('traceparent')) {
            return init;
        }
        headers = new Headers(source);
        headers.set('traceparent', traceparent);
    } else if (Array.isArray(source)) {
        if (source.some(([k]) => String(k).toLowerCase() === 'traceparent')) {
            return init;
        }
        headers = [...source, ['traceparent', traceparent]];
    } else if (isIterable(source)) {
        // Those have no enumerable own props, so the record branch below would see an empty object and
        // drop every caller header.
        const pairs = headerPairsFrom(source);
        if (pairs === null) {
            headers = source; // throwing/malformed -> passthrough (inject nothing)
        } else if (pairs.some(([k]) => k.toLowerCase() === 'traceparent')) {
            return init;
        } else {
            headers = [...pairs, ['traceparent', traceparent]];
        }
    } else if (source) {
        if (Object.keys(source as Record<string, string>).some((k) => k.toLowerCase() === 'traceparent')) {
            return init;
        }
        headers = { ...(source as Record<string, string>), traceparent };
    } else {
        headers = { traceparent };
    }

    // Descriptors, not a spread: a spread copies only enumerable properties, and SvelteKit marks the
    // init it hands a `load` function with a hidden `__sveltekit_fetch__` flag. Drop that and Kit's
    // dev-mode wrapper tells the developer to use the `fetch` they were already using.
    const result: RequestInitWithDuplex = { headers };
    if (init) {
        const descriptors = Object.getOwnPropertyDescriptors(init);
        delete descriptors.headers; // the merged headers above win
        Object.defineProperties(result, descriptors);
    }
    // A Request with a ReadableStream body needs `duplex` when re-issued with an init, or fetch throws
    // and breaks a host request that worked before tracing.
    if (
        result.duplex === undefined &&
        typeof Request !== 'undefined' &&
        input instanceof Request &&
        input.body != null
    ) {
        result.duplex = 'half';
    }
    return result;
}
