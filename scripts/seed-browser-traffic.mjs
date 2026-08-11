// Throwaway script: drive the React playground through realistic shopping sessions so a real
// Flare project fills up with page loads, navigations, web vitals, fetch spans and errors.
// Built to produce screenshot material for the announcement post.
//
// Usage:
//   1. Build and preview the playground (NOT `vite dev`, see below):
//        NODE_EXTRA_CA_CERTS="$HOME/.config/flare-local/valet-ca.pem" \
//          npm run build --workspace=@flareapp/playgrounds-react
//        npm run preview --workspace=@flareapp/playgrounds-react
//   2. node scripts/seed-browser-traffic.mjs
//
// The build must be a production build. In `vite dev` every lazily imported module is a real
// network request, so Vite's own /@fs/ and /src/ requests become browser_fetch spans and sit in
// the middle of every waterfall. The NODE_EXTRA_CA_CERTS line is what gets the sourcemaps
// uploaded, without it the stack traces stay minified. Both rules are from playgrounds/SCREENSHOTS.md.
//
// Where the data lands is decided by playgrounds/react/.env.local (VITE_FLARE_KEY +
// VITE_FLARE_URL), which is baked into the build. This script does not talk to Flare itself.
//
// Deliberately never navigates to /broken or /http: those routes are test fixtures and look
// wrong in a page-performance list.

import { parseArgs } from 'node:util';

import { chromium } from 'playwright';

const { values } = parseArgs({
    options: {
        'sessions': { type: 'string', default: '60' },
        'concurrency': { type: 'string', default: '3' },
        'port': { type: 'string', default: '5181' },
        'base-url': { type: 'string' },
        'error-rate': { type: 'string', default: '0.08' },
        'deep-entry-share': { type: 'string', default: '0.45' },
        'headed': { type: 'boolean', default: false },
        'forever': { type: 'boolean', default: false },
        'help': { type: 'boolean', default: false },
    },
});

if (values.help) {
    console.log(
        [
            'Usage: node scripts/seed-browser-traffic.mjs [options]',
            '',
            '  --sessions <n>      how many sessions to run (default 60)',
            '  --concurrency <n>   how many browsers in parallel (default 3)',
            '  --port <n>          playground preview port (default 5181)',
            '  --base-url <url>    serve from this origin instead of localhost, e.g. https://flarepix.test',
            '  --error-rate <0-1>  share of sessions that get an injected API failure (default 0.08)',
            '  --deep-entry-share <0-1>  share of sessions landing straight on a deep route (default 0.45)',
            '  --headed            watch it happen',
            '  --forever           keep going until ctrl-c',
        ].join('\n'),
    );
    process.exit(0);
}

const totalSessions = Number(values.sessions);
const concurrency = Number(values.concurrency);
const port = Number(values.port);
const errorRate = Number(values['error-rate']);
const deepEntryShare = Number(values['deep-entry-share']);
// Every host in the data reads as whatever this origin is, so point it at a real-looking hostname
// (a Herd/Valet proxy to the preview port) when the screenshots should not say "localhost".
const baseUrl = (values['base-url'] ?? `http://localhost:${port}`).replace(/\/$/, '');

const PRICING_GAP_PRODUCT_ID = '7';
const productIds = Array.from({ length: 12 }, (_, index) => String(index + 1));
const normalProductIds = productIds.filter((id) => id !== PRICING_GAP_PRODUCT_ID);

