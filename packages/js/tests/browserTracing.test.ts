import type { Config, Span, SpanOptions } from '@flareapp/core';
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { startBrowserTracing, stopBrowserTracing, type BrowserTracingFlare } from '../src/tracing/browserTracing';

function fakeSpan(name: string): Span {
    return {
        traceId: 'T',
        spanId: 's_' + name,
        parentSpanId: null,
        name,
        isRecording: true,
        endTimeUnixNano: 0,
        setAttribute() {
            return this;
        },
        setStatus() {
            return this;
        },
        addEvent() {
            return this;
        },
        end: vi.fn(),
    } as unknown as Span;
}

function fakeFlare() {
    const startSpan = vi.fn((_name: string, _opts?: SpanOptions) => fakeSpan(_name));
    const setActiveRoot = vi.fn();
    const addSpanListener = vi.fn(() => () => {});
    const flush = vi.fn();
    const flare: BrowserTracingFlare = {
        config: {
            idleTimeout: 1000,
            finalTimeout: 30000,
            childSpanTimeout: 15000,
            urlDenylist: /(?!)/,
        } as unknown as Config,
        startSpan,
        tracer: { addSpanListener, setActiveRoot, flush } as unknown as BrowserTracingFlare['tracer'],
    };
    return { flare, startSpan, setActiveRoot, flush };
}

describe('browserTracing', () => {
    afterEach(() => {
        stopBrowserTracing();
        vi.useRealTimers();
        window.history.replaceState({}, '', '/');
    });

    it('starts a browser_pageload root on start', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/start');
        const { flare, startSpan } = fakeFlare();

        startBrowserTracing(flare);

        expect(startSpan).toHaveBeenCalledTimes(1);
        const [name, opts] = startSpan.mock.calls[0];
        expect(name).toBe('/start');
        expect(opts.spanType).toBe('browser_pageload');
        expect(opts.forceRoot).toBe(true); // must not become a child of an ambient active span
        expect(opts.attributes?.['flare.entry_point.type']).toBe('web');
        expect(opts.attributes?.['flare.entry_point.handler.identifier']).toBe('/start');
        expect(opts.attributes?.['url.full']).toContain('/start');
        expect('context.route' in (opts.attributes ?? {})).toBe(false);
        expect('context.url' in (opts.attributes ?? {})).toBe(false);
    });

    it('starts a browser_navigation root and ends the prior root on pushState path change', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/a');
        const { flare, startSpan, setActiveRoot } = fakeFlare();
        startBrowserTracing(flare);
        setActiveRoot.mockClear();

        window.history.pushState({}, '', '/b');

        expect(setActiveRoot).toHaveBeenCalledWith(undefined);
        const navCall = startSpan.mock.calls[1];
        expect(navCall[0]).toBe('/b');
        expect(navCall[1].spanType).toBe('browser_navigation');
        expect(navCall[1].forceRoot).toBe(true);
    });

    it('does not start a navigation root when the path is unchanged', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/same');
        const { flare, startSpan } = fakeFlare();
        startBrowserTracing(flare);

        window.history.pushState({}, '', '/same?q=1'); // same pathname, different query

        expect(startSpan).toHaveBeenCalledTimes(1); // only the pageload root
    });

    it('does not let a tracer error escape into history.pushState', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/a');
        const { flare, startSpan } = fakeFlare();
        startBrowserTracing(flare); // pageload root ok
        startSpan.mockImplementationOnce(() => {
            throw new Error('tracer boom'); // navigation root creation throws
        });
        expect(() => window.history.pushState({}, '', '/b')).not.toThrow();
    });

    it('ends the orphaned root and clears active state if the idle controller fails to construct', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/x');
        const { flare, setActiveRoot } = fakeFlare();
        const created: Array<{ end: ReturnType<typeof vi.fn> }> = [];
        (flare.startSpan as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
            const s = {
                traceId: 'T',
                spanId: 's',
                parentSpanId: null,
                name,
                isRecording: true,
                endTimeUnixNano: 0,
                setAttribute() {
                    return this;
                },
                setStatus() {
                    return this;
                },
                addEvent() {
                    return this;
                },
                end: vi.fn(),
            };
            created.push(s);
            return s as never;
        });
        // Make IdleRootController construction throw AFTER setActiveRoot(root): addSpanListener throws.
        (flare.tracer.addSpanListener as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
            throw new Error('listener boom');
        });

        expect(() => startBrowserTracing(flare)).not.toThrow();
        expect(created[0].end).toHaveBeenCalled(); // orphaned root ended
        expect(setActiveRoot).toHaveBeenLastCalledWith(undefined); // active root cleared
    });

    it('pagehide ends the open root, then keepalive-flushes', () => {
        vi.useFakeTimers();
        const { flare, startSpan, setActiveRoot, flush } = fakeFlare();
        startBrowserTracing(flare);
        const root = startSpan.mock.results[0].value as { end: ReturnType<typeof vi.fn> };
        setActiveRoot.mockClear();

        window.dispatchEvent(new Event('pagehide'));

        expect(root.end).toHaveBeenCalled();
        expect(setActiveRoot).toHaveBeenCalledWith(undefined);
        expect(flush).toHaveBeenCalledWith({ keepalive: true });
        // The flush must run AFTER the root ends, or the just-ended root misses the envelope.
        expect(root.end.mock.invocationCallOrder[0]).toBeLessThan(flush.mock.invocationCallOrder[0]);
    });

    it('visibilitychange to hidden ends the open root and keepalive-flushes', () => {
        vi.useFakeTimers();
        const { flare, startSpan, flush } = fakeFlare();
        startBrowserTracing(flare);
        const root = startSpan.mock.results[0].value as { end: ReturnType<typeof vi.fn> };

        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        try {
            document.dispatchEvent(new Event('visibilitychange'));
        } finally {
            delete (document as { visibilityState?: string }).visibilityState;
        }

        expect(root.end).toHaveBeenCalled();
        expect(flush).toHaveBeenCalledWith({ keepalive: true });
    });

    it('still keepalive-flushes on pagehide when the root already ended', () => {
        vi.useFakeTimers();
        const { flare, startSpan, flush } = fakeFlare();
        startBrowserTracing(flare);
        vi.advanceTimersByTime(1000); // idleTimeout ends the pageload root
        const root = startSpan.mock.results[0].value as { end: ReturnType<typeof vi.fn> };
        expect(root.end).toHaveBeenCalledTimes(1);

        window.dispatchEvent(new Event('pagehide'));

        expect(root.end).toHaveBeenCalledTimes(1); // not ended twice
        expect(flush).toHaveBeenCalledWith({ keepalive: true });
    });

    it('removes the pagehide and visibilitychange listeners on stop', () => {
        vi.useFakeTimers();
        const { flare, flush } = fakeFlare();
        startBrowserTracing(flare);
        stopBrowserTracing();

        window.dispatchEvent(new Event('pagehide'));
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        try {
            document.dispatchEvent(new Event('visibilitychange'));
        } finally {
            delete (document as { visibilityState?: string }).visibilityState;
        }

        expect(flush).not.toHaveBeenCalled();
    });

    it('stopBrowserTracing ends the active root and unpatches history', () => {
        vi.useFakeTimers();
        const { flare, setActiveRoot } = fakeFlare();
        startBrowserTracing(flare);
        setActiveRoot.mockClear();

        stopBrowserTracing();
        expect(setActiveRoot).toHaveBeenCalledWith(undefined);

        const before = (flare.startSpan as ReturnType<typeof vi.fn>).mock.calls.length;
        window.history.pushState({}, '', '/after-stop');
        expect((flare.startSpan as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before);
    });
});
