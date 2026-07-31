// @vitest-environment jsdom
import { browserSeamStub, type FakeNavigationSource } from '@flareapp/test-helpers';
import { beforeEach, describe, expect, test, vi } from 'vitest';

function navSpies(): FakeNavigationSource {
    return {
        startNavigation: vi.fn(),
        setActiveRouteName: vi.fn(),
        settleNavigation: vi.fn(),
        unregister: vi.fn(),
    };
}

/**
 * Spread the REAL barrel (for createFlareResolver, called at resolveFlare.ts module load), override
 * registerNavigationSource with a spy, and shim insulate/safeInvoke so this file passes even against a
 * dist built before those existed.
 */
function mockBrowserSeam(registerNavigationSource: ReturnType<typeof vi.fn>): void {
    vi.doMock('@flareapp/js/browser', async () => {
        const actual = await vi.importActual<Record<string, unknown>>('@flareapp/js/browser');
        return {
            ...actual,
            registerNavigationSource,
            insulate:
                (fn: (...args: unknown[]) => void) =>
                (...args: unknown[]) => {
                    try {
                        fn(...args);
                    } catch {
                        /* swallow */
                    }
                },
            safeInvoke: (fn?: (() => void) | null) => {
                try {
                    fn?.();
                } catch {
                    /* swallow */
                }
            },
        };
    });
}

describe('@flareapp/vue vue-router tracing entry', () => {
    beforeEach(() => {
        vi.resetModules();
        delete (window as unknown as { flare?: unknown }).flare;
    });

    test('importing traceVueRouter does NOT evaluate the @flareapp/js root singleton', async () => {
        const rootFactory = vi.fn(() => ({ flare: {} }));
        vi.doMock('@flareapp/js', rootFactory);
        vi.doMock('@flareapp/js/browser', () => browserSeamStub());
        await import('../src/traceVueRouter');
        expect(rootFactory).not.toHaveBeenCalled();
        expect((window as unknown as { flare?: unknown }).flare).toBeUndefined();
    });

    test('installing flareVue with a router option wires tracing exactly once', async () => {
        const registerNavigationSource = vi.fn(() => navSpies());
        mockBrowserSeam(registerNavigationSource);

        const { flareVue } = await import('../src/inject');
        const { createApp } = await import('vue');

        const flareStub = {
            reportSilently: vi.fn(),
            reportMessage: vi.fn(),
            setSdkInfo: vi.fn(),
            setFramework: vi.fn(),
            config: { enableTracing: true },
        } as unknown as import('../src/types').FlareVueOptions['flare'];

        const router = {
            currentRoute: { value: { path: '/', fullPath: '/', matched: [] } },
            beforeEach: vi.fn(() => () => {}),
            afterEach: vi.fn(() => () => {}),
            onError: vi.fn(() => () => {}),
        };

        const app = createApp({ render: () => null });
        app.use(flareVue, { flare: flareStub, router });

        expect(registerNavigationSource).toHaveBeenCalledTimes(1);
        expect(router.beforeEach).toHaveBeenCalledTimes(1);
        expect(router.afterEach).toHaveBeenCalledTimes(1);
    });

    // Flipped deliberately. This used to assert the opposite, back when flareVue gated router tracing
    // on enableTracing at install time. `flare.configure({ enableTracing: true })` can arrive after
    // app.use(flareVue), and the seam no-ops until it does, so wiring is now unconditional and the
    // plugin is order independent like the other four integrations.
    test('installing flareVue with a router wires tracing even while tracing is off', async () => {
        const nav = navSpies();
        const registerNavigationSource = vi.fn(() => nav);
        mockBrowserSeam(registerNavigationSource);

        const { flareVue } = await import('../src/inject');
        const { createApp } = await import('vue');

        const flareStub = {
            reportSilently: vi.fn(),
            reportMessage: vi.fn(),
            setSdkInfo: vi.fn(),
            setFramework: vi.fn(),
            config: { enableTracing: false },
        } as unknown as import('../src/types').FlareVueOptions['flare'];

        const router = {
            currentRoute: { value: { path: '/', fullPath: '/', matched: [] } },
            beforeEach: vi.fn(() => () => {}),
            afterEach: vi.fn(() => () => {}),
            onError: vi.fn(() => () => {}),
        };

        const app = createApp({ render: () => null });
        app.use(flareVue, { flare: flareStub, router });

        expect(registerNavigationSource).toHaveBeenCalledTimes(1);
        expect(router.beforeEach).toHaveBeenCalledTimes(1);
        expect(router.afterEach).toHaveBeenCalledTimes(1);
    });

    test('a router installed before tracing is enabled still produces a parameterized name', async () => {
        const nav = navSpies();
        mockBrowserSeam(vi.fn(() => nav));

        const { flareVue } = await import('../src/inject');
        const { createApp } = await import('vue');

        const flareStub = {
            reportSilently: vi.fn(),
            reportMessage: vi.fn(),
            setSdkInfo: vi.fn(),
            setFramework: vi.fn(),
            config: { enableTracing: false },
        } as unknown as import('../src/types').FlareVueOptions['flare'];

        let beforeEachGuard!: (to: unknown, from: unknown) => void;
        const router = {
            currentRoute: { value: { path: '/', fullPath: '/', matched: [] } },
            beforeEach: vi.fn((guard: (to: unknown, from: unknown) => void) => {
                beforeEachGuard = guard;
                return () => {};
            }),
            afterEach: vi.fn(() => () => {}),
            onError: vi.fn(() => () => {}),
        };

        const app = createApp({ render: () => null });
        app.use(flareVue, { flare: flareStub, router });

        // The consumer calls flare.configure({ enableTracing: true }) here. The guard is already
        // attached, so the very next navigation is named from the route rather than the url.
        beforeEachGuard(
            { path: '/product/p01', fullPath: '/product/p01', matched: [{ path: '/product/:id' }] },
            { path: '/', fullPath: '/', matched: [{ path: '/' }] },
        );

        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        expect(nav.setActiveRouteName).toHaveBeenCalledWith(
            expect.objectContaining({ name: '/product/:id', source: 'route' }),
        );
    });

    test('installing flareVue without a router option does not touch the nav seam', async () => {
        const registerNavigationSource = vi.fn();
        mockBrowserSeam(registerNavigationSource);

        const { flareVue } = await import('../src/inject');
        const { createApp } = await import('vue');
        const flareStub = {
            reportSilently: vi.fn(),
            reportMessage: vi.fn(),
            setSdkInfo: vi.fn(),
            setFramework: vi.fn(),
        } as unknown as import('../src/types').FlareVueOptions['flare'];
        const app = createApp({ render: () => null });
        app.use(flareVue, { flare: flareStub });
        expect(registerNavigationSource).not.toHaveBeenCalled();
    });
});
