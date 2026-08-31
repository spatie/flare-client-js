// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({
    startNavigation: vi.fn(),
    setActiveRouteName: vi.fn(),
    settleNavigation: vi.fn(),
    unregister: vi.fn(),
}));
vi.mock('@flareapp/js/browser', async (importOriginal) =>
    (await import('@flareapp/test-helpers')).browserSeamMock(nav, await importOriginal()),
);

// The real router only treats a response as an Inertia page when it carries the x-inertia header, so
// the stub speaks that protocol instead of just resolving. It also honors the AbortSignal on an
// interrupted visit — real axios rejects on abort, and Response.process() (@inertiajs/core
// src/response.ts) doesn't check cancelled/interrupted itself — and defers resolution a microtask so a
// synchronous second visit() can call abort() first.
type StubPage = { url: string; component: string; props?: Record<string, unknown> };

const axiosMock = vi.hoisted(() => {
    const pageFor = new Map<string, StubPage>();
    const fn = vi.fn((config: { url: string; signal?: AbortSignal }) => {
        return new Promise((resolve, reject) => {
            let aborted = false;
            config.signal?.addEventListener('abort', () => {
                aborted = true;
            });
            queueMicrotask(() => {
                if (aborted) {
                    const error = new Error('canceled');
                    (error as { __CANCEL__?: boolean }).__CANCEL__ = true;
                    reject(error);
                    return;
                }
                const requestPath = new URL(config.url).pathname;
                const page = pageFor.get(requestPath) ?? { url: requestPath, component: 'Products', props: {} };
                resolve({
                    status: 200,
                    headers: { 'x-inertia': 'true' },
                    data: { component: page.component, props: page.props ?? {}, url: page.url, version: '1' },
                });
            });
        });
    });
    (fn as unknown as { isCancel: (error: unknown) => boolean }).isCancel = (error) =>
        !!(error as { __CANCEL__?: boolean })?.__CANCEL__;
    return { fn, pageFor };
});
vi.mock('axios', () => ({ default: axiosMock.fn }));

import { router } from '@inertiajs/core';

import { traceInertiaRouter } from '../src/traceInertiaRouter';

const u = (path: string): string => `${window.location.origin}${path}`;

// Registers what the stub axios answers for a request to `requestPath`, mimicking a Laravel controller.
// Pass `landOn` when the response's own `url` should differ from the request, i.e. a redirect.
function respondAt(
    requestPath: string,
    component: string,
    options: { landOn?: string; props?: Record<string, unknown> } = {},
): void {
    axiosMock.pageFor.set(requestPath, { url: options.landOn ?? requestPath, component, props: options.props });
}

function initRouter(initialPath = '/', component = 'Products'): void {
    window.history.replaceState({}, '', initialPath);
    router.init({
        initialPage: {
            component,
            props: { errors: {} },
            url: initialPath,
            version: '1',
            clearHistory: false,
            encryptHistory: false,
            flash: {},
            rememberedState: {},
        },
        resolveComponent: async (name) => ({ name }),
        swapComponent: async () => {},
    });
}

let stop: () => void = () => {};

beforeEach(() => {
    nav.startNavigation.mockClear();
    nav.setActiveRouteName.mockClear();
    nav.settleNavigation.mockClear();
    nav.unregister.mockClear();
    axiosMock.fn.mockClear();
    axiosMock.pageFor.clear();
    // jsdom has no scroll layout, so it logs "not implemented" for every call. The real router resets
    // scroll on every page swap, and that behavior is not what this suite is testing.
    window.scrollTo = () => {};
});

afterEach(() => {
    stop();
});

describe('traceInertiaRouter against a real @inertiajs/core router', () => {
    it('opens a held root and settles it with the page component on a plain visit', async () => {
        initRouter();
        stop = traceInertiaRouter(router);
        await vi.waitFor(() => expect(nav.setActiveRouteName).toHaveBeenCalledTimes(1)); // initial navigate
        nav.setActiveRouteName.mockClear();

        respondAt('/product/p01', 'Products/Show');
        router.visit('/product/p01');

        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        expect(nav.startNavigation).toHaveBeenCalledWith(
            expect.objectContaining({ path: '/product/p01', url: u('/product/p01'), hold: true }),
        );
        await vi.waitFor(() => expect(nav.settleNavigation).toHaveBeenCalledTimes(1));
        expect(nav.settleNavigation).toHaveBeenCalledWith({
            name: 'Products/Show',
            source: 'route',
            url: u('/product/p01'),
        });
    });

    it('settles a redirected visit under the page that actually arrived', async () => {
        initRouter();
        stop = traceInertiaRouter(router);
        await vi.waitFor(() => expect(nav.setActiveRouteName).toHaveBeenCalledTimes(1));
        nav.setActiveRouteName.mockClear();

        // POST /login -> the server redirects -> the Dashboard page arrives. The JSON payload's own
        // `url` field is what lands, not the request path, which is how a redirect looks on the wire.
        respondAt('/login', 'Auth/Dashboard', { landOn: '/dashboard' });
        router.post('/login');

        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        expect(nav.startNavigation).toHaveBeenCalledWith(
            expect.objectContaining({ path: '/login', url: u('/login'), hold: true }),
        );
        await vi.waitFor(() => expect(nav.settleNavigation).toHaveBeenCalledTimes(1));
        expect(nav.settleNavigation).toHaveBeenCalledWith({
            name: 'Auth/Dashboard',
            source: 'route',
            url: u('/dashboard'),
        });
    });

    it('opens one root for an interrupted visit and settles it on the newer destination', async () => {
        initRouter();
        stop = traceInertiaRouter(router);
        await vi.waitFor(() => expect(nav.setActiveRouteName).toHaveBeenCalledTimes(1));
        nav.setActiveRouteName.mockClear();

        respondAt('/slow', 'Slow/Show');
        respondAt('/fast', 'Fast/Show');

        // No await between the two: the router interrupts the first visit synchronously from inside the
        // second router.visit() call, before either response arrives.
        router.visit('/slow');
        router.visit('/fast');

        expect(nav.startNavigation).toHaveBeenCalledTimes(1); // re-points the same root, does not open a second
        expect(nav.startNavigation).toHaveBeenCalledWith(
            expect.objectContaining({ path: '/slow', url: u('/slow'), hold: true }),
        );
        await vi.waitFor(() => expect(nav.settleNavigation).toHaveBeenCalledTimes(1));
        expect(nav.settleNavigation).toHaveBeenCalledWith({
            name: 'Fast/Show',
            source: 'route',
            url: u('/fast'),
        });
    });
});
