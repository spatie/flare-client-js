import type { Config } from '@flareapp/core';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { setInstrumentationConfig } from '../src/instrument/config';
import {
    addRequestSettleHandler,
    createXHROpen,
    createXHRSend,
    createXHRSetRequestHeader,
    resetRequestInstrumentationForTests,
    type RequestContext,
    type RequestResult,
    setRequestStartHandler,
} from '../src/instrument/request';
import { internalRequestInit } from '../src/tracing/internalRequest';
import { fixedUrls } from './helpers';

const nativeFetch = globalThis.fetch;

// Same shape as `makeTracer` in tests/helpers/fakeTracer.ts: only the keys the instrumentation reads.
const config = {
    enableTracing: true,
    ingestUrl: 'https://ingest.test/v1/errors',
    logsIngestUrl: 'https://ingest.test/v1/logs',
    tracesIngestUrl: 'https://ingest.test/v1/traces',
} as unknown as Config;

// The patch keeps the `supportsNativeFetch` guard, and a bare `vi.fn` fails it: its toString carries
// no "[native code]". The `.bind` hides the implementation the way `nativeFetchStub` does, while the
// calls still land on the underlying mock. Assertions read `fetchMock`, never `globalThis.fetch`:
// once the patch installs, the global is the wrapper, and the wrapper has no `.mock`.
let fetchMock: ReturnType<typeof vi.fn>;
function stubFetch(impl: () => Promise<Response>): void {
    fetchMock = vi.fn(impl);
    globalThis.fetch = fetchMock.bind(null) as unknown as typeof fetch;
}

function recordSettles(): { entries: Array<{ context: RequestContext; result: RequestResult }>; stop: () => void } {
    const entries: Array<{ context: RequestContext; result: RequestResult }> = [];
    const stop = addRequestSettleHandler((context, result) => entries.push({ context, result }));
    return { entries, stop };
}

describe('request instrumentation', () => {
    beforeEach(() => {
        setInstrumentationConfig(() => config);
        stubFetch(async () => new Response('ok', { status: 200 }));
    });

    afterEach(() => {
        resetRequestInstrumentationForTests();
        globalThis.fetch = nativeFetch;
        vi.restoreAllMocks();
    });

    test('patches nothing until the first handler registers', () => {
        const before = globalThis.fetch;

        const stop = addRequestSettleHandler(() => {});

        expect(globalThis.fetch).not.toBe(before);
        stop();
        expect(globalThis.fetch).toBe(before);
    });

    test('tells every settle handler what happened', async () => {
        const { entries, stop } = recordSettles();

        await fetch('https://api.test/products');

        expect(entries).toHaveLength(1);
        expect(entries[0].context.method).toBe('GET');
        expect(entries[0].context.url).toBe('https://api.test/products');
        expect(entries[0].result.status).toBe(200);
        stop();
    });

    test('asks the start owner for a traceparent and sends it', async () => {
        const stopStart = setRequestStartHandler(() => '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01');
        const { stop } = recordSettles();

        await fetch('https://api.test/products');

        const init = fetchMock.mock.calls[0][1] as RequestInit;
        expect(new Headers(init.headers).get('traceparent')).toBe(
            '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
        );
        stopStart();
        stop();
    });

    test('a settle handler is never asked to change the request', async () => {
        const settle = vi.fn();
        const stop = addRequestSettleHandler(settle);

        await fetch('https://api.test/products');

        expect(fetchMock.mock.calls[0][1]).toBeUndefined();
        stop();
    });

    test('drops Flare ingest requests', async () => {
        const { entries, stop } = recordSettles();

        await fetch('https://ingest.test/v1/errors', { method: 'POST' });

        expect(entries).toHaveLength(0);
        stop();
    });

    test('drops requests the SDK marked as its own', async () => {
        const { entries, stop } = recordSettles();

        await fetch('https://cdn.test/app.js', internalRequestInit());

        expect(entries).toHaveLength(0);
        stop();
    });

    test('drops data: and blob: reads', async () => {
        const { entries, stop } = recordSettles();

        await fetch('data:text/plain,hello');

        expect(entries).toHaveLength(0);
        stop();
    });

    test('reports a rejection as an error result and keeps the host reason', async () => {
        const boom = new TypeError('Failed to fetch');
        stubFetch(async () => {
            throw boom;
        });
        const { entries, stop } = recordSettles();

        await expect(fetch('https://api.test/products')).rejects.toBe(boom);

        expect(entries[0].result.error).toBe(boom);
        expect(entries[0].result.status).toBe(0);
        stop();
    });

    test('a response whose status getter throws still reaches the caller', async () => {
        const hostile = {};
        Object.defineProperty(hostile, 'status', {
            get() {
                throw new Error('hostile status');
            },
        });
        stubFetch(async () => hostile as Response);
        const { entries, stop } = recordSettles();

        await expect(fetch('https://api.test/products')).resolves.toBe(hostile);

        expect(entries).toHaveLength(0);
        stop();
    });

    test('stamps a start and an end time', async () => {
        const { entries, stop } = recordSettles();

        await fetch('https://api.test/products');

        expect(entries[0].context.startTimeUnixNano).toBeGreaterThan(0);
        expect(entries[0].result.endTimeUnixNano).toBeGreaterThanOrEqual(entries[0].context.startTimeUnixNano);
        stop();
    });

    test('a second start owner is refused and the first one keeps the slot', async () => {
        const first = vi.fn(() => null);
        const second = vi.fn(() => null);
        const stopFirst = setRequestStartHandler(first);
        const stopSecond = setRequestStartHandler(second);

        await fetch('https://api.test/products');

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).not.toHaveBeenCalled();
        stopSecond();
        stopFirst();
    });

    // Same wiring as instrumentXHR.test.ts: the three factories patched onto a minimal fake XHR.
    test('an XHR with its own traceparent still asks the owner, but never overwrites the header', () => {
        const owner = vi.fn(() => '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01');
        const stopStart = setRequestStartHandler(owner);
        const { stop } = recordSettles();

        const setHeaderSpy = vi.fn();
        const xhr = {
            readyState: 1,
            status: 0,
            open(..._args: unknown[]) {},
            send(_body?: unknown) {},
            setRequestHeader(name: string, value: string) {
                setHeaderSpy(name, value);
            },
            addEventListener(_type: string, _cb: () => void) {},
            removeEventListener(_type: string, _cb: () => void) {},
        };
        xhr.open = createXHROpen(xhr.open as any) as any;
        xhr.setRequestHeader = createXHRSetRequestHeader(xhr.setRequestHeader as any) as any;
        xhr.send = createXHRSend(xhr.send as any, fixedUrls('https://app.test')) as any;

        xhr.open('GET', 'https://api.test/products');
        xhr.setRequestHeader('traceparent', 'app-own-value');
        xhr.send();

        expect(owner).toHaveBeenCalledTimes(1);
        expect(setHeaderSpy).toHaveBeenCalledTimes(1);
        expect(setHeaderSpy).toHaveBeenCalledWith('traceparent', 'app-own-value');

        stopStart();
        stop();
    });
});
