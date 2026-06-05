// Throwaway script: send genuine-looking logs to a real Flare project so we can
// grab a clean screenshot of the Logs page for the announcement post.
//
// Usage:
//   FLARE_KEY=your-project-token node scripts/seed-logs.mjs
//
// It drives the REAL @flareapp/js SDK (from packages/js/dist) in Node by stubbing
// a minimal browser `window`, so the logs carry a genuine WEB entry point with a
// real-looking route per record. Sends to the production logs ingress by default.

const ORIGIN = 'https://shop.acme.test';
const HOSTNAME = 'shop.acme.test';

// Minimal browser-ish globals the SDK's browser collectors read. Set BEFORE
// importing the SDK: its module top-level checks `typeof window`.
const noop = () => {};
globalThis.window = {
    location: { href: `${ORIGIN}/`, pathname: '/', search: '', origin: ORIGIN, hostname: HOSTNAME },
    navigator: {
        userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
    document: { cookie: '', referrer: '', readyState: 'complete', visibilityState: 'visible', addEventListener: noop },
    addEventListener: noop,
};
globalThis.document = globalThis.window.document;

const key = process.env.FLARE_KEY;
if (!key) {
    console.error('Set FLARE_KEY to your Flare project token. Aborting.');
    process.exit(1);
}

const { Flare } = await import('../packages/js/dist/index.mjs');

// Custom context collector: a genuine WEB entry point for the current route, plus
// `host.name` (resource-level, so it lands in the Logs "Hostname" column). The
// stock browser collector does not set host.name today; this mimics what it would
// look like if it took window.location.hostname the way the PHP SDK takes the
// machine hostname.
const collector = () => ({
    'flare.entry_point.type': 'web',
    'flare.entry_point.value': globalThis.window.location.href,
    'flare.entry_point.handler.identifier': globalThis.window.location.pathname,
    'flare.entry_point.handler.type': 'browser',
    'host.name': globalThis.window.location.hostname,
});

const flare = new Flare(undefined, collector);
flare.light(key);
flare.configure({
    enableLogs: true,
    serviceName: 'acme-storefront',
    version: '2.4.0',
    stage: 'production',
});

// A plausible shopping session. Each entry sets the route it happened on so the
// "Entry point" column varies like a real app. Ordered roughly as a user journey.
const events = [
    { level: 'info', path: '/', message: 'Product catalog loaded', attributes: { productCount: 48, durationMs: 124, cacheHit: true } },
    { level: 'debug', path: '/', message: 'Cart restored from localStorage', attributes: { items: 2 } },
    { level: 'info', path: '/products/wireless-headphones', message: 'Product viewed', attributes: { sku: 'WH-1000', price: 279.0, inStock: true } },
    { level: 'warning', path: '/products/wireless-headphones', message: 'Product image failed to load, using fallback', attributes: { sku: 'WH-1000', status: 404, asset: 'wh-1000-hero.webp' } },
    { level: 'info', path: '/cart', message: 'Item added to cart', attributes: { sku: 'WH-1000', quantity: 1, cartTotal: 279.0 } },
    { level: 'notice', path: '/cart', message: 'Discount code applied', attributes: { code: 'SUMMER10', discount: 27.9, cartTotal: 251.1 } },
    { level: 'info', path: '/checkout', message: 'Checkout started', attributes: { cartId: 'cart_8f21a3', itemCount: 3, total: 251.1, currency: 'EUR' } },
    { level: 'info', path: '/checkout', message: 'Payment intent created', attributes: { provider: 'stripe', amountCents: 25110, method: 'card' } },
    { level: 'warning', path: '/checkout', message: 'Payment requires additional authentication', attributes: { provider: 'stripe', reason: '3ds_required' } },
    { level: 'warning', path: '/api/inventory', message: 'Slow inventory response', attributes: { endpoint: '/api/inventory', durationMs: 2143, threshold: 1000 } },
    { level: 'error', path: '/checkout', message: 'Payment declined by issuer', attributes: { provider: 'stripe', code: 'card_declined', cartId: 'cart_8f21a3' } },
    { level: 'info', path: '/checkout', message: 'Payment retried with new card', attributes: { provider: 'stripe', attempt: 2 } },
    { level: 'info', path: '/checkout/confirmation', message: 'Order placed', attributes: { orderId: 'ord_4471c9', total: 251.1, currency: 'EUR', items: 3 } },
    { level: 'notice', path: '/checkout/confirmation', message: 'Confirmation email queued', attributes: { orderId: 'ord_4471c9', template: 'order_confirmation' } },
    { level: 'error', path: '/account', message: 'Failed to refresh session token', attributes: { status: 401, reason: 'expired' } },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const e of events) {
    globalThis.window.location.pathname = e.path;
    globalThis.window.location.href = ORIGIN + e.path;
    // Second arg is PHP-style context: the SDK nests it under `log.context`, which
    // the Flare log detail panel renders as the "Context" section.
    flare.logger[e.level](e.message, e.attributes);
    console.log(`${e.level.toUpperCase().padEnd(8)} ${e.path.padEnd(32)} ${e.message}`);
    // Small stagger so each row gets a distinct timestamp.
    await sleep(200);
}

await flare.flush();
// Give the POST time to settle before the process exits.
await sleep(2500);
console.log(`\nSent ${events.length} logs. Check the Logs page in Flare.`);
