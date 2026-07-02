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
    const flare: BrowserTracingFlare = {
        config: { idleTimeout: 1000, finalTimeout: 30000, childSpanTimeout: 15000 } as unknown as Config,
        startSpan,
        tracer: { addSpanListener, setActiveRoot } as unknown as BrowserTracingFlare['tracer'],
    };
    return { flare, startSpan, setActiveRoot };
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
        expect(opts.attributes?.['flare.entry_point.type']).toBe('web');
        expect(opts.attributes?.['context.route']).toBe('/start');
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