// Mirrors playgrounds/shared/src/testIds.ts. Duplicated because that file is TypeScript source
// with no build output this script could import.
const testIds = {
    productCard: (id) => `product-card-${id}`,
    addToCart: (id) => `add-to-cart-${id}`,
    cartCount: 'cart-count',
    checkoutSubmit: 'checkout-submit',
    confirmation: 'confirmation',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const pick = (items) => items[randomInt(0, items.length - 1)];

/** Weighted pick over `[item, weight]` pairs. */
const pickWeighted = (pairs) => {
    const total = pairs.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = Math.random() * total;
    for (const [item, weight] of pairs) {
        roll -= weight;
        if (roll <= 0) {
            return item;
        }
    }
    return pairs[pairs.length - 1][0];
};

/** A pause long enough for the idle root to close (idleTimeout is 2s in the playground). */
const settle = () => sleep(randomInt(2600, 4200));

/** A short in-page pause, so clicks inside one root stay inside it. */
const beat = () => sleep(randomInt(250, 900));

// Every context gets an explicit user agent. The default one says "HeadlessChrome", which Flare
// would faithfully show in the browser breakdown. The Chrome version is the real one, filled in
// from browser.version() at launch.
const devices = [
    {
        name: 'mac',
        viewport: { width: 1440, height: 900 },
        isMobile: false,
        userAgent: (chrome) =>
            `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`,
        weight: 4,
    },
    {
        name: 'windows',
        viewport: { width: 1280, height: 800 },
        isMobile: false,
        userAgent: (chrome) =>
            `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`,
        weight: 3,
    },
    {
        name: 'iphone',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        userAgent: () =>
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
        weight: 3,
    },
];

// Throughput in bytes/sec, latency in ms. Roughly Chrome DevTools' own presets, which is what
// spreads the LCP and TTFB values out instead of pinning them all to localhost speed.
const networks = [
    {
        name: 'wifi',
        downloadThroughput: (30 * 1024 * 1024) / 8,
        uploadThroughput: (15 * 1024 * 1024) / 8,
        latency: 10,
        weight: 4,
    },
    {
        name: 'fast-4g',
        downloadThroughput: (9 * 1024 * 1024) / 8,
        uploadThroughput: (1.5 * 1024 * 1024) / 8,
        latency: 60,
        weight: 4,
    },
    {
        name: 'slow-4g',
        downloadThroughput: (1.6 * 1024 * 1024) / 8,
        uploadThroughput: (750 * 1024) / 8,
        latency: 150,
        weight: 2,
        cpu: 4,
    },
    // The two below exist to put amber and red in the Core Web Vitals score column. Measured LCP on
    // the home page: slow-3g/cpu6 lands around 3.4s (amber), 2g/cpu8 around 7.1s (red). Kept rare,
    // because a real shop is mostly green and because these sessions take much longer to run.
    {
        name: 'slow-3g',
        downloadThroughput: (400 * 1024) / 8,
        uploadThroughput: (400 * 1024) / 8,
        latency: 400,
        weight: 1.5,
        cpu: 6,
    },
    {
        name: '2g',
        downloadThroughput: (180 * 1024) / 8,
        uploadThroughput: (84 * 1024) / 8,
        latency: 700,
        weight: 0.5,
        cpu: 8,
    },
];

// Only used by the profiles that do not pin their own rate. The slow ones do, because their whole
// point is a specific vitals band.
const cpuRates = [
    [1, 5],
    [2, 3],
    [4, 2],
];

const shoppers = [
    { id: 'usr_8123', email: 'iris.dewitte@example.com', fullName: 'Iris De Witte', plan: 'studio' },
    { id: 'usr_4471', email: 'marek.novak@example.com', fullName: 'Marek Novak', plan: 'free' },
    { id: 'usr_9052', email: 'sofia.almeida@example.com', fullName: 'Sofia Almeida', plan: 'studio' },
    { id: 'usr_2310', email: 'tom.beckers@example.com', fullName: 'Tom Beckers', plan: 'pro' },
    { id: 'usr_6688', email: 'yuki.tanaka@example.com', fullName: 'Yuki Tanaka', plan: 'free' },
    { id: 'usr_1174', email: 'amara.okoye@example.com', fullName: 'Amara Okoye', plan: 'pro' },
    { id: 'usr_7729', email: 'lars.jensen@example.com', fullName: 'Lars Jensen', plan: 'studio' },
    { id: 'usr_5503', email: 'nina.petrova@example.com', fullName: 'Nina Petrova', plan: 'free' },
];

// Only endpoints whose callers have no .catch, so a failure surfaces as a real reported error
// with an app stack instead of being swallowed. /api/products/:id is caught on the product page.
const failableEndpoints = [
    // Called once on the home page only, so it can only fail there.
    { pattern: '**/api/products', label: 'GET /api/products', maxSkip: 0 },
    // Home page, then again on every product page.
    { pattern: '**/api/recommendations*', label: 'GET /api/recommendations', maxSkip: 2 },
    // Home page, then the cart page, then the checkout page.
    { pattern: '**/api/cart/summary', label: 'POST /api/cart/summary', maxSkip: 2 },
];

async function preflight() {
    let html;
    try {
        const response = await fetch(baseUrl);
        html = await response.text();
    } catch (error) {
        // node has its own certificate store, so an https --base-url on a locally signed domain
        // fails here while the browser itself would be fine.
        const hint = baseUrl.startsWith('https:')
            ? '\nFor a locally signed host, run with NODE_EXTRA_CA_CERTS pointing at your CA.'
            : '';
        abort(`Nothing is serving ${baseUrl} (${error.message}).${hint}`);
    }

    if (html.includes('/@vite/client')) {
        abort(`${baseUrl} is the dev server, not a production preview.`);
    }
}

function abort(reason) {
    console.error(
        [
            reason,
            '',
            'Build and preview the React playground first:',
            '',
            '  NODE_EXTRA_CA_CERTS="$HOME/.config/flare-local/valet-ca.pem" \\',
            '    npm run build --workspace=@flareapp/playgrounds-react',
            '  npm run preview --workspace=@flareapp/playgrounds-react',
            '',
            'A dev server turns every lazily imported module into a browser_fetch span, which',
            'ruins the waterfall. The CA line is what gets the sourcemaps uploaded.',
        ].join('\n'),
    );
    process.exit(1);
}

/**
 * Fails one call to one endpoint. The playground's own readJson throws on a non-ok response and
 * useAsyncData has no catch, so this lands as a genuine error with an app stack.
 *
 * `skip` lets earlier calls through so the failure can land on a product or cart page instead of
 * always on the home page load, which spreads the errors over routes. Both endpoints below are
 * called more than once in a full journey.
 */
async function injectApiFailure(page) {
    const endpoint = pick(failableEndpoints);
    const mode = pickWeighted([
        ['500', 3],
        ['503', 2],
        ['abort', 2],
    ]);
    const skip = randomInt(0, endpoint.maxSkip);

    const state = { fired: false, seen: 0, label: `${endpoint.label} -> ${mode}` };

    await page.route(endpoint.pattern, async (route) => {
        if (state.fired || state.seen++ < skip) {
            return route.continue();
        }
        state.fired = true;

        await sleep(randomInt(120, 400));

        if (mode === 'abort') {
            return route.abort('connectionreset');
        }

        return route.fulfill({
            status: Number(mode),
            contentType: 'application/json',
            body: JSON.stringify({ error: 'pricing service unavailable' }),
        });
    });

    return state;
}

/**
 * Swap the pinned showcase shopper for this session's one, before anything can be reported. The
 * scope survives SPA navigation, so this holds for the whole session.
 */
async function identify(page, shopper) {
    await page.evaluate((user) => globalThis.__flare?.setUser(user), shopper).catch(() => {});
}

async function openHome(page, shopper) {
    await page.goto(`${baseUrl}/`, { waitUntil: 'load' });
    // The grid wrapper renders straight away with a "Loading catalog…" placeholder, so wait for a
    // real card. All three of its requests are one Promise.all: failing any leaves it on the placeholder.
    await page.waitForSelector(`[data-testid="${testIds.productCard('1')}"]`, { timeout: 15000 });

    await identify(page, shopper);

    await beat();
    await page.mouse.wheel(0, randomInt(300, 1200));

    // INP only exists if something is clicked, and the vitals are taken once when the pageload root
    // closes. So the click has to happen here, before the first navigation, or INP is never reported.
    if (Math.random() < 0.65) {
        await page.locator(`[data-testid="${testIds.addToCart(pick(normalProductIds))}"]`).click();
        await beat();
    }
}

async function openProduct(page, id) {
    await page
        .locator(`[data-testid="${testIds.productCard(id)}"] a`)
        .first()
        .click();
    await page.waitForSelector(`[data-testid="${testIds.addToCart(id)}"]`, { timeout: 15000 });
}

async function backToShop(page) {
    await page.getByRole('link', { name: 'Shop', exact: true }).click();
    await page.waitForSelector(`[data-testid="${testIds.productCard('1')}"]`, { timeout: 15000 });
}

async function addToCart(page, id) {
    await page
        .locator(`[data-testid="${testIds.addToCart(id)}"]`)
        .first()
        .click();
    await beat();
}

async function openCart(page) {
    await page.locator(`[data-testid="${testIds.cartCount}"]`).click();
    await page.getByRole('link', { name: 'Checkout' }).waitFor({ timeout: 15000 });
}

async function openCheckout(page) {
    await page.getByRole('link', { name: 'Checkout' }).click();
    await page.locator(`[data-testid="${testIds.checkoutSubmit}"]`).waitFor({ timeout: 15000 });
}

const journeys = {
    async bounce(page, shopper) {
        await openHome(page, shopper);
        await settle();
        await page.mouse.wheel(0, randomInt(400, 1500));
        await beat();
    },

    async browse(page, shopper) {
        await openHome(page, shopper);
        await settle();
        await openProduct(page, pick(normalProductIds));
        await settle();
        await backToShop(page);
        await settle();
        await openProduct(page, pick(normalProductIds));
        await settle();
    },

    async addToCart(page, shopper) {
        await openHome(page, shopper);
        await settle();
        const id = pick(normalProductIds);
        await openProduct(page, id);
        await beat();
        await addToCart(page, id);
        await settle();
        await openCart(page);
        await settle();
    },

    async checkoutSuccess(page, shopper) {
        await openHome(page, shopper);
        await settle();
        const id = pick(normalProductIds);
        await openProduct(page, id);
        await beat();
        await addToCart(page, id);
        await settle();
        await openCart(page);
        await settle();
        await openCheckout(page);
        await beat();
        await page.locator(`[data-testid="${testIds.checkoutSubmit}"]`).click();
        await page.waitForSelector(`[data-testid="${testIds.confirmation}"]`, { timeout: 15000 });
        await settle();
    },

    // The showcase error: product 7 comes back from the pricing service without a price, so
    // calculateOrderTotal throws a TypeError out of the submit handler.
    async checkoutFailure(page, shopper) {
        await openHome(page, shopper);
        await settle();
        await openProduct(page, PRICING_GAP_PRODUCT_ID);
        await beat();
        await addToCart(page, PRICING_GAP_PRODUCT_ID);
        await settle();
        await openCart(page);
        await settle();
        await openCheckout(page);
        await beat();
        await page.locator(`[data-testid="${testIds.checkoutSubmit}"]`).click();
        await settle();
    },
};

/**
 * Landing straight on a deep route, the way a visitor arrives from search, a shared link or a
 * bookmark. This is what fills the Core Web Vitals table: only a page LOAD carries vitals, so a
 * route that is ever only reached by clicking through the app shows dashes in every vitals column.
 *
 * Each one interacts without navigating first, because INP is only recorded before the first
 * navigation, and only then wanders off.
 */
const deepEntries = [
    {
        name: 'land-product',
        weight: 4,
        path: () => `/product/${pick(normalProductIds)}`,
        async run(page, shopper, path) {
            const id = path.split('/').pop();
            await page.waitForSelector(`[data-testid="${testIds.addToCart(id)}"]`, { timeout: 20000 });
            await identify(page, shopper);
            await beat();
            await page.mouse.wheel(0, randomInt(200, 700));
            await addToCart(page, id);
            await settle();
            if (Math.random() < 0.5) {
                await openCart(page);
                await settle();
            }
        },
    },
    {
        name: 'land-cart',
        weight: 2,
        path: () => '/cart',
        async run(page, shopper) {
            await page.getByRole('link', { name: 'Checkout' }).waitFor({ timeout: 20000 });
            await identify(page, shopper);
            await beat();
            await page.mouse.wheel(0, randomInt(100, 400));
            await settle();
            if (Math.random() < 0.6) {
                await openCheckout(page);
                await settle();
            }
        },
    },
    {
        name: 'land-checkout',
        weight: 2,
        path: () => '/checkout',
        async run(page, shopper) {
            await page.locator(`[data-testid="${testIds.checkoutSubmit}"]`).waitFor({ timeout: 20000 });
            await identify(page, shopper);
            await beat();
            // Focusing a field is a real interaction, and unlike Pay it cannot end the session early.
            await page.locator('input[name="name"]').click();
            await settle();
        },
    },
    {
        name: 'land-confirmation',
        weight: 1,
        path: () => '/confirmation',
        async run(page, shopper) {
            await page.getByRole('link', { name: 'Continue shopping' }).waitFor({ timeout: 20000 });
            await identify(page, shopper);
            await beat();
            await page.mouse.wheel(0, randomInt(50, 200));
            await settle();
        },
    },
];

const journeyWeights = [
    ['bounce', 25],
    ['browse', 30],
    ['addToCart', 20],
    ['checkoutSuccess', 15],
    ['checkoutFailure', 10],
];

const NO_THROTTLE = { offline: false, downloadThroughput: -1, uploadThroughput: -1, latency: 0 };

async function runSession(browser, label, chromeVersion) {
    const device = pickWeighted(devices.map((item) => [item, item.weight]));
    const network = pickWeighted(networks.map((item) => [item, item.weight]));
    const cpu = network.cpu ?? pickWeighted(cpuRates);
    const shopper = pick(shoppers);
    const deep = Math.random() < deepEntryShare ? pickWeighted(deepEntries.map((item) => [item, item.weight])) : null;
    const journeyName = deep ? deep.name : pickWeighted(journeyWeights);
    const startedAt = process.hrtime.bigint();

    const context = await browser.newContext({
        viewport: device.viewport,
        userAgent: device.userAgent(chromeVersion),
        isMobile: device.isMobile,
        hasTouch: device.isMobile,
        deviceScaleFactor: device.isMobile ? 3 : 1,
        // The playground reports to a locally signed flareapp.io.test.
        ignoreHTTPSErrors: true,
    });

    // A visitor landing on /cart or /checkout got there with something in the basket.
    if (deep) {
        const lines = [{ productId: pick(normalProductIds), quantity: randomInt(1, 2) }];
        await context.addInitScript(
            (value) => localStorage.setItem('flare-playground-cart', value),
            JSON.stringify(lines),
        );
    }

    let injected = null;
    let abandoned = false;

    try {
        const page = await context.newPage();

        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', {
            offline: false,
            downloadThroughput: network.downloadThroughput,
            uploadThroughput: network.uploadThroughput,
            latency: network.latency,
        });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });

        if (Math.random() < errorRate) {
            injected = await injectApiFailure(page);
        }

        try {
            if (deep) {
                const path = deep.path();
                await page.goto(`${baseUrl}${path}`, { waitUntil: 'load', timeout: 90000 });
                await deep.run(page, shopper, path);
            } else {
                await journeys[journeyName](page, shopper);
            }
        } catch (error) {
            // A failed request leaves the page stuck, so the rest of the journey cannot run. That is
            // what a real visitor hitting a broken page looks like, and the error was already
            // reported, so end the session here instead of throwing the whole thing away.
            if (!injected?.fired) {
                throw error;
            }
            abandoned = true;
        }

        // The vitals are already recorded by now, so drop the throttle rather than make the teardown
        // flush crawl over a 700ms-latency link.
        await cdp.send('Network.emulateNetworkConditions', NO_THROTTLE);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

        // pagehide is what flushes the late browser_web_vital span and the keepalive buffer.
        await page.goto('about:blank');
        await sleep(1800);
    } finally {
        await context.close();
    }

    const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    console.log(
        `${label} ${journeyName.padEnd(17)} ${device.name.padEnd(7)} ${network.name.padEnd(7)} cpu ${cpu}x  ${seconds.toFixed(1)}s${
            injected?.fired ? `  [failed ${injected.label}${abandoned ? ', abandoned' : ''}]` : ''
        }`,
    );

    return { journeyName, injected: Boolean(injected?.fired) };
}

