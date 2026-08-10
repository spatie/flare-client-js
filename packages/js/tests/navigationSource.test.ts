// @vitest-environment jsdom
import type { Config, Span, SpanOptions } from '@flareapp/core';
import { resetNavigationSource } from '@flareapp/test-helpers';
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
        resetNavigationSource(registerNavigationSource);
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
        expect(spans[0].attrs['http.route']).toBe('/product/$id');
        expect(spans[0].attrs['flare.route.source']).toBe('route');
        src.unregister();
    });

    // `startNavigation` sets url.full from the first destination, but a redirect, or a newer
    // navigation replacing this one, renames the same held root. Without updating the url too, the
    // root shows the name of the page it landed on next to the url of the one it never reached.
    it('setActiveRouteName updates url.full and entry_point.value when a name carries a url', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/');
        const { flare, spans } = fakeFlare();
        startBrowserTracing(flare);
        const src = registerNavigationSource();

        src.startNavigation({ path: '/old', url: 'https://app.example/old?keep=me', hold: true });
        src.setActiveRouteName({ name: '/cart', source: 'route', url: 'https://app.example/cart' });

        const nav = spans[1];
        expect(nav.attrs['url.full']).toBe('https://app.example/cart');
        expect(nav.attrs['flare.entry_point.value']).toBe('https://app.example/cart');
        expect(nav.attrs['url.path']).toBe('/cart');
        // The destination has no query, so the one the root opened with has to be blanked out rather
        // than left sitting next to the new path.
        expect(nav.attrs['url.query']).toBe('');
        // The route template still owns the identifier. Taking it from the href would turn '/cart'
        // back into a url-shaped name.
        expect(nav.attrs['flare.entry_point.handler.identifier']).toBe('/cart');
        expect(nav.attrs['http.route']).toBe('/cart');
        src.unregister();
    });

    // `attrs` only records setAttribute calls, so a missing key here means we never tried to update
    // it and the root keeps whatever startNavigation set when it was created.
    it('omitting url leaves the url the root opened with untouched', () => {
        vi.useFakeTimers();
        const { flare, startSpan, spans } = fakeFlare();
        startBrowserTracing(flare);
        const src = registerNavigationSource();

        src.startNavigation({ path: '/old', url: 'https://app.example/old', hold: true });
        src.settleNavigation({ name: '/old', source: 'route' }); // no url

        expect(spans[1].attrs['url.full']).toBeUndefined(); // no re-stamp
        expect(startSpan.mock.calls[1]![1]!.attributes?.['url.full']).toBe('https://app.example/old');
        src.unregister();
    });

    it('a url that will not parse leaves the existing url.full alone', () => {
        vi.useFakeTimers();
        const { flare, startSpan, spans } = fakeFlare();
        startBrowserTracing(flare);
        const src = registerNavigationSource();

        src.startNavigation({ path: '/old', url: 'https://app.example/old', hold: true });
        src.setActiveRouteName({ name: '/cart', source: 'route', url: 'http://[' });

        expect(spans[1].attrs['url.full']).toBeUndefined(); // rejected, not written
        expect(startSpan.mock.calls[1]![1]!.attributes?.['url.full']).toBe('https://app.example/old');
        expect(spans[1].span.name).toBe('/cart'); // the rename still lands
        src.unregister();
    });

    it('the updated url is redacted by urlDenylist like the opening one', () => {
        vi.useFakeTimers();
        const { flare, spans } = fakeFlare();
        (flare.config as { urlDenylist: RegExp }).urlDenylist = /token/;
        startBrowserTracing(flare);
        const src = registerNavigationSource();

        src.startNavigation({ path: '/old', url: 'https://app.example/old', hold: true });
        src.settleNavigation({ name: '/cart', source: 'route', url: 'https://app.example/cart?token=secret' });

        expect(spans[1].attrs['url.full']).not.toContain('secret');
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

    // An app that installs its router integration before calling configure({ enableTracing: true })
    // names the initial route while there is no root yet. Dropping that name leaves the pageload root
    // url-named for the life of the page, because nothing ever names it a second time.
    it('names the pageload root from a route handed over before tracing started', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/product/p01');
        const src = registerNavigationSource();
        src.setActiveRouteName({ name: '/product/:id', source: 'route' });

        const { flare, spans } = fakeFlare();
        startBrowserTracing(flare);

        expect(spans[0].span.name).toBe('/product/:id');
        expect(spans[0].attrs['flare.entry_point.handler.identifier']).toBe('/product/:id');
        expect(spans[0].attrs['flare.route.source']).toBe('route');
        src.unregister();
    });

    // `attrs` only records setAttribute calls, so an absent key means the held name was applied once
    // and let go, instead of following every root the page opens after it.
    it('applies a handed-over name to the pageload root only', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/product/p01');
        const src = registerNavigationSource();
        src.setActiveRouteName({ name: '/product/:id', source: 'route' });

        const { flare, spans } = fakeFlare();
        startBrowserTracing(flare);
        src.startNavigation({ path: '/cart' });

        expect(spans[1].span.name).toBe('/cart');
        expect(spans[1].attrs['flare.route.source']).toBeUndefined();
        src.unregister();
    });

    // The source unmounted (e.g. app.unmount()) before tracing ever started. Applying its name to a
    // later pageload root would put an authoritative 'route' label, and a possibly stale url.full, on
    // a page the dead source never saw.
    it('drops a held name once its source unregisters, before any root ever picked it up', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/product/p01');
        const src = registerNavigationSource();
        src.setActiveRouteName({ name: '/product/:id', source: 'route' });
        src.unregister();

        const { flare, spans } = fakeFlare();
        startBrowserTracing(flare);

        expect(spans[0].span.name).not.toBe('/product/:id');
        expect(spans[0].attrs['flare.route.source']).not.toBe('route');
    });

    // Last-wins: a second registration replaces the first without either side calling unregister().
    // The first source's held name must not survive the handover either.
    it('drops a held name from a source that was superseded before any root picked it up', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/product/p01');
        const first = registerNavigationSource();
        first.setActiveRouteName({ name: '/product/:id', source: 'route' });
        registerNavigationSource(); // supersedes `first`, last-wins

        const { flare, spans } = fakeFlare();
        startBrowserTracing(flare);

        expect(spans[0].span.name).not.toBe('/product/:id');
        expect(spans[0].attrs['flare.route.source']).not.toBe('route');
    });

    // What makes the clear in stopBrowserTracing safe: a source that outlives a tracing-off/on toggle
    // hands its name over again, and that one is held and applied. Re-enabling opens a second pageload
    // root (not backdated, but a real root), so without this it would stay url-named for good.
    it('names the pageload root of a re-enabled session from a name handed over while tracing was off', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/product/p01');
        const { flare } = fakeFlare();
        startBrowserTracing(flare);
        const src = registerNavigationSource();
        stopBrowserTracing();

        src.setActiveRouteName({ name: '/product/:id', source: 'route' }); // no root open right now

        const { flare: flare2, spans: spans2 } = fakeFlare();
        startBrowserTracing(flare2);

        expect(spans2[0].span.name).toBe('/product/:id');
        expect(spans2[0].attrs['flare.route.source']).toBe('route');
        src.unregister();
    });

    it('stopBrowserTracing clears a held name so a later start does not apply it', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/product/p01');
        const src = registerNavigationSource();
        src.setActiveRouteName({ name: '/product/:id', source: 'route' });

        stopBrowserTracing();

        const { flare, spans } = fakeFlare();
        startBrowserTracing(flare);

        expect(spans[0].span.name).not.toBe('/product/:id');
        expect(spans[0].attrs['flare.route.source']).not.toBe('route');
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

    it('startNavigation stamps url.full from the destination url, not the live location', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/a'); // live location is /a
        const { flare, startSpan } = fakeFlare();
        startBrowserTracing(flare);
        const src = registerNavigationSource();

        src.startNavigation({ path: '/product/p01', url: 'https://app.test/product/p01' });

        const nav = startSpan.mock.calls[1]!;
        expect(nav[1]!.attributes?.['url.full']).toBe('https://app.test/product/p01');
        expect(nav[1]!.attributes?.['flare.entry_point.value']).toBe('https://app.test/product/p01');
        expect(nav[1]!.attributes?.['flare.entry_point.handler.identifier']).toBe('/product/p01');
        src.unregister();
    });

    it('a held navigation root does not idle-close before settleNavigation, then closes an idle window after it', () => {
        vi.useFakeTimers();
        const { flare, spans } = fakeFlare();
        startBrowserTracing(flare);
        const src = registerNavigationSource();

        src.startNavigation({ path: '/product/p01', url: 'https://app.test/product/p01', hold: true });
        const navRoot = spans[1].span as unknown as { end: ReturnType<typeof vi.fn> };

        vi.advanceTimersByTime(1000); // idleTimeout would normally close it
        expect(navRoot.end).not.toHaveBeenCalled();

        src.settleNavigation({ name: '/product/:id', source: 'route' });
        expect(spans[1].span.name).toBe('/product/:id');
        expect(spans[1].attrs['flare.entry_point.handler.identifier']).toBe('/product/:id');
        expect(spans[1].attrs['flare.route.source']).toBe('route');

        // Settling hands the root back to the idle lifecycle rather than closing it: a framework
        // mounts its route component after the router settles, and that mount must still find a
        // live root to attach to.
        expect(navRoot.end).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1000); // idleTimeout with nothing attached
        expect(navRoot.end).toHaveBeenCalled();
        src.unregister();
    });

    it('settleNavigation no-ops when the held root already force-closed (finalTimeout)', () => {
        vi.useFakeTimers();
        const { flare, spans } = fakeFlare();
        startBrowserTracing(flare);
        const src = registerNavigationSource();
        src.startNavigation({ path: '/slow', url: 'https://app.test/slow', hold: true });

        vi.advanceTimersByTime(30000); // finalTimeout force-closes the held root
        src.settleNavigation({ name: '/slow/:id', source: 'route' });

        expect(spans[1].span.name).not.toBe('/slow/:id'); // name-drop for a genuinely stuck nav
        src.unregister();
    });

    it('unregister releases a held navigation root instead of leaving it hung to finalTimeout', () => {
        vi.useFakeTimers();
        const { flare, spans } = fakeFlare();
        startBrowserTracing(flare);
        const src = registerNavigationSource();

        src.startNavigation({ path: '/product/p01', url: 'https://app.test/product/p01', hold: true });
        const navRoot = spans[1].span as unknown as { end: ReturnType<typeof vi.fn> };

        // Nothing settled it; tearing down the source mid-hold must hand the childless root back to
        // the idle lifecycle, not leave it idle-suppressed until the 30s finalTimeout.
        src.unregister();
        expect(navRoot.end).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1000); // idleTimeout, not the 30s backstop
        expect(navRoot.end).toHaveBeenCalled();
    });

    it('omitting url and hold preserves the prior live-location, idle-closing behavior', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/a');
        const { flare, startSpan, spans } = fakeFlare();
        startBrowserTracing(flare);
        const src = registerNavigationSource();

        src.startNavigation({ path: '/b' }); // no url, no hold (the TanStack path)
        const navRoot = spans[1].span as unknown as { end: ReturnType<typeof vi.fn> };
        expect(startSpan.mock.calls[1]![1]!.attributes?.['url.full']).toContain('/a'); // live location
        vi.advanceTimersByTime(1000);
        expect(navRoot.end).toHaveBeenCalled(); // idle-closes as before (no hold)
        src.unregister();
    });
});
