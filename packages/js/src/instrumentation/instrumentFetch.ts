import { createPatcher } from '../tracing/createPatcher';
import { isInternalRequest } from '../tracing/internalRequest';
import type { FetchInput } from '../tracing/propagation';
import { supportsNativeFetch } from '../tracing/supportsNativeFetch';
import { hasRequestConsumers, publishRequestStart, type RequestSettle } from './requestBus';

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
 * Build a fetch replacement that publishes each call on the request bus and applies whatever the mutation
 * slot hands back. It knows nothing about spans or breadcrumbs: consumers decide what a request means.
 *
 * Pure factory, so it is unit-testable without a browser.
 */
export function createFetchWrapper(original: typeof fetch): typeof fetch {
    return function (this: unknown, input: FetchInput, init?: RequestInit): Promise<Response> {
        const call = (i?: RequestInit): Promise<Response> =>
            (original as (input: FetchInput, init?: RequestInit) => Promise<Response>).call(this, input, i);

        // Everything up to the handoff reads host-supplied input and user config, so any of it can
        // throw. A throw here costs the instrumentation, never the request. The handoff itself must sit
        // outside the try, or a synchronous throw from `call` gets swallowed by the catch below and
        // retried here, invoking the underlying fetch twice.
        let published: { settle(result: RequestSettle): void; init: RequestInit | undefined } | null = null;
        try {
            if (hasRequestConsumers() && !isInternalRequest(init)) {
                const resolved = resolveRequest(input, init);
                published = publishRequestStart({
                    kind: 'fetch',
                    method: resolved.method,
                    url: resolved.url,
                    input,
                    init,
                });
            }
        } catch {
            published = null;
        }

        // Null means nothing is watching this request, so it must reach the original untouched.
        if (!published) {
            return call(init);
        }
        const settle = published.settle;

        const finishError = (error: unknown): Promise<never> => {
            settle({ error });
            return Promise.reject(error);
        };

        let promise: Promise<Response>;
        try {
            promise = call(published.init);
        } catch (error) {
            return finishError(error);
        }

        return promise.then((response) => {
            settle({ status: response.status });
            return response;
        }, finishError);
    };
}

type FetchGlobals = { fetch?: typeof fetch };

// A wrapper left behind by a failed unpatch stays live and checks `hasRequestConsumers` per call, so one
// wrapper in the chain is always enough. See createPatcher for how install and uninstall stay in step.
const patcher = createPatcher<FetchGlobals>();

/**
 * Patch the global `fetch` so outgoing requests reach the bus. No-op when there is no `fetch` or it is
 * not native (a polyfilled/XHR-backed fetch is left for the XHR patch). Idempotent via `fill`.
 * Reversible via `unpatchFetch`.
 */
export function instrumentFetch(): void {
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

    patcher.install(globals, { fetch: (original) => createFetchWrapper(original) });
}

/** Restore the original global `fetch`. Safe if never patched. */
export function unpatchFetch(): void {
    patcher.uninstall(globalThis as FetchGlobals);
}
