// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('@flareapp/vue vue-router tracing entry', () => {
    beforeEach(() => {
        vi.resetModules();
        delete (window as unknown as { flare?: unknown }).flare;
    });

    test('importing traceVueRouter does NOT evaluate the @flareapp/js root singleton', async () => {
        const rootFactory = vi.fn(() => ({ flare: {} }));
        vi.doMock('@flareapp/js', rootFactory);
        vi.doMock('@flareapp/js/browser', () => ({
            registerNavigationSource: () => ({}),
            insulate: (fn: (...a: unknown[]) => void) => fn,
            safeInvoke: (fn?: () => void) => fn?.(),
        }));
        await import('../src/traceVueRouter');
        expect(rootFactory).not.toHaveBeenCalled();
        expect((window as unknown as { flare?: unknown }).flare).toBeUndefined();
    });

    test('installing flareVue with a router option wires tracing exactly once', async () => {
        const registerNavigationSource = vi.fn(() => ({
            startNavigation: vi.fn(),
            setActiveRouteName: vi.fn(),
            settleNavigation: vi.fn(),
            unregister: vi.fn(),
        }));
        vi.doMock('@flareapp/js/browser', async () => {
            // Spread the REAL barrel (for createFlareResolver, called at resolveFlare.ts module load),
            // override registerNavigationSource with the spy, and shim insulate/safeInvoke so this test
            // passes even against a dist built before Task 1 added them.
            const actual = await vi.importActual<Record<string, unknown>>('@flareapp/js/browser');
            return {
                ...actual,
                registerNavigationSource,
                insulate:
                    (fn: (...a: unknown[]) => void) =>
                    (...a: unknown[]) => {
                        try {
                            fn(...a);
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

        const { flareVue } = await import('../src/inject');
        const { createApp } = await import('vue');

        const flareStub = {
            reportSilently: vi.fn(),
            reportMessage: vi.fn(),
            setSdkInfo: vi.fn(),
            setFramework: vi.fn(),
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

    test('installing flareVue without a router option does not touch the nav seam', async () => {
        const registerNavigationSource = vi.fn();
        vi.doMock('@flareapp/js/browser', async () => {
            // Spread the REAL barrel (for createFlareResolver, called at resolveFlare.ts module load),
            // override registerNavigationSource with the spy, and shim insulate/safeInvoke so this test
            // passes even against a dist built before Task 1 added them.
            const actual = await vi.importActual<Record<string, unknown>>('@flareapp/js/browser');
            return {
                ...actual,
                registerNavigationSource,
                insulate:
                    (fn: (...a: unknown[]) => void) =>
                    (...a: unknown[]) => {
                        try {
                            fn(...a);
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
