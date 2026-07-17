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
// must be re-seeded AFTER resetModules: the reset gives the module under test a brand-new mock
// instance, so anything written to a pre-reset instance is silently discarded.
async function load() {
    vi.resetModules();
    const { page, navigating } = await import('$app/state');
    page.url = HERE;
    page.route = { id: '/' };
    navigating.to = null;
    navigating.willUnload = false;
    // `flushSync` MUST come from the post-reset `svelte` instance: resetModules gives the module
    // under test a brand-new svelte runtime with its own effect queue, and the copy imported at the
    // top of this file flushes the OLD queue, which is a silent no-op.
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

// NOTE ON `url` IN THESE SNAPSHOTS: `started()` initialises `lastKey` from jsdom's `location`, i.e.
// `/`. A snapshot whose url is anything else has `key !== lastKey` and therefore hits branch 7 (the
// fallback), NOT branch 6. So pageload-naming cases MUST use `url: HERE`. `routeId` is what names the
// root; the url only decides the key and the fallback name. Getting this wrong makes a branch-6 test
// silently assert branch-7 behaviour.

// EVERY OTHER CASE BELOW CALLS `syncNavigation` DIRECTLY, so none of them touch the effect body.
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
    syncNavigation(snap({ routeId: '/product/[id]', url: HERE })); // url: HERE => branch 6
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

    // Kit's `page.route.id` is null until hydration resolves it, so the first snapshot at the
    // initial key can only name from the url. Both snapshots sit at `lastKey`, so both take
    // branch 6 and neither may open a navigation root. The re-name is a `source` flip, not a
    // name change: that IS the observable here.
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
    // Same snapshot as the pageload test above EXCEPT `url: PRODUCT`, which moves the key off
    // `lastKey` ('/') and is precisely what selects branch 7 over branch 6.
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

test('branch 7 re-stamp: a repeat snapshot after the fallback opens no second root', async () => {
    const { syncNavigation, stop } = await started();
    syncNavigation(snap({ routeId: '/product/[id]', url: PRODUCT })); // branch 7 fallback
    vi.clearAllMocks();
    syncNavigation(snap({ routeId: '/product/[id]', url: PRODUCT })); // same snapshot again
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

// Branch 0 must keep tracking the committed location, not just eat the snapshot. Without the
// lastKey stamp the key goes stale for every navigation made while tracing was off, and the first
// idle snapshot after it flips back on reads as a move and fabricates a branch-7 root for a page
// that never navigated.
test('a navigation made while tracing was off does not fabricate a root when it comes back on', async () => {
    const { syncNavigation, stop } = await started();
    flareConfig.enableTracing = false;
    syncNavigation(snap({ to: { url: PRODUCT, route: { id: '/product/[id]' } } }));
    syncNavigation(snap({ routeId: '/product/[id]', url: PRODUCT })); // committed at /product/p01
    flareConfig.enableTracing = true;

    vi.clearAllMocks();
    // An idle snapshot at the SAME committed location (e.g. Kit reassigning page.url on a hash
    // change). It is not a move, so it must take branch 6 and name, never branch 7 and open a root.
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
test('the pre-hydration placeholder does not poison lastKey while tracing is off', async () => {
    const { syncNavigation, stop } = await started();
    flareConfig.enableTracing = false;
    syncNavigation({ to: null, willUnload: false, routeId: null, url: new URL('a:') });
    flareConfig.enableTracing = true;

    syncNavigation(snap({ routeId: '/', url: HERE })); // still the initial location => branch 6
    expect(nav.startNavigation).not.toHaveBeenCalled();
    stop();
});

test('a to-null settle stranded by tracing going off does not desync the next navigation', async () => {
    const { syncNavigation, stop } = await started();
    // Navigation starts while tracing is on: held root opens, inFlight = true.
    syncNavigation(snap({ to: { url: PRODUCT, route: { id: '/product/[id]' } } }));
    flareConfig.enableTracing = false;
    // The to-null settle snapshot arrives while tracing is off; branch 0 must eat it AND clear
    // inFlight, or the next navigation below finds inFlight already true and opens no root.
    syncNavigation(snap({ routeId: '/product/[id]', url: PRODUCT }));
    flareConfig.enableTracing = true;

    vi.clearAllMocks();
    syncNavigation(snap({ to: { url: PRODUCT, route: { id: '/product/[id]' } } }));
    expect(nav.startNavigation).toHaveBeenCalledWith({ path: '/product/p01', url: PRODUCT.href, hold: true });
    stop();
});
