import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createApp, h } from 'vue';

// This file registers no resolveFlare default (it never imports the web entry). Vitest isolates the
// module registry per file, so resolveFlare's defaultProvider stays null, which is what lets the
// "throws without an instance" assertions hold.

describe('@flareapp/vue/inject entry', () => {
    beforeEach(() => {
        vi.resetModules();
        delete (window as any).flare;
    });

    test('importing the inject entry does NOT evaluate @flareapp/js root', async () => {
        const rootFactory = vi.fn(() => ({ flare: {} }));
        vi.doMock('@flareapp/js', rootFactory);

        await import('../src/inject');

        expect(rootFactory).not.toHaveBeenCalled();
        expect((window as any).flare).toBeUndefined();
    });

    test('exports flareVue and FlareErrorBoundary', async () => {
        const mod = await import('../src/inject');
        expect(typeof mod.flareVue).toBe('function');
        expect(mod.FlareErrorBoundary).toBeDefined();
    });

    test('app.use(flareVue) from inject throws when no flare option and no default', async () => {
        const { flareVue } = await import('../src/inject');
        const app = createApp({ render: () => null });
        expect(() => app.use(flareVue)).toThrow(/No Flare instance available/);
    });

    test('mounting FlareErrorBoundary from inject throws at setup when no flare prop and no default', async () => {
        const { FlareErrorBoundary } = await import('../src/inject');
        expect(() => mount(FlareErrorBoundary, { slots: { default: () => h('div', 'x') } })).toThrow(
            /No Flare instance available/,
        );
    });

    test('a failed install does not poison installedApps: a retry with a valid flare still installs', async () => {
        const { flareVue } = await import('../src/inject');
        const app = createApp({ render: () => null });

        // Call the plugin function directly (not via app.use) to verify our installedApps ordering
        // in isolation. This doesn't reflect the public `app.use` path: Vue adds the plugin to its
        // own installed-set before invoking install, so a failed `app.use(flareVue)` can't be
        // retried on the same app regardless of our ordering. First call has no instance -> throws.
        expect(() => (flareVue as any)(app, undefined)).toThrow(/No Flare instance available/);

        // Retry with a valid instance must install: the failed attempt must not have added the app
        // to installedApps (the resolve-before-add ordering, verified here via direct invocation).
        const injected = {
            reportSilently: vi.fn(),
            reportMessage: vi.fn(),
            setSdkInfo: vi.fn(),
            setFramework: vi.fn(),
        } as any;
        (flareVue as any)(app, { flare: injected });
        app.config.errorHandler!(new Error('x'), null, 'render');
        expect(injected.reportSilently).toHaveBeenCalledOnce();
    });
});
