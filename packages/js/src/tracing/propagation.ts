export type FetchInput = string | URL | Request;

function isSameOrigin(url: string, currentOrigin: string): boolean {
    try {
        return new URL(url, currentOrigin || undefined).origin === currentOrigin;
    } catch {
        return false;
    }
}

/**
 * Decide whether a W3C `traceparent` header may be attached to `url`.
 * Default: same-origin + relative. With `targets`: match by String.includes
 * (string entry) or RegExp.test. `targets: []` disables everything.
 * Mirrors OTel/Sentry `tracePropagationTargets` semantics.
 */
export function shouldPropagate(url: string, currentOrigin: string, targets?: (string | RegExp)[]): boolean {
    if (targets) {
        if (targets.length === 0) return false;
        return targets.some((t) => (typeof t === 'string' ? url.includes(t) : t.test(url)));
    }
    return isSameOrigin(url, currentOrigin);
}

/**
 * Return a NEW `RequestInit` carrying `traceparent`, without mutating the
 * caller's `Request` or `init`. Handles fetch's three headers shapes plus the
 * `Request`-input case. The returned init is passed as the second fetch arg so
 * the spec's override semantics put the header on the wire while leaving the
 * caller's `Request` (and its single-shot body) intact.
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
