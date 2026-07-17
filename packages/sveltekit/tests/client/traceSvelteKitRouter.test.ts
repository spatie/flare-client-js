// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { beforeEach, expect, test, vi } from 'vitest';

import type { NavSnapshot } from '../../src/client/traceSvelteKitRouter.svelte';

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

const PRODUCT = new URL(location.origin + '/product/p01');
const snap = (over: Partial<NavSnapshot> = {}): NavSnapshot => ({
    to: null,
    willUnload: false,
    routeId: '/',
    url: HERE,
    ...over,
});

async function started() {
    const mod = await load();
    const stop = mod.traceSvelteKitRouter();
    // The mount effect's first run (pageload naming off the seeded `$app/state`) is scheduled on a
    // microtask, not run synchronously by `$effect.root`. Without this tick it fires later, after
    // `vi.clearAllMocks()`, and leaks a `setActiveRouteName` call into whichever test happens to await
    // this helper. Let it settle before clearing so every test starts from a clean mock history.
    await Promise.resolve();
    vi.clearAllMocks();
    return { ...mod, stop };
}

// NOTE ON `url` IN THESE SNAPSHOTS: `started()` initialises `lastKey` from jsdom's `location`, i.e.
// `/`. A snapshot whose url is anything else has `key !== lastKey` and therefore hits branch 7 (the
// fallback), NOT branch 6. So pageload-naming cases MUST use `url: HERE`. `routeId` is what names the
// root; the url only decides the key and the fallback name. Getting this wrong makes a branch-6 test
// silently assert branch-7 behaviour.

test('names the pageload root from the committed route id', async () => {
    const { syncNavigation, stop } = await started();
    syncNavigation(snap({ routeId: '/product/[id]', url: HERE })); // url: HERE => branch 6
    expect(nav.setActiveRouteName).toHaveBeenCalledWith({ name: '/product/[id]', source: 'route' });
    expect(nav.startNavigation).not.toHaveBeenCalled();
    stop();
});

test('falls back to the pathname when there is no route id', async () => {
    const { syncNavigation, stop } = await started();
    syncNavigation(snap({ routeId: null }));
    expect(nav.setActiveRouteName).toHaveBeenCalledWith({ name: '/', source: 'url' });
    stop();
});

test('a late-resolving route id renames the pageload root and opens no nav root', async () => {
    const { syncNavigation, stop } = await started();

    // Kit's `page.route.id` is null until hydration resolves it, so the first snapshot at the
    // initial key can only name from the url. Both snapshots sit at `lastKey`, so both take
    // branch 6 and neither may open a navigation root. The re-name is a `source` flip, not a
    // name change: that IS the observable here.
    syncNavigation(snap({ routeId: null }));
    expect(nav.setActiveRouteName).toHaveBeenLastCalledWith({ name: '/', source: 'url' });

    syncNavigation(snap({ routeId: '/' }));
    expect(nav.setActiveRouteName).toHaveBeenLastCalledWith({ name: '/', source: 'route' });
    expect(nav.startNavigation).not.toHaveBeenCalled();
    stop();
});

test('opens a held navigation root named from the destination', async () => {
    const { syncNavigation, stop } = await started();
    syncNavigation(snap({ to: { url: PRODUCT, route: { id: '/product/[id]' } } }));
    expect(nav.startNavigation).toHaveBeenCalledWith({
        path: '/product/p01',
        url: PRODUCT.href,
        hold: true,
    });
    expect(nav.setActiveRouteName).toHaveBeenCalledWith({ name: '/product/[id]', source: 'route' });
    stop();
});

test('settles the navigation from the committed page', async () => {
    const { syncNavigation, stop } = await started();
    syncNavigation(snap({ to: { url: PRODUCT, route: { id: '/product/[id]' } } }));
    syncNavigation(snap({ routeId: '/product/[id]', url: PRODUCT }));
    expect(nav.settleNavigation).toHaveBeenCalledWith({ name: '/product/[id]', source: 'route' });
    stop();
});

test('a redirect keeps ONE held root and renames it to the final destination', async () => {
    const { syncNavigation, stop } = await started();
    const OLD = new URL(location.origin + '/old');
    syncNavigation(snap({ to: { url: OLD, route: { id: '/old' } } }));
    syncNavigation(snap({ to: { url: PRODUCT, route: { id: '/product/[id]' } } })); // redirect hop
    expect(nav.startNavigation).toHaveBeenCalledTimes(1);
    expect(nav.setActiveRouteName).toHaveBeenLastCalledWith({ name: '/product/[id]', source: 'route' });
    stop();
});

test('skips a navigation that will unload the document', async () => {
    const { syncNavigation, stop } = await started();
    syncNavigation(snap({ to: { url: PRODUCT, route: { id: '/product/[id]' } }, willUnload: true }));
    expect(nav.startNavigation).not.toHaveBeenCalled();
    expect(nav.setActiveRouteName).not.toHaveBeenCalled();
    stop();
});

test('skips a navigation to a route SvelteKit does not own', async () => {
    const { syncNavigation, stop } = await started();
    syncNavigation(snap({ to: { url: PRODUCT, route: { id: null } } }));
    expect(nav.startNavigation).not.toHaveBeenCalled();
    expect(nav.setActiveRouteName).not.toHaveBeenCalled();
    stop();
});

test('a hash-only change opens no navigation root', async () => {
    const { syncNavigation, stop } = await started();
    syncNavigation(snap({ url: new URL(location.origin + '/#section-2') }));
    expect(nav.startNavigation).not.toHaveBeenCalled();
    stop();
});

test('fallback: a committed key change while idle opens an un-held root and settles it at once', async () => {
    const { syncNavigation, stop } = await started();
    // Same snapshot as the pageload test above EXCEPT `url: PRODUCT`, which moves the key off
    // `lastKey` ('/') and is precisely what selects branch 7 over branch 6.
    syncNavigation(snap({ routeId: '/product/[id]', url: PRODUCT }));
    expect(nav.startNavigation).toHaveBeenCalledWith({ path: '/product/p01', url: PRODUCT.href });
    expect(nav.startNavigation.mock.calls[0][0]).not.toHaveProperty('hold');
    expect(nav.settleNavigation).toHaveBeenCalledWith({ name: '/product/[id]', source: 'route' });
    stop();
});

test('lastKey re-stamp: a repeat snapshot after a settle opens no second root', async () => {
    const { syncNavigation, stop } = await started();
    syncNavigation(snap({ to: { url: PRODUCT, route: { id: '/product/[id]' } } }));
    syncNavigation(snap({ routeId: '/product/[id]', url: PRODUCT })); // settle
    vi.clearAllMocks();
    syncNavigation(snap({ routeId: '/product/[id]', url: PRODUCT })); // Kit reassigns page.url
    expect(nav.startNavigation).not.toHaveBeenCalled();
    stop();
});

test('branch 0 does not consume the transition when tracing is off', async () => {
    const { syncNavigation, stop } = await started();
    flareConfig.enableTracing = false;
    syncNavigation(snap({ to: { url: PRODUCT, route: { id: '/product/[id]' } } }));
    syncNavigation(snap({ routeId: '/product/[id]', url: PRODUCT }));
    flareConfig.enableTracing = true;

    // inFlight must still be false, so a real navigation afterwards still opens a root.
    syncNavigation(snap({ to: { url: PRODUCT, route: { id: '/product/[id]' } } }));
    expect(nav.startNavigation).toHaveBeenCalledTimes(1);
    expect(nav.startNavigation).toHaveBeenCalledWith({ path: '/product/p01', url: PRODUCT.href, hold: true });
    stop();
});
