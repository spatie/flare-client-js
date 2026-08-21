import { nativeFetchStub } from '@flareapp/test-helpers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    addRequestSettleHandler,
    createFetchWrapper,
    resetRequestInstrumentationForTests,
    setRequestStartHandler,
} from '../src/instrument/request';
import type { UrlContext } from '../src/tracing/httpRequestSpan';
import { internalRequestInit } from '../src/tracing/internalRequest';
import { fixedUrls, recordSettles, useInstrumentationConfig } from './helpers';

const ORIGIN = 'https://app.example';
const URLS = fixedUrls(ORIGIN);
const TRACEPARENT = `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`;

const okFetch = (status = 200) => vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch;

/** The init the wrapper actually handed the underlying fetch. */
function initOf(original: typeof fetch): RequestInit | undefined {
    return (original as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit | undefined;
}

function traceparentOf(original: typeof fetch): string | undefined {
    return ((initOf(original)?.headers ?? {}) as Record<string, string>).traceparent;
}

/** Wrap `original` with a settle recorder registered, which is also what installs the patch. */
function wrap(original: typeof fetch, urls: UrlContext = URLS) {
    const { entries, stop } = recordSettles();
    return { wrapped: createFetchWrapper(original, urls), entries, stop };
}

beforeEach(() => {
    useInstrumentationConfig();
});

afterEach(() => {
    resetRequestInstrumentationForTests();
});

describe('createFetchWrapper', () => {
    it('reports the request and its response status to the settle handlers', async () => {
        const { wrapped, entries } = wrap(okFetch());

        await wrapped('https://app.example/api/products');

        expect(entries).toHaveLength(1);
        expect(entries[0].context.kind).toBe('fetch');
        expect(entries[0].context.method).toBe('GET');
        expect(entries[0].context.url).toBe('https://app.example/api/products');
        expect(entries[0].context.absoluteUrl?.href).toBe('https://app.example/api/products');
        expect(entries[0].result.status).toBe(200);
        expect(entries[0].result.error).toBeUndefined();
    });

    it('takes the method from the init and upper-cases it', async () => {
        const { wrapped, entries } = wrap(okFetch());

        await wrapped('https://app.example/api/products', { method: 'post' });

        expect(entries[0].context.method).toBe('POST');
    });

    it('sends the traceparent the start owner returns', async () => {
        const original = okFetch();
        const { wrapped } = wrap(original);
        setRequestStartHandler(() => TRACEPARENT);

        await wrapped('https://app.example/api/products');

        expect(traceparentOf(original)).toBe(TRACEPARENT);
    });

    it('sends no traceparent when the start owner returns null', async () => {
        const original = okFetch();
        const { wrapped } = wrap(original);
        setRequestStartHandler(() => null);

        await wrapped('https://third-party.example/track');

        expect(traceparentOf(original)).toBeUndefined();
    });

    it('does not inject our traceparent when the app already set one (caller wins, matching XHR)', async () => {
        const original = okFetch();
        const { wrapped } = wrap(original);
        setRequestStartHandler(() => TRACEPARENT);

        await wrapped('https://app.example/api/x', { headers: { traceparent: '00-appappapp-child-01' } });

        expect(traceparentOf(original)).toBe('00-appappapp-child-01');
    });

    it('reports a network failure as an error result and rethrows', async () => {
        const boom = new Error('network down');
        const original = vi.fn(async () => {
            throw boom;
        }) as unknown as typeof fetch;
        const { wrapped, entries } = wrap(original);

        await expect(wrapped('https://app.example/api/x')).rejects.toThrow('network down');

        expect(entries[0].result.status).toBe(0);
        expect(entries[0].result.error).toBe(boom);
    });

    it('reports an error result and rethrows when the underlying fetch throws synchronously', async () => {
        const boom = new Error('sync boom');
        const original = vi.fn(() => {
            throw boom;
        }) as unknown as typeof fetch;
        const { wrapped, entries } = wrap(original);

        await expect(wrapped('https://app.example/api/x')).rejects.toThrow('sync boom');

        expect(entries[0].result.status).toBe(0);
        expect(entries[0].result.error).toBe(boom);
    });

    it('skips Flare ingest URLs entirely (no settle, passthrough)', async () => {
        const original = okFetch();
        const { wrapped, entries } = wrap(original);

        await wrapped('https://ingress.flareapp.io/v1/traces');

        expect(entries).toHaveLength(0);
        expect(original).toHaveBeenCalledOnce();
    });

    it('does not report the flush POST when the traces ingest URL is relative', async () => {
        useInstrumentationConfig({ tracesIngestUrl: '/flare/v1/traces' });
        const { wrapped, entries } = wrap(okFetch());

        await wrapped('/flare/v1/traces', { method: 'POST' });

        expect(entries).toHaveLength(0);
    });

    it('skips a request marked internal, and does not propagate on it', async () => {
        const original = okFetch();
        const { wrapped, entries } = wrap(original);
        setRequestStartHandler(() => TRACEPARENT);

        // A snippet fetch targets the app's own asset, so it is same-origin and would otherwise be
        // both reported and given a traceparent.
        await wrapped('https://app.example/assets/index.js', internalRequestInit());

        expect(entries).toHaveLength(0);
        expect(original).toHaveBeenCalledOnce();
        expect(traceparentOf(original)).toBeUndefined();
    });

    it('drops data: and blob: reads (never network traffic)', async () => {
        const original = okFetch();
        const { wrapped, entries } = wrap(original);

        await wrapped('data:text/plain;base64,' + btoa('x'.repeat(2000)));
        await wrapped('blob:https://app.example/abc');

        expect(entries).toHaveLength(0);
        expect(original).toHaveBeenCalledTimes(2);
    });

    it('passes through untouched once every handler has unsubscribed', async () => {
        const original = okFetch();
        const { wrapped, entries, stop } = wrap(original);
        stop(); // the wrapper stays in place, but must now idle

        await wrapped('https://app.example/api/x');

        expect(entries).toHaveLength(0);
        expect(original).toHaveBeenCalledOnce();
        expect(initOf(original)).toBeUndefined();
    });

    it('calls the underlying fetch exactly once and propagates a synchronous throw with no handler registered', () => {
        const original = vi.fn(() => {
            throw new Error('sync boom');
        }) as unknown as typeof fetch;
        const { wrapped, stop } = wrap(original);
        stop();

        expect(() => wrapped('https://app.example/api/x')).toThrow('sync boom');
        expect(original).toHaveBeenCalledOnce();
    });

    it('calls the underlying fetch exactly once and propagates a synchronous throw for an internal request', () => {
        const original = vi.fn(() => {
            throw new Error('sync boom');
        }) as unknown as typeof fetch;
        const { wrapped } = wrap(original);

        expect(() => wrapped('https://app.example/assets/index.js', internalRequestInit())).toThrow('sync boom');
        expect(original).toHaveBeenCalledOnce();
    });

    it('resolves a bare-relative URL against the document base, not the origin', async () => {
        const { wrapped, entries } = wrap(okFetch(), fixedUrls(ORIGIN, `${ORIGIN}/store/`));

        await wrapped('api/products'); // the browser sends this to /store/api/products

        expect(entries[0].context.absoluteUrl?.href).toBe(`${ORIGIN}/store/api/products`);
    });

    it('re-reads the base per request, so a pushState navigation relabels later fetches', async () => {
        let base = `${ORIGIN}/store/`;
        const { wrapped, entries } = wrap(
            okFetch(),
            fixedUrls(ORIGIN, () => base),
        );

        await wrapped('api/products');
        base = `${ORIGIN}/store/cart/`;
        await wrapped('api/products');

        expect(entries.map((entry) => entry.context.absoluteUrl?.href)).toEqual([
            `${ORIGIN}/store/api/products`,
            `${ORIGIN}/store/cart/api/products`,
        ]);
    });

    it('resolves a relative URL against a cross-origin <base href>', async () => {
        const { wrapped, entries } = wrap(okFetch(), fixedUrls(ORIGIN, 'https://cdn.other.example/assets/'));

        await wrapped('data.json');

        expect(entries[0].context.absoluteUrl?.href).toBe('https://cdn.other.example/assets/data.json');
    });

    it('reports an unparseable URL with a null absoluteUrl', async () => {
        const { wrapped, entries } = wrap(okFetch());

        await wrapped('http://[');

        expect(entries).toHaveLength(1);
        expect(entries[0].context.url).toBe('http://[');
        expect(entries[0].context.absoluteUrl).toBeNull();
    });
});

// The host's fetch must survive our instrumentation throwing. Every step below is reachable from user
// input, user config or a third-party handler, so none of them can be assumed infallible.
describe('createFetchWrapper never breaks the host fetch', () => {
    const throwingUrls: UrlContext = {
        origin: ORIGIN,
        base: () => {
            throw new Error('context setup exploded');
        },
    };

    it('still performs the request when opening the request context throws', async () => {
        const original = okFetch();
        const { wrapped } = wrap(original, throwingUrls);

        const response = await wrapped('https://app.example/api/x');

        expect(response.status).toBe(200);
        expect(original).toHaveBeenCalledOnce();
    });

    it('calls the underlying fetch exactly once when opening the request context throws', async () => {
        const original = okFetch();
        const { wrapped } = wrap(original, throwingUrls);

        await wrapped('https://app.example/api/x');

        expect(original).toHaveBeenCalledOnce();
    });

    it('still performs the request when the input url getter throws', async () => {
        const original = okFetch();
        const { wrapped } = wrap(original);
        const hostileInput = {
            toString() {
                throw new Error('hostile input');
            },
        };

        const response = await wrapped(hostileInput as unknown as string);

        expect(response.status).toBe(200);
        expect(original).toHaveBeenCalledOnce();
    });

    it('still performs the request, and still settles it, when the start owner throws', async () => {
        const original = okFetch();
        const { wrapped, entries } = wrap(original);
        setRequestStartHandler(() => {
            throw new Error('owner exploded');
        });

        const response = await wrapped('https://app.example/api/x');

        // Losing the header costs backend correlation; the request itself must still be reported.
        expect(response.status).toBe(200);
        expect(original).toHaveBeenCalledOnce();
        expect(traceparentOf(original)).toBeUndefined();
        expect(entries[0].result.status).toBe(200);
    });

    it('still resolves with the response when a settle handler throws', async () => {
        addRequestSettleHandler(() => {
            throw new Error('settle exploded');
        });
        const wrapped = createFetchWrapper(okFetch(), URLS);

        const response = await wrapped('https://app.example/api/x');

        expect(response.status).toBe(200);
    });

    it('still rejects with the host error when a settle handler throws', async () => {
        addRequestSettleHandler(() => {
            throw new Error('settle exploded');
        });
        const boom = new Error('network down');
        const original = vi.fn(async () => {
            throw boom;
        }) as unknown as typeof fetch;
        const wrapped = createFetchWrapper(original, URLS);

        await expect(wrapped('https://app.example/api/x')).rejects.toBe(boom);
    });
});

describe('the global fetch patch', () => {
    it('patches global fetch when native, then restores it on the last unsubscribe', async () => {
        const g = globalThis as { fetch: typeof fetch };
        const native = nativeFetchStub();
        const before = g.fetch;
        g.fetch = native;

        try {
            const { entries, stop } = recordSettles();
            expect(g.fetch).not.toBe(native); // wrapped
            expect((g.fetch as { __flare_original__?: unknown }).__flare_original__).toBe(native);

            await g.fetch('https://app.example/api/x');
            expect(entries).toHaveLength(1);

            stop();
            expect(g.fetch).toBe(native); // restored
        } finally {
            g.fetch = before;
        }
    });

    it('does not double-wrap on re-registration when a third party wrapped fetch after Flare', async () => {
        const g = globalThis as { fetch: typeof fetch };
        const native = nativeFetchStub();
        const before = g.fetch;
        g.fetch = native;

        try {
            const first = recordSettles();
            const flareWrapped = g.fetch;

            // A third party wraps on top of Flare's wrapper, so the last unsubscribe cannot restore
            // (the current fetch is not Flare's tagged wrapper).
            const thirdParty = function (this: unknown, ...args: Parameters<typeof fetch>) {
                return flareWrapped.apply(this, args);
            } as typeof fetch;
            g.fetch = thirdParty;

            first.stop();
            expect(g.fetch).toBe(thirdParty); // the leak is real

            const second = recordSettles(); // re-registering must not stack a second wrapper
            expect(g.fetch).toBe(thirdParty);

            await g.fetch('https://app.example/api/x');
            expect(second.entries).toHaveLength(1); // one report per request, not two

            // Once the third party unwinds, the last unsubscribe restores and registering works again.
            g.fetch = flareWrapped;
            second.stop();
            expect(g.fetch).toBe(native);
            const third = recordSettles();
            expect((g.fetch as { __flare_original__?: unknown }).__flare_original__).toBe(native);
            third.stop();
        } finally {
            g.fetch = before;
        }
    });

    it('does not patch a non-native (polyfilled) fetch', () => {
        const g = globalThis as { fetch: typeof fetch };
        const polyfill = vi.fn(async () => new Response()) as unknown as typeof fetch; // toString has no [native code]
        const before = g.fetch;
        g.fetch = polyfill;

        try {
            const { stop } = recordSettles();
            expect(g.fetch).toBe(polyfill); // untouched
            stop();
        } finally {
            g.fetch = before;
        }
    });
});