async function main() {
    await preflight();

    // Held in an object so the worker loop below reads the SIGINT handler's update.
    const control = { stopping: false };
    process.on('SIGINT', () => {
        if (control.stopping) {
            process.exit(130);
        }
        control.stopping = true;
        console.log('\nFinishing the sessions in flight, ctrl-c again to kill.');
    });

    const browser = await chromium.launch({ headless: !values.headed });
    // "148.0.7778.96" -> "148.0.0.0", the shape Chrome itself reports since it froze the minor parts.
    const chromeVersion = `${browser.version().split('.')[0]}.0.0.0`;
    const counts = {};
    let injectedTotal = 0;
    let started = 0;
    const startedAt = Date.now();

    const workers = Array.from({ length: concurrency }, async (_, index) => {
        // Stagger the starts so the run does not open every browser at the same instant.
        await sleep(index * 1500);

        while (!control.stopping && (values.forever || started < totalSessions)) {
            const number = ++started;
            const label = values.forever ? `[${number}]` : `[${number}/${totalSessions}]`;

            try {
                const result = await runSession(browser, label, chromeVersion);
                counts[result.journeyName] = (counts[result.journeyName] ?? 0) + 1;
                if (result.injected) {
                    injectedTotal++;
                }
            } catch (error) {
                console.error(`${label} failed: ${error.message}`);
            }
        }
    });

    await Promise.all(workers);
    await browser.close();

    const minutes = ((Date.now() - startedAt) / 60000).toFixed(1);
    console.log(`\nDone in ${minutes} min.`);
    for (const [name, count] of Object.entries(counts).toSorted((a, b) => b[1] - a[1])) {
        console.log(`  ${name.padEnd(16)} ${count}`);
    }
    console.log(`  ${'api failures'.padEnd(16)} ${injectedTotal}`);
}

await main();
