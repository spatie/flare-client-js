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

export function createFetchWrapper(original: typeof fetch): typeof fetch {
    return function (this: unknown, input: FetchInput, init?: RequestInit): Promise<Response> {
        const call = (i?: RequestInit): Promise<Response> =>
            (original as (input: FetchInput, init?: RequestInit) => Promise<Response>).call(this, input, i);

        // `call` stays outside the try: the catch would swallow a synchronous throw from the host
        // fetch and then call it a second time.
        let watched: { settle(result: RequestSettle): void; init: RequestInit | undefined } | null = null;
        try {
            if (hasRequestConsumers() && !isInternalRequest(init)) {
                const request = resolveRequest(input, init);
                watched = publishRequestStart({
                    kind: 'fetch',
                    method: request.method,
                    url: request.url,
                    input,
                    init,
                });
            }
        } catch {
            watched = null;
        }

        if (!watched) {
            return call(init);
        }
        const settle = watched.settle;

        const finishError = (error: unknown): Promise<never> => {
            settle({ error });
            return Promise.reject(error);
        };

        let promise: Promise<Response>;
        try {
            promise = call(watched.init);
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

const patcher = createPatcher<FetchGlobals>();

/** A polyfilled fetch runs on XHR, where the XHR patch already sees it, so leave it alone. */
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

export function unpatchFetch(): void {
    patcher.uninstall(globalThis as FetchGlobals);
}
