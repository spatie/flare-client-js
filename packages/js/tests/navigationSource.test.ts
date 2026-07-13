// @vitest-environment jsdom
import type { Config, Span, SpanOptions } from '@flareapp/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    registerNavigationSource,
    startBrowserTracing,
    stopBrowserTracing,
    type BrowserTracingFlare,
} from '../src/tracing/browserTracing';

function recordingSpan(name: string) {
    const attrs: Record<string, unknown> = {};
    const span = {
        traceId: 'T',
        spanId: 's_' + name,
        parentSpanId: null,
        name,
        isRecording: true,
        endTimeUnixNano: 0,
        setAttribute(k: string, v: unknown) {
            attrs[k] = v;
            return span;
        },
        setStatus() {
            return span;
        },
        addEvent() {
            return span;
        },
        end: vi.fn(),
    } as unknown as Span;
    return { span, attrs };
}

function fakeFlare() {
    const spans: Array<{ span: Span; attrs: Record<string, unknown> }> = [];
    const startSpan = vi.fn((name: string, _o?: SpanOptions) => {
        const s = recordingSpan(name);
        spans.push(s);
        return s.span;
    });
    const flare: BrowserTracingFlare = {
        config: {
            idleTimeout: 1000,
            finalTimeout: 30000,
            childSpanTimeout: 15000,
            urlDenylist: /(?!)/,
        } as unknown as Config,
        startSpan,
        tracer: {
            addSpanListener: vi.fn(() => () => {}),
            setActiveRoot: vi.fn(),
            flush: vi.fn(),
        } as unknown as BrowserTracingFlare['tracer'],
    };
    return { flare, startSpan, spans };
}

describe('registerNavigationSource', () => {
    afterEach(() => {
        // Force-clear any navigation source leaked by a mid-test assertion failure:
        // registering a fresh source replaces a leaked one (last-wins), and
        // unregistering that fresh handle clears the slot.
        registerNavigationSource().unregister();
        stopBrowserTracing();
        vi.useRealTimers();
        window.history.replaceState({}, '', '/');
    });

    it('suppresses History-based navigation roots while registered', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/a');
        const { flare, startSpan } = fakeFlare();
        startBrowserTracing(flare);
        const src = registerNavigationSource();

        window.history.pushState({}, '', '/b');

        expect(startSpan).toHaveBeenCalledTimes(1); // only the pageload root
        src.unregister();
    });

    it('startNavigation opens a URL-named browser_navigation root and ends the prior root', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/a');
        const { flare, startSpan, spans } = fakeFlare();
        startBrowserTracing(flare);
        const pageloadRoot = spans[0].span as unknown as { end: ReturnType<typeof vi.fn> };
        const src = registerNavigationSource();

        src.startNavigation({ path: '/product/p01' });

        expect(pageloadRoot.end).toHaveBeenCalled();
        const nav = startSpan.mock.calls[1];
        expect(nav[0]).toBe('/product/p01');
        expect(nav[1]!.spanType).toBe('browser_navigation');
        expect(nav[1]!.attributes?.['flare.route.source']).toBe('url');
        src.unregister();
    });

    it('setActiveRouteName renames the active root and flips the source flag', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/product/p01');
        const { flare, spans } = fakeFlare();
        startBrowserTracing(flare);
        const src = registerNavigationSource();

        src.setActiveRouteName({ name: '/product/$id', source: 'route' });

        expect(spans[0].span.name).toBe('/product/$id');
        expect(spans[0].attrs['flare.entry_point.handler.identifier']).toBe('/product/$id');
        expect(spans[0].attrs['flare.route.source']).toBe('route');
        src.unregister();
    });

    it('setActiveRouteName no-ops once the active root has ended', () => {
        vi.useFakeTimers();
        const { flare, spans } = fakeFlare();
        startBrowserTracing(flare);
        const src = registerNavigationSource();

        vi.advanceTimersByTime(1000); // idleTimeout ends the pageload root
        src.setActiveRouteName({ name: '/x', source: 'route' });

        expect(spans[0].span.name).not.toBe('/x');
        src.unregister();
    });

    it('is last-wins: a stale handle cannot drive or tear down a newer registration', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/a');
        const { flare, startSpan } = fakeFlare();
        startBrowserTracing(flare);
        const first = registerNavigationSource();
        const second = registerNavigationSource(); // replaces first

        first.startNavigation({ path: '/b' }); // stale -> no-op
        expect(startSpan).toHaveBeenCalledTimes(1);
        first.unregister(); // stale -> no-op (does not clear `second`)
        window.history.pushState({}, '', '/c'); // second still registered -> suppressed
        expect(startSpan).toHaveBeenCalledTimes(1);

        second.unregister();
    });

    it('unregister restores default History detection', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/a');
        const { flare, startSpan } = fakeFlare();
        startBrowserTracing(flare);
        const src = registerNavigationSource();
        src.unregister();

        window.history.pushState({}, '', '/b');

        expect(startSpan).toHaveBeenCalledTimes(2); // pageload + nav
        expect(startSpan.mock.calls[1]![0]).toBe('/b');
    });

    it('a registered source survives a stop/start tracing toggle and still drives navigation', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/a');
        const { flare } = fakeFlare();
        startBrowserTracing(flare);
        const src = registerNavigationSource();

        // Toggle tracing off then on: stopBrowserTracing deliberately does not
        // clear navSource, only activeFlare/currentRoot. A brand new Flare session
        // (fresh startSpan mock) takes over as the active flare.
        stopBrowserTracing();
        const { flare: flare2, startSpan: startSpan2, spans: spans2 } = fakeFlare();
        startBrowserTracing(flare2);

        // The SAME handle still drives navigation, now against the new flare.
        src.startNavigation({ path: '/b' });
        expect(startSpan2).toHaveBeenCalledTimes(2); // restarted pageload root + the new nav root
        const nav = startSpan2.mock.calls[1]!;
        expect(nav[0]).toBe('/b');
        expect(nav[1]!.spanType).toBe('browser_navigation');
        expect(nav[1]!.attributes?.['flare.route.source']).toBe('url');

        // It also renames the now-current root (the '/b' navigation root) on flare2.
        src.setActiveRouteName({ name: '/x', source: 'route' });
        expect(spans2[1].span.name).toBe('/x');
        expect(spans2[1].attrs['flare.entry_point.handler.identifier']).toBe('/x');
        expect(spans2[1].attrs['flare.route.source']).toBe('route');

        // Built-in History detection is still suppressed after the re-start: a
        // pushState opens no extra root because navSource survived the toggle.
        window.history.pushState({}, '', '/c');
        expect(startSpan2).toHaveBeenCalledTimes(2);

        src.unregister();
    });

    it('operations no-op when tracing is not active', () => {
        const src = registerNavigationSource(); // no startBrowserTracing
        expect(() => {
            src.startNavigation({ path: '/x' });
            src.setActiveRouteName({ name: '/x', source: 'route' });
            src.unregister();
        }).not.toThrow();
    });
});
