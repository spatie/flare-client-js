// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { beforeEach, expect, test, vi } from 'vitest';

const nav = vi.hoisted(() => ({
    startNavigation: vi.fn(),
    setActiveRouteName: vi.fn(),
    settleNavigation: vi.fn(),
    unregister: vi.fn(),
}));
const registerNavigationSource = vi.hoisted(() => vi.fn(() => nav));
vi.mock('@flareapp/js/browser', async () => ({
    ...(await import('@flareapp/test-helpers')).browserSeamMock(nav),
    registerNavigationSource,
}));

const flareConfig = vi.hoisted(() => ({ enableTracing: true }));
vi.mock('@flareapp/js', () => ({
    flare: {
        get config() {
            return flareConfig;
        },
    },
}));

const HERE = new URL(location.origin + '/');

// The module holds state (tracing/inFlight/lastKey), so every test needs a fresh copy. `$app/state`
// must be re-seeded AFTER resetModules: the reset gives the module under test a brand-new mock
// instance, so anything written to a pre-reset instance is silently discarded.
async function load() {
    vi.resetModules();
    const { page, navigating } = await import('$app/state');
    page.url = HERE;
    page.route = { id: '/' };
    navigating.to = null;
    navigating.willUnload = false;
    return import('../../src/client/traceSvelteKitRouter.svelte');
}

beforeEach(() => {
    vi.clearAllMocks();
    flareConfig.enableTracing = true;
});

test('registers a navigation source even when tracing is off at call time', async () => {
    flareConfig.enableTracing = false;
    const { traceSvelteKitRouter } = await load();

    const stop = traceSvelteKitRouter();

    // The whole point of having no call-time gate: registration happens regardless, so a later
    // flare.configure({ enableTracing: true }) still produces named roots. That tracing-flips-on-later
    // behaviour needs branch 6, so it is asserted in Task 3 (case 16), not here.
    expect(registerNavigationSource).toHaveBeenCalledTimes(1);
    stop();
});

test('is idempotent: a second call registers no second source', async () => {
    const { traceSvelteKitRouter } = await load();
    const stop = traceSvelteKitRouter();
    traceSvelteKitRouter();
    expect(registerNavigationSource).toHaveBeenCalledTimes(1);
    stop();
});

test('ignores the pre-hydration placeholder page', async () => {
    const { traceSvelteKitRouter, syncNavigation } = await load();
    const stop = traceSvelteKitRouter();
    vi.clearAllMocks();

    syncNavigation({ to: null, willUnload: false, routeId: null, url: new URL('a:') });

    expect(nav.startNavigation).not.toHaveBeenCalled();
    expect(nav.setActiveRouteName).not.toHaveBeenCalled();
    stop();
});

test('cleanup disposes the effect and unregisters', async () => {
    const { traceSvelteKitRouter } = await load();
    const stop = traceSvelteKitRouter();
    flushSync();
    stop();
    expect(nav.unregister).toHaveBeenCalledTimes(1);
});
