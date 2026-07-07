import { createPatcher } from './createPatcher';
import {
    endHttpRequestSpan,
    finishHttpSpanError,
    type HttpTracer,
    isFlareIngestUrl,
    requestSpanAttributes,
    safeAbsolute,
    traceparentFor,
} from './httpRequestSpan';
import { type FetchInput, mergeTraceparentHeader } from './propagation';
import { supportsNativeFetch } from './supportsNativeFetch';

function resolveRequest(input: FetchInput, init: RequestInit | undefined): { method: string; url: string } {
    let url: string;
    let method = init?.method;
    if (typeof Request !== 'undefined' && input instanceof Request) {
        url = input.url;
        method = method ?? input.method;
    } else {
        url = typeof input === 'string' ? input : String(input);
    }
    return { method: (method ?? 'GET').toUpperCase(), url };
}

/**
 * Build a fetch replacement that opens a `browser_fetch` span per call, injects `traceparent` on
 * propagation-eligible URLs, and ends the span on settle. Pure factory: `origin` is injected (node
 * test env has no `location`), so this is unit-testable without a browser.
 */
export function createFetchWrapper(tracer: HttpTracer, original: typeof fetch, origin: string): typeof fetch {
    return function (this: unknown, input: FetchInput, init?: RequestInit): Promise<Response> {
        const call = (i?: RequestInit): Promise<Response> =>
            (original as (input: FetchInput, init?: RequestInit) => Promise<Response>).call(this, input, i);

        const config = tracer.config;
        if (!config.enableTracing) return call(init);

        const { method, url } = resolveRequest(input, init);
        const abs = safeAbsolute(url, origin);
        if (isFlareIngestUrl(abs, config)) return call(init);

        const pathname = abs ? abs.pathname : url;

        const span = tracer.startSpan(`${method} ${pathname}`, {
            spanType: 'browser_fetch',
            attributes: requestSpanAttributes(method, abs, url, config),
        });

        let finalInit = init;
        const traceparent = traceparentFor(span, abs, url, origin, config);
        if (traceparent) finalInit = mergeTraceparentHeader(input, init, traceparent);

        const finishError = (error: unknown): Promise<never> => {
            finishHttpSpanError(span, error);
            return Promise.reject(error);
        };

        let promise: Promise<Response>;
        try {
            promise = call(finalInit);
        } catch (error) {
            return finishError(error);
        }

        return promise.then(
            (response) => {
                endHttpRequestSpan(span, response.status);
                return response;
            },
            (error: unknown) => finishError(error),
        );
    };
}

// Owns the installed flag for the single `fetch` method. A wrapper leaked by a failed unpatch
// stays live and checks enableTracing per call, so one wrapper in the chain is always enough.
// See createPatcher for the shared atomic install/uninstall semantics.
const patcher = createPatcher();

/**
 * Patch the global `fetch` so outgoing requests are traced. No-op when there is no `fetch` or it
 * is not native (a polyfilled/XHR-backed fetch is left for the XHR patch). Idempotent via `fill`.
 * Reversible via `unpatchFetch`.
 */
export function instrumentFetch(tracer: HttpTracer): void {
    if (patcher.installed) return;

    const g = globalThis as { fetch?: typeof fetch; location?: { origin?: string } };
    if (typeof g.fetch !== 'function') return;
    if (!supportsNativeFetch()) return;

    const origin = g.location?.origin ?? '';
    patcher.install(g as unknown as Record<string, unknown>, [
        { name: 'fetch', wrap: (original) => createFetchWrapper(tracer, original as typeof fetch, origin) },
    ]);
}

/** Restore the original global `fetch`. Safe if never patched. */
export function unpatchFetch(): void {
    patcher.uninstall(globalThis as unknown as Record<string, unknown>);
}
