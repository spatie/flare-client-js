import { createPatcher } from '../../tracing/createPatcher';
import { isInternalRequest } from '../../tracing/internalRequest';
import type { FetchInput } from '../../tracing/propagation';
import { supportsNativeFetch } from '../../tracing/supportsNativeFetch';
import { hasRequestSubscribers, publishRequestStart } from './requestBus';
import type { RequestSettle } from './types';

function resolveRequest(input: FetchInput, init: RequestInit | undefined): { method: string; url: string } {
    let url: string;
    // Stays undefined on purpose: a Request object below can still supply the method.
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

        let watched: { settle(result: RequestSettle): void; init: RequestInit | undefined } | null = null;
        try {
            if (hasRequestSubscribers() && !isInternalRequest(init)) {
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

        // Never move `call` into the try above. Its catch would hide an error that fetch throws
        // right away, and we would then call fetch a second time.
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

export function instrumentFetch(): void {
    if (patcher.installed) {
        return;
    }

    const globals = globalThis as FetchGlobals;
    if (typeof globals.fetch !== 'function') {
        return;
    }
    // A fetch polyfill runs on top of XHR, so the XHR patch already sees these requests.
    if (!supportsNativeFetch()) {
        return;
    }

    patcher.install(globals, { fetch: (original) => createFetchWrapper(original) });
}

export function unpatchFetch(): void {
    patcher.uninstall(globalThis as FetchGlobals);
}
