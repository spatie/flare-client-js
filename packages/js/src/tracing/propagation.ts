export type FetchInput = string | URL | Request;

/**
 * Decide whether a W3C `traceparent` header may be attached to `url`.
 * Default: same-origin + relative (`abs`, the caller's already-parsed URL, is
 * compared by origin; null -> not same-origin, matching a failed parse).
 * With `targets`: match by String.includes (string entry) or RegExp.test
 * against the raw `url`. `targets: []` disables everything.
 * Mirrors OTel/Sentry `tracePropagationTargets` semantics.
 */
export function shouldPropagate(
    url: string,
    abs: URL | null,
    currentOrigin: string,
    targets?: (string | RegExp)[],
): boolean {
    if (targets) {
        if (targets.length === 0) return false;
        return targets.some((t) => (typeof t === 'string' ? url.includes(t) : t.test(url)));
    }
    return abs !== null && abs.origin === currentOrigin;
}

/**
 * Snapshot an iterable HeadersInit (Map, URLSearchParams, cross-realm Headers)
 * into an array of string pairs. Returns null when iteration throws or yields
 * a malformed entry; callers must then pass the source through untouched so a
 * bad merge never breaks the host request (fetch will reject it the same way
 * it would have without tracing).
 */
function headerPairsFrom(source: Iterable<unknown>): [string, string][] | null {
    try {
        const pairs: [string, string][] = [];
        for (const entry of source) {
            if (entry === null || typeof entry !== 'object') return null;
            const pair = Array.from(entry as ArrayLike<unknown>);
            if (pair.length !== 2) return null;
            pairs.push([String(pair[0]), String(pair[1])]);
        }
        return pairs;
    } catch {
        return null;
    }
}

/**
 * Return a NEW `RequestInit` carrying `traceparent`, without mutating the
 * caller's `Request` or `init`. Handles fetch's headers shapes (Headers,
 * pair arrays, other pair iterables, plain records) plus the `Request`-input
 * case. The returned init is passed as the second fetch arg so the spec's
 * override semantics put the header on the wire while leaving the caller's
 * `Request` (and its single-shot body) intact.
 */
export function mergeTraceparentHeader(
    input: FetchInput,
    init: RequestInit | undefined,
    traceparent: string,
): RequestInit {
    const source: HeadersInit | undefined =
        init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined);

    let headers: HeadersInit;
    if (source instanceof Headers) {
        headers = new Headers(source);
        headers.set('traceparent', traceparent); // set() is case-insensitive: no duplicate
    } else if (Array.isArray(source)) {
        // Drop any caller-supplied traceparent (any case) before appending ours, or the
        // wire carries two values and W3C parsers treat the header as malformed.
        headers = [...source.filter(([k]) => String(k).toLowerCase() !== 'traceparent'), ['traceparent', traceparent]];
    } else if (source && typeof (source as Partial<Iterable<unknown>>)[Symbol.iterator] === 'function') {
        // Fetch's WebIDL conversion accepts ANY iterable of string pairs as
        // HeadersInit: Map, URLSearchParams, polyfilled or cross-realm Headers.
        // Those have no enumerable own properties, so the record branch below
        // would see an empty object and silently drop every caller header.
        const pairs = headerPairsFrom(source as unknown as Iterable<unknown>);
        headers = pairs
            ? [...pairs.filter(([k]) => k.toLowerCase() !== 'traceparent'), ['traceparent', traceparent]]
            : source;
    } else if (source) {
        // Same reason: strip case-variant keys (TraceParent, TRACEPARENT) before setting.
        const merged: Record<string, string> = {};
        for (const [k, v] of Object.entries(source as Record<string, string>)) {
            if (k.toLowerCase() !== 'traceparent') merged[k] = v;
        }
        merged.traceparent = traceparent;
        headers = merged;
    } else {
        headers = { traceparent };
    }

    const result: RequestInit = { ...init, headers };
    // A Request with a ReadableStream body requires `duplex` when re-issued with an
    // init; without it fetch throws and breaks a host request that worked pre-tracing.
    if (
        (result as RequestInit & { duplex?: string }).duplex === undefined &&
        typeof Request !== 'undefined' &&
        input instanceof Request &&
        input.body != null
    ) {
        (result as RequestInit & { duplex?: string }).duplex = 'half';
    }
    return result;
}
