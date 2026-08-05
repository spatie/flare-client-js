# Screenshot runbook

How to produce the eight images the JavaScript client docs need. Every playground is the same webshop
("Flare Pix"), loads its catalog over a mock `/api/*` and can throw one realistic checkout error, so the
reports and traces in the screenshots look like a real app rather than a test fixture.

Everything below was run against a local `flareapp.io.test` and the payloads checked, so the numbers and
span names are measured, not guessed.

## Setup

Each playground reads a gitignored `playgrounds/<framework>/.env.local`:

```
VITE_FLARE_KEY=<your project key>
VITE_FLARE_URL=https://flareapp.io.test/v1/errors
FLARE_UPLOAD_SOURCEMAPS=1
```

`VITE_FLARE_URL` is the error ingest path. Logs and traces are derived from it by the playground's
`flare.ts`, and the sourcemap plugin derives `https://flareapp.io.test/api/sourcemaps` from its origin.

Setting `VITE_FLARE_URL` also switches the playgrounds to their e2e timings: a root span idles out after
2 seconds and the buffer flushes every 500ms, so a trace shows up a few seconds after the page settles
instead of the 5 second production default.

### Three rules that decide whether the screenshots are usable

**1. Build and preview, do not use the dev server.** In `vite dev` every lazily imported module is a real
network request, so Vite's own `/@fs/...` and `/src/...` requests turn into `browser_fetch` spans and sit
in the middle of the waterfall. A production build has none of that. Measured on `/`: 4 spans from the
build, 12 from the dev server.

```bash
NODE_EXTRA_CA_CERTS="$HOME/.config/flare-local/valet-ca.pem" \
  npm run build --workspace=@flareapp/playgrounds-<framework>
npm run preview --workspace=@flareapp/playgrounds-<framework>
```

**2. Give node the Valet CA, or every sourcemap upload fails.** The upload runs in node, which has its
own certificate store and does not read the system keychain. Without the CA it dies with
`@flareapp/vite: Network error after 3 attempts: fetch failed`. The browser is unaffected, so errors and
traces still arrive while sourcemaps silently do not.

The CA that signed `flareapp.io.test` lives in the system keychain, and it is **not** the same
certificate as the one in Herd's config directory. Both carry the subject
`Laravel Valet CA Self Signed CN`, but they are different certificates:

```
system keychain   4E:8C:0E:A3:9C:6E:FD:A6:…   <- signed the certificate being served
Herd CA on disk   A8:71:D0:88:7C:1B:B3:E4:…   <- a regenerated CA, does not match
```

So pointing `NODE_EXTRA_CA_CERTS` at Herd's `config/valet/CA/LaravelValetCASelfSigned.pem` does not work
either: node finds a CA with the right name, fails the signature check, and reports
`CERT_SIGNATURE_FAILURE`. Export the keychain one instead, once:

```bash
mkdir -p ~/.config/flare-local
security find-certificate -a -c "Laravel Valet CA Self Signed CN" -p \
  /Library/Keychains/System.keychain > ~/.config/flare-local/valet-ca.pem
```

Verify it before relying on it. `Verify return code: 0 (ok)` means node will accept it too:

```bash
echo | openssl s_client -connect flareapp.io.test:443 -servername flareapp.io.test \
  -CAfile ~/.config/flare-local/valet-ca.pem 2>/dev/null | grep "Verify return code"
```

`NODE_TLS_REJECT_UNAUTHORIZED=0` also gets the upload through, but it turns off certificate checking for
the whole node process. Prefer the CA.

**3. Navigate by clicking, never by reloading.** Glows live in the page's scope, so a `page reload` or a
typed URL throws away the breadcrumb trail. Walking the journey with clicks gives the report all three
glows; jumping straight to `/checkout` gives it one.

### Ports

| Framework    | Port | Notes                                |
| ------------ | ---- | ------------------------------------ |
| js           | 5180 | Vanilla TypeScript, no components    |
| react        | 5181 | TanStack Router, `withFlareProfiler` |
| vue          | 5182 | vue-router, `profileComponents`      |
| svelte       | 5183 | SvelteKit, `withFlareConfig`         |
| react-router | 5185 | React Router v7 data mode            |

## What the app produces

**Page load of `/`** fires three parallel requests, deliberately different lengths so the waterfall has
shape. Measured from the js production build:

