import { buildTraceparent, type Config, type Span, type SpanOptions } from '@flareapp/core';

import { fill, unfill } from './fill';
import { type FetchInput, mergeTraceparentHeader, shouldPropagate } from './propagation';
import { supportsNativeFetch } from './supportsNativeFetch';

/** The subset of the Flare surface the fetch wrapper needs. `Flare` satisfies this structurally. */
export type FetchTracer = {
    readonly config: Config;
    startSpan(name: string, opts?: SpanOptions): Span;
};

function safeAbsolute(url: string, origin: string): URL | null {
    try {
        return new URL(url, origin || undefined);
    } catch {
        return null;
    }
}

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

function isFlareIngestUrl(url: string, origin: string, config: Config): boolean {
    const abs = safeAbsolute(url, origin);
    if (!abs) return false;
    return [config.ingestUrl, config.logsIngestUrl, config.tracesIngestUrl].some(
        (u) => typeof u === 'string' && u.length > 0 && abs.href.startsWith(u),
    );
}

/**
 * Build a fetch replacement that opens a `browser_fetch` span per call, injects
 * `traceparent` on propagation-eligible URLs, and ends the span on settle.
 * Pure factory: `origin` is injected (node test env has no `location`), so this
 * is directly unit-testable without a browser.
 */
export function createFetchWrapper(tracer: FetchTracer, original: typeof fetch, origin: string): typeof fetch {
    return function (this: unknown, input: FetchInput, init?: RequestInit): Promise<Response> {
        const call = (i?: RequestInit): Promise<Response> =>
            (original as (input: FetchInput, init?: RequestInit) => Promise<Response>).call(this, input, i);

        const config = tracer.config;
        if (!config.enableTracing) return call(init);

        const { method, url } = resolveRequest(input, init);
        if (isFlareIngestUrl(url, origin, config)) return call(init);

        const abs = safeAbsolute(url, origin);
        const pathname = abs ? abs.pathname : url;

        const span = tracer.startSpan(`${method} ${pathname}`, {
            spanType: 'browser_fetch',
            attributes: {
                'http.request.method': method,
                'url.full': abs ? abs.href : url,
                ...(abs ? { 'server.address': abs.hostname } : {}),
                ...(abs && abs.port ? { 'server.port': Number(abs.port) } : {}),
            },
        });

        let finalInit = init;
        if (shouldPropagate(url, origin, config.tracePropagationTargets)) {
            const traceparent = buildTraceparent(span.traceId, span.spanId, span.isRecording);
            finalInit = mergeTraceparentHeader(input, init, traceparent);
        }

        const finishError = (error: unknown): Promise<never> => {
            span.setStatus({ code: 2, message: error instanceof Error ? error.message : String(error) });
            span.end();
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
                span.setAttribute('http.response.status_code', response.status);
                if (response.status >= 500) span.setStatus({ code: 2 });
                span.end();
                return response;
            },
            (error: unknown) => finishError(error),
        );
    };
}

/**
 * Patch the global `fetch` so outgoing requests are traced. No-op when there is
 * no `fetch` or it is not native (a polyfilled/XHR-backed fetch is left for the
 * future XHR patch). Idempotent via `fill`. Reversible via `unpatchFetch`.
 */
export function instrumentFetch(tracer: FetchTracer): void {
    const g = globalThis as { fetch?: typeof fetch; location?: { origin?: string } };
    if (typeof g.fetch !== 'function') return;
    if (!supportsNativeFetch()) return;

    const origin = g.location?.origin ?? '';
    fill(g as unknown as Record<string, unknown>, 'fetch', (original) =>
        createFetchWrapper(tracer, original as typeof fetch, origin),
    );
}

/** Restore the original global `fetch`. Safe if never patched. */
export function unpatchFetch(): void {
    unfill(globalThis as unknown as Record<string, unknown>, 'fetch');
}
