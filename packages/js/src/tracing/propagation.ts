export type FetchInput = string | URL | Request;

/**
 * Decide whether a W3C `traceparent` header may attach to `url`. Mirrors OTel/Sentry
 * `tracePropagationTargets` semantics.
 * Default: same-origin (`abs` compared by origin; null counts as not same-origin).
 * With `targets`: String.includes (string) or RegExp.test against raw `url`; `[]` disables all.
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
 * Snapshot an iterable HeadersInit (Map, URLSearchParams, cross-realm Headers) into string
 * pairs. Returns null on a throwing/malformed entry; callers must then pass the source through
 * untouched so a bad merge never breaks the host request.
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
 * Return a new `RequestInit` carrying `traceparent` without mutating the caller's `Request` or
 * `init`. Caller-wins: if the caller already set `traceparent` (any case), `init` is returned
 * unchanged (possibly undefined) and nothing is injected, matching XHR's `hasAppTraceparent` skip.
 * Handles all fetch headers shapes (Headers, pair arrays, other pair iterables, plain records) plus
 * the `Request`-input case. On inject, the init is passed as fetch's second arg so the header lands
 * on the wire while the caller's `Request` (and its single-shot body) stays intact.
 */
export function mergeTraceparentHeader(
    input: FetchInput,
    init: RequestInit | undefined,
    traceparent: string,
): RequestInit | undefined {
    const source: HeadersInit | undefined =
        init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined);

    // Caller-wins is decided within each shape branch below, alongside injection, so every source
    // is walked at most once. A separate detect-then-inject pass would walk a pair-iterable source
    // twice; a one-shot iterator's first walk exhausts it, so the second drops every caller header.
    let headers: HeadersInit;
    if (source instanceof Headers) {
        if (source.has('traceparent')) return init; // caller-wins
        headers = new Headers(source);
        headers.set('traceparent', traceparent);
    } else if (Array.isArray(source)) {
        if (source.some(([k]) => String(k).toLowerCase() === 'traceparent')) return init; // caller-wins
        headers = [...source, ['traceparent', traceparent]];
    } else if (source && typeof (source as Partial<Iterable<unknown>>)[Symbol.iterator] === 'function') {
        // Fetch's WebIDL conversion accepts any iterable of string pairs as HeadersInit (Map,
        // URLSearchParams, polyfilled/cross-realm Headers). Those have no enumerable own props,
        // so the record branch below would see an empty object and drop every caller header.
        const pairs = headerPairsFrom(source as unknown as Iterable<unknown>);
        if (pairs === null) {
            headers = source; // throwing/malformed -> passthrough (inject nothing)
        } else if (pairs.some(([k]) => k.toLowerCase() === 'traceparent')) {
            return init; // caller-wins
        } else {
            headers = [...pairs, ['traceparent', traceparent]];
        }
    } else if (source) {
        if (Object.keys(source as Record<string, string>).some((k) => k.toLowerCase() === 'traceparent')) {
            return init; // caller-wins
        }
        headers = { ...(source as Record<string, string>), traceparent };
    } else {
        headers = { traceparent };
    }

    // Copy the property descriptors instead of spreading. A spread only copies enumerable
    // properties, and SvelteKit marks the init it gives a `load` function with a hidden
    // `__sveltekit_fetch__` flag. If we drop that flag, SvelteKit's dev-mode fetch wrapper warns the
    // developer to use the `fetch` from their load function, which is what they were already doing.
    const result: RequestInit = { headers };
    if (init) {
        const descriptors = Object.getOwnPropertyDescriptors(init);
        delete descriptors.headers; // the merged headers above win
        Object.defineProperties(result, descriptors);
    }
    // A Request with a ReadableStream body requires `duplex` when re-issued with an init;
    // without it fetch throws and breaks a host request that worked pre-tracing.
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