```
browser_pageload   /                          197ms
  browser_fetch    GET /api/products          184ms
  browser_fetch    GET /api/recommendations    92ms
  browser_fetch    POST /api/cart/summary      63ms
```

The React build adds 15 `browser_component` spans to that same root: `Layout`, `ProductsPage`,
`ProductGrid`, and one `ProductCard` per product.

**Clicking a product** opens a `browser_navigation` root named after the route pattern, with the detail
and recommendation requests under it:

```
browser_navigation /product/$id               127ms
  browser_fetch    GET /api/products/p01      123ms
  browser_fetch    GET /api/recommendations    93ms
```

**The checkout error.** `POST /api/cart/summary` answers without a price for one product, `Studio Still`
(`p07`), as if the pricing service had a gap. The cart page renders that as "Price unavailable", but
`calculateOrderTotal` trusts the contract, so paying throws:

```
TypeError: Cannot read properties of undefined (reading 'amountCents')
    at lineTotalCents      playgrounds/shared/src/checkout/pricing.ts:2
    at calculateOrderTotal playgrounds/shared/src/checkout/pricing.ts:3
    at buildOrderSummary   playgrounds/shared/src/checkout/order.ts:4
    at placeOrder          playgrounds/shared/src/checkout/order.ts:7
    at <the checkout page's submit handler>
```

The report carries the signed-in shopper (`user.id`, `user.email`, `user.full_name`, `user.attributes`)
and the three glows with their context: `Viewed product`, `Added product to cart`, `Opened checkout`.

Any other product checks out cleanly, which is why the e2e happy path still passes.

## The images

### `docs/javascript/error-detail.png`

_An error report in Flare showing the message, stack trace, and browser context._

Build and preview the js playground, then at <http://localhost:5180>:

1. Click **Studio Still** to open its detail page.
2. Click **Add to cart**.
3. Click **Cart** in the header, then the **Checkout** link, then **Pay**.

Clicking through in that order is what fills the breadcrumbs. The report lands within a second.

### `docs/javascript/sourcemaps-original-source.png`

_A stack trace in Flare showing the original, unminified source code._

Same steps. The build already uploaded the maps (it logs `@flareapp/vite: Successfully uploaded all
sourcemaps to Flare.`), and because the reporting build is the uploading build the version ids match. The
frames resolve back to `pricing.ts` and `order.ts`.

### `docs/javascript/trace-waterfall.png`

_A trace waterfall showing a page load span with several fetch spans nested inside it._

1. Open <http://localhost:5180>.
2. Leave the page alone for about four seconds so the root idles out and flushes.
3. The trace is one `browser_pageload` with the three request spans under it, and nothing else.

### `docs/javascript/component-tree.png`

_A trace waterfall in Flare showing component mount spans nested under a page load._

The vanilla playground has no components, so take this one from React: build and preview it, open
<http://localhost:5181>, wait four seconds. The tree is `Layout` > `ProductsPage` > `ProductGrid` >
`ProductCard` (twelve of them).

### `docs/react/navigation-trace.png`, `docs/vue/…`, `docs/svelte/…`

_A trace waterfall in Flare showing a browser_navigation span named after a route pattern._

1. Build and preview the framework's playground, open its port.
2. Wait about four seconds so the page load trace flushes and the navigation gets its own root.
3. Click any product, then wait another four seconds.

The navigation root is named after the route pattern, not the URL:

| Playground   | Root name       |
| ------------ | --------------- |
| react        | `/product/$id`  |
| vue          | `/product/:id`  |
| svelte       | `/product/[id]` |
| react-router | `/product/:id`  |

### `docs/react/component-spans.png`, `docs/vue/…`, `docs/svelte/…`

_A trace waterfall in Flare showing component mount spans nested under a page load._

Same as `component-tree.png`, once per framework. The profiled names are aligned across all four, so the
three screenshots show the same tree:

| Playground   | Where profiling is configured             |
| ------------ | ----------------------------------------- |
| react        | `withFlareProfiler(...)` per component    |
| react-router | `withFlareProfiler(...)` per component    |
| vue          | `profileComponents` in `src/main.ts`      |
| svelte       | `profileComponents` in `svelte.config.js` |

## Resetting

The cart lives in `localStorage` under `flare-playground-cart`. Clear site data between runs so the cart
line count in the screenshots is not the leftovers of the previous attempt.
