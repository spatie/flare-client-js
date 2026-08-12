import type { Span } from '@flareapp/core';

import { createPatcher } from './createPatcher';
import {
    browserUrlContext,
    endHttpRequestSpan,
    finishHttpSpanError,
    type HttpTracer,
    startHttpRequestSpan,
    traceparentFor,
    type UrlContext,
} from './httpRequestSpan';
import { insulate } from './instrumentationGuard';
import { isInternalRequest } from './internalRequest';
import { type FetchInput, mergeTraceparentHeader } from './propagation';
import { BrowserSpanType } from './spanTypes';
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
 * propagation-eligible URLs, and ends the span on settle. Pure factory: `urls` is injected (node
 * test env has no `location` or `document`), so this is unit-testable without a browser.
 */
export function createFetchWrapper(tracer: HttpTracer, original: typeof fetch, urls: UrlContext): typeof fetch {
    return function (this: unknown, input: FetchInput, init?: RequestInit): Promise<Response> {
        const call = (i?: RequestInit): Promise<Response> =>
            (original as (input: FetchInput, init?: RequestInit) => Promise<Response>).call(this, input, i);

        // Everything up to the handoff reads host-supplied input and user config, so any of it can
        // throw. A throw here costs the trace, never the request.
        let started: { span: Span; absoluteUrl: URL | null } | null = null;
        let url = '';
        try {
            const config = tracer.config;
            if (!config.enableTracing || isInternalRequest(init)) {
                return call(init);
            }
            const resolved = resolveRequest(input, init);
            url = resolved.url;
            started = startHttpRequestSpan(tracer, {
                method: resolved.method,
                url,
                urls,
                spanType: BrowserSpanType.Fetch,
            });
        } catch {
            started = null;
        }

        if (!started) {
            return call(init);
        }
        const { span, absoluteUrl } = started;

        // Separate guard from the one above: the span already exists here, so a throw must leave it
        // started and end normally below. Losing the header only costs backend correlation.
        let finalInit = init;
        try {
            const traceparent = traceparentFor(span, absoluteUrl, url, urls.origin, tracer.config);
            if (traceparent) {
                finalInit = mergeTraceparentHeader(input, init, traceparent);
            }
        } catch {
            finalInit = init;
        }

        // Insulated so a throw out of our own span bookkeeping cannot swallow the host's response, nor
        // replace the host's rejection reason with ours.
        const endSpan = insulate((response: Response) => endHttpRequestSpan(span, response.status));
        const failSpan = insulate((error: unknown) => finishHttpSpanError(span, error));

        const finishError = (error: unknown): Promise<never> => {
            failSpan(error);
            return Promise.reject(error);
        };

        let promise: Promise<Response>;
        try {
            promise = call(finalInit);
        } catch (error) {
            return finishError(error);
        }

        return promise.then((response) => {
            endSpan(response);
            return response;
        }, finishError);
    };
}

type FetchGlobals = { fetch?: typeof fetch };

// A wrapper left behind by a failed unpatch stays live and checks enableTracing per call, so one
// wrapper in the chain is always enough. See createPatcher for how install and uninstall stay in step.
const patcher = createPatcher<FetchGlobals>();

/**
 * Patch the global `fetch` so outgoing requests are traced. No-op when there is no `fetch` or it
 * is not native (a polyfilled/XHR-backed fetch is left for the XHR patch). Idempotent via `fill`.
 * Reversible via `unpatchFetch`.
 */
export function instrumentFetch(tracer: HttpTracer): void {
    if (patcher.installed) {
        return;
    }

    const globals = globalThis as FetchGlobals;
    if (typeof globals.fetch !== 'function') {
        return;
    }
    if (!supportsNativeFetch()) {
        return;
    }

    const urls = browserUrlContext();
    patcher.install(globals, { fetch: (original) => createFetchWrapper(tracer, original, urls) });
}

/** Restore the original global `fetch`. Safe if never patched. */
export function unpatchFetch(): void {
    patcher.uninstall(globalThis as FetchGlobals);
}
