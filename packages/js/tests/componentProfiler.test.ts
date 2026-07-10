// @vitest-environment jsdom
import type { Config, Span, SpanOptions } from '@flareapp/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { startBrowserTracing, stopBrowserTracing, type BrowserTracingFlare } from '../src/tracing/browserTracing';
import { activeComponentRoot, recordComponentSpan, reserveSpanId } from '../src/tracing/componentProfiler';

function rootSpan(over: Partial<Pick<Span, 'traceId' | 'spanId' | 'isRecording'>> = {}): Span {
    return {
        traceId: over.traceId ?? 'T',
        spanId: over.spanId ?? 'root',
        parentSpanId: null,
        name: 'root',
        isRecording: over.isRecording ?? true,
        endTimeUnixNano: 0,
        setAttribute: () => rootSpan(),
        setStatus: () => rootSpan(),
        addEvent: () => rootSpan(),
        end: vi.fn(),
    } as unknown as Span;
}

// `active` lets a test swap the value tracer.getActiveSpan() returns after startup.
function fakeFlare(active: () => Span | undefined) {
    const started: Array<{ name: string; opts?: SpanOptions; end: ReturnType<typeof vi.fn> }> = [];
    const startSpan = vi.fn((name: string, opts?: SpanOptions) => {
        const end = vi.fn();
        started.push({ name, opts, end });
        return { traceId: 'T', spanId: 'c', name, isRecording: true, end } as unknown as Span;
    });
    const flare: BrowserTracingFlare = {
        config: { idleTimeout: 1000, finalTimeout: 30000, childSpanTimeout: 15000 } as unknown as Config,
        startSpan,
        tracer: {
            addSpanListener: vi.fn(() => () => {}),
            setActiveRoot: vi.fn(),
            flush: vi.fn(),
            getActiveSpan: vi.fn(() => active()),
        } as unknown as BrowserTracingFlare['tracer'],
    };
    return { flare, startSpan, started };
}

describe('component-profiler seam', () => {
    afterEach(() => {
        stopBrowserTracing();
        vi.useRealTimers();
        window.history.replaceState({}, '', '/');
    });

    it('reserveSpanId returns a 16-hex id', () => {
        expect(reserveSpanId()).toMatch(/^[0-9a-f]{16}$/);
    });

    it('activeComponentRoot returns the live recording root as parent context', () => {
        vi.useFakeTimers();
        const root = rootSpan({ traceId: 'T', spanId: 'root' });
        const { flare } = fakeFlare(() => root);
        startBrowserTracing(flare);
        expect(activeComponentRoot()).toEqual({ traceId: 'T', parentSpanId: 'root' });
    });

    it('activeComponentRoot is null with no root, a non-recording root, or tracing off', () => {
        vi.useFakeTimers();
        let active: Span | undefined;
        const { flare } = fakeFlare(() => active);
        startBrowserTracing(flare);
        expect(activeComponentRoot()).toBeNull(); // no root
        active = rootSpan({ isRecording: false });
        expect(activeComponentRoot()).toBeNull(); // root exists but is not recording
        stopBrowserTracing();
        expect(activeComponentRoot()).toBeNull(); // no active flare
    });

    it('recordComponentSpan records under the live root, reusing its trace (no re-sample)', () => {
        vi.useFakeTimers();
        const { flare, startSpan } = fakeFlare(() => rootSpan({ traceId: 'T', spanId: 'root' }));
        startBrowserTracing(flare);
        startSpan.mockClear();

        recordComponentSpan({
            name: 'ProductPage',
            spanId: 'p1',
            parent: { traceId: 'T', parentSpanId: 'root' },
            startTimeUnixNano: 10,
            endTimeUnixNano: 20,
        });

        expect(startSpan).toHaveBeenCalledWith(
            'ProductPage',
            expect.objectContaining({
                spanId: 'p1',
                parent: { traceId: 'T', spanId: 'root' },
                spanType: 'browser_react_component',
                startTimeUnixNano: 10,
                attributes: { 'flare.react.component': 'ProductPage' },
            }),
        );
    });

    it('recordComponentSpan drops the span when the active root no longer matches the traceId', () => {
        vi.useFakeTimers();
        const { flare, startSpan } = fakeFlare(() => rootSpan({ traceId: 'DIFFERENT', spanId: 'root2' }));
        startBrowserTracing(flare);
        startSpan.mockClear();

        recordComponentSpan({
            name: 'ProductPage',
            spanId: 'p1',
            parent: { traceId: 'T', parentSpanId: 'root' },
            startTimeUnixNano: 10,
            endTimeUnixNano: 20,
        });

        expect(startSpan).not.toHaveBeenCalled(); // dropped: root idle-closed or a new nav took over
    });

    it('never throws into the host', () => {
        expect(() =>
            recordComponentSpan({
                name: 'X',
                spanId: 'x',
                parent: { traceId: 'T', parentSpanId: 'root' },
                startTimeUnixNano: 1,
                endTimeUnixNano: 2,
            }),
        ).not.toThrow(); // no active flare -> no-op
    });
});
