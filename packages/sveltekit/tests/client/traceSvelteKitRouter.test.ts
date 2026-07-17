// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';

import type { NavSnapshot } from '../../src/client/traceSvelteKitRouter.svelte';

const nav = vi.hoisted(() => ({
    startNavigation: vi.fn(),
    setActiveRouteName: vi.fn(),
    settleNavigation: vi.fn(),
    unregister: vi.fn(),
}));
const registerNavigationSource = vi.hoisted(() => vi.fn(() => nav));
vi.mock('@flareapp/js/browser', async (importOriginal) => ({
    ...(await import('@flareapp/test-helpers')).browserSeamMock(nav, await importOriginal()),
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
// has to be seeded again after resetModules: the reset gives the module under test a brand-new mock
// instance, so anything written to the old one is quietly thrown away.
async function load() {
    vi.resetModules();
    const { page, navigating } = await import('$app/state');
    page.url = HERE;
    page.route = { id: '/' };
    navigating.to = null;
    navigating.willUnload = false;
    // `flushSync` has to come from the svelte instance created after the reset. resetModules gives
    // the module under test its own svelte runtime with its own effect queue, and a copy imported at
    // the top of this file would flush the old queue, which does nothing at all.
    const { flushSync } = await import('svelte');
    return { ...(await import('../../src/client/traceSvelteKitRouter.svelte')), page, navigating, flushSync };
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
    // behaviour needs a naming snapshot, which the pageload tests below cover instead.
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
    const { traceSvelteKitRouter, flushSync } = await load();
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

// About `url` in these snapshots: `started()` takes the starting key from jsdom's location, which is
// `/`. A snapshot with any other url looks like the page moved, and then it opens a root instead of
// naming one. So a test about naming the pageload has to pass `url: HERE`. The name comes from
// `routeId`; the url only decides whether we read it as a move. Get this wrong and a naming test
// quietly asserts the behaviour of the fallback instead.

// Every other case below calls `syncNavigation` directly, so none of them touch the effect body.
// That body is the fragile half: it must read `navigating.to` (not `.from`), `page.route.id` and
// `page.url`, and it must re-run when any of them change. Swap a field for the wrong one and every
// other unit test here still passes. So drive one full navigation through the reactive state.
test('the effect reads $app/state and re-runs, feeding the state machine', async () => {
    const { traceSvelteKitRouter, page, navigating, flushSync } = await load();
    const stop = traceSvelteKitRouter();
    flushSync();
    vi.clearAllMocks();

    navigating.to = { url: PRODUCT, route: { id: '/product/[id]' } };
    flushSync();
    expect(nav.startNavigation).toHaveBeenCalledWith({ path: '/product/p01', url: PRODUCT.href, hold: true });
    expect(nav.setActiveRouteName).toHaveBeenCalledWith({
        name: '/product/[id]',
        source: 'route',
        url: PRODUCT.href,
    });

    // Kit commits `page` before it nulls `navigating`, so the settle names from the committed route.
    navigating.to = null;
    page.url = PRODUCT;
    page.route = { id: '/product/[id]' };
    flushSync();
    expect(nav.settleNavigation).toHaveBeenCalledWith({
        name: '/product/[id]',
        source: 'route',
        url: PRODUCT.href,
    });
    stop();
});

test('the disposed effect stops observing $app/state', async () => {
    const { traceSvelteKitRouter, navigating, flushSync } = await load();
    const stop = traceSvelteKitRouter();
    flushSync();
    stop();
    vi.clearAllMocks();

    navigating.to = { url: PRODUCT, route: { id: '/product/[id]' } };
    flushSync();
    expect(nav.startNavigation).not.toHaveBeenCalled();
});

test('names the pageload root from the committed route id', async () => {
    const { syncNavigation, stop } = await started();
    syncNavigation(snap({ routeId: '/product/[id]', url: HERE })); // url: HERE, so this only names
    expect(nav.setActiveRouteName).toHaveBeenCalledWith({ name: '/product/[id]', source: 'route', url: HERE.href });
    expect(nav.startNavigation).not.toHaveBeenCalled();
    stop();
});

test('falls back to the pathname when there is no route id', async () => {
    const { syncNavigation, stop } = await started();
    syncNavigation(snap({ routeId: null }));
    expect(nav.setActiveRouteName).toHaveBeenCalledWith({ name: '/', source: 'url', url: HERE.href });
    stop();
});

test('a late-resolving route id renames the pageload root and opens no nav root', async () => {
    const { syncNavigation, stop } = await started();

    // Kit's `page.route.id` is null until hydration resolves it, so the first snapshot can only
    // name from the url. Neither snapshot moves the page, so neither may open a navigation root.
    // The second one changes `source`, not the name, and that is what this asserts.
    syncNavigation(snap({ routeId: null }));
    expect(nav.setActiveRouteName).toHaveBeenLastCalledWith({ name: '/', source: 'url', url: HERE.href });

    syncNavigation(snap({ routeId: '/' }));
    expect(nav.setActiveRouteName).toHaveBeenLastCalledWith({ name: '/', source: 'route', url: HERE.href });
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
    expect(nav.setActiveRouteName).toHaveBeenCalledWith({ name: '/product/[id]', source: 'route', url: PRODUCT.href });
    stop();
});

test('settles the navigation from the committed page', async () => {
    const { syncNavigation, stop } = await started();
    syncNavigation(snap({ to: { url: PRODUCT, route: { id: '/product/[id]' } } }));
    syncNavigation(snap({ routeId: '/product/[id]', url: PRODUCT }));
    expect(nav.settleNavigation).toHaveBeenCalledWith({ name: '/product/[id]', source: 'route', url: PRODUCT.href });
    stop();
});

test('a redirect keeps ONE held root and renames it to the final destination', async () => {
    const { syncNavigation, stop } = await started();
    const OLD = new URL(location.origin + '/old');
    syncNavigation(snap({ to: { url: OLD, route: { id: '/old' } } }));
    syncNavigation(snap({ to: { url: PRODUCT, route: { id: '/product/[id]' } } })); // redirect hop
    expect(nav.startNavigation).toHaveBeenCalledTimes(1);
    expect(nav.setActiveRouteName).toHaveBeenLastCalledWith({
        name: '/product/[id]',
        source: 'route',
        url: PRODUCT.href,
    });
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
    // The same snapshot as the pageload test above apart from `url: PRODUCT`, which moves the page
    // off the starting location and is what makes this read as a navigation rather than a naming.
    syncNavigation(snap({ routeId: '/product/[id]', url: PRODUCT }));
    expect(nav.startNavigation).toHaveBeenCalledWith({ path: '/product/p01', url: PRODUCT.href });
    expect(nav.startNavigation.mock.calls[0][0]).not.toHaveProperty('hold');
    expect(nav.settleNavigation).toHaveBeenCalledWith({ name: '/product/[id]', source: 'route', url: PRODUCT.href });
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

test('a repeat snapshot after the fallback opens no second root', async () => {
    const { syncNavigation, stop } = await started();
    syncNavigation(snap({ routeId: '/product/[id]', url: PRODUCT })); // the fallback
    vi.clearAllMocks();
    syncNavigation(snap({ routeId: '/product/[id]', url: PRODUCT })); // same snapshot again
    expect(nav.startNavigation).not.toHaveBeenCalled();
    stop();
});

test('a snapshot seen while tracing is off is not treated as a navigation', async () => {
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

// While tracing is off we still have to follow the current page, not just drop the snapshot.
// Without that the key goes stale during every navigation made while tracing was off, and the first
// snapshot after it comes back on reads as a move and opens a root for a page that never moved.
test('a navigation made while tracing was off does not open a root when it comes back on', async () => {
    const { syncNavigation, stop } = await started();
    flareConfig.enableTracing = false;
    syncNavigation(snap({ to: { url: PRODUCT, route: { id: '/product/[id]' } } }));
    syncNavigation(snap({ routeId: '/product/[id]', url: PRODUCT })); // committed at /product/p01
    flareConfig.enableTracing = true;

    vi.clearAllMocks();
    // A snapshot at the same location (for example Kit reassigning page.url on a hash
    // change). The page did not move, so it must name the root and never open a new one.
    syncNavigation(snap({ routeId: '/product/[id]', url: PRODUCT }));

    expect(nav.startNavigation).not.toHaveBeenCalled();
    expect(nav.settleNavigation).not.toHaveBeenCalled();
    expect(nav.setActiveRouteName).toHaveBeenCalledWith({
        name: '/product/[id]',
        source: 'route',
        url: PRODUCT.href,
    });
    stop();
});

// The `a:` placeholder is checked before the tracing gate precisely so it cannot reach that stamp:
// its pathname is empty, and stamping '' would make the next real snapshot look like a move.
test('the pre-hydration placeholder is not mistaken for a page while tracing is off', async () => {
    const { syncNavigation, stop } = await started();
    flareConfig.enableTracing = false;
    syncNavigation({ to: null, willUnload: false, routeId: null, url: new URL('a:') });
    flareConfig.enableTracing = true;

    syncNavigation(snap({ routeId: '/', url: HERE })); // still the initial location, so just name it
    expect(nav.startNavigation).not.toHaveBeenCalled();
    stop();
});

test('a settle lost because tracing went off does not break the next navigation', async () => {
    const { syncNavigation, stop } = await started();
    // Navigation starts while tracing is on: held root opens, inFlight = true.
    syncNavigation(snap({ to: { url: PRODUCT, route: { id: '/product/[id]' } } }));
    flareConfig.enableTracing = false;
    // The settle snapshot arrives while tracing is off, so it must be dropped and also clear
    // inFlight, or the next navigation below finds inFlight already true and opens no root.
    syncNavigation(snap({ routeId: '/product/[id]', url: PRODUCT }));
    flareConfig.enableTracing = true;

    vi.clearAllMocks();
    syncNavigation(snap({ to: { url: PRODUCT, route: { id: '/product/[id]' } } }));
    expect(nav.startNavigation).toHaveBeenCalledWith({ path: '/product/p01', url: PRODUCT.href, hold: true });
    stop();
});
